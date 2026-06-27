/* 貢獻註記 */
let contributionAnnotation = "部分程式內容由 [@mm-news](https://github.com/mm-news) 以 [CC BY 4.0 License](https://creativecommons.org/licenses/by/4.0/) 貢獻";

/* 0. 頁面狀態（History API） */
function pushPage(name) {
    history.pushState({ page: name }, '');
}

window.addEventListener('popstate', function(e) {
    const page = e.state?.page;
    if (page === 'form') {
    document.getElementById('formArea').style.display = 'none';
    document.getElementById('date').disabled = false;
    document.getElementById('menuArea').style.display = 'flex';
    } else if (page === 'records') {
    document.getElementById('recordsArea').style.display = 'none';
    document.getElementById('recordsList').style.display = 'block';
    document.getElementById('recordDetailArea').style.display = 'none';
    document.getElementById('menuArea').style.display = 'flex';
    } else if (page === 'recordDetail') {
    document.getElementById('recordDetailArea').style.display = 'none';
    document.getElementById('recordsList').style.display = 'block';
    } else if (page === 'editForm') {
    // 修改模式中按返回鍵：視同放棄修改，回到紀錄列表
    document.getElementById('formArea').style.display = 'none';
    document.getElementById('date').disabled = false;
    clearDraft();
    window._originalRecord = null;
    window._editingDate = null;
    showRecords(true);
    } else if (page === 'menu') {
        // 已在選單，不做事
    }
});

/* 1. 常數與全域變數 */
const GAS_URL = 'https://script.google.com/macros/s/AKfycby-nBw6O7YdUrXTOZ-2WR4A1o8FP68iwhVgmOOa1WbSWFlo_QLv6jUIjlbWH7S6dHrb/exec';
const CLIENT_ID = '311035173241-nuamoemc7al4bhlp5p0nploepd6rg23h.apps.googleusercontent.com';

const MAX_DESC_LEN = 200;
const MAX_TEACHER_LEN = 30;

class PackagedUserInfo {
    #userEmail;
    #userFillerInfo;
    #club;
    #fillerName;
    constructor(email, fillerInfo, club, fillerName) {
    this.#userEmail = email;
    this.#userFillerInfo = fillerInfo;
    this.#club = club;
    this.#fillerName = fillerName;
    }

    get userEmail() {
    return this.#userEmail;
    }

    get userFillerInfo() {
    return this.#userFillerInfo;
    }

    get club() {
    return this.#club;
    }

    get fillerName() {
    return this.#fillerName;
    }
}

window.packagedInformation = undefined;
let canvas, ctx, isDrawing = false, hasSigned = false, isCanvasSized = false;
let allStudents = [];

const DRAFT_KEY = 'attendanceDraft';

/* 2. 底層工具函式 */
/* 2-1. GAS API Helper */
async function gasPost(body) {
    const res = await fetch(GAS_URL, {
    method: 'POST',
    body: JSON.stringify(body)
    });
    return res.json();
}

/* 2-2. 報錯工具 */
function showError(msg) {
    const area = document.getElementById('loadingArea');
    area.innerHTML = '';
    const div = document.createElement('div');
    div.style.cssText = 'color:var(--red);font-size:.95rem;';
    div.textContent = msg;
    area.appendChild(div);
}

/* 2-3. 社員身分判斷 */
function isOfficer(remark) {
    return remark !== '社員' && remark !== '外部登入_社員';
}

/* 2-4. 檢查表單是否有變動 */
function checkIfFormChanged() {
    if (!window._originalRecord) return;

    const descEl = document.getElementById('desc');
    const teacherPresentEl = document.getElementById('teacherPresent');
    const subTeacherEl = document.getElementById('subTeacher');

    const currentDesc = descEl.value.trim();
    const currentTeacherPresent = teacherPresentEl.value;
    const currentSubTeacher = subTeacherEl.value.trim() || '無';

    // 計算目前勾選完後的缺席名單字串
    const checkboxes = getStudentCheckboxes();
    let absentList = [];
    checkboxes.forEach(cb => {
    if (!cb.checked) absentList.push(cb.value);
    });
    const currentAbsentList = absentList.length > 0 ? absentList.join('\n') : '全勤';

    // 檢查簽名是否有變動過
    const isSignatureChanged = !window._keepOriginalSignature;

    // 比對所有欄位是否跟原始資料一模一樣
    const hasChanged = 
    currentDesc !== window._originalRecord.desc ||
    currentTeacherPresent !== window._originalRecord.teacherPresent ||
    currentSubTeacher !== window._originalRecord.subTeacher ||
    currentAbsentList !== (window._originalRecord.absentList || '全勤') ||
    isSignatureChanged;

    // 如果目前在修改模式，就根據「有沒有改過」來控制按鈕鎖定狀態
    const btn = document.getElementById('submitBtn');
    if (btn && btn.textContent === '確認修改') {
    btn.disabled = !hasChanged;
    }
}

/* 2-5. 取得所有點名checkbox */
function getStudentCheckboxes() {
    return document.querySelectorAll('.student-cb');
}

/* 3. 草稿管理 */
/* 3-1. 儲存草稿 */
function getDraftMode() {
    // 區分「新增點名」與「修改特定日期紀錄」，避免草稿互相污染
    return window._editingDate ? ('edit_' + window._editingDate) : 'new';
}

function saveDraft() {
    const draft = {
    mode: getDraftMode(),
    date: document.getElementById('date').value,
    desc: document.getElementById('desc').value,
    teacherPresent: document.getElementById('teacherPresent').value,
    subTeacher: document.getElementById('subTeacher').value,
    signature: hasSigned ? canvas.toDataURL('image/png') : '',
    absentIds: Array.from(getStudentCheckboxes())
    .filter(cb => !cb.checked)
    .map(cb => cb.id)
    };
    try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch (e) {
    // 容量超出或寫入失敗時，不讓整個流程中斷，僅放棄這次草稿儲存
    console.warn('草稿儲存失敗：', e);
    }
    if (window._originalRecord) checkIfFormChanged();
}

/* 3-2. 清除填答內容 */
function clearDraft() {
    localStorage.removeItem(DRAFT_KEY);
}

/* 3-3. 還原草稿 */
function restoreDraftIfExists() {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return;

    let draft;
    try { draft = JSON.parse(raw); } catch (e) { clearDraft(); return; }

    // 情境不符（例如草稿是上次修改某天的紀錄，但現在是新增點名 / 修改另一天）
    // 直接視為過期草稿，靜默清除，不要誤套用到目前畫面
    if (draft.mode !== getDraftMode()) {
    clearDraft();
    return;
    }

    if (!confirm('偵測到上次未送出的內容，要還原嗎？')) {
    clearDraft();
    return;
    }

    if (draft.date) document.getElementById('date').value = draft.date;
    if (draft.desc) {
    document.getElementById('desc').value = draft.desc;
    updateCharCounter(document.getElementById('desc'), 'descCounter', 200);
    }
    if (draft.teacherPresent) {
    document.getElementById('teacherPresent').value = draft.teacherPresent;
    toggleSubTeacher();
    }
    if (draft.subTeacher) document.getElementById('subTeacher').value = draft.subTeacher;

    if (Array.isArray(draft.absentIds)) {
    draft.absentIds.forEach(id => {
    const cb = document.getElementById(id);
    if (cb) cb.dispatchEvent(new Event('__noop')); // 佔位，避免 lint，可省略
    });
    getStudentCheckboxes().forEach(cb => {
    cb.checked = !draft.absentIds.includes(cb.id);
    cb.dispatchEvent(new Event('change'));
    });
    }

    if (draft.signature) {
    const img = new Image();
    img.onload = () => {
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    hasSigned = true;
    document.getElementById('sigStatus').style.display = 'block';
    };
    img.src = draft.signature;
    }
}

/* 4. UI 小工具 */
/* 4-1. 日期計算機 */
function initDatePicker() {
    const input = document.getElementById('date');
    const today = new Date();
    const tz = today.getTimezoneOffset() * 60000;
    const max = new Date(today.getTime() - tz).toISOString().split('T')[0];
    const min = new Date(today.getTime() - 4 * 86400000 - tz).toISOString().split('T')[0];
    input.max = max;
    input.min = min;
    input.value = max;
}

/* 4-2. 代課老師顯示切換 */
function toggleSubTeacher() {
    const present = document.getElementById('teacherPresent').value;
    const grp = document.getElementById('subTeacherGroup');
    const inp = document.getElementById('subTeacher');
    if (present === '否') {
    grp.style.display = 'block';
    } else {
    grp.style.display = 'none';
    inp.value = '無';
    }
}

/* 4-3. 字元計數器 */
function updateCharCounter(el, counterId, max) {
    const len = el.value.length;
    const counter = document.getElementById(counterId);
    counter.textContent = len + ' / ' + max;
    counter.classList.toggle('warn', len >= max * 0.9);
}

/* 4-4. 切換帳號/登出 */
function switchAccount() {
    localStorage.removeItem('cachedUserInfo');
    google.accounts.id.disableAutoSelect();
    location.reload();
}

/* 5. 簽名板功能 */
/* 5-1. 初始化 Canvas */
function initCanvas() {
    canvas = document.getElementById('sigCanvas');
    ctx = canvas.getContext('2d');

    let canvasRect = null;

    const getPos = (e) => {
    const src = e.touches ? e.touches[0] : e;
    return { x: src.clientX - canvasRect.left, y: src.clientY - canvasRect.top };
    };
    const start = (e) => {
    isDrawing = true;
    window._keepOriginalSignature = false;
    canvasRect = canvas.getBoundingClientRect();
    draw(e);
    };
    const stop = () => { isDrawing = false; ctx.beginPath(); };
    const draw = (e) => {
    if (!isDrawing) return;
    e.preventDefault();
    hasSigned = true;
    const p = getPos(e);
    ctx.lineWidth = 2.5; ctx.lineCap = 'round';
    ctx.lineTo(p.x, p.y); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(p.x, p.y);
    };

    canvas.addEventListener('mousedown', start);
    canvas.addEventListener('mousemove', draw);
    canvas.addEventListener('mouseup', stop);
    canvas.addEventListener('touchstart', start, { passive: false });
    canvas.addEventListener('touchmove', draw, { passive: false });
    canvas.addEventListener('touchend', stop);
}

/* 5-2. 開啟簽名 Modal */
function openSigModal() {
    document.getElementById('sigModal').classList.add('open');
    if (!isCanvasSized) {
    canvas.width = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;
    isCanvasSized = true;
    }
}

/* 5-3. 清除簽名 */
function clearCanvas() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    hasSigned = false;
    window._keepOriginalSignature = false;
    if (window._originalRecord) checkIfFormChanged();
}

/* 5-4. 關閉簽名 Modal */
function closeSigModal() {
    document.getElementById('sigModal').classList.remove('open');
    if (!window._keepOriginalSignature) {
    document.getElementById('sigStatus').textContent = '✅ 已完成簽名';
    }
    document.getElementById('sigStatus').style.display = hasSigned ? 'block' : 'none';
    saveDraft();
}

/* 6. 登入流程 */
/* 6-1-1. 初始化 Google Sign-In */
function initGoogleSignIn() {
    google.accounts.id.initialize({
    client_id: CLIENT_ID,
    callback: handleGoogleCredential,
    auto_select: true,
    cancel_on_tap_outside: false
    });
    showLoginButton();
    initDatePicker();
}

/* 6-1-2. 顯示登入按鈕 */
function showLoginButton() {
    const raw = localStorage.getItem('cachedUserInfo');
    if (raw) {
    try {
        const cached = JSON.parse(raw);
        const now = Date.now();
        const CACHE_TTL = 14 * 24 * 60 * 60 * 1000; // 兩周
        if (cached._ts && (now - cached._ts) < CACHE_TTL) {
        renderForm(cached);
        fetchUserInfo(cached.email);
        return;
        }
    } catch (e) { /* 快取損毀，清除 */ }
    localStorage.removeItem('cachedUserInfo');
    }
    document.getElementById('loadingArea').style.display = 'none';
    document.getElementById('loginArea').style.display = 'block';
    google.accounts.id.renderButton(
    document.getElementById('g_id_signin'),
    { theme: 'outline', size: 'large', locale: 'zh-TW', text: 'signin_with' }
    );
}

/* 6-1-3. 處理 Google 登入回傳 */
async function handleGoogleCredential(response) {
    window.googleToken = response.credential; // 把 Token 存起來
    document.getElementById('loginArea').style.display = 'none';
    document.getElementById('loadingArea').style.display = 'block';
    try {
    const base64 = response.credential.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(base64));
    const email = payload.email;
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    showError('無效的帳號格式，請重試。');
    return;
    }
    await fetchUserInfo(email);
    } catch (e) {
    showError('登入憑證解析失敗，請重試。');
    }
}

/* 6-1-4. 從 GAS 取得使用者資訊 */
async function fetchUserInfo(email) {
    try {
    const res = await gasPost({ action: 'getLoginUser', email });
    handleUserInfo(res, email);
    } catch (err) {
    showError('無法連線至伺服器，請稍後再試。');
    }
}

/* 6-1-5. 處理使用者資訊 */
function handleUserInfo(info, email) {
    document.getElementById('loadingArea').style.display = 'none';

    if (info.needManualLogin) {
    document.getElementById('teacherAuthArea').style.display = 'block';
    if (info.defaultEmail) document.getElementById('teacherEmail').value = info.defaultEmail;
    return;
    }
    if (info.error) { showError('驗證失敗，請重新整理頁面再試。'); return; }
    renderForm(info);
}

/* 6-2. 外部登入 */
async function submitTeacherAuth() {
    const email = document.getElementById('teacherEmail').value.trim();
    const password = document.getElementById('teacherPassword').value.trim();
    const club = document.getElementById('testClub').value.trim();
    const identity = document.getElementById('testIdentity').value;

    if (!email || !password || !club) { alert('錯誤: 請完整填寫所有欄位！'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { alert('錯誤: Email 格式不正確！'); return; }
    if (club.length > 30) { alert('錯誤: 社團名稱過長！'); return; }

    const btn = document.getElementById('teacherAuthBtn');
    btn.disabled = true; btn.textContent = '驗證中…';

    try {
    const res = await gasPost({ action: 'verifyTestLogin', email, password, club, identity });
    btn.disabled = false; btn.textContent = '登入';
    if (res.error) { alert('❌ ' + res.msg); return; }
    document.getElementById('teacherAuthArea').style.display = 'none';
    renderForm(res);
    } catch (err) {
    btn.disabled = false; btn.textContent = '登入';
    alert('連線失敗，請稍後再試。');
    }
}

/* 7. 主頁面邏輯 */
/* 7-1. 渲染表單 */
function renderForm(info) {
    const toCache = Object.assign({}, info, { _ts: Date.now() });
    try {
    localStorage.setItem('cachedUserInfo', JSON.stringify(toCache));
    } catch (e) {
    console.warn('使用者資訊快取寫入失敗：', e);
    }

    window._loginInfo = info;

    let userFillerInfo = (info.remark || '') + '-' + (info.class || '') + ' ' + (info.no || '') + ' ' + (info.name || '');
    const tempPackagedInformation = Object.freeze(
    new PackagedUserInfo(info.email || '', userFillerInfo, info.club || '', info.name || '')
    );

    Object.defineProperty(window, "packagedInformation", {
    value: tempPackagedInformation, writable: false, configurable: false, enumerable: true,
    });

    document.getElementById('menuArea').style.display = 'flex';
    history.replaceState({ page: 'menu' }, '');
    document.getElementById('btnNewForm').style.display =
    isOfficer(info.remark) ? 'flex' : 'none';
}

/* 7-2. 顯示新表單 */
function showNewForm() {
    window._originalRecord = null;
    window._editingDate = null;
    document.getElementById('submitBtn').disabled = false;

    document.getElementById('menuArea').style.display = 'none';
    document.getElementById('menuArea').style.display = 'none';
    pushPage('form');
    document.getElementById('formArea').style.display = 'block';
    document.getElementById('date').disabled = false;

    const info = window._loginInfo;
    document.getElementById('club').value = info.club || '';
    document.getElementById('fillerName').value = info.name || '';
    document.getElementById('fillerInfo').value = (info.remark || '') + '-' + (info.class || '') + ' ' + (info.no || '') + ' ' + (info.name || '');
    document.getElementById('identityClubName').value = (info.clubId || '') + ' ' + (info.club || '');
    document.getElementById('identityWriter').value = (info.remark || '') + ' ' + (info.name || '');

    document.getElementById('submitBtn').textContent = '確認送出';
    document.getElementById('submitBtn').onclick = submitForm;
    document.getElementById('formFooterLink').textContent = '返回';
    document.getElementById('formFooterLink').onclick = function() {
    document.getElementById('formArea').style.display = 'none';
    document.getElementById('menuArea').style.display = 'flex';
    return false;
    };

    initCanvas();
    loadStudents(info.club);
}

/* 8. 名單與送出 */
/* 8-1-1. 載入社團名單 */
async function loadStudents(clubName) {
    try {
    const students = await gasPost({ action: 'getClubMembers', clubName });
    renderStudents(students);
    } catch (err) {
    document.getElementById('studentList').textContent = '名單載入失敗，請重新整理。';
    }
}

/* 8-1-2. 渲染社團名單 */
function renderStudents(students) {
    allStudents = students;
    const listDiv = document.getElementById('studentList');
    listDiv.innerHTML = '';

    if (!students || students.length === 0) {
    listDiv.textContent = '找不到該社團名單，請聯絡社活組。';
    return;
    }

    students.forEach(s => {
    const text = `${s.class} ${s.no} ${s.name}`;
    const item = document.createElement('div');
    item.className = 'student-item';

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'student-cb';
    cb.value = text;
    cb.id = 'cb_' + s.id;
    cb.addEventListener('change', () => {
    item.classList.toggle('present', cb.checked);
    updateCount();
    saveDraft(); 
    });

    const lbl = document.createElement('label');
    lbl.htmlFor = cb.id;
    lbl.textContent = text;   // ★ textContent，非 innerHTML

    item.appendChild(cb);
    item.appendChild(lbl);
    listDiv.appendChild(item);
    });

    updateCount();
    restoreDraftIfExists();
}

/* 8-1-3. 即時顯示出席人數 */
function updateCount() {
    const total = allStudents.length;
    const present = document.querySelectorAll('.student-cb:checked').length;
    document.getElementById('attendCount').textContent = `（出席 ${present} / ${total} 人）`;
}

/* 8-2. 送出表單 */
async function submitForm() {
    const btn = document.getElementById('submitBtn');

    const descEl = document.getElementById('desc');
    const desc = descEl.value.trim();

    if (!desc) { alert('錯誤: 請填寫社課內容簡述！'); return; }
    if (desc.length > MAX_DESC_LEN) { alert(`錯誤: 社課內容不可超過 ${MAX_DESC_LEN} 字！`); return; }
    if (!hasSigned) { alert('錯誤: 請完成老師簽名！'); return; }

    const subTeacherEl = document.getElementById('subTeacher');
    const subTeacherVal = subTeacherEl.value.trim() || '無';
    if (subTeacherVal.length > MAX_TEACHER_LEN) {
    alert(`錯誤: 代課老師姓名不可超過 ${MAX_TEACHER_LEN} 字！`);
    return;
    }

    const dateInput = document.getElementById('date');
    const dateVal = dateInput.value;
    if (!dateVal || (!dateInput.disabled && (dateVal < dateInput.min || dateVal > dateInput.max))) {
    alert('錯誤: 日期超出允許範圍！');
    return;
    }

    const checkboxes = getStudentCheckboxes();
    let absentList = [];
    let presentCount = 0;

    checkboxes.forEach(cb => {
    if (cb.checked) presentCount++;
    else absentList.push(cb.value);
    });

    const data = {
    token: window.googleToken,
    email: window.packagedInformation.userEmail,
    fillerInfo: window.packagedInformation.userFillerInfo,
    club: window.packagedInformation.club,
    date: dateVal,
    fillerName: window.packagedInformation.fillerName,
    desc: desc,
    teacherPresent: document.getElementById('teacherPresent').value === '是' ? '是' : '否',
    subTeacher: subTeacherVal,
    presentCount: presentCount,
    absentList: absentList.length > 0 ? absentList.join('\n') : '全勤',
    signature: window._keepOriginalSignature ? 'KEEP' : (hasSigned ? canvas.toDataURL('image/png') : '')
    };

    btn.disabled = true;
    btn.textContent = '資料傳送中，請勿關閉網頁…';

    try {
    const res = await gasPost({ action: 'submitAttendance', data });
    if (res === 'SUCCESS' || res?.status !== 'error') {
        alert('✅ 送出成功！');
        btn.disabled = false;
        btn.textContent = '確認送出';
        document.getElementById('formArea').style.display = 'none';
        document.getElementById('date').disabled = false;   // 如果是修改模式進來的，記得解鎖日期欄
        clearDraft();                                    // 如果你做了上一步的草稿快取，順手清掉
        window._originalRecord = null;
        window._editingDate = null;
        showRecords(true);
    } else {
        alert('送出失敗：' + (res.message || '未知錯誤'));
        btn.disabled = false;
        btn.textContent = '確認送出';
    }
    } catch (err) {
    alert('連線失敗，請稍後再試。');
    btn.disabled = false;
    btn.textContent = '確認送出';
    }
} 

/* 9. 查看紀錄 */
/* 9-1. 顯示紀錄列表 */
async function showRecords(skipPush) {
    document.getElementById('menuArea').style.display = 'none';
    if (!skipPush) pushPage('records');
    document.getElementById('recordsArea').style.display = 'block';
    document.getElementById('recordsLoading').style.display = 'block';
    document.getElementById('recordsList').innerHTML = '';
    const info = window._loginInfo;

    if (isOfficer(info.remark)) {
    const list = await gasPost({ action: 'getAttendanceList', club: info.club });
    document.getElementById('recordsLoading').style.display = 'none';
    if (!Array.isArray(list)) { document.getElementById('recordsList').textContent = '讀取失敗，請稍後再試。'; return; }
    renderOfficerRecordList(list);
    document.getElementById('recordsBackLink').style.display = 'block';
    } else {
    const identity = `${info.class} ${info.no} ${info.name}`;
    const list = await gasPost({ action: 'getMyAttendance', club: info.club, identity });
    document.getElementById('recordsLoading').style.display = 'none';
    if (!Array.isArray(list)) { document.getElementById('recordsList').textContent = '讀取失敗，請稍後再試。'; return; }
    renderMemberRecordList(list);
    document.getElementById('recordsBackLink').style.display = 'block';
    }
}

/* 9-2. 返回選單 */
function renderOfficerRecordList(list) {
    const div = document.getElementById('recordsList');
    div.innerHTML = '';
    if (!list.length) { div.textContent = '尚無點名紀錄。'; return; }

    list.forEach(r => {
    const item = document.createElement('div');
    item.className = 'record-item';
    item.textContent = `${r.date}（填寫人：${r.fillerName}）`;
    item.onclick = () => showRecordDetail(r.date);
    div.appendChild(item);
    });
}

/* 9-3. 顯示個人出缺列表 */
function renderMemberRecordList(list) {
    const div = document.getElementById('recordsList');
    div.innerHTML = '';
    if (!list.length) { div.textContent = '尚無點名紀錄。'; return; }

    list.forEach(r => {
    const item = document.createElement('div');
    item.className = 'record-item';
    item.textContent = `${r.date}：${r.status}`;
    item.style.color = r.status === '缺席' ? '#c00' : '#137333';
    div.appendChild(item);
    });
}

/* 9-4. 顯示紀錄詳細資訊 */
async function showRecordDetail(date) {
    const info = window._loginInfo;

    document.getElementById('recordsList').style.display = 'none';
    document.getElementById('recordsBackLink').style.display = 'none';
    pushPage('recordDetail');
    const detailDiv = document.getElementById('recordDetailArea');
    detailDiv.style.display = 'block';
    detailDiv.innerHTML = `<div style="text-align:center;padding:24px 0;color:var(--gray-500);"><div class="spinner" style="margin:0 auto 10px;"></div>載入中…</div>`;
    const r = await gasPost({ action: 'getAttendanceDetail', club: info.club, date });

    if (r.status === 'error') {
    alert(r.message || '讀取失敗');
    detailDiv.style.display = 'none';
    document.getElementById('recordsList').style.display = 'block';
    return;
    }

    detailDiv.innerHTML = `
    <div class="detail-card">
        <div class="detail-row"><span class="detail-label">社課日期</span><span>${r.date}</span></div>
        <div class="detail-row"><span class="detail-label">填寫人</span><span>${r.fillerName}</span></div>
        <div class="detail-row"><span class="detail-label">社課內容</span><span>${r.desc}</span></div>
        <div class="detail-row"><span class="detail-label">老師出席</span><span>${r.teacherPresent}（代課：${r.subTeacher}）</span></div>
        <div class="detail-row"><span class="detail-label">實到人數</span><span>${r.presentCount} 人</span></div>
        <div class="detail-row detail-row-absent">
        <span class="detail-label">缺席名單</span>
        <div class="absent-box">${r.absentList}</div>
        </div>
    </div>
    ${r.editable ? `<button class="btn btn-primary" id="editRecordBtn" style="margin-top:14px;">✏️ 修改點名紀錄</button>` : ''}
    <p style="text-align:center;margin-top:10px;">
        <a href="#" onclick="backToDetailList(); return false;"
        style="font-size:.78rem;color:var(--gray-500);text-decoration:underline;">返回</a>
    </p>
    `;

    if (r.editable) {
    document.getElementById('editRecordBtn').onclick = () => enterEditMode(r);
    }
}

/* 9-5. 返回紀錄清單 */
function backToDetailList() {
    document.getElementById('recordDetailArea').style.display = 'none';
    document.getElementById('recordsList').style.display = 'block';
    document.getElementById('recordsBackLink').style.display = 'block';
}

/* 9-6. 進入修改模式 */
function enterEditMode(record) {
    clearDraft();
    window._editingDate = record.date;
    document.getElementById('recordsArea').style.display = 'none';
    document.getElementById('recordDetailArea').style.display = 'none';
    document.getElementById('formArea').style.display = 'block';
    pushPage('editForm');

    const info = window._loginInfo;
    document.getElementById('club').value = info.club || '';
    document.getElementById('identityClubName').value = (info.clubId || '') + ' ' + (info.club || '');
    document.getElementById('identityWriter').value = (info.remark || '') + ' ' + (info.name || '');
    document.getElementById('date').value = record.date;
    document.getElementById('date').disabled = true;
    document.getElementById('desc').value = record.desc;
    document.getElementById('teacherPresent').value = record.teacherPresent;
    toggleSubTeacher();
    document.getElementById('subTeacher').value = record.subTeacher;

    // 缺席勾選還原
    loadStudents(info.club).then(() => {
    const absentSet = new Set(String(record.absentList || '').split('\n'));
    getStudentCheckboxes().forEach(cb => {
    cb.checked = !absentSet.has(cb.value);
    cb.dispatchEvent(new Event('change'));
    });
    window._originalRecord = record;
    checkIfFormChanged();
    });

    initCanvas();
    hasSigned = true;
    window._keepOriginalSignature = true;
    const sigStatus = document.getElementById('sigStatus');
    sigStatus.textContent = '✅ 使用原有簽名（重新簽名可覆蓋）';
    sigStatus.style.display = 'block';

    document.getElementById('submitBtn').textContent = '確認修改';
    document.getElementById('submitBtn').onclick = submitForm;
    document.getElementById('formFooterLink').textContent = '放棄修改';
    document.getElementById('formFooterLink').onclick = function() {
    document.getElementById('formArea').style.display = 'none';
    document.getElementById('date').disabled = false;
    window._originalRecord = null;
    window._editingDate = null;
    showRecords(true);
    return false;
    };
}

/* 10. 返回選單 */
/* 10-1. 返回主選單（點返回） */
function backToMenu() {
document.getElementById('recordsArea').style.display = 'none';
document.getElementById('recordsList').style.display = 'block';
document.getElementById('recordDetailArea').style.display = 'none';
document.getElementById('menuArea').style.display = 'flex';
}

/* 10-2. 回到主選單（點 header） */
function goHome() {
    const menu = document.getElementById('menuArea');
    if (!menu || menu.style.display === 'none') return; // 還沒登入就不動
    
    const areas = ['formArea', 'recordsArea', 'recordDetailArea'];
    areas.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
    });
    document.getElementById('recordsList').style.display = 'block';
    document.getElementById('date').disabled = false;
    menu.style.display = 'flex';
}

/* 貢獻註記 */
let contributionAnnotation = "部分程式內容由 [@mm-news](https://github.com/mm-news) 以 [CC BY 4.0 License](https://creativecommons.org/licenses/by/4.0/) 貢獻";

// ==========================================
// 0. 全域常數與系統設定
// ==========================================
// 指向 Google 雲端試算表後台的 API 網址，用於讀寫資料
const GAS_URL = 'https://script.google.com/macros/s/AKfycby-nBw6O7YdUrXTOZ-2WR4A1o8FP68iwhVgmOOa1WbSWFlo_QLv6jUIjlbWH7S6dHrb/exec';
// 用於 Google 帳號登入驗證的用戶端識別碼 (Client ID)
const CLIENT_ID = '311035173241-nuamoemc7al4bhlp5p0nploepd6rg23h.apps.googleusercontent.com';

const MAX_DESC_LEN = 200;    // 社課內容簡述最大字數
const MAX_TEACHER_LEN = 30;   // 代課老師姓名最大字數
const DRAFT_KEY = 'attendanceDraft'; // 暫存草稿在瀏覽器內的金鑰名稱

// 封裝登入使用者資訊的類別，保護內部變數不被外部隨意修改
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
    get userEmail() { return this.#userEmail; }
    get userFillerInfo() { return this.#userFillerInfo; }
    get club() { return this.#club; }
    get fillerName() { return this.#fillerName; }
}

window.packagedInformation = undefined; // 全域唯讀的使用者封裝資訊
let canvas, ctx, isDrawing = false, hasSigned = false, isCanvasSized = false; // 簽名板相關變數
let allStudents = []; // 暫存當前社團的所有學生名單

// ==========================================
// 1. 頁面切換與路由 (Browser History API)
// ==========================================

/**
 * 核心網頁畫面渲染器
 * 根據目前的「狀態名稱」顯示對應的 HTML 區塊，並隱藏其他不相關的區域。
 * 這能確保在點選返回或重新整理時，不會顯示多個畫面或出現空白。
 */
function renderPage(page, state) {
    // 預先隱藏所有頁面區塊
    const areas = ['loadingArea', 'loginArea', 'teacherAuthArea', 'menuArea', 'formArea', 'recordsArea'];
    areas.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });

    if (page === 'menu') {
        // 顯示主選單畫面
        document.getElementById('menuArea').style.display = 'flex';
        // 清空修改模式暫存，重置日期欄位
        window._originalRecord = null;
        window._editingDate = null;
        document.getElementById('date').disabled = false;
    } else if (page === 'form') {
        // 顯示填寫點名表單畫面
        document.getElementById('formArea').style.display = 'block';
        document.getElementById('date').disabled = false;

        const info = window._loginInfo;
        // 自動填入目前登入使用者的社團與姓名
        document.getElementById('club').value = info.club || '';
        document.getElementById('fillerName').value = info.name || '';
        document.getElementById('fillerInfo').value = (info.remark || '') + '-' + (info.class || '') + ' ' + (info.no || '') + ' ' + (info.name || '');
        document.getElementById('identityClubName').value = (info.clubId || '') + ' ' + (info.club || '');
        document.getElementById('identityWriter').value = (info.remark || '') + ' ' + (info.name || '');

        // 設定下方按鈕功能為「送出新點名表」
        document.getElementById('submitBtn').textContent = '確認送出';
        document.getElementById('submitBtn').onclick = submitForm;
        document.getElementById('formFooterLink').textContent = '返回';
        document.getElementById('formFooterLink').onclick = function() {
            history.back(); // 使用瀏覽器返回，維持歷史記錄同步
            return false;
        };

        initCanvas(); // 初始化簽名板

        // 重置表單欄位以防殘留上次填寫的內容
        document.getElementById('desc').value = '';
        updateCharCounter(document.getElementById('desc'), 'descCounter', 200);
        document.getElementById('teacherPresent').value = '是';
        toggleSubTeacher();
        document.getElementById('subTeacher').value = '無';

        // 重置老師簽名板與狀態提示
        hasSigned = false;
        window._keepOriginalSignature = false;
        if (canvas && ctx) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
        const sigStatus = document.getElementById('sigStatus');
        if (sigStatus) {
            sigStatus.textContent = '✅ 已完成簽名';
            sigStatus.style.display = 'none';
        }

        window._draftPrompted = false; // 重置草稿提示旗標
        loadStudents(info.club); // 載入社團名單
    } else if (page === 'editForm') {
        // 進入修改已送出表單的模式
        if (state && state.record) {
            enterEditMode(state.record, true);
        } else {
            history.back(); // 缺少資料時自動返回上一頁
        }
    } else if (page === 'records') {
        // 顯示出缺席紀錄專區
        document.getElementById('recordsArea').style.display = 'block';
        document.getElementById('recordsList').style.display = 'block';
        document.getElementById('recordDetailArea').style.display = 'none';
        document.getElementById('recordsBackLink').style.display = 'block';
        showRecords(true); // 載入最新歷史紀錄
    } else if (page === 'recordDetail') {
        // 顯示單筆紀錄的詳細內容
        if (state && state.date) {
            showRecordDetail(state.date, true);
        } else {
            history.back();
        }
    } else {
        // 預設Fallback：如果已登入就去主選單，未登入就顯示登入按鈕
        if (window._loginInfo) {
            document.getElementById('menuArea').style.display = 'flex';
        } else {
            showLoginButton();
        }
    }
}

/**
 * 回到主選單
 * 點選網頁上方標題時觸發，若已登入則引導回主選單。
 */
function goHome() {
    if (!window._loginInfo) return; // 還沒登入就不動作
    if (history.state?.page === 'menu') return; // 如果已經在主選單了也不重覆執行
    
    history.pushState({ page: 'menu' }, ''); // 記錄在瀏覽器歷史中
    renderPage('menu');
}

// 監聽瀏覽器的「上一頁」與「下一頁」操作，自動將網頁渲染成對應畫面
window.addEventListener('popstate', function(e) {
    const state = e.state;
    if (state && state.page) {
        renderPage(state.page, state);
    } else {
        if (window._loginInfo) {
            renderPage('menu');
        }
    }
});

// ==========================================
// 2. Google 登入與測試帳號驗證流程
// ==========================================

/**
 * 初始化 Google 登入元件
 * 在網頁載入時呼叫，設定 Google 登入按鈕與預設日期範圍。
 */
function initGoogleSignIn() {
    google.accounts.id.initialize({
        client_id: CLIENT_ID,
        callback: handleGoogleCredential, // 登入成功後的處理函式
        auto_select: true, // 若曾登入過，自動選擇帳號
        cancel_on_tap_outside: false
    });
    showLoginButton();
    initDatePicker(); // 設定日期選擇器的範圍限制
}

/**
 * 顯示 Google 登入按鈕或自動登入
 * 檢查瀏覽器本機快取 (cachedUserInfo)，如果在有效期內則快速登入。
 */
function showLoginButton() {
    const raw = localStorage.getItem('cachedUserInfo');
    if (raw) {
        try {
            const cached = JSON.parse(raw);
            const now = Date.now();
            const CACHE_TTL = 14 * 24 * 60 * 60 * 1000; // 快取有效期限：14 天
            if (cached._ts && (now - cached._ts) < CACHE_TTL && cached.token) {
                renderForm(cached); // 渲染主選單
                fetchUserInfo(cached.token); // 向後台確認 Token 狀態
                return;
            }
        } catch (e) {
            // 快取解析失敗，靜默清除
        }
        localStorage.removeItem('cachedUserInfo');
    }
    document.getElementById('loadingArea').style.display = 'none';
    document.getElementById('loginArea').style.display = 'block';
    
    // 渲染漂亮的 Google 登入按鈕
    google.accounts.id.renderButton(
        document.getElementById('g_id_signin'),
        { theme: 'outline', size: 'large', locale: 'zh-TW', text: 'signin_with' }
    );
}

/**
 * 處理 Google 登入回傳的資訊
 * 取得加密憑證 (Credential Token) 並送往 Google 試算表 API 進行身分核對。
 */
async function handleGoogleCredential(response) {
    window.googleToken = response.credential; // 快取 Token
    document.getElementById('loginArea').style.display = 'none';
    document.getElementById('loadingArea').style.display = 'block'; // 顯示讀取中畫面
    try {
        await fetchUserInfo(response.credential);
    } catch (e) {
        showError('連線至伺服器驗證失敗，請重試。');
    }
}

/**
 * 向 Google Apps Script 後台取得登入者的詳細學生/幹部資料
 */
async function fetchUserInfo(token) {
    try {
        const res = await gasPost({ action: 'getLoginUser', token });
        if (res && res.error && res.needLogout) {
            await showAlert(res.msg || '登入狀態已過期，請重新登入。');
            switchAccount(); // 強制登出
            return;
        }
        if (res && !res.token) {
            res.token = token;
        }
        handleUserInfo(res, token);
    } catch (err) {
        showError('無法連線至伺服器，請稍後再試。');
    }
}

/**
 * 處理並引導登入後的身份檢查
 * 若是非官方網域(例如測試用的一般帳號)，會被要求引導至手動輸入測試密碼的區域。
 */
function handleUserInfo(info, token) {
    document.getElementById('loadingArea').style.display = 'none';

    if (info.needManualLogin) {
        // 顯示測試人員專用登入框
        document.getElementById('teacherAuthArea').style.display = 'block';
        if (info.defaultEmail) document.getElementById('teacherEmail').value = info.defaultEmail;
        return;
    }
    if (info.error) {
        showError(info.msg || '驗證失敗，請重新整理頁面再試。');
        return;
    }
    renderForm(info); // 通過驗證，顯示主選單
}

/**
 * 測試/外部帳號登入提交
 * 適用於沒有學校建中帳號，但需要測試或查看系統的社團老師與幹部。
 */
async function submitTeacherAuth() {
    const email = document.getElementById('teacherEmail').value.trim();
    const password = document.getElementById('teacherPassword').value.trim();
    const club = document.getElementById('testClub').value.trim();
    const identity = document.getElementById('testIdentity').value;

    if (!email || !password || !club) { await showAlert('錯誤: 請完整填寫所有欄位！'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { await showAlert('錯誤: Email 格式不正確！'); return; }
    if (club.length > 30) { await showAlert('錯誤: 社團名稱過長！'); return; }

    const btn = document.getElementById('teacherAuthBtn');
    btn.disabled = true; btn.textContent = '驗證中…';

    try {
        // 呼叫 GAS 後台驗證測試密碼與尋找對應社團
        const res = await gasPost({ action: 'verifyTestLogin', email, password, club, identity });
        btn.disabled = false; btn.textContent = '登入';
        if (res.error) { await showAlert('❌ ' + res.msg); return; }
        
        document.getElementById('teacherAuthArea').style.display = 'none';
        renderForm(res); // 登入成功，將規格化後的資料渲染主頁面
    } catch (err) {
        btn.disabled = false; btn.textContent = '登入';
        await showAlert('連線失敗，請稍後再試。');
    }
}

/**
 * 成功驗證後，準備渲染主頁面選單，並寫入本機快取快顯
 */
function renderForm(info) {
    const toCache = Object.assign({}, info, { _ts: Date.now() });
    try {
        localStorage.setItem('cachedUserInfo', JSON.stringify(toCache)); // 儲存本機登入憑證
    } catch (e) {
        console.warn('使用者資訊快取寫入失敗：', e);
    }

    window._loginInfo = info;
    if (info.token) {
        window.googleToken = info.token;
    }

    // 將登入身分轉為防竄改的全域變數
    let userFillerInfo = (info.remark || '') + '-' + (info.class || '') + ' ' + (info.no || '') + ' ' + (info.name || '');
    if (!window.packagedInformation) {
        const tempPackagedInformation = Object.freeze(
            new PackagedUserInfo(info.email || '', userFillerInfo, info.club || '', info.name || '')
        );
        Object.defineProperty(window, "packagedInformation", {
            value: tempPackagedInformation, writable: false, configurable: false, enumerable: true,
        });
    }

    document.getElementById('menuArea').style.display = 'flex';
    history.replaceState({ page: 'menu' }, ''); // 置換目前的歷史頁面為首頁 menu
    
    // 只有幹部或管理員才能看到「開始點名」按鈕，社員只能查詢
    document.getElementById('btnNewForm').style.display = isOfficer(info.remark) ? 'flex' : 'none';
}

/**
 * 切換帳號與登出
 * 清除本機登入資訊快取並重新載入網頁。
 */
function switchAccount() {
    localStorage.removeItem('cachedUserInfo');
    google.accounts.id.disableAutoSelect(); // 關閉 Google 自動選擇帳號
    location.reload(); // 重新整理網頁
}

// ==========================================
// 3. 查詢與出缺席歷史紀錄專區
// ==========================================

/**
 * 載入並顯示出缺席歷史紀錄列表
 */
async function showRecords(skipPush) {
    if (!skipPush) {
        history.pushState({ page: 'records' }, ''); // 寫入瀏覽器上一頁記錄
    }
    ['loadingArea', 'loginArea', 'teacherAuthArea', 'menuArea', 'formArea', 'recordsArea'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });
    document.getElementById('menuArea').style.display = 'none';
    document.getElementById('recordsArea').style.display = 'block';
    document.getElementById('recordsLoading').style.display = 'block'; // 顯示轉圈圈動畫
    document.getElementById('recordsList').style.display = 'block';
    document.getElementById('recordDetailArea').style.display = 'none';
    document.getElementById('recordsBackLink').style.display = 'block';
    document.getElementById('recordsList').innerHTML = '';
    
    const info = window._loginInfo;

    if (isOfficer(info.remark)) {
        // 幹部身分：向後台讀取「整個社團」的所有點名紀錄
        const list = await gasPost({ action: 'getAttendanceList', club: info.club, token: window.googleToken });
        document.getElementById('recordsLoading').style.display = 'none';
        if (list && list.error) {
            document.getElementById('recordsList').textContent = list.msg || '讀取失敗，請稍後再試。';
            return;
        }
        if (!Array.isArray(list)) { document.getElementById('recordsList').textContent = '讀取失敗，請稍後再試。'; return; }
        renderOfficerRecordList(list);
    } else {
        // 社員身分：向後台讀取「該社員自己」的個人歷史點名出缺席狀態
        const identity = `${info.class} ${info.no} ${info.name}`;
        const list = await gasPost({ action: 'getMyAttendance', club: info.club, identity, token: window.googleToken });
        document.getElementById('recordsLoading').style.display = 'none';
        if (list && list.error) {
            document.getElementById('recordsList').textContent = list.msg || '讀取失敗，請稍後再試。';
            return;
        }
        if (!Array.isArray(list)) { document.getElementById('recordsList').textContent = '讀取失敗，請稍後再試。'; return; }
        renderMemberRecordList(list);
    }
}

/**
 * 渲染幹部看到的點名歷史清單
 */
function renderOfficerRecordList(list) {
    const div = document.getElementById('recordsList');
    div.innerHTML = '';
    if (!list.length) { div.textContent = '尚無點名紀錄。'; return; }

    list.forEach(r => {
        const item = document.createElement('div');
        item.className = 'record-item';
        item.textContent = `${r.date}（填寫人：${r.fillerName}）`;
        item.onclick = () => showRecordDetail(r.date); // 點選展開詳細內容
        div.appendChild(item);
    });
}

/**
 * 渲染社員看到的個人出缺席清單
 */
function renderMemberRecordList(list) {
    const div = document.getElementById('recordsList');
    div.innerHTML = '';
    if (!list.length) { div.textContent = '尚無點名紀錄。'; return; }

    list.forEach(r => {
        const item = document.createElement('div');
        item.className = 'record-item';
        item.textContent = `${r.date}：${r.status}`;
        item.style.color = r.status === '缺席' ? '#c00' : '#137333'; // 缺席顯示紅色，出席綠色
        div.appendChild(item);
    });
}

/**
 * 顯示特定一天的點名紀錄詳細資訊（限幹部）
 */
async function showRecordDetail(date, skipPush) {
    const info = window._loginInfo;

    if (!skipPush) {
        history.pushState({ page: 'recordDetail', date: date }, ''); // 將此頁面詳細資料狀態推進歷史堆疊
    }
    document.getElementById('recordsList').style.display = 'none';
    document.getElementById('recordsBackLink').style.display = 'none';
    
    const detailDiv = document.getElementById('recordDetailArea');
    detailDiv.style.display = 'block';
    detailDiv.innerHTML = `<div style="text-align:center;padding:24px 0;color:var(--gray-500);"><div class="spinner" style="margin:0 auto 10px;"></div>載入中…</div>`;
    
    const r = await gasPost({ action: 'getAttendanceDetail', club: info.club, date, token: window.googleToken });

    if (r.error || r.status === 'error') {
        await showAlert(r.msg || r.message || '讀取失敗');
        detailDiv.style.display = 'none';
        document.getElementById('recordsList').style.display = 'block';
        return;
    }

    // 格式化顯示各項資料與缺席名單
    detailDiv.innerHTML = `
    <div class="detail-card">
        <div class="detail-row"><span class="detail-label">社課日期</span><span>${escapeHtml(r.date)}</span></div>
        <div class="detail-row"><span class="detail-label">填寫人</span><span>${escapeHtml(r.fillerName)}</span></div>
        <div class="detail-row"><span class="detail-label">社課內容</span><span>${escapeHtml(r.desc)}</span></div>
        <div class="detail-row"><span class="detail-label">老師出席</span><span>${escapeHtml(r.teacherPresent)}（代課：${escapeHtml(r.subTeacher)}）</span></div>
        <div class="detail-row"><span class="detail-label">實到人數</span><span>${escapeHtml(r.presentCount)} 人</span></div>
        <div class="detail-row detail-row-absent">
            <span class="detail-label">缺席名單</span>
            <div class="absent-box">${escapeHtml(r.absentList).replace(/\n/g, '<br>')}</div>
        </div>
    </div>
    ${r.editable ? `<button class="btn btn-primary" id="editRecordBtn" style="margin-top:14px;">✏️ 修改點名紀錄</button>` : ''}
    <p style="text-align:center;margin-top:10px;">
        <a href="#" onclick="history.back(); return false;"
        style="font-size:.78rem;color:var(--gray-500);text-decoration:underline;">返回</a>
    </p>
    `;

    // 若該紀錄在允許修改期限內，點選按鈕進入編輯模式
    if (r.editable) {
        document.getElementById('editRecordBtn').onclick = () => enterEditMode(r);
    }
}

// ==========================================
// 4. 點名填表功能與名單載入
// ==========================================

/**
 * 點選「開始點名」後，重置並顯示全新空白點名表單
 */
function showNewForm() {
    window._originalRecord = null;
    window._editingDate = null;
    document.getElementById('submitBtn').disabled = false;

    history.pushState({ page: 'form' }, '');
    renderPage('form');
}

/**
 * 非同步從 Google 試算表載入該社團的學生名單
 */
async function loadStudents(clubName) {
    const cacheKey = 'students_' + clubName;
    const cached = localStorage.getItem(cacheKey);
    let cachedData = null;

    if (cached) {
        try {
            cachedData = JSON.parse(cached);
            renderStudents(cachedData);
        } catch (e) {
            localStorage.removeItem(cacheKey);
        }
    }

    try {
        const students = await gasPost({ action: 'getClubMembers', clubName, token: window.googleToken });
        if (students && students.error) {
            if (!cachedData) {
                document.getElementById('studentList').textContent = students.msg || '無權限載入名單。';
            }
            return;
        }
        
        localStorage.setItem(cacheKey, JSON.stringify(students));
        
        // 如果沒有快取資料，或者新抓取的資料與快取不一致，才重新渲染
        if (!cachedData || JSON.stringify(students) !== JSON.stringify(cachedData)) {
            renderStudents(students);
        }
    } catch (err) {
        if (!cachedData) {
            document.getElementById('studentList').textContent = '名單載入失敗，請重新整理。';
        }
    }
}

/**
 * 將載入完成的學生資料，動態生成帶有 Checkbox 的 HTML 列表
 */
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
        
        // 點擊打勾時切換樣式並即時更新統計與草稿
        cb.addEventListener('change', () => {
            item.classList.toggle('present', cb.checked);
            updateCount();
            saveDraft(); 
        });

        const lbl = document.createElement('label');
        lbl.htmlFor = cb.id;
        lbl.textContent = text; // 使用 textContent 防止惡意腳本注入

        item.appendChild(cb);
        item.appendChild(lbl);
        listDiv.appendChild(item);
    });

    updateCount(); // 顯示初始人數
    restoreDraftIfExists(); // 載入先前未完成的草稿（若有）
}

/**
 * 即時更新點名人數顯示文字 (例如: 出席 15 / 20 人)
 */
function updateCount() {
    const total = allStudents.length;
    const present = document.querySelectorAll('.student-cb:checked').length;
    document.getElementById('attendCount').textContent = `（出席 ${present} / ${total} 人）`;
}

/**
 * 獲取所有的點名勾選框
 */
function getStudentCheckboxes() {
    return document.querySelectorAll('.student-cb');
}

/**
 * 點名表單資料提交 (包含防呆檢查與資料封裝)
 */
async function submitForm() {
    const btn = document.getElementById('submitBtn');
    const descEl = document.getElementById('desc');
    const desc = descEl.value.trim();

    // 防呆驗證：必須輸入社課大綱與老師簽名
    if (!desc) { await showAlert('錯誤: 請填寫社課內容簡述！'); return; }
    if (desc.length > MAX_DESC_LEN) { await showAlert(`錯誤: 社課內容不可超過 ${MAX_DESC_LEN} 字！`); return; }
    if (!hasSigned) { await showAlert('錯誤: 請完成老師簽名！'); return; }

    const subTeacherEl = document.getElementById('subTeacher');
    const subTeacherVal = subTeacherEl.value.trim() || '無';
    if (subTeacherVal.length > MAX_TEACHER_LEN) {
        await showAlert(`錯誤: 代課老師姓名不可超過 ${MAX_TEACHER_LEN} 字！`);
        return;
    }

    const dateInput = document.getElementById('date');
    const dateVal = dateInput.value;
    if (!dateVal || (!dateInput.disabled && (dateVal < dateInput.min || dateVal > dateInput.max))) {
        await showAlert('錯誤: 日期超出允許範圍！');
        return;
    }

    const checkboxes = getStudentCheckboxes();
    let absentList = [];
    let presentCount = 0;

    // 分流出出席與缺席名單
    checkboxes.forEach(cb => {
        if (cb.checked) presentCount++;
        else absentList.push(cb.value);
    });

    // 彙整即將傳輸的物件資訊
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
        // 若使用原有簽名且沒重新簽名，標記為 KEEP
        signature: window._keepOriginalSignature ? 'KEEP' : (hasSigned ? canvas.toDataURL('image/png') : '')
    };

    btn.disabled = true;
    btn.textContent = '資料傳送中，請勿關閉網頁…';

    const isEditing = !!window._editingDate; // 判斷是否為編輯模式

    try {
        const res = await gasPost({ action: 'submitAttendance', data });
        if (res === 'SUCCESS') {
            await showAlert('✅ 送出成功！');
            btn.disabled = false;
            btn.textContent = '確認送出';
            clearDraft();
            window._originalRecord = null;
            window._editingDate = null;
            document.getElementById('date').disabled = false;
            
            if (isEditing) {
                history.go(-2);
            } else {
                history.replaceState({ page: 'records' }, '');
                renderPage('records');
            }
        } else {
            // res 必定是 { status: "error", message: "..." }
            await showAlert('送出失敗：' + (res.message || res.msg || '未知錯誤'));
            btn.disabled = false;
            btn.textContent = isEditing ? '確認修改' : '確認送出';
        }
    } catch (err) {
        await showAlert('連線失敗，請稍後再試。');
        btn.disabled = false;
        btn.textContent = isEditing ? '確認修改' : '確認送出';
    }
}

// ==========================================
// 5. 修改現有點名紀錄模式
// ==========================================

/**
 * 載入指定的一筆現有點名紀錄並切換成修改狀態
 */
function enterEditMode(record, skipPush) {
    clearDraft();
    window._editingDate = record.date;
    window._draftPrompted = false; // 重置草稿提示旗標
    if (!skipPush) {
        history.pushState({ page: 'editForm', record: record }, ''); // 記錄在歷史中
    }
    document.getElementById('menuArea').style.display = 'none';
    document.getElementById('recordsArea').style.display = 'none';
    document.getElementById('recordDetailArea').style.display = 'none';
    document.getElementById('formArea').style.display = 'block';

    const info = window._loginInfo;
    // 預填寫原有表單資料
    document.getElementById('club').value = info.club || '';
    document.getElementById('identityClubName').value = (info.clubId || '') + ' ' + (info.club || '');
    document.getElementById('identityWriter').value = (info.remark || '') + ' ' + (info.name || '');
    document.getElementById('date').value = record.date;
    document.getElementById('date').disabled = true; // 鎖定日期不可修改
    document.getElementById('desc').value = record.desc;
    document.getElementById('teacherPresent').value = record.teacherPresent;
    toggleSubTeacher();
    document.getElementById('subTeacher').value = record.subTeacher;

    // 將學生的打勾狀況還原成送出時的樣貌
    loadStudents(info.club).then(() => {
        const absentSet = new Set(String(record.absentList || '').split('\n'));
        getStudentCheckboxes().forEach(cb => {
            cb.checked = !absentSet.has(cb.value);
            cb.dispatchEvent(new Event('change'));
        });
        window._originalRecord = record;
        checkIfFormChanged(); // 執行按鈕啟用狀態檢查
    });

    initCanvas();
    hasSigned = true;
    window._keepOriginalSignature = true; // 標示為沿用原老師簽名
    const sigStatus = document.getElementById('sigStatus');
    sigStatus.textContent = '✅ 使用原有簽名（重新簽名可覆蓋）';
    sigStatus.style.display = 'block';

    // 重新綁定「確認修改」按鈕與下方「放棄修改」事件
    document.getElementById('submitBtn').textContent = '確認修改';
    document.getElementById('submitBtn').onclick = submitForm;
    document.getElementById('formFooterLink').textContent = '放棄修改';
    document.getElementById('formFooterLink').onclick = function() {
        clearDraft();
        window._originalRecord = null;
        window._editingDate = null;
        document.getElementById('date').disabled = false;
        history.replaceState({ page: 'records' }, '');
        renderPage('records');
        return false;
    };
}

/**
 * 檢查修改表單的欄位與原有紀錄是否有任何不同
 * 如果完全相同，則「確認修改」按鈕會呈現灰色鎖定狀態，防止無意義的重覆提交。
 */
function checkIfFormChanged() {
    if (!window._originalRecord) return;

    const descEl = document.getElementById('desc');
    const teacherPresentEl = document.getElementById('teacherPresent');
    const subTeacherEl = document.getElementById('subTeacher');

    const currentDesc = descEl.value.trim();
    const currentTeacherPresent = teacherPresentEl.value;
    const currentSubTeacher = subTeacherEl.value.trim() || '無';

    const checkboxes = getStudentCheckboxes();
    let absentList = [];
    checkboxes.forEach(cb => {
        if (!cb.checked) absentList.push(cb.value);
    });
    const currentAbsentList = absentList.length > 0 ? absentList.join('\n') : '全勤';

    // 檢查老師簽名是否有重簽
    const isSignatureChanged = !window._keepOriginalSignature;

    // 任一欄位被動過，即代表已變更
    const hasChanged = 
        currentDesc !== window._originalRecord.desc ||
        currentTeacherPresent !== window._originalRecord.teacherPresent ||
        currentSubTeacher !== window._originalRecord.subTeacher ||
        currentAbsentList !== (window._originalRecord.absentList || '全勤') ||
        isSignatureChanged;

    const btn = document.getElementById('submitBtn');
    if (btn && btn.textContent === '確認修改') {
        btn.disabled = !hasChanged; // 啟用或禁用確認按鈕
    }
}

// ==========================================
// 6. 表單控制元件與格式防錯工具
// ==========================================

/**
 * 初始化日期選擇器範圍限制
 * 點名日期最多只允許選取當天到過去 4 天的日期，防止誤填未來或其他日期。
 */
function initDatePicker() {
    const input = document.getElementById('date');
    const today = new Date();
    const tz = today.getTimezoneOffset() * 60000;
    const max = new Date(today.getTime() - tz).toISOString().split('T')[0];
    const min = new Date(today.getTime() - 4 * 86400000 - tz).toISOString().split('T')[0];
    input.max = max; // 當天為最大允許日期
    input.min = min; // 限制至前 4 天
    input.value = max;
}

/**
 * 老師出席狀態切換
 * 當指導老師選擇「否」時，才會動態顯露「代課老師姓名」的輸入格。
 */
function toggleSubTeacher() {
    const present = document.getElementById('teacherPresent').value;
    const grp = document.getElementById('subTeacherGroup');
    const inp = document.getElementById('subTeacher');
    if (present === '否') {
        grp.style.display = 'block';
    } else {
        grp.style.display = 'none';
        inp.value = '無'; // 重設為無
    }
}

/**
 * 即時顯示社課簡述已填字數 (例如: 12 / 200 字)
 */
function updateCharCounter(el, counterId, max) {
    const len = el.value.length;
    const counter = document.getElementById(counterId);
    counter.textContent = len + ' / ' + max;
    counter.classList.toggle('warn', len >= max * 0.9); // 字數即將用盡時顯示黃橘色警告
}

/**
 * 防止惡意 HTML 腳本注入的防護工具，確保字串內不包含特殊 HTML 字元
 */
function escapeHtml(text) {
    if (!text) return "";
    return String(text)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// ==========================================
// 7. 手寫手勢簽名板 Canvas 功能
// ==========================================

/**
 * 綁定並初始化簽名板 Canvas 元件與手勢滑鼠監聽器
 */
function initCanvas() {
    canvas = document.getElementById('sigCanvas');
    ctx = canvas.getContext('2d');

    let canvasRect = null;

    // 取得相對於簽名板上的觸控/滑鼠坐標點
    const getPos = (e) => {
        const src = e.touches ? e.touches[0] : e;
        return { x: src.clientX - canvasRect.left, y: src.clientY - canvasRect.top };
    };
    
    // 手勢觸碰開始
    const start = (e) => {
        isDrawing = true;
        window._keepOriginalSignature = false; // 有新簽名，不使用原簽名
        canvasRect = canvas.getBoundingClientRect();
        draw(e);
    };
    
    // 觸碰結束
    const stop = () => { isDrawing = false; ctx.beginPath(); };
    
    // 繪製線條
    const draw = (e) => {
        if (!isDrawing) return;
        e.preventDefault();
        hasSigned = true;
        const p = getPos(e);
        ctx.lineWidth = 2.5; ctx.lineCap = 'round';
        ctx.lineTo(p.x, p.y); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(p.x, p.y);
    };

    // 綁定手勢與滑鼠事件
    canvas.addEventListener('mousedown', start);
    canvas.addEventListener('mousemove', draw);
    canvas.addEventListener('mouseup', stop);
    canvas.addEventListener('touchstart', start, { passive: false });
    canvas.addEventListener('touchmove', draw, { passive: false });
    canvas.addEventListener('touchend', stop);
}

/**
 * 打開老師手寫簽名板視窗 (Modal Overlay)
 */
function openSigModal() {
    document.getElementById('sigModal').classList.add('open');
    if (!isCanvasSized) {
        // 設定 Canvas 實體寬高為自適應的外容器尺寸
        canvas.width = canvas.offsetWidth;
        canvas.height = canvas.offsetHeight;
        isCanvasSized = true;
    }
}

/**
 * 清除已寫的老師簽名並重簽
 */
function clearCanvas() {
    ctx.clearRect(0, 0, canvas.width, canvas.height); // 清空畫布內容
    hasSigned = false;
    window._keepOriginalSignature = false;
    if (window._originalRecord) checkIfFormChanged();
}

/**
 * 儲存當前手寫內容並關閉簽名板視窗
 */
function closeSigModal() {
    document.getElementById('sigModal').classList.remove('open');
    if (!window._keepOriginalSignature) {
        document.getElementById('sigStatus').textContent = '✅ 已完成簽名';
    }
    document.getElementById('sigStatus').style.display = hasSigned ? 'block' : 'none';
    saveDraft(); // 順便將目前的簽名板資料暫存於草稿
}

// ==========================================
// 8. 瀏覽器離線草稿儲存系統
// ==========================================

/**
 * 區分目前為「新增草稿」還是「修改指定日期草稿」，防止混淆
 */
function getDraftMode() {
    return window._editingDate ? ('edit_' + window._editingDate) : 'new';
}

/**
 * 將目前表單內打勾、說明文字等，寫入 LocalStorage 本機暫存中
 */
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
        console.warn('草稿儲存失敗：', e);
    }
    if (window._originalRecord) checkIfFormChanged(); // 變動時同步檢查修改模式的按鈕狀態
}

/**
 * 當表單成功傳送或退出時，主動清除離線草稿
 */
function clearDraft() {
    localStorage.removeItem(DRAFT_KEY);
}

/**
 * 還原上一次未完成的草稿（如果有偵測到的話）
 */
async function restoreDraftIfExists() {
    if (window._draftPrompted) return;

    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return;

    // 檢查目前是否確實在填寫或修改表單頁面，以防在其他頁面彈出提示
    const currentPage = history.state?.page;
    if (currentPage !== 'form' && currentPage !== 'editForm') {
        return;
    }

    // 標記已提示過，避免重複彈出
    window._draftPrompted = true;

    let draft;
    try { draft = JSON.parse(raw); } catch (e) { clearDraft(); return; }

    // 草稿類型不符（例如上次是新增草稿，但這次是修改紀錄），直接丟棄防污染
    if (draft.mode !== getDraftMode()) {
        clearDraft();
        return;
    }

    if (!(await showConfirm('偵測到上次未送出的內容，要還原嗎？'))) {
        clearDraft();
        return;
    }

    // 還原文字、選單與日期
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

    // 還原學生的打勾出缺席狀態
    if (Array.isArray(draft.absentIds)) {
        getStudentCheckboxes().forEach(cb => {
            cb.checked = !draft.absentIds.includes(cb.id);
            cb.dispatchEvent(new Event('change'));
        });
    }

    // 還原老師手寫簽名
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

// ==========================================
// 9. API 後台通訊與全域輔助工具
// ==========================================

/**
 * 送出非同步 POST 請求至後端 Google 試算表 (Apps Script)
 */
async function gasPost(body) {
    const res = await fetch(GAS_URL, {
        method: 'POST',
        body: JSON.stringify(body)
    });
    return res.json();
}

/**
 * 在驗證登入階段若出現連線失敗或無效網域，在畫面上印出提示資訊
 */
function showError(msg) {
    const area = document.getElementById('loadingArea');
    area.innerHTML = '';
    const div = document.createElement('div');
    div.style.cssText = 'color:var(--red);font-size:.95rem;';
    div.textContent = msg;
    area.appendChild(div);
}

/**
 * 輔助判斷身分備註欄是否代表社團幹部
 */
function isOfficer(remark) {
    return remark !== '社員' && remark !== '外部登入_社員';
}

/**
 * 自訂的 Alert 彈出式視窗，返回 Promise 物件
 */
function showAlert(message, title = "提示") {
    return new Promise((resolve) => {
        const dialog = document.getElementById('customDialog');
        const titleEl = document.getElementById('customDialogTitle');
        const messageEl = document.getElementById('customDialogMessage');
        const cancelBtn = document.getElementById('customDialogCancelBtn');
        const confirmBtn = document.getElementById('customDialogConfirmBtn');

        titleEl.textContent = title;
        messageEl.textContent = message;
        
        cancelBtn.style.display = 'none';
        confirmBtn.className = 'btn btn-primary';
        confirmBtn.textContent = '確定';

        dialog.classList.add('open');

        confirmBtn.addEventListener('click', function() {
            dialog.classList.remove('open');
            resolve(true);
        }, { once: true });
    });
}

/**
 * 自訂的 Confirm 彈出式確認視窗，返回 Promise 物件 (resolve 為 true 或 false)
 */
function showConfirm(message, title = "確認動作") {
    return new Promise((resolve) => {
        const dialog = document.getElementById('customDialog');
        const titleEl = document.getElementById('customDialogTitle');
        const messageEl = document.getElementById('customDialogMessage');
        const cancelBtn = document.getElementById('customDialogCancelBtn');
        const confirmBtn = document.getElementById('customDialogConfirmBtn');

        titleEl.textContent = title;
        messageEl.textContent = message;

        cancelBtn.style.display = 'block';
        cancelBtn.textContent = '取消';
        confirmBtn.className = 'btn btn-primary';
        confirmBtn.textContent = '確認';

        dialog.classList.add('open');

        confirmBtn.addEventListener('click', function() {
            dialog.classList.remove('open');
            resolve(true);
        }, { once: true });

        cancelBtn.addEventListener('click', function() {
            dialog.classList.remove('open');
            resolve(false);
        }, { once: true });
    });
}

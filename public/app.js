/* 1. 常數設定(字數) */
var SECURITY = {
  MAX_DESC_LEN:       200,   // 社課內容簡述最大字元數
  MAX_TEACHER_LEN:    30,    // 代課老師姓名最大字元數
  MAX_CLUB_LEN:       30,    // 社團名稱最大字元數
  MAX_EMAIL_LEN:      100,   // email 最大字元數
  SUBMIT_COOLDOWN_SEC: 60,   // 同一 email 兩次送出最短間隔（秒）
  ALLOWED_DATE_RANGE:  5,    // 允許的日期往前天數（天）
};

/* 2. 工具函式 */
/* 2-1. 清理字串 */
function sanitize(val, maxLen) {
  if (val === null || val === undefined) return "";
  var s = String(val)
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "") // 控制字元
    .replace(/[<>]/g, "")      // 防止 HTML 注入（若試算表以 HTML 顯示）
    .replace(/[=+\-@|`]/g, function(c) {   // 防止 CSV/試算表公式注入
      return "\u200B" + c;
    })
    .trim();
  if (maxLen && s.length > maxLen) s = s.slice(0, maxLen);
  return s;
}

/* 2-2. 驗證 email 格式 */
function isValidEmail(email) {
  if (!email || typeof email !== "string") return false;
  if (email.length > SECURITY.MAX_EMAIL_LEN) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/* 2-3. 驗證日期字串 */
function isValidDate(dateStr) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  var d     = new Date(dateStr.replace(/-/g, "/"));
  if (isNaN(d.getTime())) return false;
  var today = new Date();
  today.setHours(23, 59, 59, 999);
  var minDate = new Date();
  minDate.setDate(minDate.getDate() - SECURITY.ALLOWED_DATE_RANGE);
  minDate.setHours(0, 0, 0, 0);
  return d >= minDate && d <= today;
}

/* 2-4. 防止短時間重複送出（同一 email 兩次送出最短間隔） */
function checkAndSetCooldown(email) {
  var props  = PropertiesService.getScriptProperties();
  var key    = "submit_ts_" + email.replace(/[^a-zA-Z0-9]/g, "_");
  var lastTs = props.getProperty(key);

  if (lastTs) {
    var elapsed = (Date.now() - parseInt(lastTs, 10)) / 1000;
    if (elapsed < SECURITY.SUBMIT_COOLDOWN_SEC) {
      return false;
    }
  }
  props.setProperty(key, String(Date.now()));
  return true;
}

/* 2-5. 雲端硬碟資料夾解析工具 */
function parseDriveId(rawValue) {
  if (!rawValue) return null;
  var match = rawValue.toString().trim().match(/folders\/([a-zA-Z0-9-_]+)/);
  return match ? match[1] : rawValue.toString().trim();
}


/* 3. 讀取系統設定 */
function getSignFolderId() {
  try {
    var ss   = SpreadsheetApp.getActiveSpreadsheet();
    var raw  = ss.getSheetByName("系統設定").getRange("B1").getValue();
    if (!raw) throw new Error("「系統設定」工作表的 B1 儲存格不可以是空白！");
    return parseDriveId(raw);
  } catch (e) {
    SpreadsheetApp.getUi().alert("❌ 系統設定錯誤：" + e.message);
    return null;
  }
}

/* 4. 核心業務邏輯 */
/* 4-1. 身分驗證群 */
/* 4-1-1. 取得登入者資訊 */
function getLoginUserExternal(email) {
  // 驗證 email 格式
  if (!isValidEmail(email)) return { needManualLogin: true };

  var studentId = "";
  var match = email.match(/^ck(\d+)/i);
  if (match) studentId = match[1];

  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("原始名單");
  var data  = sheet.getDataRange().getValues();

  var COL = { CLASS: 0, NO: 1, NAME: 2, ID: 3, REMARK: 4, CLUB_ID: 5, CLUB: 6 };

  for (var i = 1; i < data.length; i++) {
    if (String(data[i][COL.ID]) === studentId) {
      var remark = data[i][COL.REMARK] || "社員";
      return {
        email:      email,
        id:         studentId,
        class:      data[i][COL.CLASS],
        no:         data[i][COL.NO],
        name:       data[i][COL.NAME],
        club:       data[i][COL.CLUB],
        clubId:     data[i][COL.CLUB_ID],
        remark:     remark,
        fillerInfo: remark + "-" + data[i][COL.CLASS] + " " + data[i][COL.NO] + " " + data[i][COL.NAME]
      };
    }
  }

  return { needManualLogin: true, defaultEmail: email };
}

/* 4-1-2. 取得外部登入身分 */
function verifyTestLogin(inputEmail, inputPassword, inputClub, inputIdentity) {
  if (!checkAndSetCooldown("login_try_" + inputEmail)) {
    return { error: true, msg: "嘗試登入過於頻繁，請等待 60 秒後再試" };
  }
  if (!isValidEmail(inputEmail))   return { error: true, msg: "Email 格式不正確" };
  if (!inputPassword || typeof inputPassword !== "string" || inputPassword.length > 100) {
    return { error: true, msg: "密碼格式不正確" };
  }
  var safeClub = sanitize(inputClub, SECURITY.MAX_CLUB_LEN);
  if (!safeClub) return { error: true, msg: "社團名稱不可為空" };
  
  var safeIdentity = (inputIdentity === "社員") ? "社員" : "幹部";

  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("系統設定");
  var data  = sheet.getDataRange().getValues();

  for (var i = 4; i < data.length; i++) {
    var rowEmail = data[i][0] ? data[i][0].toString().trim().toLowerCase() : "";
    if (rowEmail === inputEmail.toLowerCase()) {
      var teacherName     = data[i][1] ? data[i][1].toString().trim() : "測試人員";
      var correctPassword = data[i][2] ? data[i][2].toString().trim() : "";

      if (inputPassword !== correctPassword) {
        return { error: true, msg: "密碼錯誤！請重新確認。" };
      }

      var remarkVal = "外部登入_" + safeIdentity;   // ★ 改這裡

      return {
        email:      inputEmail,
        id:         "TEST_USER",
        class:      "000",
        no:         "00",
        name:       teacherName,
        club:       safeClub,
        clubId:     "測試",
        remark:     remarkVal,                      // ★ 改這裡
        fillerInfo: remarkVal + "-" + teacherName
      };
    }
  }
  return { error: true, msg: "您並非測試人員，請聯絡管理員建立測試帳號" };
}

/* 4-2. 名單查詢 */
function getClubMembers(clubName) {
  var safeClub = sanitize(clubName, SECURITY.MAX_CLUB_LEN);
  if (!safeClub) return [];

  var sheet    = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("原始名單");
  var data     = sheet.getDataRange().getValues();
  var students = [];

  for (var i = 1; i < data.length; i++) {
    if (data[i][6] === safeClub) {
      students.push({
        class: data[i][0],
        no:    data[i][1],
        name:  data[i][2],
        id:    data[i][3]
      });
    }
  }

  students.sort(function(a, b) {
    return a.class !== b.class ? a.class - b.class : a.no - b.no;
  });

  return students;
}

/* 4-3. 點名紀錄讀取 */
/* 4-3-1. 取得指定社團的最新點名紀錄 */
function getLatestRowsByClub(club) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("點名紀錄");
  var data  = sheet.getDataRange().getValues();
  // A:填寫時間 B:身分 C:社團 D:社課日期 E:填寫人 F:內容 G:老師出席 H:代課老師 I:實到 J:缺席名單 K:簽名連結
  var latest = {}; // key = yyyy-MM-dd, value = row data

  for (var i = 1; i < data.length; i++) {
    if (String(data[i][2]) !== club) continue;
    var dDate = data[i][3];
    if (!(dDate instanceof Date)) continue;
    var key = Utilities.formatDate(dDate, Session.getScriptTimeZone(), "yyyy-MM-dd");
    var ts  = data[i][0] instanceof Date ? data[i][0].getTime() : 0;

    if (!latest[key] || ts > latest[key]._ts) {
      latest[key] = {
        _ts: ts,
        date: key,
        fillerInfo: data[i][1],
        club: data[i][2],
        fillerName: data[i][4],
        desc: data[i][5],
        teacherPresent: data[i][6],
        subTeacher: data[i][7],
        presentCount: data[i][8],
        absentList: data[i][9],
        signatureUrl: data[i][10]
      };
    }
  }
  return latest;
}

/* 4-3-2. 判斷日期是否在可修改範圍內 */
function isWithinEditableRange(dateStr) {
  return isValidDate(dateStr);
}

/* 4-3-3. 取得指定社團的點名紀錄列表 */
function getAttendanceList(club) {
  var safeClub = sanitize(club, SECURITY.MAX_CLUB_LEN);
  if (!safeClub) return [];
  var latest = getLatestRowsByClub(safeClub);

  var list = Object.keys(latest).map(function(key) {
    var r = latest[key];
    return {
      date: r.date,
      fillerName: r.fillerName,
      teacherPresent: r.teacherPresent,
      presentCount: r.presentCount,
      editable: isWithinEditableRange(r.date)
    };
  });

  list.sort(function(a, b) { return a.date < b.date ? 1 : -1; }); // 新到舊
  return list;
}

/* 4-3-4. 取得指定社團、指定日期的點名紀錄 */
function getAttendanceDetail(club, date) {
  var safeClub = sanitize(club, SECURITY.MAX_CLUB_LEN);
  var latest = getLatestRowsByClub(safeClub);
  var r = latest[date];
  if (!r) return { status: "error", message: "找不到該日期的紀錄" };
  r.editable = isWithinEditableRange(r.date);
  return r;
}

/* 4-3-5. 取得自己的出席紀錄 */
function getMyAttendance(club, identity) {
  // identity 格式："class no name"，例如 "301 12 王小明"
  var safeClub = sanitize(club, SECURITY.MAX_CLUB_LEN);
  var safeIdentity = sanitize(identity, 30);
  if (!safeClub || !safeIdentity) return [];

  var latest = getLatestRowsByClub(safeClub);

  return Object.keys(latest).map(function(key) {
    var r = latest[key];
    var absentLines = String(r.absentList || "").split("\n");
    var isAbsent = absentLines.indexOf(safeIdentity) !== -1;
    return { date: r.date, status: isAbsent ? "缺席" : "出席" };
  }).sort(function(a, b) { return a.date < b.date ? 1 : -1; });
}

/* 4-4 寫入點名資料 */
function submitAttendance(data) {
  if (!data) return { status: "error", message: "資料不完整" };
  // Email 驗證
  var safeEmail = "";
  if (data.email && data.email !== "") {
    if (!isValidEmail(data.email)) return { status: "error", message: "Email 格式不正確" };
    safeEmail = data.email;
  }

  // 日期驗證
  if (!isValidDate(data.date)) {
    return { status: "error", message: "日期格式不正確或超出允許範圍" };
  }

  // 冷卻時間
  var cooldownKey = safeEmail || (data.fillerInfo || "anonymous");
  if (!checkAndSetCooldown(cooldownKey)) {
    return { status: "error", message: "送出過於頻繁，請稍後再試" };
  }

  // 清洗所有文字欄位（防公式注入 & 過長輸入）
  var safeDesc          = sanitize(data.desc,           SECURITY.MAX_DESC_LEN);
  var safeSubTeacher    = sanitize(data.subTeacher,     SECURITY.MAX_TEACHER_LEN);
  var safeClub          = sanitize(data.club,           SECURITY.MAX_CLUB_LEN);
  var safeFillerInfo    = sanitize(data.fillerInfo,     60);
  var safeFillerName    = sanitize(data.fillerName,     20);

  // teacherPresent 白名單限制（只允許「是」或「否」）
  var safeTeacherPresent = (data.teacherPresent === "否") ? "否" : "是";

  // presentCount 必須是非負整數
  var safePresentCount = parseInt(data.presentCount, 10);
  if (isNaN(safePresentCount) || safePresentCount < 0) safePresentCount = 0;

  // 缺席名單：清洗每一行（逐條名字消毒）
  var safeAbsentList = "全勤";
  if (data.absentList && data.absentList !== "全勤") {
    var absentLines = String(data.absentList).split("\n").slice(0, 200); // 最多 200 人
    safeAbsentList  = absentLines
      .map(function(line) { return sanitize(line, 30); })
      .filter(function(line) { return line.length > 0; })
      .join("\n");
    if (!safeAbsentList) safeAbsentList = "全勤";
  }

  // 簽名 base64 格式驗證（必須是合法的 PNG Data URL）
  var signatureData = "";
  if (data.signature === 'KEEP') {
    // 沿用舊簽名：從最新紀錄取得原 Drive URL
    var existing = getLatestRowsByClub(safeClub);
    var existingRow = existing[data.date];
    signatureData = existingRow ? existingRow.signatureUrl : '無簽名';
  } else {
    if (data.signature && data.signature.length > 200000) {
      return { status: "error", message: "簽名檔過大，請重新簽名" };
    }
    if (data.signature && data.signature !== "") {
      if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(data.signature)) {
        return { status: "error", message: "簽名格式不正確" };
      }
      signatureData = data.signature;
    }
  }

  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("點名紀錄");

  var formattedDate = new Date(data.date.replace(/-/g, "/"));

  // 老師簽名上傳至 Drive
  var fileUrl = "無簽名";
  if (signatureData === '無簽名' || signatureData === '') {
    fileUrl = "無簽名";
  } else if (signatureData.startsWith('https://')) {
    // KEEP 模式：直接沿用原 Drive URL，不重新上傳
    fileUrl = signatureData;
  } else {
    // 新簽名：上傳到 Drive
    var folderId = getSignFolderId();
    var folder = DriveApp.getFolderById(folderId);
    var base64 = signatureData.split(",")[1];
    var fileName = data.date + "_" + safeClub + "_老師簽名.png";
    var blob = Utilities.newBlob(Utilities.base64Decode(base64), "image/png", fileName);
    var file = folder.createFile(blob);
    fileUrl = file.getUrl();
  }

  // 寫入試算表
  sheet.appendRow([
    new Date(),            // A: 填寫日期
    safeFillerInfo,        // B: 填答身分
    safeClub,              // C: 社團名稱
    formattedDate,         // D: 社課日期
    safeFillerName,        // E: 填寫人姓名
    safeDesc,              // F: 內容簡述
    safeTeacherPresent,    // G: 老師出席狀況
    safeSubTeacher,        // H: 代課老師姓名
    safePresentCount,      // I: 實到人數
    safeAbsentList,        // J: 缺席名單
    fileUrl                // K: 簽名檔連結
  ]);

  return "SUCCESS";
}

/* 5. 路由器與進入點 */
/* 5-1. 發送資料 */
function jsonResponse(data, headers) {
  var output = ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
  return output;
}

/* 5-2. OPTIONS preflight */
function doGet(e) {
  return ContentService.createTextOutput("建中社團點名系統 API endpoint. 請使用 POST 方法存取。");
}

/* 5-3. 路由器 */
function doPost(e) {
  var corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };

  if (!e || !e.postData) {
    return jsonResponse({ status: "error", message: "沒有收到任何資料" }, corsHeaders);
  }

  try {
    var req    = JSON.parse(e.postData.contents);
    var action = req.action;
    var result;

    if      (action === "getLoginUser")      result = getLoginUserExternal(req.email);
    else if (action === "getClubMembers")    result = getClubMembers(req.clubName);
    else if (action === "verifyTestLogin")   result = verifyTestLogin(req.email, req.password, req.club, req.identity);
    else if (action === "submitAttendance")  result = submitAttendance(req.data);
    else if (action === "getAttendanceList")    result = getAttendanceList(req.club);
    else if (action === "getAttendanceDetail")  result = getAttendanceDetail(req.club, req.date);
    else if (action === "getMyAttendance")      result = getMyAttendance(req.club, req.identity);
    else result = { status: "error", message: "未知的操作指令" };

    return jsonResponse(result, corsHeaders);

  } catch (err) {
    return jsonResponse({ status: "error", message: "請求處理失敗，請稍後再試" }, corsHeaders);
  }
}
if (typeof google !== 'undefined' && google.accounts) {
    initGoogleSignIn();
}

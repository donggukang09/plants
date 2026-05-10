/**
 * 🌱 식물집사 Apps Script 백엔드
 * ───────────────────────────────────────
 * Google Sheets + Google Drive 백엔드
 *
 * 사용법:
 *   1. Apps Script 프로젝트 생성 (script.google.com)
 *   2. 이 코드 전체를 복사 → 코드.gs에 붙여넣기
 *   3. 아래 CONFIG 값 수정 (SHEET_ID, DRIVE_FOLDER_ID)
 *   4. 배포 → 새 배포 → 웹 앱 → "나"로 실행, "모든 사용자"가 액세스
 *   5. 웹 앱 URL을 index.html의 SCRIPT_URL에 넣기
 */

const CONFIG = {
  SHEET_ID: '1oTIyJyOpLuIDvOZfcGDgP3a8hz4ss0frAIGM1nb3rfY',
  DRIVE_FOLDER_ID: '1gEJQcvpNKVcRCy2IvqzDxZO87o2VeTWG',
  SHEETS: {
    plants: 'plants',
    watering_log: 'watering_log',
    growth_log: 'growth_log'
  }
};

// ─────────────────────────────────────────
// 시트 헤더 정의 (initSheets로 자동 생성)
// ─────────────────────────────────────────
const HEADERS = {
  plants: [
    'id', 'name', 'photo_url',
    'purchase_date', 'vendor', 'last_repot_date',
    'watering_interval_days', 'last_watered_date',
    'fertilizer_interval_days', 'last_fertilized_date',
    'light_level', 'location', 'health_status', 'notes',
    'status', 'created_at', 'updated_at'
  ],
  watering_log: [
    'id', 'plant_id', 'date', 'type', 'notes', 'created_at'
  ],
  growth_log: [
    'id', 'plant_id', 'date', 'photo_url', 'notes', 'created_at'
  ]
};

// ─────────────────────────────────────────
// 시트 초기화 (최초 1회 수동 실행)
// Apps Script 에디터에서 initSheets() 직접 실행
// ─────────────────────────────────────────
function initSheets() {
  const ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  Object.keys(HEADERS).forEach(sheetKey => {
    const name = CONFIG.SHEETS[sheetKey];
    let sheet = ss.getSheetByName(name);
    if (!sheet) sheet = ss.insertSheet(name);
    if (sheet.getLastRow() === 0) {
      sheet.getRange(1, 1, 1, HEADERS[sheetKey].length).setValues([HEADERS[sheetKey]]);
      sheet.setFrozenRows(1);
    }
  });
  return '✅ 시트 초기화 완료';
}

// ─────────────────────────────────────────
// HTTP 진입점
// ─────────────────────────────────────────
function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const action = body.action;
    let result;
    switch (action) {
      case 'addPlant': result = addPlant(body.plant); break;
      case 'updatePlant': result = updatePlant(body.plant); break;
      case 'deletePlant': result = deletePlant(body.plant_id); break;
      case 'logWatering': result = logEvent(body.plant_id, body.date, 'water'); break;
      case 'logFertilizing': result = logEvent(body.plant_id, body.date, 'fertilizer'); break;
      case 'addGrowthRecord': result = addGrowthRecord(body.record); break;
      case 'uploadPhoto': result = uploadPhoto(body.base64, body.mimeType, body.filename); break;
      case 'ping': result = { pong: true, time: new Date().toISOString() }; break;
      default: throw new Error('Unknown action: ' + action);
    }
    return jsonResponse({ ok: true, ...result });
  } catch (err) {
    return jsonResponse({ ok: false, error: err.message, stack: err.stack });
  }
}

function doGet(e) {
  return jsonResponse({ ok: true, message: '식물집사 API 작동 중', time: new Date().toISOString() });
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ─────────────────────────────────────────
// 식물 CRUD
// ─────────────────────────────────────────
function addPlant(plant) {
  const sheet = getSheet('plants');
  const row = HEADERS.plants.map(h => {
    if (h === 'created_at' || h === 'updated_at') return new Date().toISOString();
    return plant[h] !== undefined ? plant[h] : '';
  });
  sheet.appendRow(row);
  return { id: plant.id };
}

function updatePlant(plant) {
  const sheet = getSheet('plants');
  const data = sheet.getDataRange().getValues();
  const idIdx = HEADERS.plants.indexOf('id');
  const updIdx = HEADERS.plants.indexOf('updated_at');
  for (let r = 1; r < data.length; r++) {
    if (String(data[r][idIdx]) === String(plant.id)) {
      const row = HEADERS.plants.map((h, i) => {
        if (h === 'updated_at') return new Date().toISOString();
        if (h === 'created_at') return data[r][i] || new Date().toISOString();
        return plant[h] !== undefined ? plant[h] : data[r][i];
      });
      sheet.getRange(r + 1, 1, 1, HEADERS.plants.length).setValues([row]);
      return { updated: true };
    }
  }
  throw new Error('식물을 찾을 수 없음: ' + plant.id);
}

function deletePlant(plantId) {
  const sheet = getSheet('plants');
  const data = sheet.getDataRange().getValues();
  const idIdx = HEADERS.plants.indexOf('id');
  for (let r = data.length - 1; r >= 1; r--) {
    if (String(data[r][idIdx]) === String(plantId)) {
      sheet.deleteRow(r + 1);
      break;
    }
  }
  // 관련 성장기록도 삭제
  const gSheet = getSheet('growth_log');
  const gData = gSheet.getDataRange().getValues();
  const gPidIdx = HEADERS.growth_log.indexOf('plant_id');
  for (let r = gData.length - 1; r >= 1; r--) {
    if (String(gData[r][gPidIdx]) === String(plantId)) {
      gSheet.deleteRow(r + 1);
    }
  }
  return { deleted: true };
}

// ─────────────────────────────────────────
// 물/비료 이벤트 기록
// ─────────────────────────────────────────
function logEvent(plantId, date, type) {
  // 1. 로그 시트에 기록
  const logSheet = getSheet('watering_log');
  const logRow = [
    `e_${Date.now()}_${Math.random().toString(36).slice(2,6)}`,
    plantId,
    date || todayISO(),
    type,
    '',
    new Date().toISOString()
  ];
  logSheet.appendRow(logRow);

  // 2. 식물 시트의 last_*_date 갱신
  const sheet = getSheet('plants');
  const data = sheet.getDataRange().getValues();
  const idIdx = HEADERS.plants.indexOf('id');
  const colName = type === 'water' ? 'last_watered_date' : 'last_fertilized_date';
  const colIdx = HEADERS.plants.indexOf(colName);
  const updIdx = HEADERS.plants.indexOf('updated_at');
  for (let r = 1; r < data.length; r++) {
    if (String(data[r][idIdx]) === String(plantId)) {
      sheet.getRange(r + 1, colIdx + 1).setValue(date || todayISO());
      sheet.getRange(r + 1, updIdx + 1).setValue(new Date().toISOString());
      return { logged: true };
    }
  }
  throw new Error('식물을 찾을 수 없음');
}

// ─────────────────────────────────────────
// 성장 기록
// ─────────────────────────────────────────
function addGrowthRecord(record) {
  const sheet = getSheet('growth_log');
  const row = HEADERS.growth_log.map(h => {
    if (h === 'created_at') return new Date().toISOString();
    return record[h] !== undefined ? record[h] : '';
  });
  sheet.appendRow(row);
  return { id: record.id };
}

// ─────────────────────────────────────────
// 사진 업로드 (Drive)
// ─────────────────────────────────────────
function uploadPhoto(base64, mimeType, filename) {
  if (!base64) throw new Error('No image data');
  const folder = DriveApp.getFolderById(CONFIG.DRIVE_FOLDER_ID);
  const blob = Utilities.newBlob(
    Utilities.base64Decode(base64),
    mimeType || 'image/jpeg',
    filename || ('plant_' + Date.now() + '.jpg')
  );
  const file = folder.createFile(blob);
  // 누구나 보기 가능하게 권한 설정 (썸네일 URL 작동을 위해 필요)
  try {
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  } catch (e) {
    // 일부 워크스페이스에선 ANYONE 차단됨 - 도메인 공유로 대체
    try { file.setSharing(DriveApp.Access.DOMAIN_WITH_LINK, DriveApp.Permission.VIEW); } catch(_) {}
  }
  return { fileId: file.getId(), url: 'https://drive.google.com/thumbnail?id=' + file.getId() + '&sz=w800' };
}

// ─────────────────────────────────────────
// 유틸
// ─────────────────────────────────────────
function getSheet(key) {
  const name = CONFIG.SHEETS[key];
  const ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  const sheet = ss.getSheetByName(name);
  if (!sheet) throw new Error('시트를 찾을 수 없음: ' + name + ' (먼저 initSheets() 실행)');
  return sheet;
}

function todayISO() {
  const d = new Date();
  return Utilities.formatDate(d, Session.getScriptTimeZone() || 'Asia/Seoul', 'yyyy-MM-dd');
}

// ─────────────────────────────────────────
// 디버그/테스트용
// ─────────────────────────────────────────
function testPing() {
  Logger.log(JSON.stringify({ ok: true, time: new Date().toISOString() }));
}

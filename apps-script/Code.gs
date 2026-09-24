/**
 * 순소비 캘린더 v3 — 알림 수집 + 데이터 API (Apps Script 웹앱, 시트에 붙은 스크립트)
 *
 * 토큰 2개는 Secrets.gs(커밋 금지, clasp로만 push)의 상수에서 읽는다.
 *   const WRITE_TOKEN = '…';  // 폰 자동화 — 적재만 가능
 *   const READ_TOKEN  = '…';  // 앱 — 읽기·설정 저장·직접 추가
 * 처음 한 번: 편집기에서 setup()을 실행해 시트 탭을 만들고 권한을 승인한다.
 * 배포 업데이트는 항상 기존 배포 ID 갱신(npm run gas:deploy) — 새 배포 금지.
 */
const TZ = 'Asia/Seoul';
const SHEET_RAW = '알림';
const SHEET_SET = '설정';
const HEADER = ['받은시각', '앱', '제목', '내용', 'ID', '직접입력'];

/** 처음 한 번 실행: 시트 탭을 만들고 권한을 승인합니다. */
function setup() {
  rawSheet_();
  setSheet_();
  Logger.log('준비 완료. 이제 배포 › 웹 앱으로 배포하세요.');
}

/** 웹 앱은 화면을 제공하지 않는다 — 안내 문구만. */
function doGet() {
  return ContentService.createTextOutput(
    '순소비 캘린더 데이터 주소예요. 폰 자동화가 알림을 보내는 용도라 여기에는 아무것도 표시되지 않습니다. 앱은 홈 화면의 순소비 아이콘(GitHub Pages 주소)으로 여세요.'
  );
}

/** 모든 요청 입구. 처리 안 된 예외는 CORS 없는 구글 오류 페이지가 되므로 전체를 try/catch. */
function doPost(e) {
  try {
    return handlePost_(e);
  } catch (err) {
    return json_({ ok: false, error: 'server' });
  }
}

function handlePost_(e) {
  const p = readPayload_(e);
  if (p.action !== undefined && p.action !== '') return handleAction_(p);

  // action 없음 = 알림 적재 (WRITE 전용)
  if (!validWrite_(p.k)) return json_({ ok: false, error: 'token' });
  const app = String(p.app || '').slice(0, 100);
  const title = String(p.title || '').slice(0, 500);
  const body = String(p.body || p.text || '').slice(0, 2000);
  if (!title && !body) return json_({ ok: false, error: 'empty' });
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return json_({ ok: false, error: 'busy' });
  try {
    const sh = rawSheet_();
    const now = new Date();
    const last = sh.getLastRow();
    if (last > 1) {
      const n = Math.min(10, last - 1);
      const recent = sh.getRange(last - n + 1, 1, n, 4).getDisplayValues();
      for (let i = 0; i < recent.length; i++) {
        const r = recent[i];
        if (r[1] === app && r[2] === title && r[3] === body) {
          const t = Utilities.parseDate(r[0], TZ, 'yyyy-MM-dd HH:mm:ss');
          if (now.getTime() - t.getTime() < 90 * 1000) return json_({ ok: true, dup: true });
        }
      }
    }
    sh.appendRow([Utilities.formatDate(now, TZ, 'yyyy-MM-dd HH:mm:ss'), app, title, body, Utilities.getUuid(), '']);
    return json_({ ok: true });
  } finally {
    lock.releaseLock();
  }
}

/* ---------- 앱이 부르는 action (READ 전용) ---------- */
function handleAction_(p) {
  if (!validRead_(p.k)) return json_({ ok: false, error: 'token' });
  switch (String(p.action)) {
    case 'getData': return getData_(p);
    case 'saveSettings': return saveSettings_(p);
    case 'addManual': return addManual_(p);
    case 'purgeLiveCheck': return purgeLiveCheck_();
    default: return json_({ ok: false, error: 'action' });
  }
}

function getData_(p) {
  const sh = rawSheet_();
  const last = sh.getLastRow();
  let rows = last > 1 ? sh.getRange(2, 1, last - 1, HEADER.length).getDisplayValues() : [];
  const since = String(p.since || '');
  if (/^\d{4}-\d{2}-\d{2}$/.test(since)) rows = rows.filter(function (r) { return String(r[0]).slice(0, 10) >= since; });
  return json_({
    ok: true,
    rows: rows,
    settings: String(setSheet_().getRange('A1').getValue() || '{}'),
    serverTime: Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss')
  });
}

function saveSettings_(p) {
  const s = String(p.settings || '{}');
  if (s.length > 45000) return json_({ ok: false, error: 'settings-too-big' });
  try { JSON.parse(s); } catch (err) { return json_({ ok: false, error: 'settings-json' }); }
  setSheet_().getRange('A1').setValue(s);
  return json_({ ok: true });
}

function addManual_(p) {
  let raw = p.entry;
  if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch (err) { raw = null; } }
  const o = {
    desc: String(raw && raw.desc || '').slice(0, 100),
    amt: Math.abs(Math.round(Number(raw && raw.amt) || 0)),
    choice: String(raw && raw.choice || 'spend:기타').slice(0, 30),
    method: String(raw && raw.method || '현금').slice(0, 50),
    date: String(raw && raw.date || '').slice(0, 10)
  };
  if (!o.amt) return json_({ ok: false, error: 'amount' });
  const now = new Date();
  const today = Utilities.formatDate(now, TZ, 'yyyy-MM-dd');
  const ts = /^\d{4}-\d{2}-\d{2}$/.test(o.date) && o.date !== today ? o.date + ' 12:00:00' : Utilities.formatDate(now, TZ, 'yyyy-MM-dd HH:mm:ss');
  const row = [ts, '직접 입력', '', o.desc + ' ' + o.amt + '원', Utilities.getUuid(), JSON.stringify(o)];
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return json_({ ok: false, error: 'busy' });
  try { rawSheet_().appendRow(row); } finally { lock.releaseLock(); }
  return json_({ ok: true, row: row });
}

/** live-check가 넣은 테스트 행(앱 이름 __live_check__)만 삭제 */
function purgeLiveCheck_() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return json_({ ok: false, error: 'busy' });
  try {
    const sh = rawSheet_();
    const last = sh.getLastRow();
    let removed = 0;
    if (last > 1) {
      const vals = sh.getRange(2, 1, last - 1, HEADER.length).getDisplayValues();
      for (let i = vals.length - 1; i >= 0; i--) {
        if (vals[i][1] === '__live_check__') { sh.deleteRow(i + 2); removed++; }
      }
    }
    return json_({ ok: true, removed: removed });
  } finally {
    lock.releaseLock();
  }
}

/* ---------- 내부 ---------- */
function readPayload_(e) {
  let p = {};
  if (e && e.postData && e.postData.contents) {
    try { const j = JSON.parse(e.postData.contents); if (j && typeof j === 'object') p = j; } catch (err) { p = {}; }
  }
  if (e && e.parameter) for (const k in e.parameter) if (p[k] === undefined) p[k] = e.parameter[k];
  return p;
}
function validWrite_(k) { return validToken_(k, typeof WRITE_TOKEN === 'string' ? WRITE_TOKEN : ''); }
function validRead_(k) { return validToken_(k, typeof READ_TOKEN === 'string' ? READ_TOKEN : ''); }
function validToken_(k, tok) { return typeof tok === 'string' && tok.length >= 12 && tok.indexOf('__') !== 0 && typeof k === 'string' && k === tok; }
function rawSheet_() {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(SHEET_RAW);
  if (!sh) {
    sh = ss.insertSheet(SHEET_RAW);
    sh.getRange(1, 1, 1, HEADER.length).setValues([HEADER]);
    sh.setFrozenRows(1);
    sh.getRange('A:A').setNumberFormat('@');
  }
  return sh;
}
function setSheet_() {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(SHEET_SET);
  if (!sh) { sh = ss.insertSheet(SHEET_SET); sh.getRange('A1').setNumberFormat('@').setValue('{}'); }
  return sh;
}
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

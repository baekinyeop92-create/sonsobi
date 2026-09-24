/**
 * 순소비 캘린더 — 카드·은행 알림 수집 + 앱
 * 1) setup 한 번 실행  2) 웹 앱으로 두 번 배포 (받기용: 모든 사용자 / 앱: 나만)
 */
const TOKEN = '__TOKEN__';      // 비밀 키. 폰 자동화의 k 값과 같아야 합니다.
const TZ = 'Asia/Seoul';
const SHEET_RAW = '알림';
const SHEET_SET = '설정';
const HEADER = ['받은시각', '앱', '제목', '내용', 'ID', '직접입력'];

/** 처음 한 번 실행: 시트 탭을 만듭니다. */
function setup() {
  rawSheet_();
  setSheet_();
  Logger.log('준비 완료. 이제 배포 › 새 배포로 웹 앱을 두 번 배포하세요.');
}

/** 폰 자동화가 보내는 알림을 받습니다 (받기용 주소, 액세스: 모든 사용자). */
function doPost(e) {
  const p = readPayload_(e);
  if (!validToken_(p.k)) return json_({ ok: false, error: 'token' });
  const app = String(p.app || '').slice(0, 100);
  const title = String(p.title || '').slice(0, 500);
  const body = String(p.body || p.text || '').slice(0, 2000);
  if (!title && !body) return json_({ ok: false, error: 'empty' });
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
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

/** 앱 화면 (앱 주소, 액세스: 나만). 받기용 주소로 열면 앱을 보여주지 않습니다. */
function doGet(e) {
  const k = e && e.parameter ? e.parameter.k : '';
  if (!isOwner_() && !validToken_(k)) {
    return HtmlService.createHtmlOutput('<p style="font-family:sans-serif;padding:24px;line-height:1.6">이 주소는 알림을 받는 용도예요.<br>앱은 ‘나만’으로 배포한 앱 주소로 여세요.</p>')
      .setTitle('순소비 캘린더').addMetaTag('viewport', 'width=device-width, initial-scale=1');
  }
  const boot = '<script>window.__SONSOBI_KEY=' + JSON.stringify(TOKEN) + ';</script>';
  const html = HtmlService.createHtmlOutputFromFile('Index').getContent().replace('<head>', '<head>' + boot);
  return HtmlService.createHtmlOutput(html)
    .setTitle('순소비 캘린더')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
}

/* ---------- 앱이 부르는 함수 ---------- */
function getData(key) {
  check_(key);
  const sh = rawSheet_();
  const last = sh.getLastRow();
  const rows = last > 1 ? sh.getRange(2, 1, last - 1, HEADER.length).getDisplayValues() : [];
  return { rows: rows, settings: String(setSheet_().getRange('A1').getValue() || '{}') };
}

function saveSettings(key, json) {
  check_(key);
  const s = String(json || '{}');
  if (s.length > 45000) throw new Error('설정이 너무 커요. 개별 수정을 정리해 주세요.');
  JSON.parse(s);
  setSheet_().getRange('A1').setValue(s);
  return true;
}

function addManual(key, obj) {
  check_(key);
  const o = {
    desc: String(obj && obj.desc || '').slice(0, 100),
    amt: Math.abs(Math.round(Number(obj && obj.amt) || 0)),
    choice: String(obj && obj.choice || 'spend:기타').slice(0, 30),
    method: String(obj && obj.method || '현금').slice(0, 50),
    date: String(obj && obj.date || '').slice(0, 10)
  };
  if (!o.amt) throw new Error('금액을 입력하세요.');
  const now = new Date();
  const today = Utilities.formatDate(now, TZ, 'yyyy-MM-dd');
  const ts = /^\d{4}-\d{2}-\d{2}$/.test(o.date) && o.date !== today ? o.date + ' 12:00:00' : Utilities.formatDate(now, TZ, 'yyyy-MM-dd HH:mm:ss');
  const row = [ts, '직접 입력', '', o.desc + ' ' + o.amt + '원', Utilities.getUuid(), JSON.stringify(o)];
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try { rawSheet_().appendRow(row); } finally { lock.releaseLock(); }
  return row;
}

/** 설정 확인용: 테스트 결제 1건(4,500원)을 넣습니다. 확인 후 시트에서 그 줄을 지우세요. */
function testPost() {
  const res = doPost({ postData: { contents: JSON.stringify({
    k: TOKEN, app: '테스트', title: '현대카드 승인',
    body: '홍*동님 4,500원 일시불 ' + Utilities.formatDate(new Date(), TZ, 'MM/dd HH:mm') + ' 스타벅스 테스트점 누적 4,500원'
  }) }, parameter: {} });
  Logger.log(res.getContent());
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
function validToken_(k) { return TOKEN.length >= 12 && TOKEN.indexOf('__') !== 0 && k === TOKEN; }
function check_(key) { if (!validToken_(key)) throw new Error('권한이 없어요.'); }
function isOwner_() {
  try {
    const a = Session.getActiveUser().getEmail();
    return !!a && a === Session.getEffectiveUser().getEmail();
  } catch (err) { return false; }
}
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

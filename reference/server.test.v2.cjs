const fs = require('fs'); const vm = require('vm');
let src = fs.readFileSync(require('path').join(__dirname, 'Code.gs'), 'utf8').replace("'__TOKEN__'", "'abcDEF123456xyz'");
// --- mocks ---
const sheets = {};
function mkSheet(name) {
  const data = []; let fmt = {};
  return { name, data,
    getLastRow: () => data.length,
    getRange(a, b, c, d) {
      if (typeof a === 'string') { // 'A:A' or 'A1'
        return { setNumberFormat() { return this; }, setValue(v) { data[0] = data[0] || []; data[0][0] = v; return this; }, getValue() { return data[0] ? data[0][0] : ''; } };
      }
      return { getDisplayValues: () => data.slice(a - 1, a - 1 + c).map(r => r.slice(b - 1, b - 1 + d).map(x => String(x ?? ''))),
               setValues: (v) => { v.forEach((row, i) => { data[a - 1 + i] = row.slice(); }); } };
    },
    appendRow(r) { data.push(r.slice()); }, setFrozenRows() {} };
}
let activeEmail = 'me@gmail.com';
let clock = new Date('2026-09-24T03:00:00Z').getTime();
const ctx = {
  SpreadsheetApp: { getActive: () => ({ getSheetByName: n => sheets[n] || null, insertSheet: n => (sheets[n] = mkSheet(n)) }) },
  Utilities: {
    formatDate: (d, tz, f) => { const k = new Date(d.getTime() + 9 * 3600e3); const p = n => String(n).padStart(2, '0');
      const Y = k.getUTCFullYear(), M = p(k.getUTCMonth() + 1), D = p(k.getUTCDate()), h = p(k.getUTCHours()), m = p(k.getUTCMinutes()), s = p(k.getUTCSeconds());
      return f.replace('yyyy', Y).replace('MM', M).replace('dd', D).replace('HH', h).replace('mm', m).replace('ss', s); },
    parseDate: (s, tz, f) => new Date(s.replace(' ', 'T') + '+09:00'),
    getUuid: (() => { let i = 0; return () => 'uuid-' + (++i); })()
  },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  ContentService: { MimeType: { JSON: 'json' }, createTextOutput: t => ({ t, setMimeType() { return this; }, getContent() { return this.t; } }) },
  HtmlService: { createHtmlOutput: h => ({ h, setTitle() { return this; }, addMetaTag() { return this; } }),
                 createHtmlOutputFromFile: () => ({ getContent: () => '<!DOCTYPE html><html><head><base target="_top"></head><body>APP</body></html>' }) },
  Session: { getActiveUser: () => ({ getEmail: () => activeEmail }), getEffectiveUser: () => ({ getEmail: () => 'me@gmail.com' }) },
  Logger: { log: m => console.log('  [log]', m) },
  JSON, String, Number, Math, Object,
  Date: class extends Date { constructor(...a) { a.length ? super(...a) : super(clock); } static now() { return clock; } }
};
vm.createContext(ctx); vm.runInContext(src, ctx);
const post = (obj, asForm) => JSON.parse(ctx.doPost(asForm ? { postData: { contents: new URLSearchParams(obj).toString() }, parameter: obj } : { postData: { contents: JSON.stringify(obj) }, parameter: {} }).getContent());
const R = [];
const t = (name, cond) => { R.push([name, !!cond]); };
ctx.setup();
t('setup creates sheets', sheets['알림'] && sheets['설정']);
t('bad token rejected', post({ k: 'nope', title: 'x', body: '1원' }).ok === false);
t('empty rejected', post({ k: 'abcDEF123456xyz' }).error === 'empty');
t('json post ok', post({ k: 'abcDEF123456xyz', app: '현대카드', title: '현대카드 승인', body: '홍*동님 4,500원 일시불 09/24 12:00 스타벅스' }).ok);
t('dup within 90s suppressed', post({ k: 'abcDEF123456xyz', app: '현대카드', title: '현대카드 승인', body: '홍*동님 4,500원 일시불 09/24 12:00 스타벅스' }).dup === true);
clock += 120 * 1000;
t('same after 2 min accepted', post({ k: 'abcDEF123456xyz', app: '현대카드', title: '현대카드 승인', body: '홍*동님 4,500원 일시불 09/24 12:00 스타벅스' }).dup === undefined);
t('form-encoded post ok', post({ k: 'abcDEF123456xyz', app: 'KB스타뱅킹', title: '[KB국민] 출금', body: '출금 650,000원 김영희 잔액 1원' }, true).ok);
const raw = sheets['알림'].data;
t('rows appended (header+3)', raw.length === 4);
t('ts format', /^2026-09-24 12:0\d:\d\d$/.test(raw[1][0]));
let err = null; try { ctx.getData('wrong'); } catch (e) { err = e.message; }
t('getData rejects bad key', err);
const d = ctx.getData('abcDEF123456xyz');
t('getData returns rows', d.rows.length === 3 && d.rows[2][1] === 'KB스타뱅킹' && d.settings === '{}');
ctx.saveSettings('abcDEF123456xyz', JSON.stringify({ myName: '홍길동', rules: [], overrides: { 'uuid-1': 'fixed' } }));
t('settings saved', JSON.parse(ctx.getData('abcDEF123456xyz').settings).myName === '홍길동');
let e2 = null; try { ctx.saveSettings('abcDEF123456xyz', 'not json'); } catch (e) { e2 = e.message; } t('bad settings json rejected', e2);
const m = ctx.addManual('abcDEF123456xyz', { desc: '시장 떡볶이', amt: '-8000', choice: 'spend:식비', method: '현금', date: '2026-09-20' });
t('manual row', m[0] === '2026-09-20 12:00:00' && JSON.parse(m[5]).amt === 8000 && m[1] === '직접 입력');
t('doGet owner gets app with key injected', ctx.doGet({ parameter: {} }).h.includes('window.__SONSOBI_KEY="abcDEF123456xyz"'));
activeEmail = '';
t('doGet anonymous blocked', !ctx.doGet({ parameter: {} }).h.includes('__SONSOBI_KEY'));
t('doGet anonymous with k allowed', ctx.doGet({ parameter: { k: 'abcDEF123456xyz' } }).h.includes('__SONSOBI_KEY'));
ctx.testPost();
// placeholder token must never validate
const ctx2 = Object.assign({}, ctx); vm.createContext(ctx2); vm.runInContext(fs.readFileSync(require('path').join(__dirname, 'Code.gs'), 'utf8'), ctx2);
t('placeholder token never valid', JSON.parse(ctx2.doPost({ postData: { contents: JSON.stringify({ k: '__TOKEN__', body: '1원' }) }, parameter: {} }).getContent()).ok === false);
for (const [n, ok] of R) console.log((ok ? 'PASS ' : 'FAIL ') + n);
console.log(R.every(r => r[1]) ? 'ALL PASS' : 'SOME FAIL');

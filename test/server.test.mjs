/* Apps Script 서버 모의 테스트 — reference/server.test.v2.cjs를 v3 API로 이식.
   Secrets.gs는 읽지 않는다: vm 컨텍스트에 가짜 토큰을 먼저 주입한다. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const src = readFileSync(new URL('../apps-script/Code.gs', import.meta.url), 'utf8');
const W = 'writeTOKENabc123456';
const R = 'readTOKENxyz987654';

/* ---------- Apps Script 목(mock) ---------- */
function makeEnv({ tokens = `const WRITE_TOKEN = '${W}'; const READ_TOKEN = '${R}';` } = {}) {
  const sheets = {};
  function mkSheet(name) {
    const data = [];
    return {
      name, data,
      getLastRow: () => data.length,
      getRange(a, b, c, d) {
        if (typeof a === 'string') { // 'A:A' 또는 'A1'
          return { setNumberFormat() { return this; }, setValue(v) { data[0] = data[0] || []; data[0][0] = v; return this; }, getValue() { return data[0] ? data[0][0] : ''; } };
        }
        return {
          getDisplayValues: () => data.slice(a - 1, a - 1 + c).map(r => r.slice(b - 1, b - 1 + d).map(x => String(x ?? ''))),
          setValues: v => { v.forEach((row, i) => { data[a - 1 + i] = row.slice(); }); }
        };
      },
      appendRow(r) { data.push(r.slice()); },
      deleteRow(n) { data.splice(n - 1, 1); },
      setFrozenRows() {}
    };
  }
  const env = { sheets, clock: new Date('2026-09-24T03:00:00Z').getTime(), lockOk: true };
  const ctx = {
    SpreadsheetApp: { getActive: () => ({ getSheetByName: n => sheets[n] || null, insertSheet: n => (sheets[n] = mkSheet(n)) }) },
    Utilities: {
      formatDate: (d, tz, f) => {
        const k = new Date(d.getTime() + 9 * 3600e3); const p = n => String(n).padStart(2, '0');
        return f.replace('yyyy', k.getUTCFullYear()).replace('MM', p(k.getUTCMonth() + 1)).replace('dd', p(k.getUTCDate()))
          .replace('HH', p(k.getUTCHours())).replace('mm', p(k.getUTCMinutes())).replace('ss', p(k.getUTCSeconds()));
      },
      parseDate: (s, tz, f) => new Date(s.replace(' ', 'T') + '+09:00'),
      getUuid: (() => { let i = 0; return () => 'uuid-' + (++i); })()
    },
    LockService: { getScriptLock: () => ({ tryLock: () => env.lockOk, releaseLock() {} }) },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: t => ({ t, setMimeType() { return this; }, getContent() { return this.t; } }) },
    Logger: { log() {} },
    JSON, String, Number, Math, Object, RegExp,
    Date: class extends Date { constructor(...a) { a.length ? super(...a) : super(env.clock); } static now() { return env.clock; } }
  };
  vm.createContext(ctx);
  vm.runInContext(tokens, ctx);       // Secrets.gs 대신 가짜 토큰 주입
  vm.runInContext(src, ctx);
  env.ctx = ctx;
  env.post = (obj, asForm) => JSON.parse(ctx.doPost(asForm
    ? { postData: { contents: new URLSearchParams(obj).toString() }, parameter: obj }
    : { postData: { contents: JSON.stringify(obj) }, parameter: {} }).getContent());
  return env;
}

const env = makeEnv();
const { post, ctx, sheets } = env;

test('setup이 시트 탭을 만든다', () => {
  ctx.setup();
  assert.ok(sheets['알림'] && sheets['설정']);
});

test('doGet은 안내 문구만 — 토큰·HTML 없음', () => {
  const out = ctx.doGet().getContent();
  assert.match(out, /순소비/);
  assert.ok(!out.includes(W) && !out.includes(R));
  assert.ok(!/<html|<script/i.test(out));
});

test('적재: 잘못된 토큰 거부', () => {
  assert.deepEqual(post({ k: 'nope', title: 'x', body: '1원' }), { ok: false, error: 'token' });
});

test('토큰 분리: READ 토큰으로 적재 거부', () => {
  assert.deepEqual(post({ k: R, title: 'x', body: '1원' }), { ok: false, error: 'token' });
});

test('적재: 빈 알림 거부', () => {
  assert.equal(post({ k: W }).error, 'empty');
});

test('적재: JSON POST 성공', () => {
  assert.equal(post({ k: W, app: '현대카드', title: '현대카드 승인', body: '홍*동님 4,500원 일시불 09/24 12:00 스타벅스' }).ok, true);
});

test('적재: 90초 안 같은 알림은 dup', () => {
  assert.equal(post({ k: W, app: '현대카드', title: '현대카드 승인', body: '홍*동님 4,500원 일시불 09/24 12:00 스타벅스' }).dup, true);
});

test('적재: 2분 뒤 같은 알림은 새 행', () => {
  env.clock += 120 * 1000;
  assert.equal(post({ k: W, app: '현대카드', title: '현대카드 승인', body: '홍*동님 4,500원 일시불 09/24 12:00 스타벅스' }).dup, undefined);
});

test('적재: form-urlencoded POST 성공', () => {
  assert.equal(post({ k: W, app: 'KB스타뱅킹', title: '[KB국민] 출금', body: '출금 650,000원 김영희 잔액 1원' }, true).ok, true);
});

test('행이 쌓이고 받은시각 형식이 맞다', () => {
  const raw = sheets['알림'].data;
  assert.equal(raw.length, 4); // 헤더 + 3
  assert.match(raw[1][0], /^2026-09-24 12:0\d:\d\d$/);
});

test('getData: WRITE 토큰 거부 (토큰 분리)', () => {
  assert.deepEqual(post({ action: 'getData', k: W }), { ok: false, error: 'token' });
});

test('getData: READ 토큰으로 rows·settings·serverTime', () => {
  const d = post({ action: 'getData', k: R });
  assert.equal(d.ok, true);
  assert.equal(d.rows.length, 3);
  assert.equal(d.rows[2][1], 'KB스타뱅킹');
  assert.equal(d.settings, '{}');
  assert.match(d.serverTime, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
});

test('getData: since로 이전 날짜 행 제외', () => {
  sheets['알림'].data.splice(1, 0, ['2026-09-01 09:00:00', '옛날앱', '제목', '본문 1,000원', 'uuid-old', '']);
  const all = post({ action: 'getData', k: R });
  assert.equal(all.rows.length, 4);
  const d = post({ action: 'getData', k: R, since: '2026-09-24' });
  assert.equal(d.rows.length, 3);
  assert.ok(d.rows.every(r => r[0].slice(0, 10) >= '2026-09-24'));
});

test('saveSettings: 저장·재조회', () => {
  const s = JSON.stringify({ myName: '홍길동', rules: [], overrides: { 'uuid-1': 'fixed' } });
  assert.equal(post({ action: 'saveSettings', k: R, settings: s }).ok, true);
  assert.equal(JSON.parse(post({ action: 'getData', k: R }).settings).myName, '홍길동');
});

test('saveSettings: JSON 아니면 거부', () => {
  const r = post({ action: 'saveSettings', k: R, settings: 'not json' });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'settings-json');
});

test('saveSettings: 45,000자 초과 거부', () => {
  const r = post({ action: 'saveSettings', k: R, settings: '"' + 'x'.repeat(45001) + '"' });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'settings-too-big');
});

test('addManual: 행 형식과 응답', () => {
  const r = post({ action: 'addManual', k: R, entry: { desc: '시장 떡볶이', amt: '-8000', choice: 'spend:식비', method: '현금', date: '2026-09-20' } });
  assert.equal(r.ok, true);
  assert.equal(r.row[0], '2026-09-20 12:00:00');
  assert.equal(r.row[1], '직접 입력');
  assert.equal(JSON.parse(r.row[5]).amt, 8000);
});

test('addManual: 금액 없으면 거부', () => {
  assert.equal(post({ action: 'addManual', k: R, entry: { desc: 'x' } }).error, 'amount');
});

test('purgeLiveCheck: __live_check__ 행만 삭제', () => {
  post({ k: W, app: '__live_check__', title: 'live', body: '테스트 1원' });
  env.clock += 120 * 1000;
  post({ k: W, app: '__live_check__', title: 'live', body: '테스트 2원' });
  const before = sheets['알림'].data.length;
  const r = post({ action: 'purgeLiveCheck', k: R });
  assert.equal(r.ok, true);
  assert.equal(r.removed, 2);
  assert.equal(sheets['알림'].data.length, before - 2);
  assert.ok(sheets['알림'].data.every(row => row[1] !== '__live_check__'));
});

test('모르는 action은 거부', () => {
  assert.deepEqual(post({ action: 'what', k: R }), { ok: false, error: 'action' });
});

test('잠금 실패 시 busy', () => {
  env.lockOk = false;
  assert.deepEqual(post({ k: W, title: 'x', body: '1원' }), { ok: false, error: 'busy' });
  env.lockOk = true;
});

test('처리 중 예외가 나도 {ok:false,error:server} JSON', () => {
  const orig = ctx.SpreadsheetApp.getActive;
  ctx.SpreadsheetApp.getActive = () => { throw new Error('boom'); };
  assert.deepEqual(post({ k: W, title: 'x', body: '1원' }), { ok: false, error: 'server' });
  assert.deepEqual(post({ action: 'getData', k: R }), { ok: false, error: 'server' });
  ctx.SpreadsheetApp.getActive = orig;
});

test('자리표시자·짧은 토큰은 절대 통과 못 한다', () => {
  const bad = makeEnv({ tokens: "const WRITE_TOKEN = '__WRITE_TOKEN__'; const READ_TOKEN = 'short';" });
  assert.deepEqual(bad.post({ k: '__WRITE_TOKEN__', title: 'x', body: '1원' }), { ok: false, error: 'token' });
  assert.deepEqual(bad.post({ action: 'getData', k: 'short' }), { ok: false, error: 'token' });
});

test('Secrets.gs가 없어도 (토큰 미선언) 전부 거부', () => {
  const none = makeEnv({ tokens: ';' });
  assert.deepEqual(none.post({ k: '', title: 'x', body: '1원' }), { ok: false, error: 'token' });
  assert.deepEqual(none.post({ action: 'getData', k: '' }), { ok: false, error: 'token' });
});

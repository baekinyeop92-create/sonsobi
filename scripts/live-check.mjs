/* 실제 배포 점검 (DoD 2): npm run live-check
   .env.local의 API_URL·WRITE_TOKEN·READ_TOKEN으로
   적재 → 조회 포함 → WRITE로 조회 거부 → READ로 적재 거부 → 테스트 행 삭제를 확인한다. */
const { API_URL, WRITE_TOKEN, READ_TOKEN } = process.env;
if (!API_URL || !WRITE_TOKEN || !READ_TOKEN) {
  console.error('.env.local에 API_URL, WRITE_TOKEN, READ_TOKEN이 있어야 합니다.');
  process.exit(1);
}

const post = async body => {
  const res = await fetch(API_URL, { method: 'POST', body: JSON.stringify(body) });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
};
let fail = 0;
const check = (name, ok, extra) => { console.log((ok ? '✓' : '✗') + ' ' + name + (!ok && extra ? ` — ${extra}` : '')); if (!ok) fail++; };

const stamp = Date.now().toString(36);
const r1 = await post({ k: WRITE_TOKEN, app: '__live_check__', title: 'live-check', body: `점검 4,500원 ${stamp}` });
check('WRITE 토큰으로 적재', r1.ok === true, JSON.stringify(r1));

const r2 = await post({ action: 'getData', k: READ_TOKEN });
const found = r2.ok === true && (r2.rows || []).some(row => row[1] === '__live_check__' && String(row[3]).includes(stamp));
check('READ 토큰으로 조회 — 방금 넣은 행 포함', found, JSON.stringify({ ok: r2.ok, error: r2.error, rows: r2.rows && r2.rows.length }));

const r3 = await post({ action: 'getData', k: WRITE_TOKEN });
check('WRITE 토큰으로 조회 거부', r3.ok === false && r3.error === 'token', JSON.stringify(r3));

const r4 = await post({ k: READ_TOKEN, app: '__live_check__', title: 'x', body: '1원' });
check('READ 토큰으로 적재 거부', r4.ok === false && r4.error === 'token', JSON.stringify(r4));

const r5 = await post({ action: 'purgeLiveCheck', k: READ_TOKEN });
check('테스트 행 삭제', r5.ok === true && r5.removed >= 1, JSON.stringify(r5));

const r6 = await post({ action: 'getData', k: READ_TOKEN });
check('삭제 뒤 테스트 행 없음', r6.ok === true && !(r6.rows || []).some(row => row[1] === '__live_check__'));

if (fail) { console.error(`\n${fail}개 실패`); process.exit(1); }
console.log('\n전부 ✓');

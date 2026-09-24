/* 순소비 캘린더 v3 — 화면. 해석·분류·중복 제거·집계는 web/core/* 를 그대로 사용한다.
   알림에서 온 텍스트는 반드시 esc()/textContent로만 출력한다 (WRITE 토큰만으로 넣을 수 있는 값).
   ES 모듈이라 항상 strict mode. */
import { CATS } from './core/categories.js';
import { parseRows } from './core/parse.js';
import { normSettings, fnv } from './core/classify.js';
import { deriveRows } from './core/dedupe.js';
import { groupByMonth, aggregate } from './core/aggregate.js';

/* ================= helpers ================= */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const p2 = n => String(n).padStart(2, '0');
const num = n => Math.round(n).toLocaleString('ko-KR');
const won = n => num(n) + '원';
const man = n => { const a = Math.abs(n), s = n < 0 ? '−' : '';
  if (a >= 1e8) return s + (a / 1e8).toFixed(1).replace(/\.0$/, '') + '억';
  if (a >= 1e5) return s + Math.round(a / 1e4) + '만';
  if (a >= 1e4) return s + (a / 1e4).toFixed(1).replace(/\.0$/, '') + '만';
  return s + num(a); };
const pctStr = (a, b) => { if (!(b > 0) || !(a > 0)) return '0%'; const p = a / b * 100; return p < 1 ? '<1%' : Math.round(p) + '%'; };
const DOW = ['일','월','화','수','목','금','토'];
const shiftYM = (ym, d) => { const [y, m] = ym.split('-').map(Number); const t = new Date(y, m - 1 + d, 1); return t.getFullYear() + '-' + p2(t.getMonth() + 1); };
const fmtDate = d => d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
const nowYM = () => fmtDate(new Date()).slice(0, 7);
const todayStr = () => fmtDate(new Date());
const fmtAt = ms => { const d = new Date(ms); return `${p2(d.getMonth() + 1)}.${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`; };
function jong(w) { const c = String(w).trim().slice(-1).charCodeAt(0); return (c >= 0xAC00 && c <= 0xD7A3) ? (c - 0xAC00) % 28 : -1; }
const ro = w => { const j = jong(w); return w + (j < 0 ? '(으)로' : (j === 0 || j === 8) ? '로' : '으로'); };
const iga = w => { const j = jong(w); return w + (j < 0 ? '이(가)' : j === 0 ? '가' : '이'); };
const LS = {
  get(k) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
  del(k) { try { localStorage.removeItem(k); } catch (e) {} }
};

/* ================= 연결 상태 ================= */
const K_CONN = 'sonsobi.conn.v1';       // { api, k }
const K_CACHE = 'sonsobi.cache.v1';     // { rows, settings(문자열), at }
const K_DEMO = 'sonsobi.demo.v1';
const K_SET = 'sonsobi.demo.settings.v2';
const CONN = LS.get(K_CONN);
const LIVE = !!(CONN && CONN.api && CONN.k);
const MODE = LIVE ? 'live' : (LS.get(K_DEMO) ? 'demo' : 'gate');

const errMsg = code =>
  code === 'token' ? '연결 코드가 맞지 않아요. 설정에서 연결을 해제하고 최신 코드로 다시 연결해 주세요.'
  : code === 'busy' ? '시트가 잠시 바빠요. 잠시 후 다시 시도해 주세요.'
  : code === 'settings-too-big' ? '설정이 너무 커요. 개별 수정을 정리해 주세요.'
  : code === 'server' ? '서버에서 오류가 났어요. 잠시 후 다시 시도해 주세요.'
  : '요청을 처리하지 못했어요' + (code ? ` (${code})` : '') + '.';

/** Apps Script 호출 — 헤더 없는 text/plain POST(사전 요청 없음), 토큰은 본문에.
    GAS가 드물게 일시적인 404·비JSON을 주므로, 다시 보내도 안전한 요청만 1회 재시도. */
async function api(action, extra) {
  const retryable = action !== 'addManual'; // addManual은 재시도하면 중복 저장 위험
  let last = null;
  for (let i = 0; i < (retryable ? 2 : 1); i++) {
    if (i > 0) await new Promise(r => setTimeout(r, 1500));
    const res = await fetch(CONN.api, { method: 'POST', body: JSON.stringify(Object.assign({ action, k: CONN.k }, extra || {})) });
    if (!res.ok) { last = new Error('HTTP ' + res.status); continue; }
    const d = await res.json().catch(() => null);
    if (!d) { last = new Error('서버 응답을 읽지 못했어요. 잠시 후 다시 시도해 주세요.'); continue; }
    if (d.ok !== true) throw new Error(errMsg(d.error));
    return d;
  }
  throw last || new Error('요청을 처리하지 못했어요.');
}

/* ================= buckets (화면 표시용) ================= */
const ORDER = ['spend', 'fixed', 'save', 'review', 'income', 'excl'];
const B = {
  spend:  { label: '소비',      color: 'var(--s-spend)' },
  fixed:  { label: '고정지출',  color: 'var(--s-fixed)' },
  save:   { label: '저축·투자', color: 'var(--s-save)' },
  review: { label: '분류 필요', color: 'var(--s-review)' },
  income: { label: '수입',      color: 'var(--ink-2)' },
  excl:   { label: '제외',      color: 'var(--s-excl)' },
  left:   { label: '남은 돈',   color: 'var(--s-left)' }
};
function glyph(b) {
  const c = B[b].color;
  const inner = {
    spend:  `<rect x="0" y="1.5" width="8" height="5" rx="1.5" fill="${c}"/>`,
    fixed:  `<circle cx="4" cy="4" r="3.6" fill="${c}"/>`,
    save:   `<rect x=".5" y=".5" width="7" height="7" rx="1" fill="${c}"/>`,
    review: `<path d="M4 .3 7.9 7.6H.1Z" fill="${c}"/>`,
    income: `<path d="M3 .3h2v2.7h2.7v2H5v2.7H3V5H.3V3H3z" fill="${c}"/>`,
    excl:   `<rect x=".5" y=".5" width="7" height="7" rx="1" fill="${c}"/><path d="M2.4 2.4 5.6 5.6M5.6 2.4 2.4 5.6" stroke="var(--surface)" stroke-width="1.2" stroke-linecap="round"/>`,
    left:   `<rect x=".5" y=".5" width="7" height="7" rx="1" fill="${c}" stroke="var(--line-strong)"/>`
  }[b];
  return `<svg class="g" viewBox="0 0 8 8" aria-hidden="true">${inner}</svg>`;
}

/* ================= state ================= */
const DEMO_SETTINGS = { myName: '홍길동', rules: [{ id: 'd1', value: '김영희', bucket: 'fixed' }], overrides: {} };
const S = { raw: [], tx: [], unrec: [], rows: [], month: nowYM(), selDay: null, filter: 'all', cat: null,
  byMonth: new Map(), cache: new Map(), months: [], settings: normSettings(null), lastAt: '',
  loading: LIVE, error: '', offline: false, cachedAt: 0 };
function parseAllState() {
  const { tx, unrec, lastAt } = parseRows(S.raw);
  S.tx = tx; S.unrec = unrec; S.lastAt = lastAt;
}
function deriveState() {
  S.rows = deriveRows(S.tx, S.settings);
  S.byMonth = groupByMonth(S.rows);
  S.months = [...S.byMonth.keys()].sort();
  S.cache = new Map();
}
function agg(ym) {
  if (!S.cache.has(ym)) S.cache.set(ym, aggregate(ym, S.byMonth.get(ym) || []));
  return S.cache.get(ym);
}

/* ================= persistence ================= */
let saveTimer = null, saving = false, saveAgain = false;
function saveSettings() {
  if (!LIVE) { LS.set(K_SET, S.settings); return; }
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSettings, 500);
}
async function flushSettings() {
  if (saving) { saveAgain = true; return; }
  saving = true;
  try {
    await api('saveSettings', { settings: JSON.stringify(S.settings) });
    const c = LS.get(K_CACHE); if (c) { c.settings = JSON.stringify(S.settings); LS.set(K_CACHE, c); }
  } catch (e) { toast('설정을 저장하지 못했어요. 인터넷 연결을 확인해 주세요.'); }
  saving = false;
  if (saveAgain) { saveAgain = false; flushSettings(); }
}
let lastLoad = 0;
async function loadLive(quiet) {
  if (!quiet) { S.loading = true; renderBanner(); }
  try {
    const d = await api('getData');
    S.raw = d.rows || [];
    try { S.settings = normSettings(d.settings ? JSON.parse(d.settings) : null); } catch (e) { S.settings = normSettings(null); }
    S.error = ''; S.offline = false; S.cachedAt = Date.now(); lastLoad = Date.now();
    LS.set(K_CACHE, { rows: S.raw, settings: d.settings || '{}', at: S.cachedAt });
    const keepMonth = S.months.length > 0;
    parseAllState(); deriveState();
    if (!keepMonth) S.month = nowYM();
  } catch (e) {
    if (!navigator.onLine || (e && e.name === 'TypeError')) S.offline = true;
    else S.error = '데이터를 불러오지 못했어요: ' + (e && e.message ? e.message : e);
  }
  S.loading = false;
  renderAll();
}

/* ================= demo data (v2 그대로) ================= */
function mulberry32(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function makeDemoRaw() {
  const R = mulberry32(2718);
  const pick = a => a[Math.floor(R() * a.length)];
  const rt = (lo, hi, st) => Math.round((lo + R() * (hi - lo)) / st) * st;
  const fmtA = n => num(n);
  const POOL = {
    lunch: ['김밥천국','한솥도시락','본죽&비빔밥','서브웨이','맘스터치','순대국 명가','샐러디','역전우동'],
    cafe: ['스타벅스 역삼점','메가MGC커피','컴포즈커피','투썸플레이스','이디야커피'],
    conv: ['GS25 역삼점','CU 테헤란점','세븐일레븐'],
    deliv: ['배달의민족','쿠팡이츠','요기요'],
    shop: ['쿠팡','무신사','오늘의집'],
    night: ['이자카야 하루','역삼 포차','연탄 고깃집','마라탕 하오'],
    etc: [['다이소',3000,25000],['올리브영',8000,45000],['온누리약국',4000,18000],['CGV 강남',14000,30000],['교보문고',12000,40000],['카카오T',5800,18000],['(주)에이치앤비',9000,30000]]
  };
  const CARDS = [
    { app: '현대카드', title: '현대카드 승인', fmt: (a, md, hm, m, c) => `홍*동님 ${a}원 일시불 ${md} ${hm} ${m} 누적 ${c}원`, cfmt: (a, md, hm, m) => `홍*동님 ${a}원 취소 ${md} ${hm} ${m}` },
    { app: '신한 SOL페이', title: '신한카드', fmt: (a, md, hm, m, c) => `[신한카드(1234)승인] 홍*동 ${a}원(일시불)${md} ${hm} ${m} 누적${c}원` },
    { app: 'KB Pay', title: 'KB국민카드', fmt: (a, md, hm, m, c) => `KB국민체크(5678)승인 홍*동님 ${a}원 일시불 ${md} ${hm} ${m} 누적${c}원` }
  ];
  const now = new Date(), Y = now.getFullYear(), M = now.getMonth(), T = now.getDate(), NH = now.getHours();
  const out = []; let seq = 0;
  let prevCard = [rt(700000, 950000, 10), rt(250000, 420000, 10)];
  let bal = 2480000;
  for (let k = 5; k >= 0; k--) {
    const d0 = new Date(Y, M - k, 1), y = d0.getFullYear(), m = d0.getMonth() + 1, dim = new Date(y, m, 0).getDate(), last = k === 0 ? T : dim;
    const cum = [0, 0, 0];
    const push = (day, h, mi, app, title, body) => {
      if (day > last || (k === 0 && day === T && h > NH)) return;
      out.push([`${y}-${p2(m)}-${p2(day)} ${p2(h)}:${p2(mi)}:${p2(Math.floor(R() * 60))}`, app, title, body, 'demo-' + (seq++), '']);
    };
    const md = day => `${p2(m)}/${p2(day)}`;
    const cardPay = (day, h, merchant, amount, ci) => {
      const c = CARDS[ci]; const mi = Math.floor(R() * 60);
      if (day > last || (k === 0 && day === T && h > NH)) return;
      cum[ci] += amount;
      push(day, h, mi, c.app, c.title, c.fmt(fmtA(amount), md(day), `${p2(h)}:${p2(mi)}`, merchant, fmtA(cum[ci])));
      return mi;
    };
    const cardIdx = () => R() < 0.6 ? 0 : 1;
    for (let day = 1; day <= last; day++) {
      const dow = new Date(y, m - 1, day).getDay(), wk = dow > 0 && dow < 6;
      if (wk) cardPay(day, 12, pick(POOL.lunch), rt(8500, 13500, 500), cardIdx());
      if (R() < 0.6) cardPay(day, 9 + Math.floor(R() * 6), pick(POOL.cafe), rt(4300, 6800, 100), cardIdx());
      if (R() < 0.18) cardPay(day, 19 + Math.floor(R() * 3), pick(POOL.deliv), rt(16000, 32000, 500), 0);
      if (R() < 0.14) cardPay(day, 10 + Math.floor(R() * 12), pick(POOL.shop), rt(9900, 86000, 10), 0);
      if (!wk && R() < 0.5) cardPay(day, 19 + Math.floor(R() * 3), pick(POOL.night), rt(24000, 78000, 1000), cardIdx());
      if (R() < 0.18) { const [nm, lo, hi] = pick(POOL.etc); cardPay(day, 11 + Math.floor(R() * 10), nm, rt(lo, hi, 100), cardIdx()); }
    }
    for (const day of [5, 18]) {
      const v = rt(3200, 9800, 100), h = 21;
      const mi = cardPay(day, h, pick(POOL.conv), v, 2);
      if (mi !== undefined) { bal -= v; push(day, h, mi, 'KB스타뱅킹', '[KB국민] 출금', `${md(day)} ${p2(h)}:${p2(mi)} 123-45**-678 체크카드출금 ${fmtA(v)}원 ${'GS25'} 잔액 ${fmtA(bal)}원`); }
    }
    const bankOut = (day, h, amount, who) => { bal -= amount; push(day, h, 5, 'KB스타뱅킹', '[KB국민] 출금', `${md(day)} ${p2(h)}:05 123-45**-678 출금 ${fmtA(amount)}원 ${who} 잔액 ${fmtA(bal)}원`); };
    bal += 3850000; push(10, 9, 2, 'KB스타뱅킹', '[KB국민] 입금', `${md(10)} 09:02 123-45**-678 입금 3,850,000원 (주)한빛테크급여 잔액 ${fmtA(bal)}원`);
    bankOut(1, 8, 650000, '김영희');
    bankOut(25, 6, rt(160000, 210000, 10), '아파트관리비');
    bankOut(11, 10, 300000, '미래에셋증권');
    bankOut(12, 12, 1000000, '홍길동');
    push(12, 12, 6, '카카오뱅크', '입금', '입금 1,000,000원 | 홍길동');
    bankOut(14, 7, prevCard[0], '현대카드');
    bankOut(14, 7, prevCard[1], '신한카드');
    push(15, 10, 0, '카카오뱅크', '출금', '출금 500,000원 | 자유적금');
    push(15, 10, 1, '카카오뱅크', '출금', '출금 100,000원 | 주택청약');
    bankOut(20, 19, 30000, '토스');
    push(20, 19, 6, '토스', '토스머니', '토스머니 30,000원 충전 완료');
    push(21, 4, 12, '현대카드', '현대카드 승인', `홍*동님 69,000원 일시불 ${md(21)} 04:12 SKT통신요금 누적 ${fmtA(cum[0] + 69000)}원`);
    push(3, 3, 5, '신한 SOL페이', '신한카드', `[신한카드(1234)승인] 홍*동 17,000원(일시불)${md(3)} 03:05 넷플릭스 누적${fmtA(cum[1] + 17000)}원`);
    if (R() < 0.75) push(17, 21, 30, '토스', '송금 완료', `박지훈님에게 ${fmtA(rt(20000, 60000, 1000))}원을 보냈어요`);
    push(9, 14, 3, '현대카드', '현대카드 승인취소', CARDS[0].cfmt('23,900', md(9), '14:03', '쿠팡'));
    push(19, 20, 40, '카카오페이', '결제 완료', `배달의민족에서 ${fmtA(22000)}원 결제했어요`);
    if (19 <= last && !(k === 0 && 19 === T && 20 > NH)) { cum[0] += 22000; push(19, 20, 40, CARDS[0].app, CARDS[0].title, CARDS[0].fmt('22,000', md(19), '20:40', '배달의민족', fmtA(cum[0]))); }
    push(8, 18, 0, '현대카드', '결제 예정 금액 안내', `${m}월 결제 예정 금액 ${fmtA(prevCard[0])}원입니다. 결제일 14일`);
    push(28, 0, 10, '카카오뱅크', '입금', `입금 ${fmtA(rt(900, 1600, 10))}원 | 예금이자`);
    prevCard = [cum[0], cum[1]];
  }
  out.sort((a, b) => a[0].localeCompare(b[0]));
  return out;
}

/* ================= rendering ================= */
function monthBounds() {
  const ms = S.months.length ? S.months : [nowYM()];
  const max = ms[ms.length - 1] > nowYM() ? ms[ms.length - 1] : nowYM();
  return { min: ms[0] < nowYM() ? ms[0] : nowYM(), max };
}
function renderTop() {
  const [y, m] = S.month.split('-');
  $('#mLabel').textContent = y + '.' + m;
  const b = monthBounds();
  $('#prevM').disabled = S.month <= b.min;
  $('#nextM').disabled = S.month >= b.max;
  $('#refresh').hidden = !LIVE;
  if (LIVE && S.lastAt) $('#subline').textContent = `마지막 알림 ${S.lastAt.slice(5, 16).replace('-', '.')} · 카드대금·내 계좌 이체는 빼고 봅니다`;
}
function renderBanner() {
  let h = '';
  if (!LIVE) h = `<div class="banner"><span><b>예시 데이터</b>를 보고 있어요. 카드·은행 알림 예시로 만든 숫자입니다.</span><span class="row"><a class="btn primary" href="./setup.html">내 폰에 설치하기</a><button class="btn" type="button" data-open="connect">연결 코드 입력</button></span></div>`;
  else if (S.loading && !S.raw.length) h = `<div class="msg">불러오는 중…</div>`;
  else if (S.offline) h = S.raw.length
    ? `<div class="msg">오프라인이에요 — ${S.cachedAt ? esc(fmtAt(S.cachedAt)) + '에 ' : ''}마지막으로 불러온 내용을 보여주고 있어요. <button class="btn sm" type="button" id="retry">다시 시도</button></div>`
    : `<div class="msg err">오프라인이에요. 인터넷에 연결한 뒤 다시 시도해 주세요. <button class="btn sm" type="button" id="retry">다시 시도</button></div>`;
  else if (S.error) h = `<div class="msg err">${esc(S.error)} <button class="btn sm" type="button" id="retry">다시 시도</button></div>`;
  else if (!S.raw.length && !S.loading) h = `<div class="msg">아직 받은 알림이 없어요. 카드로 결제하면 1분 안에 여기에 나타납니다. 안 나타나면 폰 자동화 설정을 확인하세요.</div>`;
  $('#banner').innerHTML = h;
}
function renderHero(a) {
  const [y, m] = S.month.split('-').map(Number);
  const net = a.spend + a.fixed;
  const cur = S.month === nowYM(), today = new Date().getDate();
  const pa = agg(shiftYM(S.month, -1));
  let prevNet = pa.spend + pa.fixed, cmpLabel = '지난달보다';
  if (cur) { prevNet = pa.rows.filter(r => +r.date.slice(8) <= today && (r.b === 'spend' || r.b === 'fixed')).reduce((s, r) => s - r.amt, 0); cmpLabel = `지난달 같은 기간(1~${today}일)보다`; }
  let delta = '';
  if (pa.rows.length) {
    const diff = net - prevNet;
    if (Math.abs(diff) >= 1) { const less = diff < 0; const p = prevNet > 0 ? Math.round(Math.abs(diff) / prevNet * 100) : null;
      delta = `<span class="flag ${less ? 'good' : 'bad'}"><svg viewBox="0 0 10 10" aria-hidden="true"><path d="${less ? 'M5 9 1 3h8Z' : 'M5 1l4 6H1Z'}" fill="currentColor"/></svg>${cmpLabel} ${won(Math.abs(diff))} ${less ? '덜' : '더'} 썼어요${p !== null ? ` (${less ? '−' : '+'}${p}%)` : ''}</span>`; }
  }
  const review = a.reviewN ? `<a class="flag bad" href="#review">${glyph('review')} 분류 필요 ${a.reviewN}건 · ${won(a.review)}</a>` : '';
  const outParts = [['spend', a.spend], ['fixed', a.fixed], ['save', a.save], ['review', a.review], ['excl', a.exclOut]].map(([b, v]) => [b, Math.max(0, v)]);
  const outTotal = outParts.reduce((s, [, v]) => s + v, 0);
  const used = Math.max(0, a.spend) + Math.max(0, a.fixed) + Math.max(0, a.save);
  const incParts = [['spend', Math.max(0, a.spend)], ['fixed', Math.max(0, a.fixed)], ['save', Math.max(0, a.save)], ['left', Math.max(0, a.income - used)]];
  const incBase = Math.max(a.income, used);
  const stack = (parts, label) => `<div class="stack" role="img" aria-label="${esc(label)}">${parts.filter(([, v]) => v > 0).map(([b, v]) => `<span style="flex:${v} 1 0;background:${B[b].color}"></span>`).join('')}</div>`;
  const legend = (parts, total) => `<div class="legend">${parts.filter(([, v]) => v > 0).map(([b, v]) => `<div class="li">${glyph(b)}<span>${B[b].label}</span><span class="v">${num(v)} · ${pctStr(v, total)}</span></div>`).join('')}</div>`;
  const aria1 = '나간 돈 구성: ' + outParts.filter(([, v]) => v > 0).map(([b, v]) => `${B[b].label} ${pctStr(v, outTotal)}`).join(', ');
  const aria2 = '수입 대비: ' + incParts.filter(([, v]) => v > 0).map(([b, v]) => `${B[b].label} ${pctStr(v, incBase)}`).join(', ');
  const over = used - a.income;
  $('#hero').innerHTML = `
    <div>
      <div class="eyebrow">${y}년 ${m}월 순소비${cur ? ` · ${today}일까지` : ''}</div>
      <div class="big">${num(net)}<small>원</small></div>
      <div class="hero-sub">소비 <span class="num">${num(a.spend)}</span> + 고정지출 <span class="num">${num(a.fixed)}</span></div>
      <div class="hero-flags">${delta}${review}</div>
    </div>
    <div class="bars">
      <div>
        <div class="bar-head"><span><b>통장·카드에서 나간 돈</b> <span class="num">${won(outTotal)}</span></span><span class="psub">중복·카드대금·내 돈 이동 <span class="num">${won(a.exclOut)}</span>은 뺐어요</span></div>
        ${outTotal > 0 ? stack(outParts, aria1) + legend(outParts, outTotal) : '<p class="empty">이 달에는 나간 돈이 없어요.</p>'}
      </div>
      <div>
        <div class="bar-head"><span><b>수입 대비</b> <span class="num">${won(a.income)}</span></span><span class="psub">${a.income > 0 ? `저축률 <span class="num">${pctStr(Math.max(0, a.save), a.income)}</span>${over > 0 ? ` · 수입보다 <span class="num">${won(over)}</span> 더 나감` : ''}` : '이 달 수입 기록이 없어요'}</span></div>
        ${a.income > 0 ? stack(incParts, aria2) + legend(incParts, incBase) : ''}
      </div>
    </div>`;
}
function renderCalendar(a) {
  const [y, m] = S.month.split('-').map(Number);
  const start = new Date(y, m - 1, 1).getDay(), dim = new Date(y, m, 0).getDate();
  const valOf = x => x ? (S.cat ? (x.cats[S.cat] || 0) : x.spend) : 0;
  const vals = Object.values(a.byDay).map(valOf).filter(v => v > 0).sort((p, q) => p - q);
  const q = f => vals.length ? vals[Math.min(vals.length - 1, Math.floor(f * (vals.length - 1)))] : Infinity;
  const t1 = q(0.25), t2 = q(0.5), t3 = q(0.8), today = todayStr();
  let h = '';
  for (let i = 0; i < start; i++) h += '<div class="day pad" aria-hidden="true"></div>';
  for (let d = 1; d <= dim; d++) {
    const ds = S.month + '-' + p2(d), x = a.byDay[ds], dow = (start + d - 1) % 7, v = valOf(x);
    const l = v <= 0 ? 0 : v <= t1 ? 1 : v <= t2 ? 2 : v <= t3 ? 3 : 4;
    const mk = x && !S.cat ? ['fixed', 'save', 'review', 'income'].filter(b => x[b]) : [];
    const cls = ['day', dow === 0 ? 'sun' : '', dow === 6 ? 'sat' : '', ds === today ? 'today' : '', ds === S.selDay ? 'sel' : '', ds > today ? 'future' : '', mk.length ? 'has-mk' : ''].filter(Boolean).join(' ');
    const lab = `${m}월 ${d}일 ${DOW[dow]}요일` + (v ? `, ${S.cat || '소비'} ${won(v)}` : '') + mk.map(b => `, ${B[b].label} ${won(Math.abs(x[b]))}`).join('');
    h += `<button type="button" class="${cls}" data-date="${ds}" data-l="${l}" aria-label="${esc(lab)}" aria-pressed="${ds === S.selDay}"><span class="dtop"><span class="dnum">${d}</span><span class="mks">${mk.map(glyph).join('')}</span></span><span class="damt${v < 0 ? ' neg' : ''}">${v ? man(v) : ''}</span></button>`;
  }
  $('#calGrid').innerHTML = h;
  $('#calSub').innerHTML = S.cat ? `<span class="fchip">${esc(S.cat)}만 보는 중<button type="button" data-clearcat="1" aria-label="항목 필터 해제">✕</button></span>` : '칸 숫자 = 그날 소비 (고정지출·저축 제외)';
  $('#mkey').innerHTML = S.cat ? '' : ['fixed', 'save', 'review', 'income'].map(b => `<span>${glyph(b)}${B[b].label}</span>`).join('');
}
const choiceOf = r => r.b === 'spend' ? 'spend:' + (r.cat || '기타') : r.b;
function choiceOptions(cur, extra) {
  const opt = (v, l) => `<option value="${esc(v)}"${v === cur ? ' selected' : ''}>${esc(l)}</option>`;
  return `<optgroup label="소비 항목">${CATS.map(c => opt('spend:' + c, c)).join('')}</optgroup><optgroup label="그 외">${['fixed', 'save', 'income', 'excl'].concat(extra || []).map(b => opt(b, B[b].label)).join('')}</optgroup>`;
}
function bucketSelect(r) {
  const cur = choiceOf(r);
  const opts = choiceOptions(cur, r.b === 'review' ? ['review'] : []) + (r.ov ? '<option value="__auto">자동 분류로 되돌리기</option>' : '');
  const label = r.b === 'spend' ? (r.cat || '기타') : B[r.b].label;
  return `<label class="bsel${r.ov ? ' ov' : ''}">${glyph(r.b)}<span class="bl">${esc(label)}</span><select data-key="${esc(r.key)}" aria-label="${esc((r.desc || '거래') + ' 항목 바꾸기')}">${opts}</select></label>`;
}
const amtText = r => (r.amt > 0 ? '+' : '') + num(Math.abs(r.amt));
function txRow(r, withDate) {
  const meta = [r.method, r.b === 'fixed' && r.cat ? r.cat : '', r.why].filter(Boolean).join(' · ');
  const left = withDate ? `${+r.date.slice(5, 7)}/${+r.date.slice(8)}` : (r.time || '—');
  return `<div class="tx${r.b === 'excl' ? ' x' : ''}"><span class="tx-time">${esc(left)}</span>
    <div><div class="tx-desc">${esc(r.desc)}</div><div class="tx-meta">${esc(meta)}</div>${r.raw && (r.desc === '(가맹점 미확인)' || r.b === 'review') ? `<div class="tx-raw">${esc(r.raw)}</div>` : ''}</div>
    <div class="tx-side"><span class="tx-amt${r.amt > 0 ? ' pos' : ''}">${amtText(r)}</span>${bucketSelect(r)}</div></div>`;
}
function defaultDay(a) {
  const t = todayStr(); if (t.startsWith(S.month)) return t;
  const ds = Object.keys(a.byDay).sort(); return ds.length ? ds[ds.length - 1] : S.month + '-01';
}
function renderDay(a) {
  if (!S.selDay || !S.selDay.startsWith(S.month)) S.selDay = defaultDay(a);
  const ds = S.selDay, [y, m, d] = ds.split('-').map(Number), dow = new Date(y, m - 1, d).getDay();
  const rows = a.rows.filter(r => r.date === ds).sort((p, q) => p.ts.localeCompare(q.ts));
  const x = a.byDay[ds];
  const chips = x ? ['spend', 'fixed', 'save', 'review', 'income', 'excl'].map(b => { const v = x[b];
    return v ? `<span class="dchip">${glyph(b)}${B[b].label} <span class="num">${b === 'income' ? '+' : ''}${num(v)}</span></span>` : ''; }).join('') : '';
  $('#dayPanel').innerHTML = `<div class="phead"><h2 class="ptitle">${m}월 ${d}일 ${DOW[dow]}요일</h2><span class="psub">${rows.length}건</span></div>
    ${chips ? `<div class="dchips">${chips}</div>` : ''}
    ${rows.length ? `<div class="txl">${rows.map(r => txRow(r)).join('')}</div>` : '<p class="empty">이 날은 기록이 없어요.</p>'}`;
  $$('#calGrid .day[data-date]').forEach(b => { const on = b.dataset.date === ds; b.classList.toggle('sel', on); b.setAttribute('aria-pressed', on); });
}
function renderCats(a) {
  const ents = Object.entries(a.byCat).filter(([, v]) => v > 0).sort((p, q) => q[1] - p[1]);
  const total = ents.reduce((s, [, v]) => s + v, 0);
  if (S.cat && !a.byCat[S.cat]) S.cat = null;
  const max = Math.max(1, ...ents.map(([, v]) => v));
  $('#catSub').textContent = total > 0 ? `소비 ${won(total)} · 누르면 그 항목만 보기` : '';
  const box = $('#cats'); box.classList.toggle('filtering', !!S.cat);
  box.innerHTML = ents.length ? ents.map(([c, v]) => `<button type="button" class="catbtn" data-cat="${esc(c)}" aria-pressed="${S.cat === c}"><span class="cat-name">${esc(c)} <span class="psub">${a.catN[c]}</span></span><span class="cat-track"><span class="cat-bar" style="width:${(v / max * 100).toFixed(2)}%"></span></span><span class="cat-amt">${num(v)}</span><span class="cat-pct">${pctStr(v, total)}</span></button>`).join('')
    : '<p class="empty">이 달 소비 기록이 없어요.</p>';
  const rows = S.cat ? a.rows.filter(r => r.b === 'spend' && (r.cat || '기타') === S.cat).sort((p, q) => q.ts.localeCompare(p.ts)) : [];
  $('#catRows').innerHTML = S.cat ? `<div class="catrows"><div class="fg-head" style="border:0"><span>${glyph('spend')}${esc(S.cat)} ${rows.length}건</span><button class="btn quiet sm" type="button" data-clearcat="1">전체 보기</button></div><div class="txl">${rows.map(r => txRow(r, true)).join('')}</div></div>` : '';
}
function niceScale(maxV, n) { const raw = maxV / n, mag = Math.pow(10, Math.floor(Math.log10(raw))), nr = raw / mag; const step = (nr <= 1 ? 1 : nr <= 2 ? 2 : nr <= 2.5 ? 2.5 : nr <= 5 ? 5 : 10) * mag; return { step, max: Math.ceil(maxV / step) * step }; }
function roundTop(x, y, w, h, r) { r = Math.min(r, h, w / 2); return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`; }
let trendData = [];
function renderTrend() {
  const el = $('#trend'); const W = Math.max(260, Math.floor(el.clientWidth || 520)), H = 232, ml = 46, mr = 6, mt = 12, mb = 28;
  const months = []; for (let i = 5; i >= 0; i--) months.push(shiftYM(S.month, -i));
  trendData = months.map(ym => { const a = agg(ym); return { ym, spend: Math.max(0, a.spend), fixed: Math.max(0, a.fixed), save: Math.max(0, a.save), income: Math.max(0, a.income), n: a.rows.length }; });
  const sc = niceScale(Math.max(10000, ...trendData.map(d => Math.max(d.spend + d.fixed + d.save, d.income))), 4);
  const iw = W - ml - mr, ih = H - mt - mb, band = iw / trendData.length, bw = Math.min(24, band * 0.5);
  const Y = v => mt + ih - v / sc.max * ih;
  let s = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="최근 6개월 소비·고정지출·저축 추이와 수입">`;
  for (let v = 0; v <= sc.max + 1e-6; v += sc.step) { const yy = Math.round(Y(v)) + 0.5; s += `<line x1="${ml}" x2="${W - mr}" y1="${yy}" y2="${yy}" class="${v === 0 ? 'axis' : 'grid'}"/><text x="${ml - 8}" y="${yy}" class="tick" text-anchor="end" dominant-baseline="middle">${v === 0 ? '0' : man(v)}</text>`; }
  trendData.forEach((d, i) => {
    const cx = ml + band * i + band / 2, x = cx - bw / 2, sel = d.ym === S.month;
    s += `<g class="col${sel ? ' sel' : ''}">`;
    const segs = [['spend', d.spend], ['fixed', d.fixed], ['save', d.save]].filter(z => z[1] > 0);
    let base = 0;
    segs.forEach(([b, v], j) => { const y1 = Y(base + v), y0 = Y(base) - (j > 0 ? 2 : 0), h = Math.max(0, y0 - y1);
      s += j === segs.length - 1 ? `<path class="mk" d="${roundTop(x, y1, bw, h, 4)}" fill="${B[b].color}"/>` : `<rect class="mk" x="${x}" y="${y1}" width="${bw}" height="${h}" fill="${B[b].color}"/>`; base += v; });
    if (d.income > 0) { const yi = Y(d.income); s += `<line class="inc mk" x1="${cx - bw / 2 - 7}" x2="${cx + bw / 2 + 7}" y1="${yi}" y2="${yi}"/>`; }
    s += `<text x="${cx}" y="${H - 9}" text-anchor="middle" class="xl${sel ? ' on' : ''}">${+d.ym.slice(5)}월</text><rect class="hit" x="${ml + band * i}" y="${mt}" width="${band}" height="${ih + mb}" tabindex="0" data-i="${i}" role="button" aria-label="${+d.ym.slice(5)}월 보기"/></g>`;
  });
  el.innerHTML = s + '</svg><div class="tip" id="tip" hidden></div>';
  $('#tlegend').innerHTML = ['spend', 'fixed', 'save'].map(b => `<span>${glyph(b)}${B[b].label}</span>`).join('') + '<span><i class="ln"></i>수입</span>';
  $('#trendTable').innerHTML = `<table><thead><tr><th>월</th><th class="r">소비</th><th class="r">고정지출</th><th class="r">저축·투자</th><th class="r">수입</th></tr></thead><tbody>${trendData.map(d => `<tr><td>${d.ym.replace('-', '.')}</td><td class="r num mono">${num(d.spend)}</td><td class="r num mono">${num(d.fixed)}</td><td class="r num mono">${num(d.save)}</td><td class="r num mono">${num(d.income)}</td></tr>`).join('')}</tbody></table>`;
}
function showTip(i, evt) {
  const d = trendData[i]; const tip = $('#tip'); if (!d || !tip) return;
  const row = (b, v) => `<div class="r">${glyph(b)}<span>${B[b].label}</span><span class="num mono">${num(v)}</span></div>`;
  tip.innerHTML = `<b>${d.ym.replace('-', '년 ')}월${d.n ? '' : ' · 기록 없음'}</b>${row('spend', d.spend)}${row('fixed', d.fixed)}${row('save', d.save)}${row('income', d.income)}`;
  tip.hidden = false;
  const box = $('#trend').getBoundingClientRect(), hit = evt.target.getBoundingClientRect();
  tip.style.left = Math.max(0, Math.min(box.width - tip.offsetWidth, hit.left - box.left + hit.width / 2 - tip.offsetWidth / 2)) + 'px'; tip.style.top = '4px';
}
function renderFlows(a) {
  const group = b => { const rows = a.rows.filter(r => r.b === b).sort((p, q) => p.ts.localeCompare(q.ts)); const sum = rows.reduce((s, r) => s - r.amt, 0);
    return `<div class="fg"><div class="fg-head"><span>${glyph(b)}${B[b].label}</span><span class="num">${won(sum)}</span></div>${rows.length ? `<div class="txl">${rows.map(r => txRow(r, true)).join('')}</div>` : `<p class="empty">이 달 ${B[b].label} 기록이 없어요.</p>`}</div>`; };
  $('#flows').innerHTML = group('fixed') + group('save');
}
function renderReview(a) {
  const rv = a.rows.filter(r => r.b === 'review').sort((p, q) => p.amt - q.amt);
  const reasons = Object.entries(a.reasons).sort((p, q) => (q[1].out + q[1].inn) - (p[1].out + p[1].inn));
  const un = S.unrec.filter(u => u.date.startsWith(S.month)).sort((p, q) => q.ts.localeCompare(p.ts));
  $('#reviewBody').innerHTML = `
    <div class="fg"><div class="fg-head"><span>${glyph('review')}분류 필요</span><span class="num">${rv.length}건 · ${won(a.review)}</span></div>
      ${rv.length ? `<p class="hint">사람 이름으로 나간 이체예요. 항목을 바꾸면 같은 받는 분에게 모두 적용할지 묻습니다. 집주인에게 보낸 돈이면 ‘고정지출’로 바꾸세요.</p><div class="txl">${rv.map(r => txRow(r, true)).join('')}</div>` : '<p class="empty">나간 이체가 모두 분류됐어요.</p>'}</div>
    <div class="fg"><div class="fg-head"><span>${glyph('excl')}소비에서 뺀 돈</span><span class="num">${won(a.exclOut)}</span></div>
      ${reasons.length ? reasons.map(([why, g]) => `<details class="xr"><summary><span class="rs">${esc(why)} · ${g.n}건</span><span class="num">${g.out ? num(g.out) : ''}${g.out && g.inn ? ' / ' : ''}${g.inn ? '+' + num(g.inn) : ''}</span></summary><div class="txl">${g.rows.map(r => txRow(r, true)).join('')}</div></details>`).join('') : '<p class="empty">뺀 내역이 없어요.</p>'}</div>
    ${un.length ? `<div class="fg"><div class="fg-head"><span>인식 못 한 알림</span><span class="num">${un.length}건</span></div><p class="hint">금액이 없거나 형식이 달라 기록하지 않은 알림입니다. 결제였다면 ‘직접 추가’로 넣어 주세요.</p><div class="txl">${un.slice(0, 30).map(u => `<div class="tx"><span class="tx-time">${+u.date.slice(5, 7)}/${+u.date.slice(8)}</span><div><div class="tx-desc">${esc(u.src || '알림')}</div><div class="tx-meta">${esc(u.why)}</div><div class="tx-raw">${esc(u.raw)}</div></div><span></span></div>`).join('')}</div></div>` : ''}`;
}
function renderTable(a) {
  const counts = { all: a.rows.length }; for (const r of a.rows) counts[r.b] = (counts[r.b] || 0) + 1;
  if (S.filter !== 'all' && !counts[S.filter]) S.filter = 'all';
  $('#allSummary').textContent = `이번 달 거래 전체 (${num(a.rows.length)}건)`;
  $('#chips').innerHTML = [['all', '전체']].concat(ORDER.map(b => [b, B[b].label])).filter(([k]) => counts[k])
    .map(([k, l]) => `<button type="button" class="chipbtn" data-filter="${k}" aria-pressed="${S.filter === k}">${k !== 'all' ? glyph(k) : ''}${l} ${counts[k]}</button>`).join('');
  if (!$('#allDetails').open) { $('#allTable').innerHTML = ''; return; }
  const rows = a.rows.filter(r => S.filter === 'all' || r.b === S.filter).sort((p, q) => q.ts.localeCompare(p.ts));
  $('#allTable').innerHTML = rows.length ? `<table><thead><tr><th>날짜</th><th>내용</th><th>결제수단</th><th class="r">금액</th><th>항목</th></tr></thead><tbody>${rows.map(r => `<tr class="${r.b === 'excl' ? 'x' : ''}"><td class="num mono">${r.date.slice(5).replace('-', '.')} ${esc(r.time)}</td><td class="wrap" title="${esc(r.why)}">${esc(r.desc)}</td><td>${esc(r.method)}</td><td class="r num mono amt">${amtText(r)}</td><td>${bucketSelect(r)}</td></tr>`).join('')}</tbody></table>` : '<p class="empty">해당 거래가 없어요.</p>';
}
const ruleLabel = r => r.bucket === 'spend' ? `소비 · ${r.cat || '자동'}` : B[r.bucket].label;
function renderSettings() {
  const st = S.settings, nOv = Object.keys(st.overrides).length;
  $('#settings').innerHTML = `
    <div class="phead" style="margin-bottom:0"><h2 class="ptitle" id="setTitle">분류 설정</h2><button class="btn quiet" type="button" data-close="settings">닫기</button></div>
    <div class="setgrid">
      <div>
        <h3>자동으로 빼는 것</h3>
        <div class="field" style="margin-bottom:10px"><label for="myName">내 이름 — 받는 분이 나인 이체(내 다른 계좌로 옮긴 돈)를 뺍니다</label><input id="myName" class="inp" value="${esc(st.myName)}" placeholder="예: 홍길동" autocomplete="off"></div>
        <details style="font-size:13px"><summary style="cursor:pointer;color:var(--ink-2)">기본 분류 기준 보기</summary>
          <ul class="builtin">
            <li><b>제외</b>: 카드대금, 내 계좌 간 이체, 페이머니 충전, 같은 결제가 여러 앱에 잡힌 중복 알림(15분 안, 같은 금액 — 카드 알림을 남김), 들어온 이체</li>
            <li><b>저축·투자</b>: 적금·청약·예금·증권·ISA·IRP·연금저축·CMA로 나간 돈</li>
            <li><b>고정지출</b>: 월세·관리비·통신·보험·OTT·구독·공과금</li>
            <li><b>분류 필요</b>: 위에 안 걸린, 사람에게 보낸 이체</li>
            <li><b>소비</b>: 카드·페이 결제. 가맹점 이름으로 항목을 정하고, 모르면 ‘기타’</li>
          </ul></details>
      </div>
      <div>
        <h3>내 규칙 <span class="psub">위에서부터 먼저 적용</span></h3>
        <div class="row"><input id="ruleText" class="inp" style="flex:1 1 9em;width:auto" placeholder="가맹점·받는 분 이름 (예: 김영희)" autocomplete="off">
          <select id="ruleChoice" class="inp" style="width:auto">${choiceOptions('fixed')}</select>
          <button class="btn" id="ruleAdd" type="button">추가</button></div>
        ${st.rules.length ? `<ul class="rules">${st.rules.map(r => `<li><span>‘${esc(r.value)}’ → ${glyph(r.bucket)} ${esc(ruleLabel(r))}</span><button class="btn quiet sm" type="button" data-delrule="${esc(r.id)}" aria-label="‘${esc(r.value)}’ 규칙 삭제">삭제</button></li>`).join('')}</ul>` : '<p class="psub" style="margin:8px 0 0">아직 규칙이 없어요. 거래의 항목을 바꾸면 여기에 쌓입니다.</p>'}
        ${nOv ? `<div class="row" style="margin-top:10px;font-size:13px">한 건씩 직접 바꾼 거래 ${nOv}건 <button class="btn quiet sm" type="button" id="clearOv">모두 자동으로</button></div>` : ''}
      </div>
    </div>
    ${LIVE ? `<div class="row"><button class="btn danger sm" type="button" id="disconnect">연결 해제</button><span class="psub">이 폰의 연결 정보와 캐시를 지웁니다. 시트 데이터는 그대로예요.</span></div>` : ''}
    <p class="psub" style="margin:0">${LIVE ? '설정은 내 구글 시트의 ‘설정’ 탭에 저장됩니다.' : '예시 모드라 설정은 이 브라우저에만 저장됩니다.'}</p>`;
}
function renderAdd() {
  $('#addPanel').innerHTML = `
    <div class="phead" style="margin-bottom:0"><h2 class="ptitle" id="addTitle">직접 추가</h2><button class="btn quiet" type="button" data-close="addPanel">닫기</button></div>
    <p class="psub" style="margin:0">현금 결제나 알림이 오지 않은 거래를 넣습니다.</p>
    <div class="formgrid">
      <div class="field"><label for="mDate">날짜</label><input id="mDate" class="inp" type="date" value="${todayStr()}"></div>
      <div class="field"><label for="mAmt">금액 (원)</label><input id="mAmt" class="inp" type="number" inputmode="numeric" min="1" placeholder="12000"></div>
      <div class="field"><label for="mDesc">내용</label><input id="mDesc" class="inp" placeholder="예: 시장 떡볶이" autocomplete="off"></div>
      <div class="field"><label for="mChoice">항목</label><select id="mChoice" class="inp">${choiceOptions('spend:식비')}</select></div>
      <div class="field"><label for="mMethod">결제수단</label><input id="mMethod" class="inp" value="현금" autocomplete="off"></div>
    </div>
    <div class="row"><button class="btn primary" id="mSave" type="button">추가</button><span class="psub" id="mMsg"></span></div>`;
}
function renderAll() {
  if (MODE === 'gate') return;
  const a = agg(S.month);
  renderTop(); renderBanner(); renderHero(a); renderCalendar(a); renderDay(a); renderCats(a); renderTrend(); renderFlows(a); renderReview(a); renderTable(a);
  if (!$('#settings').hidden) renderSettings();
}

/* ================= toast ================= */
let toastTimer = null;
function toast(text, actions = []) {
  const el = $('#toast'); clearTimeout(toastTimer);
  el.innerHTML = `<span>${esc(text)}</span>` + actions.map((a, i) => `<button type="button" data-ta="${i}" class="${i === 0 ? 'solid' : ''}">${esc(a.text)}</button>`).join('') + (actions.length ? '<button type="button" data-ta="x">닫기</button>' : '');
  el.hidden = false; el._actions = actions;
  toastTimer = setTimeout(() => { el.hidden = true; }, actions.length ? 12000 : 3500);
}
$('#toast').addEventListener('click', e => { const b = e.target.closest('[data-ta]'); if (!b) return; const el = $('#toast'); const a = el._actions && el._actions[+b.dataset.ta]; el.hidden = true; if (a) a.fn(); });

/* ================= actions ================= */
const choiceLabel = v => v.startsWith('spend:') ? v.slice(6) : B[v].label;
function setChoice(key, val) {
  const st = S.settings;
  if (val === '__auto') delete st.overrides[key]; else st.overrides[key] = val;
  saveSettings(); deriveState(); renderAll();
  if (val === '__auto') { toast('자동 분류로 되돌렸어요.'); return; }
  const r = S.rows.find(t => t.key === key); if (!r) return;
  const same = r.desc && r.desc !== '(가맹점 미확인)' ? S.rows.filter(x => x.key !== key && x.desc === r.desc && choiceOf(x) !== val) : [];
  if (same.length) toast(`‘${r.desc}’ ${same.length}건도 ${ro(choiceLabel(val))} 바꿀까요?`, [{ text: '모두 적용', fn: () => addRule(r.desc, val, key) }]);
  else toast(`${ro(choiceLabel(val))} 옮겼어요.`);
}
function addRule(value, choice, key) {
  value = String(value || '').trim(); if (!value) { toast('규칙에 넣을 이름을 적어 주세요.'); return; }
  const [bucket, cat] = choice.split(':');
  const st = S.settings;
  st.rules = st.rules.filter(r => r.value !== value);
  st.rules.unshift({ id: fnv(value + choice + Date.now()), value, bucket, cat: bucket === 'spend' ? (cat || '') : '' });
  if (key) delete st.overrides[key];
  for (const t of S.tx) if (t.desc === value && st.overrides[t.key]) delete st.overrides[t.key];
  saveSettings(); deriveState(); renderAll();
  toast(`‘${value}’${iga(value).slice(value.length)} 들어간 거래는 이제 ${ro(choiceLabel(choice))} 분류해요.`);
}
async function addManual() {
  const amt = Math.round(Number($('#mAmt').value)); const desc = $('#mDesc').value.trim(); const date = $('#mDate').value; const choice = $('#mChoice').value; const method = $('#mMethod').value.trim() || '현금';
  if (!(amt > 0)) { $('#mMsg').textContent = '금액을 입력하세요.'; return; }
  const o = { desc: desc || '(내용 없음)', amt, choice, method, date };
  const nowT = new Date(); const ts = (date === todayStr() ? todayStr() + ` ${p2(nowT.getHours())}:${p2(nowT.getMinutes())}:${p2(nowT.getSeconds())}` : (date || todayStr()) + ' 12:00:00');
  let row = [ts, '직접 입력', '', `${o.desc} ${amt}원`, 'm-' + Date.now().toString(36), JSON.stringify(o)];
  $('#mSave').disabled = true;
  if (LIVE) {
    try { const d = await api('addManual', { entry: o }); row = d.row; }
    catch (e) { $('#mMsg').textContent = '저장하지 못했어요: ' + (e.message || e); $('#mSave').disabled = false; return; }
  }
  S.raw.push(row); parseAllState(); deriveState(); S.month = (date || todayStr()).slice(0, 7); S.selDay = date || todayStr();
  renderAll(); renderAdd(); toast(LIVE ? '추가했어요.' : '추가했어요. 예시 모드라 새로고침하면 사라집니다.');
}

/* ================= 연결 (F9) ================= */
function decodeConnCode(code) {
  code = String(code || '').trim();
  if (!code) return { err: '연결 코드를 붙여넣어 주세요.' };
  if (!/^SNS1\./.test(code)) return { err: '연결 코드는 SNS1.으로 시작해요. 전체를 복사해서 붙여넣어 주세요.' };
  let obj;
  try {
    let s = code.slice(5).replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    obj = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(s), c => c.charCodeAt(0))));
  } catch (e) { return { err: '연결 코드를 읽지 못했어요. 복사할 때 중간이 잘리지 않았는지 확인해 주세요.' }; }
  const apiUrl = String(obj && obj.api || '');
  const k = String(obj && obj.k || '');
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(apiUrl)) return { err: '연결 코드 안의 서버 주소가 올바르지 않아요.' };
  if (k.length < 12) return { err: '연결 코드 안의 토큰이 올바르지 않아요.' };
  return { api: apiUrl, k };
}
async function connect() {
  const msg = $('#connMsg');
  const say = (t, bad) => { msg.innerHTML = `<div class="msg${bad ? ' err' : ''}">${esc(t)}</div>`; };
  const r = decodeConnCode($('#connCode').value);
  if (r.err) { say(r.err, true); return; }
  const btn = $('#connGo'); btn.disabled = true; say('연결을 확인하는 중…');
  try {
    let d = null;
    for (let i = 0; i < 2 && !d; i++) { // 일시적인 404·비JSON은 한 번 더
      if (i > 0) await new Promise(w => setTimeout(w, 1500));
      const res = await fetch(r.api, { method: 'POST', body: JSON.stringify({ action: 'getData', k: r.k }) });
      try { d = await res.json(); } catch (e) { d = null; }
    }
    if (!d) { say('서버 응답을 읽지 못했어요. 연결 코드가 최신인지 확인해 주세요.', true); btn.disabled = false; return; }
    if (d.ok !== true) { say(d.error === 'token' ? '코드는 읽었지만 토큰이 맞지 않아요. 가장 최근에 받은 연결 코드인지 확인해 주세요.' : errMsg(d.error), true); btn.disabled = false; return; }
    LS.set(K_CONN, { api: r.api, k: r.k });
    LS.set(K_CACHE, { rows: d.rows || [], settings: d.settings || '{}', at: Date.now() });
    LS.del(K_DEMO);
    say('연결됐어요! 잠시만요…');
    location.reload();
  } catch (e) {
    say('서버에 연결하지 못했어요. 인터넷 연결을 확인해 주세요.', true);
    btn.disabled = false;
  }
}

/* ================= events ================= */
function openPanel(id, open) {
  const p = $('#' + id); p.hidden = !open;
  const btn = { addPanel: '#openAdd', settings: '#openSettings' }[id]; if (btn) $(btn).setAttribute('aria-expanded', open);
  if (open) { if (id === 'settings') renderSettings(); if (id === 'addPanel') renderAdd(); p.scrollIntoView({ block: 'start' }); }
}
document.addEventListener('change', e => {
  const t = e.target;
  if (t.matches('select[data-key]')) { setChoice(t.dataset.key, t.value); return; }
  if (t.id === 'myName') { S.settings.myName = t.value.trim(); saveSettings(); deriveState(); renderAll(); }
});
document.addEventListener('click', e => {
  const t = e.target.closest('button, [data-open], [data-close]'); if (!t) return;
  if (t.dataset.open) { openPanel(t.dataset.open, true); return; }
  if (t.dataset.close) { openPanel(t.dataset.close, false); return; }
  if (t.dataset.clearcat) { S.cat = null; renderAll(); return; }
  if (t.dataset.cat) { S.cat = S.cat === t.dataset.cat ? null : t.dataset.cat; renderAll(); return; }
  if (t.id === 'prevM' || t.id === 'nextM') { S.month = shiftYM(S.month, t.id === 'prevM' ? -1 : 1); S.selDay = null; S.cat = null; renderAll(); return; }
  if (t.id === 'openAdd') { openPanel('addPanel', $('#addPanel').hidden); return; }
  if (t.id === 'openSettings') { openPanel('settings', $('#settings').hidden); return; }
  if (t.id === 'refresh' || t.id === 'retry') { loadLive(); return; }
  if (t.id === 'mSave') { addManual(); return; }
  if (t.id === 'ruleAdd') { addRule($('#ruleText').value, $('#ruleChoice').value); return; }
  if (t.dataset.delrule) { S.settings.rules = S.settings.rules.filter(r => r.id !== t.dataset.delrule); saveSettings(); deriveState(); renderAll(); return; }
  if (t.id === 'clearOv') { S.settings.overrides = {}; saveSettings(); deriveState(); renderAll(); return; }
  if (t.id === 'connGo') { connect(); return; }
  if (t.id === 'connDemo') { LS.set(K_DEMO, true); location.reload(); return; }
  if (t.id === 'disconnect') { toast('연결을 해제할까요? 이 폰의 연결 정보와 캐시가 지워져요.', [{ text: '해제', fn: () => { LS.del(K_CONN); LS.del(K_CACHE); LS.del(K_DEMO); location.reload(); } }]); return; }
  if (t.dataset.filter) { S.filter = t.dataset.filter; renderTable(agg(S.month)); return; }
  if (t.dataset.date) {
    S.selDay = t.dataset.date; renderDay(agg(S.month));
    if (window.matchMedia('(max-width: 960px)').matches) $('#dayPanel').scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }
});
document.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.id === 'ruleText') { e.preventDefault(); addRule(e.target.value, $('#ruleChoice').value); } });
$('#allDetails').addEventListener('toggle', () => { if (MODE !== 'gate') renderTable(agg(S.month)); });
const trendEl = $('#trend');
trendEl.addEventListener('mouseover', e => { const h = e.target.closest('.hit'); if (h) showTip(+h.dataset.i, e); });
trendEl.addEventListener('focusin', e => { const h = e.target.closest('.hit'); if (h) showTip(+h.dataset.i, e); });
trendEl.addEventListener('mouseleave', () => { const t = $('#tip'); if (t) t.hidden = true; });
trendEl.addEventListener('focusout', () => { const t = $('#tip'); if (t) t.hidden = true; });
const goTrend = h => { const d = trendData[+h.dataset.i]; if (d && d.ym !== S.month) { S.month = d.ym; S.selDay = null; S.cat = null; renderAll(); } };
trendEl.addEventListener('click', e => { const h = e.target.closest('.hit'); if (h) goTrend(h); });
trendEl.addEventListener('keydown', e => { const h = e.target.closest('.hit'); if (h && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); goTrend(h); } });
let lastW = 0;
if (window.ResizeObserver) new ResizeObserver(() => { const w = Math.floor(trendEl.clientWidth); if (Math.abs(w - lastW) > 4 && MODE !== 'gate') { lastW = w; renderTrend(); } }).observe(trendEl);
document.addEventListener('visibilitychange', () => { if (LIVE && document.visibilityState === 'visible' && Date.now() - lastLoad > 30000) loadLive(true); });

/* ================= boot ================= */
if (MODE === 'live') {
  const c = LS.get(K_CACHE);
  if (c && Array.isArray(c.rows) && c.rows.length) {
    S.raw = c.rows; S.cachedAt = c.at || 0; S.loading = false;
    try { S.settings = normSettings(JSON.parse(c.settings || '{}')); } catch (e) { S.settings = normSettings(null); }
    parseAllState(); deriveState();
  }
  renderAll();
  loadLive(S.raw.length > 0);
} else if (MODE === 'demo') {
  S.loading = false;
  S.raw = makeDemoRaw();
  S.settings = normSettings(LS.get(K_SET) || DEMO_SETTINGS);
  parseAllState(); deriveState(); S.month = nowYM();
  renderAll();
  $('#connClose').hidden = false;
} else {
  $('#appUI').hidden = true;
  $('#tools').hidden = true;
  $('#subline').textContent = '카드·은행 알림으로 자동 기록되는 1인용 가계부';
  $('#connect').hidden = false;
}

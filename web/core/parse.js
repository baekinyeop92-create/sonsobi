/* 알림 원문 해석 — reference/app.html(v2)에서 동작 그대로 이식. DOM 사용 금지 */
import { BUCKETS, CATS } from './categories.js';

export const RX_AMT = /(\d{1,3}(?:,\d{3})+|\d+)\s*원/g;
export const AMT_SKIP_BEFORE = /(누적|잔액|한도|포인트|적립|가능|예정|청구|최소)[^\d]{0,6}$/;

export function pickAmount(text) {
  for (const m of text.matchAll(RX_AMT)) {
    if (AMT_SKIP_BEFORE.test(text.slice(Math.max(0, m.index - 12), m.index))) continue;
    const v = parseInt(m[1].replace(/,/g, ''), 10);
    if (v > 0) return { v, index: m.index, end: m.index + m[0].length };
  }
  return null;
}

export const RX_ISSUER = /(현대|신한|삼성|KB국민|국민|롯데|하나|우리|비씨|BC|NH농협|농협|씨티|IBK기업|IBK)\s*(체크|신용)?\s*카드/;

export function stripTokens(s, kind) {
  let t = s.replace(/\[[^\]]*\]/g, ' ').replace(/\(주\)|㈜|주식회사/g, ' ')
    .replace(/\(\s*\d{3,4}\s*\)/g, ' ')
    .replace(/(\d{1,3}(?:,\d{3})+|\d+)\s*원(을|이)?/g, ' ')
    .replace(/\d{1,2}\/\d{1,2}|\d{2,4}[.\-]\d{1,2}[.\-]\d{1,2}|\d{1,2}:\d{2}(?::\d{2})?/g, ' ')
    .replace(/\d{2,}[-*]\S*/g, ' ')
    .replace(/[가-힣]\*+[가-힣]*(님)?/g, ' ')
    .replace(/(승인취소|승인|취소|일시불|할부\s*\d*\s*(개월)?|체크카드출금|체크카드|신용카드|결제완료|결제했어요|결제|사용|출금|입금|자동이체|이체|해외|국내|누적|잔액|고객님|완료)/g, ' ');
  if (kind !== 'bank') t = t.replace(/(현대|신한|삼성|KB국민|국민|KB|롯데|하나|우리|비씨|BC|NH농협|NH|농협|씨티|IBK)\s*(체크|신용)?\s*(카드)?(?=\s|$|\(|\d)/g, ' ');
  return t.replace(/[()|:：,·]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function merchantOf(text, amt, kind) {
  let m;
  if ((m = text.match(/([가-힣A-Za-z0-9*()&.]{1,20})님에게\s*[\d,]+원/))) return m[1];
  if ((m = text.match(/([가-힣A-Za-z0-9*()&.]{1,20})님이\s*[\d,]+원/))) return m[1];
  if ((m = text.match(/([^\s]{1,24})에서\s*[\d,]+원/))) return m[1];
  if ((m = text.match(/^([^\d]{1,20}?)\s*[\d,]+원\s*충전/))) return m[1].trim() + ' 충전';
  const tms = [...text.matchAll(/\d{1,2}:\d{2}(?::\d{2})?/g)];
  if (tms.length) {
    const last = tms[tms.length - 1];
    const seg = stripTokens(text.slice(last.index + last[0].length).split(/누적|잔액|한도|포인트|적립/)[0], kind);
    if (seg) return seg;
  }
  if (amt) {
    const after = stripTokens(text.slice(amt.end).split(/누적|잔액|한도/)[0], kind);
    if (after) return after;
    const before = stripTokens(text.slice(0, amt.index), kind);
    if (before) return before.split(' ').slice(-2).join(' ');
  }
  return '';
}

/** 원문 행 [ts, app, title, body, id, manual] → Tx | 인식 못 한 알림 | null */
export function parseRaw(a) {
  const [ts, app, title, body, id, manual] = a.map(x => x == null ? '' : String(x));
  const date = ts.slice(0, 10), time = ts.slice(11, 16);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  if (manual) {
    let o = null; try { o = JSON.parse(manual); } catch (e) {}
    if (o && Number(o.amt)) {
      const [b, c] = String(o.choice || 'spend:기타').split(':');
      const bb = BUCKETS.includes(b) ? b : 'spend';
      return { key: id, ts, date: /^\d{4}-\d{2}-\d{2}$/.test(o.date || '') ? o.date : date, time, desc: o.desc || '(내용 없음)',
        amt: (bb === 'income' ? 1 : -1) * Math.abs(Number(o.amt)), method: o.method || '현금', kind: 'manual', src: '직접 입력', raw: '', mb: bb, mcat: CATS.includes(c) ? c : '' };
    }
  }
  const bodyT = body.replace(/\s+/g, ' ').trim();
  const all = (title + ' ' + body).replace(/\s+/g, ' ').trim();
  let src = bodyT, amt = bodyT ? pickAmount(bodyT) : null;
  if (!amt) { src = all; amt = pickAmount(all); }
  if (!amt) return { unrec: true, key: id, ts, date, time, src: app, raw: all, why: /USD|JPY|EUR|CNY|달러|\$/.test(all) ? '해외 결제 — 원화 금액이 없어요' : '금액을 찾지 못했어요' };
  const cancel = /취소/.test(all);
  const cardish = /승인|일시불|할부|신용|체크(?!카드출금)/.test(all) && !/출금|입금/.test(all);
  const kind = cardish ? 'card' : /출금|입금|이체|보냈|받았|잔액|송금/.test(all) ? 'bank' : /결제|충전/.test(all) ? 'pay' : 'card';
  let inflow = /님이\s*[\d,]+원을?\s*보냈|받았|입금|들어왔|환급|캐시백/.test(all) && !/출금|님에게/.test(all);
  if (cancel) inflow = true;
  let method = app || '알림';
  if (kind === 'card') { const im = all.match(RX_ISSUER) || all.match(/(현대|신한|삼성|KB국민|롯데|하나|우리|NH농협|농협)(체크|신용)?/); if (im) method = im[1] + (im[2] === '체크' ? '체크' : '') + '카드'; }
  const desc = merchantOf(src, amt, kind) || '(가맹점 미확인)';
  return { key: id, ts, date, time, desc, amt: inflow ? amt.v : -amt.v, method, kind, src: app, raw: all };
}

/** 원문 전체 → { tx(시각순), unrec, lastAt } — v2 parseAll과 동일 */
export function parseRows(raw) {
  const tx = [], unrec = [];
  for (const a of raw) { const r = parseRaw(a); if (!r) continue; if (r.unrec) unrec.push(r); else tx.push(r); }
  tx.sort((a, b) => a.ts.localeCompare(b.ts));
  const lastAt = raw.reduce((m, a) => (String(a[0]) > m ? String(a[0]) : m), '');
  return { tx, unrec, lastAt };
}

/** 'yyyy-MM-dd HH:mm[:ss]' → epoch ms (로컬 시간대) */
export const tsMs = ts => { const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})(?::(\d{2}))?/.exec(ts || ''); return m ? new Date(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)).getTime() : 0; };

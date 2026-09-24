/* 중복 제거 — reference/app.html(v2)에서 동작 그대로 이식.
   같은 금액이 ① 다른 앱 15분 안 → card > pay > bank 우선순위로 하나만 ② 같은 앱 2분 안 & 같은 가맹점 → 뒤의 것 제외 */
import { tsMs } from './parse.js';
import { classify } from './classify.js';

export function dedupe(rows, st) {
  const pri = r => r.kind === 'card' ? 0 : r.kind === 'pay' ? 1 : r.kind === 'manual' ? 3 : 2;
  const cand = rows.filter(r => r.amt < 0 && r.b !== 'excl' && r.b !== 'save' && !st.overrides[r.key] && r.kind !== 'manual').sort((a, b) => a.ts.localeCompare(b.ts));
  const g = new Map();
  for (const r of cand) { if (!g.has(r.amt)) g.set(r.amt, []); g.get(r.amt).push(r); }
  for (const list of g.values()) {
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      if (a.b === 'excl' || b.b === 'excl') continue;
      const mins = Math.abs(tsMs(b.ts) - tsMs(a.ts)) / 60000;
      const same = a.src === b.src;
      if (same ? (mins <= 2 && a.desc === b.desc) : mins <= 15) {
        const drop = pri(a) <= pri(b) ? b : a;
        drop.b = 'excl'; drop.cat = ''; drop.why = same ? '같은 알림이 두 번 옴' : '중복 알림 — 같은 결제가 다른 앱에도 잡힘';
      }
    }
  }
}

/** 해석된 tx 목록 + 설정 → 분류·중복 제거까지 끝난 Row 목록 (v2 derive의 로직부) */
export function deriveRows(tx, st) {
  const rows = tx.map(t => { const c = classify(t, st); return Object.assign({}, t, { b: c.b, why: c.why || '', ov: !!c.ov, cat: c.cat || '' }); });
  dedupe(rows, st);
  return rows;
}

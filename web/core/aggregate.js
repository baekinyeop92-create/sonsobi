/* 월 집계 — reference/app.html(v2) agg/derive의 집계부를 동작 그대로 이식 */

/** Row 목록 → Map('yyyy-MM' → rows). 문자열 날짜로만 묶는다 (Date 재계산 금지) */
export function groupByMonth(rows) {
  const byMonth = new Map();
  for (const r of rows) { const ym = r.date.slice(0, 7); if (!byMonth.has(ym)) byMonth.set(ym, []); byMonth.get(ym).push(r); }
  return byMonth;
}

/** 한 달치 rows → 집계 (v2 agg와 동일한 구조) */
export function aggregate(ym, rows) {
  const a = { ym, rows: rows || [], spend: 0, fixed: 0, save: 0, review: 0, reviewN: 0, income: 0, exclOut: 0, exclIn: 0, byDay: {}, byCat: {}, catN: {}, reasons: {} };
  for (const r of a.rows) {
    const v = -r.amt;
    const d = a.byDay[r.date] || (a.byDay[r.date] = { spend: 0, fixed: 0, save: 0, review: 0, income: 0, excl: 0, n: 0, cats: {} });
    d.n++;
    if (r.b === 'spend') { a.spend += v; d.spend += v; const c = r.cat || '기타'; a.byCat[c] = (a.byCat[c] || 0) + v; a.catN[c] = (a.catN[c] || 0) + 1; d.cats[c] = (d.cats[c] || 0) + v; }
    else if (r.b === 'fixed') { a.fixed += v; d.fixed += v; }
    else if (r.b === 'save') { a.save += v; d.save += v; }
    else if (r.b === 'review') { a.review += v; d.review += v; a.reviewN++; }
    else if (r.b === 'income') { a.income += r.amt; d.income += r.amt; }
    else if (r.b === 'excl') {
      if (r.amt < 0) { a.exclOut += v; d.excl += v; } else a.exclIn += r.amt;
      const k = r.why || '제외';
      const g = a.reasons[k] || (a.reasons[k] = { n: 0, out: 0, inn: 0, rows: [] });
      g.n++; g.rows.push(r); if (r.amt < 0) g.out += v; else g.inn += r.amt;
    }
  }
  return a;
}

/** 순소비 = 소비 + 고정지출 */
export const netOf = a => a.spend + a.fixed;

/** 통장·카드에서 나간 돈 합계 — v2 renderHero와 같은 식 */
export const outTotalOf = a => Math.max(0, a.spend) + Math.max(0, a.fixed) + Math.max(0, a.save) + Math.max(0, a.review) + a.exclOut;

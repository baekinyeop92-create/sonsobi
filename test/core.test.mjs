/* fixtures 28개 = 파서·분류 계약. 필드 대응은 docs/SPEC.md 6장 '테스트 필드 대응' 표대로 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseRows } from '../web/core/parse.js';
import { normSettings } from '../web/core/classify.js';
import { deriveRows } from '../web/core/dedupe.js';
import { groupByMonth, aggregate, netOf, outTotalOf } from '../web/core/aggregate.js';

const fx = JSON.parse(readFileSync(new URL('./fixtures/notifications.json', import.meta.url), 'utf8'));

// 28개를 한 묶음으로 해석 → 분류 → 중복 제거 (settings.myName=홍길동)
const raw = fx.cases.map(c => [c.input.ts, c.input.app, c.input.title, c.input.body, c.id, '']);
const st = normSettings(fx.settings);
const { tx, unrec } = parseRows(raw);
const rows = deriveRows(tx, st);
const byKey = new Map(rows.map(r => [r.key, r]));
const unrecByKey = new Map(unrec.map(u => [u.key, u]));

test('fixtures 케이스 수', () => {
  assert.equal(fx.cases.length, 28);
  assert.equal(tx.length + unrec.length, 28);
});

for (const c of fx.cases) {
  test(`case ${c.id}`, () => {
    if (c.expect.unrecognized) {
      const u = unrecByKey.get(c.id);
      assert.ok(u, '인식 못 한 알림으로 분류돼야 함');
      assert.equal(u.why, c.expect.reason);
      return;
    }
    const r = byKey.get(c.id);
    assert.ok(r, '거래로 해석돼야 함');
    assert.equal(r.desc, c.expect.desc);
    assert.equal(r.amt, c.expect.amount);
    assert.equal(r.kind, c.expect.kind);
    assert.equal(r.method, c.expect.method);
    assert.equal(r.b, c.expect.bucket);
    assert.equal(r.cat || null, c.expect.category ?? null);
    assert.equal(r.why || null, c.expect.reason ?? null);
  });
}

test('aggregate_2026_09 기대값', () => {
  const e = fx.aggregate_2026_09;
  const a = aggregate('2026-09', groupByMonth(rows).get('2026-09') || []);
  assert.equal(a.spend, e.spend);
  assert.equal(a.fixed, e.fixed);
  assert.equal(a.save, e.save);
  assert.equal(a.review, e.review);
  assert.equal(a.income, e.income);
  assert.equal(a.exclOut, e.exclOut);
  assert.equal(a.exclIn, e.exclIn);
  assert.equal(netOf(a), e.net);
  assert.equal(outTotalOf(a), e.outTotal);
  assert.equal(unrec.length, e.unrecognized);
  assert.equal(tx.length, e.transactions);
});

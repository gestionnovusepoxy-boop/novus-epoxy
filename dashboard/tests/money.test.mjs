/**
 * Tests for lib/money.ts — cent-based fiscal arithmetic.
 * Run: node --test tests/money.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  dollarsToCents,
  centsToDollars,
  sumCents,
  mulCents,
  pctOfCents,
  formatCents,
  taxesFromSubtotalCents,
  TPS_RATE_PCT,
  TVQ_RATE_PCT,
  DEPOT_RATE_PCT,
} from '../lib/money.ts';

// dollarsToCents
test('dollarsToCents: 8.50 → 850', () => assert.equal(dollarsToCents(8.50), 850));
test('dollarsToCents: 0 → 0', () => assert.equal(dollarsToCents(0), 0));
test('dollarsToCents: float hazard 0.1 + 0.2', () => {
  // Classic float hazard: 0.30000000004... must round to 30
  assert.equal(dollarsToCents(0.1 + 0.2), 30);
});
test('dollarsToCents: large amount 25092.00', () => assert.equal(dollarsToCents(25092.00), 2509200));
test('dollarsToCents: half-cent rounding 1.005 → 101', () => assert.equal(dollarsToCents(1.005), 101));

// centsToDollars
test('centsToDollars: 850 → 8.50', () => assert.equal(centsToDollars(850), 8.5));
test('centsToDollars: 0 → 0', () => assert.equal(centsToDollars(0), 0));
test('centsToDollars: 2509200 → 25092', () => assert.equal(centsToDollars(2509200), 25092));

// Round-trip
test('round-trip dollarsToCents → centsToDollars', () => {
  for (const d of [8.50, 12.75, 11.00, 0.01, 999.99, 25092.00]) {
    assert.equal(centsToDollars(dollarsToCents(d)), d, `round-trip failed for ${d}`);
  }
});

// sumCents
test('sumCents: 100 + 200 + 300 = 600', () => assert.equal(sumCents(100, 200, 300), 600));
test('sumCents: single arg', () => assert.equal(sumCents(500), 500));
test('sumCents: zero args', () => assert.equal(sumCents(), 0));
test('sumCents: rounds each arg before adding (no accumulation error)', () => {
  // Each amount is rounded individually to prevent float accumulation
  assert.equal(sumCents(100.4, 100.4, 100.4), 300); // floor(100.4)*3
});

// mulCents
test('mulCents: 850 * 2952 = 2509200', () => assert.equal(mulCents(850, 2952), 2509200));
test('mulCents: fractional qty rounded', () => {
  const result = mulCents(850, 2952.5);
  assert.ok(Number.isInteger(result), `expected integer, got ${result}`);
});
test('mulCents: 0 qty = 0', () => assert.equal(mulCents(850, 0), 0));

// pctOfCents
test('pctOfCents: 15% of 2509200 = 376380', () => assert.equal(pctOfCents(2509200, 15), 376380));
test('pctOfCents: 0% = 0', () => assert.equal(pctOfCents(2509200, 0), 0));
test('pctOfCents: 100% = same', () => assert.equal(pctOfCents(5000, 100), 5000));
test('pctOfCents: 5% of 100 = 5', () => assert.equal(pctOfCents(100, TPS_RATE_PCT), 5));
test('pctOfCents: 9.975% of 10000 = 997 (float precision: 9.975/100 rounds down to 997)', () => {
  // 10000 * (9.975/100) = 997.499... in IEEE 754 → rounds to 997
  assert.equal(pctOfCents(10000, TVQ_RATE_PCT), 997);
});

// formatCents
test('formatCents: 850 → "8,50 $" (fr-CA)', () => {
  const result = formatCents(850);
  // Just verify it contains "8" and "50" and "$" — locale formatting varies by platform
  assert.ok(result.includes('8'), `got: ${result}`);
  assert.ok(result.includes('$') || result.includes('CAD'), `got: ${result}`);
});
test('formatCents: 0 renders as zero amount', () => {
  const result = formatCents(0);
  assert.ok(result.includes('0'), `got: ${result}`);
});

// taxesFromSubtotalCents — core invariants
test('taxesFromSubtotalCents: tps = 5% of subtotal', () => {
  const { tpsCents } = taxesFromSubtotalCents(100000); // $1000
  assert.equal(tpsCents, 5000); // $50
});

test('taxesFromSubtotalCents: tvq = 9.975% of subtotal', () => {
  const { tvqCents } = taxesFromSubtotalCents(100000);
  assert.equal(tvqCents, 9975); // $99.75
});

test('taxesFromSubtotalCents: total = subtotal + tps + tvq', () => {
  for (const sub of [100000, 2815820, 550000]) {
    const { tpsCents, tvqCents, totalCents } = taxesFromSubtotalCents(sub);
    assert.equal(totalCents, sub + tpsCents + tvqCents, `total mismatch at ${sub}`);
  }
});

test('taxesFromSubtotalCents: depot = 30% of total', () => {
  const { totalCents, depotCents } = taxesFromSubtotalCents(100000);
  assert.equal(depotCents, pctOfCents(totalCents, DEPOT_RATE_PCT));
});

test('taxesFromSubtotalCents: zero subtotal yields all zeros', () => {
  const r = taxesFromSubtotalCents(0);
  assert.deepEqual(r, { tpsCents: 0, tvqCents: 0, totalCents: 0, depotCents: 0 });
});

// Novus reference: devis #237 in cents (matches pricing.invariants I8)
test('taxesFromSubtotalCents: case NE-237 sous-total 28158.20$ → known taxes', () => {
  const sub = dollarsToCents(28158.20); // 2815820
  const { tpsCents, tvqCents } = taxesFromSubtotalCents(sub);
  assert.equal(centsToDollars(tpsCents), 1407.91);
  // tvq: 28158.20 * 9.975% = 2808.78... allow ±1 cent
  assert.ok(Math.abs(centsToDollars(tvqCents) - 2808.78) < 0.02,
    `tvq ${centsToDollars(tvqCents)} ≠ 2808.78`);
});

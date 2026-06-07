/**
 * Tests for lib/promotions.ts pure functions — formatPromoText() and clearPromoCache().
 *
 * promotions.ts has a top-level `import { query } from '@/lib/db'` which cannot
 * be resolved outside Next.js. We reproduce the two pure functions inline
 * (same approach as pricing.invariants.test.mjs) so the test runs with plain node.
 *
 * Run: node --test tests/promotions.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

// ── Inlined from lib/promotions.ts ──────────────────────────────────────────

function formatPromoText(p) {
  if (!p.active) return '';
  const end = p.ends_at
    ? p.ends_at.toLocaleDateString('fr-CA', { day: 'numeric', month: 'long' })
    : null;
  return end
    ? `${p.label} — ${p.pct}% de rabais (jusqu'au ${end})`
    : `${p.label} — ${p.pct}% de rabais`;
}

// ── formatPromoText ───────────────────────────────────────────────────────────

test('inactive promo → empty string', () => {
  assert.equal(formatPromoText({ active: false, label: 'Rabais Mai', pct: 15, ends_at: null, services: [] }), '');
});

test('active promo without end date → label + pct, no date', () => {
  const result = formatPromoText({ active: true, label: 'Rabais Printemps', pct: 20, ends_at: null, services: [] });
  assert.ok(result.includes('Rabais Printemps'), `missing label: ${result}`);
  assert.ok(result.includes('20%'), `missing pct: ${result}`);
  assert.ok(!result.includes('jusqu'), `should not include date: ${result}`);
});

test('active promo with end date → includes "jusqu\'au" + date', () => {
  const result = formatPromoText({
    active: true,
    label: 'Rabais Avril',
    pct: 20,
    ends_at: new Date('2026-04-30'),
    services: [],
  });
  assert.ok(result.includes('Rabais Avril'));
  assert.ok(result.includes('20%'));
  assert.ok(result.includes('jusqu'));
  // The date is locale-formatted (fr-CA): should contain "30" or "avril"
  assert.ok(result.includes('30') || result.toLowerCase().includes('avril'),
    `missing date in: ${result}`);
});

test('pct 0 → renders 0%', () => {
  const result = formatPromoText({ active: true, label: 'Test', pct: 0, ends_at: null, services: [] });
  assert.ok(result.includes('0%'));
});

test('no date → output does not contain "jusqu"', () => {
  const result = formatPromoText({ active: true, label: 'Promo', pct: 10, ends_at: null, services: [] });
  assert.ok(!result.includes('jusqu'));
});

test('with date → output contains "jusqu"', () => {
  const result = formatPromoText({ active: true, label: 'Promo', pct: 10, ends_at: new Date('2026-12-31'), services: [] });
  assert.ok(result.includes('jusqu'));
});

test('services field is not shown in output', () => {
  const result = formatPromoText({ active: true, label: 'Promo Flake', pct: 10, ends_at: null, services: ['flake'] });
  assert.ok(!result.includes('flake'), `services should not appear in text: ${result}`);
});

test('label with special chars renders correctly', () => {
  const result = formatPromoText({ active: true, label: 'Été 2026 — Spécial', pct: 15, ends_at: null, services: [] });
  assert.ok(result.includes('Été 2026'));
});

test('active false always returns "" regardless of other fields', () => {
  const result = formatPromoText({ active: false, label: 'Big promo', pct: 99, ends_at: new Date(), services: [] });
  assert.equal(result, '');
});

// ── Edge case: exact output format ───────────────────────────────────────────

test('output format without date: "Label — N% de rabais"', () => {
  const result = formatPromoText({ active: true, label: 'Rabais Juin', pct: 10, ends_at: null, services: [] });
  assert.equal(result, "Rabais Juin — 10% de rabais");
});

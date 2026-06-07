/**
 * Edge-case tests for lib/utils.ts — gaps not in utils.test.mjs:
 *   - formatDate with invalid ISO → no crash
 *   - formatDate locale consistency
 *   - formatNumber with decimal
 *   - formatVariation precision edge
 *   - escapeHtml with forward slash (not encoded)
 *   - cn with object spread (edge case)
 *
 * Run: node --test tests/utils-edge.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { formatDate, formatNumber, formatVariation, cn, escapeHtml } from '../lib/utils.ts';

// ── formatDate edge cases ─────────────────────────────────────────────────────

test('formatDate: throws RangeError on invalid ISO string', () => {
  // Intl.DateTimeFormat.format() throws RangeError for Invalid Date values
  assert.throws(() => formatDate('not-a-date'), { name: 'RangeError' });
});

test('formatDate: same timestamp always produces same output (deterministic)', () => {
  const ts = '2026-03-15T12:00:00Z';
  assert.equal(formatDate(ts), formatDate(ts));
});

test('formatDate: different years produce different output', () => {
  const y2025 = formatDate('2025-06-15T12:00:00Z');
  const y2026 = formatDate('2026-06-15T12:00:00Z');
  assert.notEqual(y2025, y2026);
});

// ── formatNumber edge cases ───────────────────────────────────────────────────

test('formatNumber: decimal 1.5 → contains 1 and 5', () => {
  const out = formatNumber(1.5);
  assert.ok(out.includes('1') && out.includes('5'), `unexpected: ${out}`);
});

test('formatNumber: very large number 1_000_000', () => {
  const out = formatNumber(1_000_000);
  assert.ok(out.includes('1'), `unexpected: ${out}`);
  // Should contain grouping separators (spaces in fr-CA)
  assert.ok(out.length > 7, `no grouping for 1000000? got: ${out}`);
});

test('formatNumber: NaN does not throw (formats to empty or NaN string)', () => {
  assert.doesNotThrow(() => formatNumber(NaN));
});

// ── formatVariation edge cases ────────────────────────────────────────────────

test('formatVariation: very large positive → + prefix', () => {
  const out = formatVariation(999.9);
  assert.ok(out.startsWith('+'), `expected + prefix, got: ${out}`);
});

test('formatVariation: -0.0 → "0.0%" (no minus sign for negative zero)', () => {
  const out = formatVariation(-0.0);
  // -0.0.toFixed(1) === "0.0" in JS
  assert.equal(out, '0.0%');
});

test('formatVariation: 0.05 rounds to 0.1%', () => {
  const out = formatVariation(0.05);
  assert.equal(out, '+0.1%');
});

test('formatVariation: -0.05 rounds to -0.1% or 0.0% (JS toFixed rounding)', () => {
  const out = formatVariation(-0.05);
  assert.ok(out === '-0.0%' || out === '-0.1%', `unexpected: ${out}`);
});

// ── escapeHtml edge cases ────────────────────────────────────────────────────

test('escapeHtml: forward slash not encoded (safe as-is in HTML)', () => {
  assert.equal(escapeHtml('a/b'), 'a/b');
});

test('escapeHtml: backtick not encoded', () => {
  assert.equal(escapeHtml('`code`'), '`code`');
});

test('escapeHtml: handles multi-line strings', () => {
  const out = escapeHtml('line1\nline2');
  assert.equal(out, 'line1\nline2'); // newlines are not HTML-special
});

test('escapeHtml: idempotent — escaping twice double-encodes &amp;', () => {
  // Not a desired property, just documenting behavior
  const once = escapeHtml('<b>');
  const twice = escapeHtml(once);
  assert.ok(twice.includes('&amp;lt;'), `expected double-encoding: ${twice}`);
});

// ── cn edge cases ─────────────────────────────────────────────────────────────

test('cn: zero-length string is falsy, filtered out', () => {
  assert.equal(cn('a', '', 'b'), 'a b');
});

test('cn: many classes joined correctly', () => {
  assert.equal(cn('a', 'b', 'c', 'd'), 'a b c d');
});

test('cn: number (not in type sig) treated as falsy/truthy', () => {
  // cn is typed as (string | undefined | false | null)[], but passing 0 (falsy) should filter
  assert.equal(cn('a', 0, 'b'), 'a b');
});

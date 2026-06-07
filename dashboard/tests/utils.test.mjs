/**
 * Tests for lib/utils.ts — formatDate, formatNumber, formatVariation, cn, escapeHtml.
 * Run: node --test tests/utils.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { formatDate, formatNumber, formatVariation, cn, escapeHtml } from '../lib/utils.ts';

// ── escapeHtml ───────────────────────────────────────────────────────────────

test('escapeHtml: ampersand', () => {
  assert.equal(escapeHtml('a & b'), 'a &amp; b');
});

test('escapeHtml: less-than', () => {
  assert.equal(escapeHtml('<script>'), '&lt;script&gt;');
});

test('escapeHtml: double quote', () => {
  assert.equal(escapeHtml('"hello"'), '&quot;hello&quot;');
});

test('escapeHtml: single quote', () => {
  assert.equal(escapeHtml("it's"), 'it&#39;s');
});

test('escapeHtml: XSS vector', () => {
  const input = '<img src=x onerror="alert(1)">';
  const out = escapeHtml(input);
  assert.ok(!out.includes('<img'), 'must escape opening tag');
  assert.ok(!out.includes('"'), 'must escape double quotes');
  assert.ok(out.includes('&lt;img'), 'must encode < as &lt;');
});

test('escapeHtml: plain text unchanged', () => {
  assert.equal(escapeHtml('Bonjour Novus'), 'Bonjour Novus');
});

test('escapeHtml: empty string', () => {
  assert.equal(escapeHtml(''), '');
});

test('escapeHtml: all special chars combined', () => {
  const out = escapeHtml('<"&\'>');
  assert.equal(out, '&lt;&quot;&amp;&#39;&gt;');
});

// ── cn ───────────────────────────────────────────────────────────────────────

test('cn: joins two classes', () => {
  assert.equal(cn('foo', 'bar'), 'foo bar');
});

test('cn: filters out falsy values', () => {
  assert.equal(cn('a', false, undefined, null, 'b'), 'a b');
});

test('cn: all falsy → empty string', () => {
  assert.equal(cn(false, undefined, null), '');
});

test('cn: single truthy', () => {
  assert.equal(cn('only'), 'only');
});

test('cn: no args → empty string', () => {
  assert.equal(cn(), '');
});

// ── formatNumber ─────────────────────────────────────────────────────────────

test('formatNumber: formats with fr-CA locale', () => {
  // In fr-CA, thousands separator is a space and decimal is comma
  const out = formatNumber(1000);
  assert.ok(out.includes('1'), 'must contain the digit 1');
  assert.ok(out.includes('000') || out.includes('1 000') || out.includes('1 000'), `unexpected: ${out}`);
});

test('formatNumber: zero', () => {
  assert.equal(formatNumber(0), '0');
});

test('formatNumber: negative', () => {
  const out = formatNumber(-5);
  assert.ok(out.includes('5'), 'must contain digit');
  assert.ok(out.startsWith('-') || out.includes('−'), 'must have minus sign');
});

// ── formatVariation ───────────────────────────────────────────────────────────

test('formatVariation: positive → +prefix', () => {
  assert.equal(formatVariation(12.5), '+12.5%');
});

test('formatVariation: negative → no extra prefix', () => {
  assert.equal(formatVariation(-3.2), '-3.2%');
});

test('formatVariation: zero → 0.0% (no plus sign)', () => {
  assert.equal(formatVariation(0), '0.0%');
});

test('formatVariation: fractional precision', () => {
  assert.equal(formatVariation(100 / 3), `+${(100 / 3).toFixed(1)}%`);
});

// ── formatDate ───────────────────────────────────────────────────────────────

test('formatDate: returns a non-empty string for valid ISO', () => {
  const out = formatDate('2026-01-15T10:30:00Z');
  assert.ok(out.length > 0, 'must not be empty');
  // Should contain the year and likely "janv" or "jan" in fr-CA
  assert.ok(out.includes('2026'), `expected year 2026 in: ${out}`);
});

test('formatDate: different months produce different output', () => {
  const jan = formatDate('2026-01-01T00:00:00Z');
  const jul = formatDate('2026-07-01T00:00:00Z');
  assert.notEqual(jan, jul);
});

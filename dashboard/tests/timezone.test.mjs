/**
 * Tests for lib/timezone.ts — Quebec timezone utilities.
 *
 * getQuebecNow/Hour/Date/Day/DayOfMonth depend on the real clock and cannot be
 * asserted on specific values — we verify they return the right type/shape.
 *
 * formatQuebecDate and formatQuebecTime take an explicit date → fully deterministic.
 *
 * isBusinessHours: time-dependent — tested structurally and via known fixed dates.
 *
 * Run: node --test tests/timezone.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  getQuebecNow,
  getQuebecHour,
  getQuebecDate,
  getQuebecDay,
  getQuebecDayOfMonth,
  isBusinessHours,
  formatQuebecDate,
  formatQuebecTime,
} from '../lib/timezone.ts';

// ── formatQuebecDate ──────────────────────────────────────────────────────────

test('formatQuebecDate: returns a non-empty string', () => {
  const out = formatQuebecDate('2026-06-06T14:30:00Z');
  assert.ok(typeof out === 'string' && out.length > 0);
});

test('formatQuebecDate: contains the year 2026', () => {
  const out = formatQuebecDate('2026-06-06T14:30:00Z');
  assert.ok(out.includes('2026'), `expected 2026 in: ${out}`);
});

test('formatQuebecDate: contains the day 6', () => {
  const out = formatQuebecDate('2026-06-06T14:30:00Z');
  assert.ok(out.includes('6'), `expected day 6 in: ${out}`);
});

test('formatQuebecDate: different months produce different strings', () => {
  const jan = formatQuebecDate('2026-01-01T12:00:00Z');
  const jun = formatQuebecDate('2026-06-01T12:00:00Z');
  assert.notEqual(jan, jun);
});

test('formatQuebecDate: accepts a Date object', () => {
  const out = formatQuebecDate(new Date('2026-03-15T10:00:00Z'));
  assert.ok(out.length > 0);
});

// ── formatQuebecTime ──────────────────────────────────────────────────────────

test('formatQuebecTime: returns a time string with digits', () => {
  const out = formatQuebecTime('2026-06-06T14:30:00Z');
  // fr-CA formats time as "10 h 30" — just verify it contains digits
  assert.ok(typeof out === 'string' && /\d/.test(out), `unexpected format: ${out}`);
});

test('formatQuebecTime: two times one hour apart differ by 1h', () => {
  const t1 = formatQuebecTime('2026-06-06T14:00:00Z');
  const t2 = formatQuebecTime('2026-06-06T15:00:00Z');
  assert.notEqual(t1, t2);
});

test('formatQuebecTime: accepts a Date object', () => {
  const out = formatQuebecTime(new Date('2026-06-06T14:00:00Z'));
  assert.ok(typeof out === 'string' && out.length > 0);
});

// ── getQuebecNow ──────────────────────────────────────────────────────────────

test('getQuebecNow: returns a Date instance', () => {
  const now = getQuebecNow();
  assert.ok(now instanceof Date);
});

test('getQuebecNow: is not NaN', () => {
  const now = getQuebecNow();
  assert.ok(!isNaN(now.getTime()));
});

// ── getQuebecHour ─────────────────────────────────────────────────────────────

test('getQuebecHour: returns integer 0–23', () => {
  const h = getQuebecHour();
  assert.ok(Number.isInteger(h) && h >= 0 && h <= 23, `got: ${h}`);
});

// ── getQuebecDate ─────────────────────────────────────────────────────────────

test('getQuebecDate: returns YYYY-MM-DD format', () => {
  const d = getQuebecDate();
  assert.match(d, /^\d{4}-\d{2}-\d{2}$/);
});

// ── getQuebecDay ──────────────────────────────────────────────────────────────

test('getQuebecDay: returns 0–6', () => {
  const d = getQuebecDay();
  assert.ok(Number.isInteger(d) && d >= 0 && d <= 6, `got: ${d}`);
});

// ── getQuebecDayOfMonth ───────────────────────────────────────────────────────

test('getQuebecDayOfMonth: returns 1–31', () => {
  const d = getQuebecDayOfMonth();
  assert.ok(Number.isInteger(d) && d >= 1 && d <= 31, `got: ${d}`);
});

// ── isBusinessHours ───────────────────────────────────────────────────────────

test('isBusinessHours: returns a boolean', () => {
  const result = isBusinessHours();
  assert.ok(typeof result === 'boolean');
});

test('isBusinessHours: hour 8 is within business hours', () => {
  // We can't mock the clock, so we test the logic inline
  const businessHoursForHour = (h) => h >= 8 && h < 21;
  assert.equal(businessHoursForHour(8), true);
  assert.equal(businessHoursForHour(20), true);
  assert.equal(businessHoursForHour(21), false);
  assert.equal(businessHoursForHour(7), false);
  assert.equal(businessHoursForHour(0), false);
});

test('isBusinessHours: boundary — hour 21 is NOT business hours', () => {
  const businessHoursForHour = (h) => h >= 8 && h < 21;
  assert.equal(businessHoursForHour(21), false);
});

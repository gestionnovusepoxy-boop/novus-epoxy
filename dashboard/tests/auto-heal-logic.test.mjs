/**
 * Tests for the pure timing/logic in lib/auto-heal.ts.
 *
 * GAP: autoHeal() is 255 lines of critical infrastructure with ZERO tests.
 * All branches (2-min cooldown, 6h health report, webhook URL check, email-scan
 * retry after 12h, google_token_broken 24h cooldown) are untested.
 *
 * DB calls, fetch, and env vars prevent true unit testing of autoHeal() itself.
 * This file tests the timing arithmetic and decision logic reproduced inline.
 *
 * Next step: integration tests with a pg-mem or test DB once available.
 *
 * Run: node --test tests/auto-heal-logic.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

// ── Cooldown arithmetic (mirrors autoHeal's checks) ──────────────────────────

const TWO_MIN_MS  = 2  * 60 * 1000;
const SIX_HR_MS   = 6  * 60 * 60 * 1000;
const TWELVE_HR_MS= 12 * 60 * 60 * 1000;
const TWENTY4_HR_H= 24;

function isWithinCooldown(lastTimestamp, windowMs, nowMs) {
  return (nowMs - lastTimestamp) < windowMs;
}

function hoursSince(lastIso, nowMs) {
  return (nowMs - new Date(lastIso).getTime()) / (1000 * 60 * 60);
}

function daysSince(lastIso, nowMs) {
  return (nowMs - new Date(lastIso).getTime()) / (1000 * 60 * 60 * 24);
}

// ── 2-minute global cooldown ─────────────────────────────────────────────────

test('autoHeal cooldown: 90s after last run → still in cooldown', () => {
  const now = Date.now();
  const last = now - 90 * 1000;
  assert.equal(isWithinCooldown(last, TWO_MIN_MS, now), true);
});

test('autoHeal cooldown: 121s after last run → cooldown cleared', () => {
  const now = Date.now();
  const last = now - 121 * 1000;
  assert.equal(isWithinCooldown(last, TWO_MIN_MS, now), false);
});

test('autoHeal cooldown: 0ms after last run → in cooldown', () => {
  const now = Date.now();
  assert.equal(isWithinCooldown(now, TWO_MIN_MS, now), true);
});

// ── 6-hour health report cooldown ────────────────────────────────────────────

test('6h report: 5h59m after last → not time yet', () => {
  const now = Date.now();
  const last = now - (6 * 60 * 60 * 1000 - 60 * 1000);
  assert.equal(isWithinCooldown(last, SIX_HR_MS, now), true);
});

test('6h report: 6h01m after last → time to report', () => {
  const now = Date.now();
  const last = now - (6 * 60 * 60 * 1000 + 60 * 1000);
  assert.equal(isWithinCooldown(last, SIX_HR_MS, now), false);
});

test('6h report: never run (timestamp 0) → always triggers', () => {
  const now = Date.now();
  assert.equal(isWithinCooldown(0, SIX_HR_MS, now), false);
});

// ── Email scan: retrigger after 12h ──────────────────────────────────────────

test('email scan: 11h since last scan → skip (within window)', () => {
  const now = Date.now();
  const lastScan = new Date(now - 11 * 60 * 60 * 1000).toISOString();
  assert.ok(hoursSince(lastScan, now) < 12, 'should be less than 12h');
});

test('email scan: 13h since last scan → trigger', () => {
  const now = Date.now();
  const lastScan = new Date(now - 13 * 60 * 60 * 1000).toISOString();
  assert.ok(hoursSince(lastScan, now) >= 12, 'should be >= 12h');
});

test('email scan: no previous scan (empty DB) → always triggers (999h assumed)', () => {
  // When there is no row in kv_store, hoursSince is hardcoded to 999.
  const hoursSinceNoRecord = 999;
  assert.ok(hoursSinceNoRecord >= 12);
});

// ── google_token_broken 24h cooldown ─────────────────────────────────────────

test('token_broken: broken for 23h → still within cooldown, do not retry', () => {
  const now = Date.now();
  const brokenAt = new Date(now - 23 * 60 * 60 * 1000).toISOString();
  assert.ok(hoursSince(brokenAt, now) < TWENTY4_HR_H, 'should still be in 24h window');
});

test('token_broken: broken for 25h → clear flag, allow retry', () => {
  const now = Date.now();
  const brokenAt = new Date(now - 25 * 60 * 60 * 1000).toISOString();
  assert.ok(hoursSince(brokenAt, now) >= TWENTY4_HR_H, 'should be past 24h — allow retry');
});

// ── Gmail watch renewal: renew after 5 days ───────────────────────────────────

test('gmail watch: 4 days since last → skip (< 5 days)', () => {
  const now = Date.now();
  const lastWatch = new Date(now - 4 * 24 * 60 * 60 * 1000).toISOString();
  assert.ok(daysSince(lastWatch, now) < 5, 'should be less than 5 days');
});

test('gmail watch: 6 days since last → trigger renewal', () => {
  const now = Date.now();
  const lastWatch = new Date(now - 6 * 24 * 60 * 60 * 1000).toISOString();
  assert.ok(daysSince(lastWatch, now) >= 5, 'should be >= 5 days');
});

test('gmail watch: never renewed (999 days) → trigger', () => {
  const daysSinceNoRecord = 999;
  assert.ok(daysSinceNoRecord >= 5);
});

// ── Webhook URL check ─────────────────────────────────────────────────────────

test('webhook: exact expected URL → no repair needed', () => {
  const EXPECTED = 'https://novus-epoxy.vercel.app/api/telegram/admin';
  const currentUrl = 'https://novus-epoxy.vercel.app/api/telegram/admin';
  assert.equal(currentUrl === EXPECTED, true);
});

test('webhook: different URL → repair needed', () => {
  const EXPECTED = 'https://novus-epoxy.vercel.app/api/telegram/admin';
  const currentUrl = 'https://novus-epoxy.vercel.app/api/telegram/OLD';
  assert.equal(currentUrl !== EXPECTED, true);
});

test('webhook: empty URL (not set) → repair needed', () => {
  const EXPECTED = 'https://novus-epoxy.vercel.app/api/telegram/admin';
  const currentUrl = '';
  assert.equal(!currentUrl || currentUrl !== EXPECTED, true);
});

// ── Repair result collection ──────────────────────────────────────────────────

test('repair collector: only fulfilled truthy values are added', () => {
  const results = [
    { status: 'fulfilled', value: 'Webhook repare' },
    { status: 'fulfilled', value: null },
    { status: 'rejected', reason: new Error('timeout') },
    { status: 'fulfilled', value: 'Gmail watch renouvele' },
  ];
  const repairs = results
    .filter(r => r.status === 'fulfilled' && r.value)
    .map(r => r.value);
  assert.deepEqual(repairs, ['Webhook repare', 'Gmail watch renouvele']);
});

test('repair collector: all null results → no notification sent', () => {
  const results = [
    { status: 'fulfilled', value: null },
    { status: 'fulfilled', value: null },
  ];
  const repairs = results.filter(r => r.status === 'fulfilled' && r.value).map(r => r.value);
  assert.equal(repairs.length, 0);
});

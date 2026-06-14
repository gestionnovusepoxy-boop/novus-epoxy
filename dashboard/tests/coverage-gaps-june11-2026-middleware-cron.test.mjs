/**
 * coverage-gaps-june11-2026-middleware-cron.test.mjs
 *
 * Run: node --test tests/coverage-gaps-june11-2026-middleware-cron.test.mjs
 *
 * TRUE GAPS — pure logic never covered by any prior test file:
 *
 *   GAP-1  middleware.ts — isRateLimited()
 *          The in-process rate-limit map protecting all public API routes.
 *          Off-by-one (> vs >=) silently allows one extra request per window;
 *          broken window-expiry resets counts incorrectly under replay attacks;
 *          map overflow cleanup (> 10,000 entries) may leak memory in prod.
 *          ZERO tests anywhere in the test suite for this function.
 *
 *   GAP-2  middleware.ts — quote-public URL regex
 *          /^\/api\/quotes\/\d+\/(contract|payment-info|confirm-deposit|confirm-balance|calendar)/
 *          Non-numeric quote IDs must NOT match (would rate-limit unrelated routes).
 *          Unknown actions (e.g. /send) must NOT fall through to the public bucket.
 *
 *   GAP-3  app/api/cron/monthly-accounting/route.ts — prev-month date range
 *          January → previous month must land in December of the PRIOR year.
 *          `new Date(firstOfThisMonth.getTime() - 1)` trick: verify it gives
 *          last millisecond of December 31, not Jan 0 / Dec 32 off-by-one.
 *
 *   GAP-4  app/api/cron/soustraitants-paie/route.ts — pay-line formatting
 *          `du = heures * taux` arithmetic and the `taux = 0` guard that
 *          emits "taux non défini" instead of "$0.00 (Xh × $0/h)".
 *
 * INTEGRATION SKELETONS (skipped unless INTEGRATION_TEST=1):
 *   INT-1  GET /api/cron/monthly-accounting — no auth → 401
 *   INT-2  GET /api/cron/soustraitants-paie — no auth → 401
 *   INT-3  GET /api/quotes/999/contract — no session → 429 or 200 depending on rate
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

const SKIP_INTEGRATION = !process.env.INTEGRATION_TEST;
const BASE = process.env.TEST_BASE_URL || 'http://localhost:3000';

// ════════════════════════════════════════════════════════════════════════════
// GAP-1: middleware.ts — isRateLimited()
//
// Inlined verbatim from middleware.ts so we can unit-test the pure logic
// without importing Next.js (which isn't available in node --test).
// ════════════════════════════════════════════════════════════════════════════

function makeRateLimiter() {
  const rateLimitMap = new Map();
  const MAX_RATE_LIMIT_ENTRIES = 10_000;

  function isRateLimited(key, maxRequests, windowMs, nowOverride) {
    const now = nowOverride ?? Date.now();
    const entry = rateLimitMap.get(key);

    if (!entry || now > entry.resetAt) {
      if (rateLimitMap.size > MAX_RATE_LIMIT_ENTRIES) {
        for (const [k, v] of rateLimitMap) {
          if (now > v.resetAt) rateLimitMap.delete(k);
        }
      }
      rateLimitMap.set(key, { count: 1, resetAt: now + windowMs });
      return false;
    }

    entry.count++;
    return entry.count > maxRequests;
  }

  return { isRateLimited, rateLimitMap, MAX_RATE_LIMIT_ENTRIES };
}

// --- First request always allowed ---

test('isRateLimited: first request is not limited', () => {
  const { isRateLimited } = makeRateLimiter();
  const result = isRateLimited('ip:1.2.3.4', 10, 60_000);
  assert.equal(result, false);
});

// --- Counts up to maxRequests (inclusive) still allowed ---

test('isRateLimited: exactly maxRequests requests are NOT limited', () => {
  const { isRateLimited } = makeRateLimiter();
  const key = 'ip:10.0.0.1';
  let limited = false;
  for (let i = 0; i < 10; i++) {
    limited = isRateLimited(key, 10, 60_000);
  }
  assert.equal(limited, false, 'the 10th request should still be allowed');
});

// --- maxRequests+1 is blocked ---

test('isRateLimited: maxRequests+1 is blocked', () => {
  const { isRateLimited } = makeRateLimiter();
  const key = 'ip:10.0.0.2';
  for (let i = 0; i < 10; i++) isRateLimited(key, 10, 60_000);
  const blocked = isRateLimited(key, 10, 60_000); // 11th
  assert.equal(blocked, true, 'the 11th request must be rate-limited');
});

// --- Window expiry resets the count ---

test('isRateLimited: after window expires, count resets and request is allowed', () => {
  const { isRateLimited } = makeRateLimiter();
  const key = 'ip:10.0.0.3';
  const t0 = 1_000_000;
  // Fill up the bucket
  for (let i = 0; i < 10; i++) isRateLimited(key, 10, 60_000, t0 + i);
  // One past the limit
  assert.equal(isRateLimited(key, 10, 60_000, t0 + 10), true, 'should be blocked before expiry');
  // Advance time past the 60s window
  const tAfter = t0 + 60_001;
  const result = isRateLimited(key, 10, 60_000, tAfter);
  assert.equal(result, false, 'after window expiry, first request should be allowed again');
});

// --- Different keys are independent ---

test('isRateLimited: different keys do not share counts', () => {
  const { isRateLimited } = makeRateLimiter();
  // Fill keyA to limit
  for (let i = 0; i < 10; i++) isRateLimited('keyA', 10, 60_000);
  isRateLimited('keyA', 10, 60_000); // 11th — blocked

  // keyB should still be fresh
  const result = isRateLimited('keyB', 10, 60_000);
  assert.equal(result, false, 'keyB must not be affected by keyA exhaustion');
});

// --- Map overflow cleanup removes expired entries ---

test('isRateLimited: overflow cleanup removes expired entries', () => {
  const { isRateLimited, rateLimitMap, MAX_RATE_LIMIT_ENTRIES } = makeRateLimiter();
  const t0 = 2_000_000;
  const windowMs = 60_000;

  // Manually stuff the map above the threshold with EXPIRED entries
  // (resetAt in the past relative to t0 + windowMs + 1)
  const overflowCount = MAX_RATE_LIMIT_ENTRIES + 1;
  for (let i = 0; i < overflowCount; i++) {
    // resetAt = t0 - 1 so they're already expired by the time we call isRateLimited
    rateLimitMap.set(`bulk:${i}`, { count: 1, resetAt: t0 - 1 });
  }
  assert.ok(rateLimitMap.size > MAX_RATE_LIMIT_ENTRIES, 'map must be overfull before the call');

  // New request at t0 + windowMs + 1 triggers the cleanup branch
  const tNow = t0 + windowMs + 1;
  isRateLimited('newkey', 5, windowMs, tNow);

  // All the expired bulk entries should have been pruned
  assert.ok(rateLimitMap.size <= 2, `expected ≤2 entries after cleanup, got ${rateLimitMap.size}`);
});

// --- Zero-limit: every request is blocked after the first ---

test('isRateLimited: maxRequests=0 blocks from the 2nd call', () => {
  const { isRateLimited } = makeRateLimiter();
  // First call creates entry with count=1; 1 > 0 → blocked? Let's check the boundary.
  // First call: count is set to 1 during entry creation (not counted yet), returns false.
  const first = isRateLimited('z:0', 0, 60_000);
  assert.equal(first, false, 'first call must not be blocked — entry is created with count=1');
  // Second call increments count to 2; 2 > 0 → blocked.
  const second = isRateLimited('z:0', 0, 60_000);
  assert.equal(second, true, 'second call must be blocked when maxRequests=0');
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-2: middleware.ts — quote public URL regex
//
// Only numeric IDs + known actions should match the public rate-limit bucket.
// ════════════════════════════════════════════════════════════════════════════

const QUOTE_PUBLIC_RE = /^\/api\/quotes\/\d+\/(contract|payment-info|confirm-deposit|confirm-balance|calendar)/;

test('quote regex: /api/quotes/123/contract matches', () => {
  assert.ok(QUOTE_PUBLIC_RE.test('/api/quotes/123/contract'));
});

test('quote regex: /api/quotes/1/payment-info matches', () => {
  assert.ok(QUOTE_PUBLIC_RE.test('/api/quotes/1/payment-info'));
});

test('quote regex: /api/quotes/99999/confirm-deposit matches', () => {
  assert.ok(QUOTE_PUBLIC_RE.test('/api/quotes/99999/confirm-deposit'));
});

test('quote regex: /api/quotes/7/confirm-balance matches', () => {
  assert.ok(QUOTE_PUBLIC_RE.test('/api/quotes/7/confirm-balance'));
});

test('quote regex: /api/quotes/42/calendar matches', () => {
  assert.ok(QUOTE_PUBLIC_RE.test('/api/quotes/42/calendar'));
});

test('quote regex: non-numeric ID does NOT match', () => {
  assert.ok(!QUOTE_PUBLIC_RE.test('/api/quotes/abc/contract'));
});

test('quote regex: /api/quotes/123/send does NOT match (not a public action)', () => {
  assert.ok(!QUOTE_PUBLIC_RE.test('/api/quotes/123/send'));
});

test('quote regex: /api/quotes/123/delete does NOT match', () => {
  assert.ok(!QUOTE_PUBLIC_RE.test('/api/quotes/123/delete'));
});

test('quote regex: /api/quotes/ with no ID does NOT match', () => {
  assert.ok(!QUOTE_PUBLIC_RE.test('/api/quotes/contract'));
});

test('quote regex: empty string does NOT match', () => {
  assert.ok(!QUOTE_PUBLIC_RE.test(''));
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-3: app/api/cron/monthly-accounting — prev-month date range logic
//
// The route runs on Vercel (UTC). The logic:
//   firstOfThisMonth = new Date(year, month, 1)   — midnight UTC when server=UTC
//   lastOfPrevMonth  = new Date(firstOfThisMonth - 1ms)
//   start/end        = .toISOString().slice(0, 10)
//
// We test the UTC-equivalent using Date.UTC() so the assertions are
// timezone-independent (same behaviour as Vercel production).
// ════════════════════════════════════════════════════════════════════════════

// UTC-safe equivalent of the production date range calculation
function getPrevMonthRange(utcYear, utcMonth0) {
  const firstOfThisMonth = new Date(Date.UTC(utcYear, utcMonth0, 1));
  const lastOfPrevMonth = new Date(firstOfThisMonth.getTime() - 1);
  const prevYear = lastOfPrevMonth.getUTCFullYear();
  const prevMonth0 = lastOfPrevMonth.getUTCMonth();
  const firstOfPrevMonth = new Date(Date.UTC(prevYear, prevMonth0, 1));
  return {
    start: firstOfPrevMonth.toISOString().slice(0, 10),
    end: lastOfPrevMonth.toISOString().slice(0, 10),
    prevYear,
    prevMonth0,
  };
}

test('monthly-accounting: February 2026 → previous month is January 2026', () => {
  const { start, end } = getPrevMonthRange(2026, 1); // month 1 = February
  assert.equal(start, '2026-01-01');
  assert.equal(end, '2026-01-31');
});

test('monthly-accounting: January 2026 → previous month is December 2025 (year boundary)', () => {
  const { start, end } = getPrevMonthRange(2026, 0); // month 0 = January
  assert.equal(start, '2025-12-01');
  assert.equal(end, '2025-12-31');
});

test('monthly-accounting: March 2026 → previous month is February 2026 (28 days)', () => {
  const { start, end } = getPrevMonthRange(2026, 2); // month 2 = March
  assert.equal(start, '2026-02-01');
  assert.equal(end, '2026-02-28');
});

test('monthly-accounting: May 2026 → previous month is April (30 days)', () => {
  const { start, end } = getPrevMonthRange(2026, 4); // month 4 = May
  assert.equal(start, '2026-04-01');
  assert.equal(end, '2026-04-30');
});

test('monthly-accounting: January 2026 → prevYear=2025, prevMonth0=11 (December)', () => {
  const { prevYear, prevMonth0 } = getPrevMonthRange(2026, 0);
  assert.equal(prevYear, 2025);
  assert.equal(prevMonth0, 11); // December = month index 11
});

test('monthly-accounting: start is always the 1st of the month', () => {
  for (const m of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]) {
    const { start } = getPrevMonthRange(2026, m);
    assert.ok(start.endsWith('-01'), `expected -01 day in start: ${start}`);
  }
});

test('monthly-accounting: start < end always', () => {
  for (const m of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]) {
    const { start, end } = getPrevMonthRange(2026, m);
    assert.ok(start <= end, `start ${start} must be <= end ${end}`);
  }
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-4: app/api/cron/soustraitants-paie — pay-line formatting
//
// Pure arithmetic: du = heures * taux
// Guard: when taux=0, label is "taux non défini" (no division by zero / NaN).
// Inlined from route.ts build loop.
// ════════════════════════════════════════════════════════════════════════════

function buildPayLine(heures, taux) {
  const du = heures * taux;
  if (taux > 0) {
    return `$${du.toFixed(2)} (${heures}h × $${taux}/h)`;
  } else {
    return `${heures}h (taux non défini)`;
  }
}

test('soustraitants-paie: standard pay line formats correctly', () => {
  const line = buildPayLine(8, 25);
  assert.equal(line, '$200.00 (8h × $25/h)');
});

test('soustraitants-paie: fractional hours produce correct total', () => {
  const line = buildPayLine(7.5, 30);
  assert.equal(line, '$225.00 (7.5h × $30/h)');
});

test('soustraitants-paie: taux=0 → "taux non défini" (not "$0.00 × $0/h")', () => {
  const line = buildPayLine(8, 0);
  assert.ok(line.includes('taux non défini'), `expected "taux non défini": ${line}`);
  assert.ok(!line.includes('$'), `no dollar sign expected when taux=0: ${line}`);
});

test('soustraitants-paie: taux=0 still shows hours', () => {
  const line = buildPayLine(6, 0);
  assert.ok(line.includes('6h'), `expected hours in output: ${line}`);
});

test('soustraitants-paie: 0 hours × valid taux → $0.00', () => {
  const line = buildPayLine(0, 25);
  assert.equal(line, '$0.00 (0h × $25/h)');
});

test('soustraitants-paie: toFixed(2) always produces two decimal places', () => {
  const line = buildPayLine(3, 20);
  assert.ok(line.includes('$60.00'), `expected two decimals: ${line}`);
});

test('soustraitants-paie: large values format without scientific notation', () => {
  const line = buildPayLine(160, 50);
  assert.equal(line, '$8000.00 (160h × $50/h)');
});

// ════════════════════════════════════════════════════════════════════════════
// INTEGRATION SKELETONS (skipped unless INTEGRATION_TEST=1)
// ════════════════════════════════════════════════════════════════════════════

test('INT-1 GET /api/cron/monthly-accounting — no auth → 401', { skip: SKIP_INTEGRATION }, async () => {
  const res = await fetch(`${BASE}/api/cron/monthly-accounting`);
  assert.equal(res.status, 401);
});

test('INT-2 GET /api/cron/soustraitants-paie — no auth → 401', { skip: SKIP_INTEGRATION }, async () => {
  const res = await fetch(`${BASE}/api/cron/soustraitants-paie`);
  assert.equal(res.status, 401);
});

test('INT-3 GET /api/cron/monthly-accounting — wrong secret → 401', { skip: SKIP_INTEGRATION }, async () => {
  const res = await fetch(`${BASE}/api/cron/monthly-accounting`, {
    headers: { Authorization: 'Bearer wrong-secret' },
  });
  assert.equal(res.status, 401);
});

test('INT-4 OPTIONS /api/submissions — CORS preflight → 204 with CORS headers', { skip: SKIP_INTEGRATION }, async () => {
  const res = await fetch(`${BASE}/api/submissions`, { method: 'OPTIONS' });
  assert.equal(res.status, 204);
  assert.ok(res.headers.get('access-control-allow-origin'), 'missing CORS header');
});

test('INT-5 POST /api/submissions — exceeds rate limit (11 requests same IP) → 429', { skip: SKIP_INTEGRATION }, async () => {
  const results = await Promise.all(
    Array.from({ length: 11 }, () =>
      fetch(`${BASE}/api/submissions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '10.0.99.99' },
        body: JSON.stringify({}),
      })
    )
  );
  const statuses = results.map(r => r.status);
  assert.ok(statuses.includes(429), `expected at least one 429 in: ${statuses}`);
});

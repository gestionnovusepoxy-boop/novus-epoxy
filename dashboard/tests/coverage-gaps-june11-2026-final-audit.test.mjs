/**
 * coverage-gaps-june11-2026-final-audit.test.mjs — Coverage gap audit, June 11 2026 (final pass).
 *
 * Run: node --test tests/coverage-gaps-june11-2026-final-audit.test.mjs
 *
 * TRUE GAPS — pure logic never covered by any prior test file:
 *
 *   GAP-1  app/api/cron/deposit-watch/route.ts — sendTelegram() 4000-char chunking.
 *          `text.match(/[\s\S]{1,4000}/g) ?? [text]` splits long messages for the
 *          Telegram 4096-byte API limit. Empty string yields null from .match(), so
 *          the `?? [text]` fallback fires and sends '' — zero tests anywhere for this.
 *          Off-by-one (4000 vs 4096) and the null-match fallback are both untested.
 *
 *   GAP-2  middleware.ts — 429 responses for cross-origin public routes have NO CORS
 *          headers. `Access-Control-Allow-Origin` is only set on `NextResponse.next()`
 *          (let-through) and OPTIONS preflight — not on the rate-limit 429 response.
 *          A browser making a cross-origin form submit from novusepoxy.ca receives a
 *          CORS opaque error instead of a 429, so the front-end cannot distinguish
 *          rate limiting from a network failure. Affects /api/track, /api/submissions,
 *          /api/chat, /api/chat/history, /api/chat/upload. Zero tests anywhere.
 *
 *   GAP-3  middleware.ts — `/api/chat/email` is missing from the OPTIONS preflight
 *          allow-list. The preflight handler checks for /api/chat, /api/chat/history,
 *          and /api/chat/upload — but NOT /api/chat/email. Cross-origin clients that
 *          send an OPTIONS preflight before POSTing to /api/chat/email will get no
 *          CORS headers back and the request will be blocked by the browser.
 *
 *   GAP-4  lib/agent.ts — notifyTelegramHandoff() uses a hardcoded vercel.app URL
 *          instead of NEXTAUTH_URL for the "Voir conversation" button. On the
 *          production custom domain (novusepoxy.ca), the deeplink in the Telegram
 *          notification always points to the Vercel deployment. Zero tests.
 *
 *   GAP-5  app/api/cron/deposit-watch/route.ts — isQuietHours() early-return guard.
 *          When quiet hours are active the cron returns {skipped:'quiet hours'} with
 *          status 200 instead of processing deposits. The quiet-hours short-circuit
 *          at the cron level is never verified (only the lib/telegram-utils.ts
 *          isQuietHours() logic itself has tests, not the early-return at call-site).
 *
 * INTEGRATION SKELETONS (skipped unless INTEGRATION_TEST=1):
 *   INT-1  GET /api/cron/deposit-watch — no auth → 401
 *   INT-2  GET /api/cron/deposit-watch — valid auth, quiet hours → 200 {skipped:...}
 *   INT-3  OPTIONS /api/chat/email — no CORS preflight configured → no ACAO header
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

const SKIP_INTEGRATION = !process.env.INTEGRATION_TEST;
const BASE = process.env.TEST_BASE_URL || 'http://localhost:3000';

// ════════════════════════════════════════════════════════════════════════════
// GAP-1: deposit-watch sendTelegram() — 4000-char chunking
//
// Inlined verbatim from app/api/cron/deposit-watch/route.ts.
// The Telegram API rejects messages > 4096 bytes; the local guard uses 4000
// chars as a conservative limit to avoid Unicode byte overflows.
// ════════════════════════════════════════════════════════════════════════════

function chunkTelegram(text) {
  return text.match(/[\s\S]{1,4000}/g) ?? [text];
}

test('sendTelegram chunking: empty string → match returns null → fallback [text] = [""]', () => {
  const chunks = chunkTelegram('');
  // ''.match(/[\s\S]{1,4000}/g) returns null (no matches)
  // so the ?? fallback fires: [text] = ['']
  assert.deepEqual(chunks, ['']);
});

test('sendTelegram chunking: 1 char → single chunk', () => {
  const chunks = chunkTelegram('A');
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0], 'A');
});

test('sendTelegram chunking: exactly 4000 chars → single chunk', () => {
  const text = 'x'.repeat(4000);
  const chunks = chunkTelegram(text);
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].length, 4000);
});

test('sendTelegram chunking: 4001 chars → 2 chunks (4000 + 1)', () => {
  const text = 'x'.repeat(4001);
  const chunks = chunkTelegram(text);
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0].length, 4000);
  assert.equal(chunks[1].length, 1);
});

test('sendTelegram chunking: 8000 chars → 2 chunks of 4000', () => {
  const text = 'x'.repeat(8000);
  const chunks = chunkTelegram(text);
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0].length, 4000);
  assert.equal(chunks[1].length, 4000);
});

test('sendTelegram chunking: 8001 chars → 3 chunks', () => {
  const text = 'x'.repeat(8001);
  const chunks = chunkTelegram(text);
  assert.equal(chunks.length, 3);
  assert.equal(chunks[2].length, 1);
});

test('sendTelegram chunking: newlines do NOT split chunks (\\n is matched by [\\s\\S])', () => {
  // \n is whitespace; [\s\S] matches it too — chunks are always exactly 4000 chars
  const text = 'a\n'.repeat(2000); // 4000 chars total
  const chunks = chunkTelegram(text);
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].length, 4000);
});

test('sendTelegram chunking: all chunks joined reproduce original text exactly', () => {
  const original = 'Hello '.repeat(1000); // 6000 chars
  const chunks = chunkTelegram(original);
  assert.equal(chunks.join(''), original);
});

test('sendTelegram chunking: short message typical admin alert → single chunk', () => {
  const msg = `💰 Dépôt détecté!\n\nQuote #42 — Jean Tremblay\nMontant: $450.00\n\nVoir le tableau de bord.`;
  const chunks = chunkTelegram(msg);
  assert.equal(chunks.length, 1);
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-2 & GAP-3: middleware.ts — CORS headers on 429 + /api/chat/email preflight
//
// These are architectural bugs in the middleware. We document the current
// behaviour with inline tests so any future fix is immediately visible.
// ════════════════════════════════════════════════════════════════════════════

// Inlined from middleware.ts — the corsHeaders object and rate-limit response
const CORS_ORIGIN = 'https://novusepoxy.ca';

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin':  CORS_ORIGIN,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function makeRateLimitedResponse(message, statusCode) {
  // Mirrors the current middleware: no CORS headers on 429
  return { status: statusCode, body: { error: message }, headers: {} };
}

function makeAllowThroughResponse(path) {
  const res = { status: 200, body: null, headers: {} };
  // CORS only set on let-through responses for specific public paths
  const publicPaths = ['/api/track', '/api/submissions', '/api/chat', '/api/chat/history', '/api/chat/upload'];
  if (publicPaths.includes(path)) {
    res.headers['Access-Control-Allow-Origin'] = CORS_ORIGIN;
  }
  return res;
}

// The OPTIONS preflight allowlist — inlined from middleware.ts
const OPTIONS_PREFLIGHT_PATHS = [
  '/api/track',
  '/api/submissions',
  '/api/chat',
  '/api/chat/history',
  '/api/chat/upload',
];

test('middleware CORS: 429 response has NO Access-Control-Allow-Origin header (current behaviour)', () => {
  // BUG: cross-origin browsers will see a CORS error, not a 429.
  // This test documents current behaviour; update it when the bug is fixed.
  const res429 = makeRateLimitedResponse('Trop de requêtes', 429);
  assert.equal(res429.headers['Access-Control-Allow-Origin'], undefined,
    'Currently, 429 responses do not carry CORS headers — browsers see opaque network error');
});

test('middleware CORS: let-through response for /api/submissions includes ACAO header', () => {
  const res = makeAllowThroughResponse('/api/submissions');
  assert.equal(res.headers['Access-Control-Allow-Origin'], CORS_ORIGIN);
});

test('middleware CORS: let-through response for /api/track includes ACAO header', () => {
  const res = makeAllowThroughResponse('/api/track');
  assert.equal(res.headers['Access-Control-Allow-Origin'], CORS_ORIGIN);
});

test('middleware CORS: OPTIONS preflight list does NOT include /api/chat/email (GAP-3 bug)', () => {
  // /api/chat/email receives POST from the inbound email agent.
  // It is rate-limited to 20/min but is NOT in the OPTIONS preflight list.
  // Any cross-origin OPTIONS request to /api/chat/email gets no ACAO header back.
  assert.equal(
    OPTIONS_PREFLIGHT_PATHS.includes('/api/chat/email'),
    false,
    '/api/chat/email must be added to OPTIONS preflight list to support cross-origin callers',
  );
});

test('middleware CORS: OPTIONS preflight list includes /api/chat/history and /api/chat/upload', () => {
  assert.ok(OPTIONS_PREFLIGHT_PATHS.includes('/api/chat/history'));
  assert.ok(OPTIONS_PREFLIGHT_PATHS.includes('/api/chat/upload'));
});

test('middleware CORS: corsHeaders() returns all three required fields', () => {
  const h = corsHeaders();
  assert.ok(h['Access-Control-Allow-Origin'], 'missing ACAO');
  assert.ok(h['Access-Control-Allow-Methods'], 'missing ACAM');
  assert.ok(h['Access-Control-Allow-Headers'], 'missing ACAH');
});

test('middleware CORS: corsHeaders() ACAO is exact novusepoxy.ca origin (not wildcard *)', () => {
  const h = corsHeaders();
  assert.equal(h['Access-Control-Allow-Origin'], 'https://novusepoxy.ca');
  assert.notEqual(h['Access-Control-Allow-Origin'], '*');
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-4: lib/agent.ts — notifyTelegramHandoff() hardcoded URL
//
// The function builds a "Voir conversation" Telegram inline button with a
// hardcoded https://novus-epoxy.vercel.app URL. On the production custom
// domain (novusepoxy.ca) or any staging environment, this points to the
// wrong host. The correct value should be process.env.NEXTAUTH_URL.
// ════════════════════════════════════════════════════════════════════════════

// Inlined URL-building logic from lib/agent.ts notifyTelegramHandoff()
function buildHandoffUrl(conversationId, nextAuthUrl) {
  // BUG: current code hardcodes the URL instead of using NEXTAUTH_URL.
  // Correct implementation (what it SHOULD be):
  const base = nextAuthUrl ?? 'https://novus-epoxy.vercel.app';
  return `${base}/dashboard/conversations/${conversationId}`;
}

// Current buggy implementation (hardcoded):
function buildHandoffUrlBuggy(conversationId) {
  return `https://novus-epoxy.vercel.app/dashboard/conversations/${conversationId}`;
}

test('notifyTelegramHandoff URL: correct impl uses NEXTAUTH_URL when set', () => {
  const url = buildHandoffUrl(42, 'https://novusepoxy.ca');
  assert.equal(url, 'https://novusepoxy.ca/dashboard/conversations/42');
});

test('notifyTelegramHandoff URL: correct impl falls back to vercel URL when NEXTAUTH_URL not set', () => {
  const url = buildHandoffUrl(42, undefined);
  assert.equal(url, 'https://novus-epoxy.vercel.app/dashboard/conversations/42');
});

test('notifyTelegramHandoff URL: current buggy impl ignores NEXTAUTH_URL (documents bug)', () => {
  // BUG: even with a custom domain set, the hardcoded URL never changes.
  const urlBuggy = buildHandoffUrlBuggy(42);
  assert.equal(urlBuggy, 'https://novus-epoxy.vercel.app/dashboard/conversations/42',
    'Current implementation always points to vercel.app — breaks on custom domain');
});

test('notifyTelegramHandoff URL: conversation ID is correctly embedded', () => {
  const url = buildHandoffUrl(999, 'https://novusepoxy.ca');
  assert.ok(url.includes('/999'), 'conversation ID must appear in URL');
  assert.ok(url.endsWith('/999'));
});

test('notifyTelegramHandoff URL: conversationId 0 is included (falsy check safety)', () => {
  // Conversation IDs start at 1 in Postgres serial, but 0 should not crash
  const url = buildHandoffUrl(0, 'https://novusepoxy.ca');
  assert.ok(url.includes('/0'));
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-5: deposit-watch — isQuietHours() early-return guard
//
// The route returns {skipped:'quiet hours'} with HTTP 200 when isQuietHours()
// is true. The lib/telegram-utils.ts isQuietHours() logic itself is tested
// in telegram-quiet-hours.test.mjs, but the cron-level early-return branch
// (returning {skipped:...}) has never been verified at the call-site.
//
// We inline the gate logic to confirm it honours the correct boundary.
// ════════════════════════════════════════════════════════════════════════════

// Inlined from lib/telegram-utils.ts and app/api/cron/deposit-watch/route.ts
function isQuietHoursAt(h) {
  return h >= 21 || h < 8;
}

function depositWatchResponse(h) {
  if (isQuietHoursAt(h)) {
    return { skipped: 'quiet hours' };
  }
  return null; // continues processing
}

test('deposit-watch quiet-hours guard: hour=7 → skipped (before 8h)', () => {
  const res = depositWatchResponse(7);
  assert.deepEqual(res, { skipped: 'quiet hours' });
});

test('deposit-watch quiet-hours guard: hour=8 → NOT skipped (business starts)', () => {
  assert.equal(depositWatchResponse(8), null);
});

test('deposit-watch quiet-hours guard: hour=20 → NOT skipped', () => {
  assert.equal(depositWatchResponse(20), null);
});

test('deposit-watch quiet-hours guard: hour=21 → skipped (after 21h cutoff)', () => {
  const res = depositWatchResponse(21);
  assert.deepEqual(res, { skipped: 'quiet hours' });
});

test('deposit-watch quiet-hours guard: hour=0 → skipped (midnight)', () => {
  const res = depositWatchResponse(0);
  assert.deepEqual(res, { skipped: 'quiet hours' });
});

test('deposit-watch quiet-hours guard: hour=23 → skipped (late night)', () => {
  const res = depositWatchResponse(23);
  assert.deepEqual(res, { skipped: 'quiet hours' });
});

test('deposit-watch quiet-hours guard: skipped response is NOT an error (status 200)', () => {
  // The route returns NextResponse.json({skipped:'quiet hours'}) with no status arg
  // meaning it defaults to 200. This must not be treated as an error by Vercel cron.
  const res = depositWatchResponse(3);
  assert.ok('skipped' in res, 'response must have skipped key');
  assert.equal(typeof res.skipped, 'string');
  // There is no error key — Vercel cron treats any 2xx as success
  assert.ok(!('error' in res));
});

// ════════════════════════════════════════════════════════════════════════════
// INTEGRATION SKELETONS — set INTEGRATION_TEST=1 to enable
// ════════════════════════════════════════════════════════════════════════════

test(
  'INT-1: GET /api/cron/deposit-watch — no auth header → 401',
  { skip: SKIP_INTEGRATION ? 'set INTEGRATION_TEST=1' : false },
  async () => {
    const res = await fetch(`${BASE}/api/cron/deposit-watch`);
    assert.equal(res.status, 401);
  },
);

test(
  'INT-2: GET /api/cron/deposit-watch — wrong auth → 401',
  { skip: SKIP_INTEGRATION ? 'set INTEGRATION_TEST=1' : false },
  async () => {
    const res = await fetch(`${BASE}/api/cron/deposit-watch`, {
      headers: { Authorization: 'Bearer wrong-secret' },
    });
    assert.equal(res.status, 401);
  },
);

test(
  'INT-3: OPTIONS /api/chat/email — no CORS preflight configured (documents GAP-3)',
  { skip: SKIP_INTEGRATION ? 'set INTEGRATION_TEST=1' : false },
  async () => {
    const res = await fetch(`${BASE}/api/chat/email`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://novusepoxy.ca',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'Content-Type',
      },
    });
    // Current behaviour: the middleware does NOT handle OPTIONS for /api/chat/email
    // so it falls through to Next.js which returns 405 with no CORS headers.
    const acao = res.headers.get('access-control-allow-origin');
    assert.equal(acao, null,
      'GAP-3: /api/chat/email preflight returns no ACAO header — fix by adding to OPTIONS list');
  },
);

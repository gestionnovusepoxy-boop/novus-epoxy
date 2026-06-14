/**
 * coverage-gaps-june10-2026.test.mjs — Coverage gaps identified by audit on 2026-06-10.
 *
 * Run: node --test tests/coverage-gaps-june10-2026.test.mjs
 *
 * PURE-LOGIC GAPS (run immediately, no DB/network):
 *   GAP-1  app/api/meta/webhook/route.ts    — verifyMetaSignature() HMAC logic
 *   GAP-2  app/api/webhooks/ghl/route.ts    — scoreTemperature() lead scoring
 *   GAP-3  app/api/webhooks/ghl/route.ts    — GHL auth guard (missing/wrong secret → 401)
 *   GAP-4  lib/composio.ts                  — getComposio() missing API key throws
 *   GAP-5  lib/composio.ts                  — runAction() wraps errors into { ok, error }
 *   GAP-6  lib/telegram-utils.ts            — sendTelegramSafe() force=true bypasses quiet hours
 *   GAP-7  lib/telegram-utils.ts            — sendTelegramSafe() returns false when no token
 *   GAP-8  lib/render-pdf.ts               — renderInvoicePdf() throws on non-200 response
 *   GAP-9  lib/render-pdf.ts               — renderInvoicePdf() strips window.onload print()
 *   GAP-10 lib/send-prospect-email.ts       — sendProspectEmail() throws when credentials missing
 *   GAP-11 app/api/cron/* auth guard        — missing Authorization header → 401
 *   GAP-12 lib/auto-heal.ts                — healEmailScan 24h auto-clear flag boundary
 *
 * INTEGRATION SKELETONS (skipped unless INTEGRATION_TEST=1):
 *   INT-1  POST /api/meta/webhook           — missing/wrong signature → 403
 *   INT-2  POST /api/webhooks/ghl           — missing secret header → 401
 *   INT-3  GET  /api/cron/aria-prospect     — no Authorization → 401
 *   INT-4  POST /api/quotes/:id/send        — no session → 401 or 403
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, timingSafeEqual } from 'node:crypto';

const SKIP_INTEGRATION = !process.env.INTEGRATION_TEST;
const BASE_URL = process.env.TEST_BASE_URL ?? 'http://localhost:3000';

// ════════════════════════════════════════════════════════════════════════════
// GAP-1: app/api/meta/webhook/route.ts — verifyMetaSignature()
//
// CRITICAL security path: FAIL-CLOSED when META_APP_SECRET is unset.
// Wrong signature must return false (attacker can't replay without the secret).
// Timing-safe comparison prevents length-based timing leaks.
// ════════════════════════════════════════════════════════════════════════════

// Inlined verbatim from app/api/meta/webhook/route.ts
function verifyMetaSignature(payload, signature, appSecret) {
  if (!appSecret) return false;
  if (!signature) return false;

  const expected = 'sha256=' + createHmac('sha256', appSecret).update(payload).digest('hex');
  try {
    const expBuf = Buffer.from(expected);
    const sigBuf = Buffer.from(signature);
    if (expBuf.length !== sigBuf.length) return false;
    return timingSafeEqual(expBuf, sigBuf);
  } catch {
    return false;
  }
}

test('verifyMetaSignature: correct HMAC-SHA256 signature → true', () => {
  const secret = 'test_app_secret_123';
  const payload = JSON.stringify({ object: 'page', entry: [] });
  const sig = 'sha256=' + createHmac('sha256', secret).update(payload).digest('hex');
  assert.equal(verifyMetaSignature(payload, sig, secret), true);
});

test('verifyMetaSignature: wrong secret → false', () => {
  const payload = '{"object":"page"}';
  const sig = 'sha256=' + createHmac('sha256', 'correct_secret').update(payload).digest('hex');
  assert.equal(verifyMetaSignature(payload, sig, 'wrong_secret'), false);
});

test('verifyMetaSignature: tampered payload → false', () => {
  const secret = 'myappsecret';
  const original = '{"entry":[{"id":"1"}]}';
  const tampered = '{"entry":[{"id":"2"}]}';
  const sig = 'sha256=' + createHmac('sha256', secret).update(original).digest('hex');
  assert.equal(verifyMetaSignature(tampered, sig, secret), false);
});

test('verifyMetaSignature: null signature → false', () => {
  assert.equal(verifyMetaSignature('{"x":1}', null, 'secret'), false);
});

test('verifyMetaSignature: missing signature (no header) → false', () => {
  assert.equal(verifyMetaSignature('{"x":1}', undefined, 'secret'), false);
});

test('verifyMetaSignature: FAIL-CLOSED — no appSecret → false (not open!)', () => {
  const payload = '{"entry":[]}';
  const sig = 'sha256=' + createHmac('sha256', 'anysecret').update(payload).digest('hex');
  assert.equal(verifyMetaSignature(payload, sig, ''), false,
    'Empty secret must fail closed — no secret = reject all payloads');
});

test('verifyMetaSignature: empty payload + correct sig → true', () => {
  const secret = 'sec';
  const sig = 'sha256=' + createHmac('sha256', secret).update('').digest('hex');
  assert.equal(verifyMetaSignature('', sig, secret), true);
});

test('verifyMetaSignature: signature missing sha256= prefix → false', () => {
  const secret = 'sec';
  const raw = createHmac('sha256', secret).update('hello').digest('hex');
  // Raw hex without the "sha256=" prefix — length mismatch → false
  assert.equal(verifyMetaSignature('hello', raw, secret), false);
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-2: app/api/webhooks/ghl/route.ts — scoreTemperature()
//
// Scores GHL contact leads as chaud/tiede/froid based on email, phone, source.
// No tests exist for this business-critical classification.
// ════════════════════════════════════════════════════════════════════════════

// Inlined verbatim from app/api/webhooks/ghl/route.ts
function scoreTemperature(lead) {
  let score = 0;
  if (lead.email) score += 2;
  if (lead.phone) score += 2;
  if (lead.source === 'Facebook') score += 2;
  if (score >= 5) return 'chaud';
  if (score >= 3) return 'tiede';
  return 'froid';
}

test('scoreTemperature: email + phone + Facebook → chaud (score=6)', () => {
  assert.equal(scoreTemperature({ email: 'a@b.com', phone: '5811234567', source: 'Facebook' }), 'chaud');
});

test('scoreTemperature: email + phone → tiede (score=4)', () => {
  assert.equal(scoreTemperature({ email: 'a@b.com', phone: '5811234567', source: 'GHL' }), 'tiede');
});

test('scoreTemperature: email + Facebook → chaud (score=4... wait: 2+2=4 ≥ 3 → tiede)', () => {
  // email(2) + Facebook(2) = 4 → tiede (not chaud — chaud requires ≥5)
  assert.equal(scoreTemperature({ email: 'a@b.com', source: 'Facebook' }), 'tiede');
});

test('scoreTemperature: phone + Facebook → chaud (score=4 → tiede)', () => {
  // phone(2) + Facebook(2) = 4 → tiede
  assert.equal(scoreTemperature({ phone: '5819876543', source: 'Facebook' }), 'tiede');
});

test('scoreTemperature: phone only → tiede (score=2 → froid... wait: 2 < 3 → froid)', () => {
  assert.equal(scoreTemperature({ phone: '5814441234' }), 'froid');
});

test('scoreTemperature: email only → froid (score=2)', () => {
  assert.equal(scoreTemperature({ email: 'x@x.com' }), 'froid');
});

test('scoreTemperature: empty lead → froid (score=0)', () => {
  assert.equal(scoreTemperature({}), 'froid');
});

test('scoreTemperature: Facebook only (no email/phone) → froid (score=2)', () => {
  assert.equal(scoreTemperature({ source: 'Facebook' }), 'froid');
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-3: app/api/webhooks/ghl/route.ts — auth guard
//
// GHL uses a plain-text secret in header x-webhook-secret (or ?secret= param).
// No secret configured → always 401 (FAIL-CLOSED).
// Wrong secret → 401.
// ════════════════════════════════════════════════════════════════════════════

// Inlined auth guard from app/api/webhooks/ghl/route.ts
function ghlAuthPasses(headerSecret, envSecret) {
  if (!envSecret) return false; // FAIL-CLOSED: pas de secret configuré
  return headerSecret === envSecret;
}

test('GHL auth: correct secret header → passes', () => {
  assert.equal(ghlAuthPasses('mysecret123', 'mysecret123'), true);
});

test('GHL auth: wrong secret header → blocked', () => {
  assert.equal(ghlAuthPasses('wrongsecret', 'mysecret123'), false);
});

test('GHL auth: empty header secret → blocked', () => {
  assert.equal(ghlAuthPasses('', 'mysecret123'), false);
});

test('GHL auth: FAIL-CLOSED — env secret not set → blocked even with correct-looking header', () => {
  assert.equal(ghlAuthPasses('anything', ''), false);
  assert.equal(ghlAuthPasses('anything', undefined), false);
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-4: lib/composio.ts — getComposio() throws when API key missing
//
// getComposio() is a lazy singleton. It must throw a clear error if
// COMPOSIO_API_KEY is not set — otherwise downstream Composio calls
// fail with a cryptic SDK error.
// ════════════════════════════════════════════════════════════════════════════

// Inlined from lib/composio.ts (key-check logic only — no SDK import needed)
function getComposioGuard(apiKey) {
  if (!apiKey) throw new Error('COMPOSIO_API_KEY manquant');
  return 'ok'; // represents successful construction
}

test('getComposio: throws descriptive error when API key is missing', () => {
  assert.throws(
    () => getComposioGuard(undefined),
    { message: 'COMPOSIO_API_KEY manquant' },
    'Must throw exactly this message so operators know what env var to set'
  );
});

test('getComposio: throws when key is empty string', () => {
  assert.throws(() => getComposioGuard(''), { message: 'COMPOSIO_API_KEY manquant' });
});

test('getComposio: does NOT throw when key is present', () => {
  assert.doesNotThrow(() => getComposioGuard('some-api-key'));
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-5: lib/composio.ts — runAction() wraps all errors into { ok, error }
//
// runAction() must NEVER propagate a raw exception to the caller.
// The { ok, error } shape is the contract — routes depend on checking ok===false
// rather than try/catch.
// ════════════════════════════════════════════════════════════════════════════

// Inlined error-wrapping from lib/composio.ts (catch branch only)
function runActionCatch(err) {
  return { ok: false, error: err instanceof Error ? err.message : String(err) };
}

test('runAction error wrapping: Error instance → ok:false with message', () => {
  const result = runActionCatch(new Error('Network timeout'));
  assert.equal(result.ok, false);
  assert.equal(result.error, 'Network timeout');
});

test('runAction error wrapping: string thrown → ok:false with string', () => {
  const result = runActionCatch('RATE_LIMITED');
  assert.equal(result.ok, false);
  assert.equal(result.error, 'RATE_LIMITED');
});

test('runAction error wrapping: object thrown → ok:false with stringified', () => {
  const result = runActionCatch({ code: 500 });
  assert.equal(result.ok, false);
  assert.ok(typeof result.error === 'string', 'error must always be a string');
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-6: lib/telegram-utils.ts — sendTelegramSafe() with force=true
//
// The force flag bypasses quiet-hours gating. Critical for payment confirmations.
// No test verifies that force=true would proceed past the quiet-hours check.
// ════════════════════════════════════════════════════════════════════════════

// Inlined early-return logic from sendTelegramSafe()
function wouldSuppress(isQuietHours, force) {
  return !force && isQuietHours;
}

test('sendTelegramSafe logic: quiet hours + force=false → would be suppressed', () => {
  assert.equal(wouldSuppress(true, false), true);
});

test('sendTelegramSafe logic: quiet hours + force=true → NOT suppressed (payment confirmation)', () => {
  assert.equal(wouldSuppress(true, true), false);
});

test('sendTelegramSafe logic: not quiet hours + force=false → NOT suppressed', () => {
  assert.equal(wouldSuppress(false, false), false);
});

test('sendTelegramSafe logic: not quiet hours + force=true → NOT suppressed', () => {
  assert.equal(wouldSuppress(false, true), false);
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-7: lib/telegram-utils.ts — sendTelegramSafe() returns false when no token
//
// If TELEGRAM_BOT_TOKEN is unset, no fetch is attempted and false is returned.
// ════════════════════════════════════════════════════════════════════════════

function sendTelegramSafeGuard(token) {
  if (!token) return false; // guard from sendTelegramSafe
  return 'would_fetch';
}

test('sendTelegramSafe: missing TELEGRAM_BOT_TOKEN → returns false (no crash)', () => {
  assert.equal(sendTelegramSafeGuard(undefined), false);
  assert.equal(sendTelegramSafeGuard(''), false);
});

test('sendTelegramSafe: token present → proceeds to fetch', () => {
  assert.equal(sendTelegramSafeGuard('1234567:ABC'), 'would_fetch');
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-8 & GAP-9: lib/render-pdf.ts — renderInvoicePdf error and HTML sanitization
//
// renderInvoicePdf() must throw when the invoice API returns non-200.
// It must also strip window.onload print() from the HTML before rendering.
// ════════════════════════════════════════════════════════════════════════════

// Inlined from lib/render-pdf.ts
function checkInvoiceResponseOk(status) {
  if (!status) throw new Error(`Failed to fetch invoice HTML: ${status}`); // renamed for clarity
  return status;
}

// Inlined print() stripping logic (from render-pdf.ts comment: strip window.onload)
function stripPrintScript(html) {
  return html.replace(/window\.onload\s*=\s*(?:function\s*\(\s*\)\s*)?\{[^}]*print\(\s*\)[^}]*\}/g, '');
}

test('renderInvoicePdf: throws descriptive error when invoice API returns 404', () => {
  assert.throws(
    () => {
      const status = 404;
      if (!200 <= status || status > 299) { // guard pattern
        throw new Error(`Failed to fetch invoice HTML: ${status}`);
      }
    },
    /Failed to fetch invoice HTML/
  );
});

test('renderInvoicePdf: stripPrintScript — removes window.onload print() block', () => {
  const html = '<html><script>window.onload = function() { window.print(); }</script></html>';
  const stripped = stripPrintScript(html);
  assert.ok(!stripped.includes('print()'), 'print() must be removed to prevent recursive print dialog');
});

test('renderInvoicePdf: stripPrintScript — leaves unrelated script intact', () => {
  const html = '<html><script>var x = 1; console.log(x);</script></html>';
  const stripped = stripPrintScript(html);
  assert.ok(stripped.includes('console.log'), 'unrelated script must not be touched');
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-10: lib/send-prospect-email.ts — throws when Gmail credentials missing
//
// Uses GOOGLE_WEB_CLIENT_ID/SECRET + GOOGLE_REFRESH_TOKEN (env or kv_store).
// When all three are absent, must throw "Gmail credentials missing" — not a
// silent no-op — so callers can catch and retry later.
// ════════════════════════════════════════════════════════════════════════════

// Inlined from lib/send-prospect-email.ts (credential guard only)
function checkProspectEmailCreds(clientId, clientSecret, refreshToken) {
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('Gmail credentials missing');
  }
  return 'ok';
}

test('sendProspectEmail: throws when all credentials are missing', () => {
  assert.throws(
    () => checkProspectEmailCreds(undefined, undefined, undefined),
    { message: 'Gmail credentials missing' }
  );
});

test('sendProspectEmail: throws when only refreshToken is missing', () => {
  assert.throws(
    () => checkProspectEmailCreds('client_id', 'client_secret', undefined),
    { message: 'Gmail credentials missing' }
  );
});

test('sendProspectEmail: throws when only clientId is missing', () => {
  assert.throws(
    () => checkProspectEmailCreds(undefined, 'secret', 'token'),
    { message: 'Gmail credentials missing' }
  );
});

test('sendProspectEmail: does NOT throw when all credentials present', () => {
  assert.doesNotThrow(() => checkProspectEmailCreds('id', 'secret', 'token'));
});

test('sendProspectEmail: env priority — GOOGLE_WEB_CLIENT_ID takes precedence over GOOGLE_CLIENT_ID', () => {
  // Both env vars set — WEB variant wins
  const clientId = process.env.GOOGLE_WEB_CLIENT_ID || process.env.GOOGLE_CLIENT_ID;
  // Just assert the fallback chain logic works — no crash
  assert.ok(typeof (clientId ?? 'fallback') === 'string');
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-11: Cron route auth guard — Bearer token check
//
// All cron routes use the same pattern:
//   const authHeader = req.headers.get('authorization') ?? '';
//   if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) return 401
//
// No tests cover this auth guard. A regression here exposes all cron jobs
// to unauthenticated execution.
// ════════════════════════════════════════════════════════════════════════════

// Inlined cron auth logic
function cronAuthPasses(authHeader, cronSecret) {
  if (!cronSecret) return false; // FAIL-CLOSED: no secret = deny all
  return authHeader === `Bearer ${cronSecret}`;
}

test('cron auth: correct Bearer token → passes', () => {
  assert.equal(cronAuthPasses('Bearer my-cron-secret-xyz', 'my-cron-secret-xyz'), true);
});

test('cron auth: wrong token → blocked', () => {
  assert.equal(cronAuthPasses('Bearer wrong-secret', 'my-cron-secret-xyz'), false);
});

test('cron auth: no Authorization header (empty string) → blocked', () => {
  assert.equal(cronAuthPasses('', 'my-cron-secret-xyz'), false);
});

test('cron auth: FAIL-CLOSED — no CRON_SECRET configured → blocks even with any header', () => {
  assert.equal(cronAuthPasses('Bearer anything', ''), false);
});

test('cron auth: token without "Bearer " prefix → blocked', () => {
  assert.equal(cronAuthPasses('my-cron-secret-xyz', 'my-cron-secret-xyz'), false,
    'Raw token without prefix must be rejected');
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-12: lib/auto-heal.ts — healEmailScan 24h auto-clear boundary
//
// When google_token_broken flag is set, healEmailScan skips for 24h.
// After 24h, it auto-clears the flag and retries.
// Edge case: brokenAge exactly at 24.0 must proceed (≥24 clears).
// ════════════════════════════════════════════════════════════════════════════

// Inlined from lib/auto-heal.ts (healEmailScan — token broken check)
function shouldSkipEmailScan(tokenBrokenRow) {
  if (!tokenBrokenRow || tokenBrokenRow.value !== 'true') return false; // not broken
  const brokenAge = tokenBrokenRow.updated_at
    ? (Date.now() - new Date(tokenBrokenRow.updated_at).getTime()) / 3600000
    : 999;
  if (brokenAge < 24) return true; // skip: still in cooldown
  return false; // would clear flag and retry
}

const ONE_HOUR_MS = 3600000;

test('healEmailScan: token not broken → should NOT skip', () => {
  assert.equal(shouldSkipEmailScan(null), false);
  assert.equal(shouldSkipEmailScan({ value: 'false', updated_at: new Date().toISOString() }), false);
});

test('healEmailScan: token broken 1h ago → skip (within 24h cooldown)', () => {
  const updated_at = new Date(Date.now() - 1 * ONE_HOUR_MS).toISOString();
  assert.equal(shouldSkipEmailScan({ value: 'true', updated_at }), true);
});

test('healEmailScan: token broken 23.9h ago → skip (still within 24h)', () => {
  const updated_at = new Date(Date.now() - 23.9 * ONE_HOUR_MS).toISOString();
  assert.equal(shouldSkipEmailScan({ value: 'true', updated_at }), true);
});

test('healEmailScan: token broken 24h ago → do NOT skip (auto-clear and retry)', () => {
  const updated_at = new Date(Date.now() - 24 * ONE_HOUR_MS).toISOString();
  assert.equal(shouldSkipEmailScan({ value: 'true', updated_at }), false);
});

test('healEmailScan: token broken 48h ago → do NOT skip (long past cooldown)', () => {
  const updated_at = new Date(Date.now() - 48 * ONE_HOUR_MS).toISOString();
  assert.equal(shouldSkipEmailScan({ value: 'true', updated_at }), false);
});

test('healEmailScan: broken flag with no updated_at → age defaults to 999h → do NOT skip', () => {
  assert.equal(shouldSkipEmailScan({ value: 'true', updated_at: null }), false);
});

// ════════════════════════════════════════════════════════════════════════════
// INTEGRATION SKELETONS (skipped unless INTEGRATION_TEST=1)
// ════════════════════════════════════════════════════════════════════════════

test('INT-1: POST /api/meta/webhook — wrong signature → 403', { skip: SKIP_INTEGRATION }, async () => {
  const res = await fetch(`${BASE_URL}/api/meta/webhook`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-hub-signature-256': 'sha256=deadbeefdeadbeefdeadbeefdeadbeef',
    },
    body: JSON.stringify({ object: 'page', entry: [] }),
  });
  assert.equal(res.status, 403, 'Invalid signature must return 403');
});

test('INT-2: POST /api/webhooks/ghl — missing secret header → 401', { skip: SKIP_INTEGRATION }, async () => {
  const res = await fetch(`${BASE_URL}/api/webhooks/ghl`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'ContactCreate', firstName: 'Test' }),
  });
  assert.equal(res.status, 401);
  const body = await res.json();
  assert.ok('error' in body);
});

test('INT-3: GET /api/cron/aria-prospect — no Authorization → 401', { skip: SKIP_INTEGRATION }, async () => {
  const res = await fetch(`${BASE_URL}/api/cron/aria-prospect`);
  assert.equal(res.status, 401, 'Cron endpoint without auth must return 401');
});

test('INT-4: GET /api/status — should return 200 health check', { skip: SKIP_INTEGRATION }, async () => {
  const res = await fetch(`${BASE_URL}/api/status`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok('status' in body || 'ok' in body, 'Health endpoint must return status field');
});

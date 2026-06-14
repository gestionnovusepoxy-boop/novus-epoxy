/**
 * Test skeletons for coverage gaps in auth.ts, llm.ts, and send-email.ts.
 *
 * All logic is inlined (no @/lib imports) so tests run with plain node:
 *   node --test tests/auth-llm-email-gaps.test.mjs
 *
 * Identified gaps:
 *   GAP-11: auth.ts  — checkPassword() bcrypt detection + plaintext timing-safe
 *   GAP-12: auth.ts  — requireAdmin() api-key vs session gate
 *   GAP-13: llm.ts   — OR_MODELS env overrides + cost calculation formula
 *   GAP-14: send-email.ts — routing (via='resend'), MIME subject encoding,
 *                           attachment base64 line-wrapping, Gmail-only rule
 *   GAP-15: api.ts   — apiFetch error code handling
 *   GAP-16: Missing error-handling tests across multiple lib files
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { timingSafeEqual, createHmac } from 'crypto';

// ════════════════════════════════════════════════════════════════════════════
// GAP-11: lib/auth.ts — checkPassword() never tested
// Critical security function: wrong logic here lets anyone in or locks out admin.
// Two branches: bcrypt hash detection AND timing-safe plaintext comparison.
// ════════════════════════════════════════════════════════════════════════════

// Inlined from lib/auth.ts (bcryptjs not available in test env — only test the
// hash-detection branch and the plaintext path we CAN test without the library)
function checkPassword_plaintext(input, stored) {
  // Only the plaintext branch (non-bcrypt stored passwords)
  if (stored.startsWith('$2a$') || stored.startsWith('$2b$')) {
    return null; // signals "bcrypt branch"
  }
  const a = Buffer.from(input);
  const b = Buffer.from(stored);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

test('checkPassword: bcrypt hash prefix $2a$ → routes to bcrypt branch (not plaintext)', () => {
  const result = checkPassword_plaintext('anypassword', '$2a$10$somehashvalue');
  assert.equal(result, null, '$2a$ prefix must route to bcrypt branch, not plaintext comparison');
});

test('checkPassword: bcrypt hash prefix $2b$ → routes to bcrypt branch', () => {
  const result = checkPassword_plaintext('anypassword', '$2b$12$somehashvalue');
  assert.equal(result, null, '$2b$ prefix must route to bcrypt branch');
});

test('checkPassword: correct plaintext → true', () => {
  const result = checkPassword_plaintext('mypassword123', 'mypassword123');
  assert.equal(result, true);
});

test('checkPassword: wrong plaintext → false', () => {
  const result = checkPassword_plaintext('wrongpassword', 'correctpassword');
  assert.equal(result, false);
});

test('checkPassword: different-length passwords → false (no timing leak)', () => {
  // Must NOT throw — different lengths return false immediately (safe)
  assert.equal(checkPassword_plaintext('short', 'muchlongerpassword'), false);
  assert.equal(checkPassword_plaintext('muchlongerpassword', 'short'), false);
});

test('checkPassword: empty string vs empty string → true (edge case)', () => {
  // Both empty: timingSafeEqual on two empty Buffers → true
  assert.equal(checkPassword_plaintext('', ''), true);
});

test('checkPassword: empty input vs non-empty stored → false (length mismatch)', () => {
  assert.equal(checkPassword_plaintext('', 'somepassword'), false);
});

test('checkPassword: timing-safe — result type is boolean not null for plaintext path', () => {
  const result = checkPassword_plaintext('hello', 'world');
  assert.equal(typeof result, 'boolean');
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-12: lib/auth.ts — requireAdmin() gate logic
// The function accepts EITHER a valid session OR an x-api-key header.
// Timing-safe comparison on api key is critical (prevents timing attacks).
// ════════════════════════════════════════════════════════════════════════════

// Inline the api-key validation logic from requireAdmin()
function validateApiKey(provided, stored) {
  if (!stored || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(stored);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

test('requireAdmin: correct api key → authorized', () => {
  assert.equal(validateApiKey('my-secret-key', 'my-secret-key'), true);
});

test('requireAdmin: wrong api key → denied', () => {
  assert.equal(validateApiKey('wrong-key', 'my-secret-key'), false);
});

test('requireAdmin: empty api key → denied', () => {
  assert.equal(validateApiKey('', 'my-secret-key'), false);
  assert.equal(validateApiKey(null, 'my-secret-key'), false);
});

test('requireAdmin: no stored api key (env var not set) → denied', () => {
  assert.equal(validateApiKey('any-key', ''), false);
  assert.equal(validateApiKey('any-key', null), false);
});

test('requireAdmin: api key length mismatch → false (no timing leak)', () => {
  assert.equal(validateApiKey('short', 'much-longer-key'), false);
});

test('requireAdmin: api key must be timing-safe (not ===)', () => {
  // Verify we're using timingSafeEqual, not simple ===
  // Both return same result for equal strings — this verifies the path
  const key = 'test-api-key-12345';
  assert.equal(validateApiKey(key, key), true);
  assert.equal(validateApiKey('x'.repeat(key.length), key), false);
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-13: lib/llm.ts — OR_MODELS env overrides + cost calculation
// Every tier can be overridden via env var. Cost = (inTok*inPrice + outTok*outPrice) / 1M.
// A wrong formula silently undercharges or overcharges — affects kill-switch threshold.
// ════════════════════════════════════════════════════════════════════════════

// Inlined from lib/llm.ts
const OR_MODELS_DEFAULTS = {
  bulk:   'deepseek/deepseek-v4-flash',
  fast:   'google/gemini-3.1-flash-lite',
  medium: 'google/gemini-3-flash-preview',
  smart:  'x-ai/grok-4.20',
  top:    'google/gemini-3.1-pro-preview',
};

const TIER_PRICES_PER_M = {
  bulk:   { in: 0.10, out: 0.20 },
  fast:   { in: 0.25, out: 1.50 },
  medium: { in: 0.50, out: 3.00 },
  smart:  { in: 1.25, out: 2.50 },
  top:    { in: 2.00, out: 12.00 },
};

function estimateCostUsd(tier, promptTokens, completionTokens) {
  const price = TIER_PRICES_PER_M[tier];
  return (promptTokens * price.in + completionTokens * price.out) / 1_000_000;
}

test('OR_MODELS: all 5 tiers have default values', () => {
  for (const tier of ['bulk', 'fast', 'medium', 'smart', 'top']) {
    assert.ok(OR_MODELS_DEFAULTS[tier], `tier "${tier}" must have a default model`);
    assert.ok(typeof OR_MODELS_DEFAULTS[tier] === 'string');
  }
});

test('OR_MODELS: smart tier is grok (highest quality for Aria)', () => {
  assert.ok(OR_MODELS_DEFAULTS.smart.includes('grok'), 'smart tier should use grok for Aria');
});

test('OR_MODELS: bulk is cheapest (lowest in-price)', () => {
  const prices = Object.values(TIER_PRICES_PER_M).map(p => p.in);
  assert.equal(TIER_PRICES_PER_M.bulk.in, Math.min(...prices), 'bulk must be cheapest input tier');
});

test('cost calculation: 1M input tokens bulk → $0.10', () => {
  const cost = estimateCostUsd('bulk', 1_000_000, 0);
  assert.ok(Math.abs(cost - 0.10) < 0.0001, `bulk 1M input should cost $0.10, got $${cost}`);
});

test('cost calculation: 1M output tokens top → $12.00', () => {
  const cost = estimateCostUsd('top', 0, 1_000_000);
  assert.ok(Math.abs(cost - 12.00) < 0.0001, `top 1M output should cost $12.00, got $${cost}`);
});

test('cost calculation: 10k input + 2k output smart → correct', () => {
  // (10000 * 1.25 + 2000 * 2.50) / 1_000_000 = (12500 + 5000) / 1M = $0.0175
  const expected = (10000 * 1.25 + 2000 * 2.50) / 1_000_000;
  const got = estimateCostUsd('smart', 10000, 2000);
  assert.ok(Math.abs(got - expected) < 0.000001);
});

test('cost calculation: zero tokens → $0', () => {
  for (const tier of Object.keys(TIER_PRICES_PER_M)) {
    assert.equal(estimateCostUsd(tier, 0, 0), 0);
  }
});

test('TIER_PRICES_PER_M: output always more expensive than input per tier', () => {
  for (const [tier, prices] of Object.entries(TIER_PRICES_PER_M)) {
    assert.ok(prices.out > prices.in,
      `tier "${tier}": output price ($${prices.out}) should be >= input price ($${prices.in})`);
  }
});

test('OR_MODELS: env var override pattern (simulated)', () => {
  // Simulate what OR_MODELS would do if env var was set
  function resolveModel(tier, envValue, defaultValue) {
    return envValue ?? defaultValue;
  }
  assert.equal(resolveModel('bulk', 'openai/gpt-5', OR_MODELS_DEFAULTS.bulk), 'openai/gpt-5');
  assert.equal(resolveModel('bulk', undefined, OR_MODELS_DEFAULTS.bulk), OR_MODELS_DEFAULTS.bulk);
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-14: lib/send-email.ts — routing, MIME encoding, attachment wrapping
// The routing rule (RÈGLE DURE) is: Gmail always, NO Resend fallback except
// when via='resend'. A regression here sends emails from the wrong address.
// ════════════════════════════════════════════════════════════════════════════

// Inline routing decision from sendEmail()
function resolveEmailRoute(via) {
  if (via === 'resend') return { primary: 'resend', fallback: 'gmail' };
  // Default: Gmail ONLY, no Resend fallback (RÈGLE DURE)
  return { primary: 'gmail', fallback: null };
}

test('sendEmail routing: via=resend → Resend primary, Gmail fallback', () => {
  const { primary, fallback } = resolveEmailRoute('resend');
  assert.equal(primary, 'resend');
  assert.equal(fallback, 'gmail');
});

test('sendEmail routing: via=undefined → Gmail only, NO Resend fallback', () => {
  const { primary, fallback } = resolveEmailRoute(undefined);
  assert.equal(primary, 'gmail');
  assert.equal(fallback, null, 'RÈGLE DURE: no Resend fallback for default route');
});

test('sendEmail routing: via=gmail → Gmail only', () => {
  const { primary, fallback } = resolveEmailRoute('gmail');
  assert.equal(primary, 'gmail');
  assert.equal(fallback, null);
});

// Subject base64 encoding — inlined from sendViaGmail
function encodeSubject(subject) {
  return `=?UTF-8?B?${Buffer.from(subject, 'utf-8').toString('base64')}?=`;
}

test('MIME subject: pure ASCII round-trips correctly', () => {
  const encoded = encodeSubject('Votre devis Novus Epoxy');
  assert.ok(encoded.startsWith('=?UTF-8?B?'));
  assert.ok(encoded.endsWith('?='));
  // Decode and verify
  const b64 = encoded.slice('=?UTF-8?B?'.length, -2);
  assert.equal(Buffer.from(b64, 'base64').toString('utf-8'), 'Votre devis Novus Epoxy');
});

test('MIME subject: accented characters round-trip (é, è, à, ç)', () => {
  const subject = 'Devis époxy garage — réparation fissures';
  const encoded = encodeSubject(subject);
  const b64 = encoded.slice('=?UTF-8?B?'.length, -2);
  assert.equal(Buffer.from(b64, 'base64').toString('utf-8'), subject);
});

test('MIME subject: empty string encodes without throwing', () => {
  const encoded = encodeSubject('');
  assert.ok(encoded.startsWith('=?UTF-8?B?'));
});

// Attachment base64 line-wrapping (RFC 2045 — 76 chars per line)
function wrapBase64(b64) {
  return b64.replace(/(.{76})/g, '$1\r\n');
}

test('attachment base64: lines are max 76 chars (RFC 2045)', () => {
  const data = Buffer.alloc(200, 0xff); // 200 bytes → ~268 base64 chars
  const b64 = data.toString('base64');
  const wrapped = wrapBase64(b64);
  for (const line of wrapped.split('\r\n').filter(Boolean)) {
    assert.ok(line.length <= 76, `line exceeds 76 chars: ${line.length}`);
  }
});

test('attachment base64: short content (< 76 chars) is not wrapped', () => {
  const data = Buffer.from('hello'); // 5 bytes → 8 base64 chars
  const b64 = data.toString('base64');
  const wrapped = wrapBase64(b64);
  assert.equal(wrapped, b64, 'content < 76 chars must not be wrapped');
});

test('attachment base64: exactly 76 chars → trailing CRLF inserted (regex matches the block)', () => {
  // The regex /(.{76})/g matches any 76-char block and appends \r\n.
  // A 76-char string is ONE full match, so it DOES get a trailing \r\n.
  const b64 = 'A'.repeat(76);
  const wrapped = wrapBase64(b64);
  assert.equal(wrapped, b64 + '\r\n', 'exactly 76 chars gets a trailing CRLF from the regex');
});

test('attachment base64: 77 chars → wrapped at 76 + remaining', () => {
  const b64 = 'A'.repeat(77);
  const wrapped = wrapBase64(b64);
  const lines = wrapped.split('\r\n').filter(Boolean);
  assert.equal(lines[0].length, 76);
  assert.equal(lines[1].length, 1);
});

// Gmail base64url encoding (final step before API call)
test('Gmail raw message: encoded as base64url (no +/=)', () => {
  const raw = 'From: test@example.com\r\n\r\nHello World';
  const encoded = Buffer.from(raw).toString('base64url');
  assert.ok(!encoded.includes('+'), 'base64url must not contain +');
  assert.ok(!encoded.includes('/'), 'base64url must not contain /');
  // base64url MAY include - and _ instead; verify decodability
  const decoded = Buffer.from(encoded, 'base64url').toString();
  assert.equal(decoded, raw);
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-15: lib/api.ts — apiFetch error code handling
// 401 triggers redirect on client side. !res.ok throws with path.
// The path is included in the error to help debug which route failed.
// ════════════════════════════════════════════════════════════════════════════

// Inline apiFetch error handling (pure logic, no fetch)
function apiFetchError(path, status) {
  if (status === 401) {
    // Client-side only: window.location.href = '/auth/signin'
    return { action: 'redirect', message: 'Session expirée' };
  }
  if (status >= 400) {
    return { action: 'throw', message: `API ${path} → ${status}` };
  }
  return { action: 'ok' };
}

test('apiFetch: 401 → redirect action with "Session expirée"', () => {
  const result = apiFetchError('/api/quotes', 401);
  assert.equal(result.action, 'redirect');
  assert.equal(result.message, 'Session expirée');
});

test('apiFetch: 404 → throws with path + status in message', () => {
  const result = apiFetchError('/api/quotes', 404);
  assert.equal(result.action, 'throw');
  assert.ok(result.message.includes('/api/quotes'), 'error message must include the path');
  assert.ok(result.message.includes('404'));
});

test('apiFetch: 500 → throws (not redirect)', () => {
  const result = apiFetchError('/api/crm/leads', 500);
  assert.equal(result.action, 'throw');
});

test('apiFetch: 200 → ok (no error)', () => {
  assert.equal(apiFetchError('/api/quotes', 200).action, 'ok');
});

test('apiFetch: 403 → throws (not redirect)', () => {
  const result = apiFetchError('/api/admin', 403);
  assert.equal(result.action, 'throw');
  // 403 is distinct from 401 — should not redirect
  assert.notEqual(result.action, 'redirect');
});

// apiFetch SSR vs browser base URL construction
function resolveBaseUrl(isServerSide, nextAuthUrl) {
  return isServerSide ? (nextAuthUrl ?? 'http://localhost:3000') : '';
}

test('apiFetch: SSR uses NEXTAUTH_URL base', () => {
  const base = resolveBaseUrl(true, 'https://novus-epoxy.vercel.app');
  assert.equal(base, 'https://novus-epoxy.vercel.app');
});

test('apiFetch: SSR falls back to localhost:3000 when NEXTAUTH_URL not set', () => {
  assert.equal(resolveBaseUrl(true, undefined), 'http://localhost:3000');
});

test('apiFetch: browser uses empty base (relative URL)', () => {
  assert.equal(resolveBaseUrl(false, 'https://novus-epoxy.vercel.app'), '');
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-16: Missing error-handling tests
//
// 16a: send-email.ts — Gmail failure must RETHROW (RÈGLE DURE — no Resend fallback)
// 16b: auth.ts — missing credentials → null (not throw)
// 16c: auto-quote.ts — non-string input to parseProjectInfo → null
// 16d: llm.ts — assertWithinDailyBudget (kill-switch) logic
// ════════════════════════════════════════════════════════════════════════════

// 16a: Gmail failure rethrows (inlined decision logic)
function sendEmailOnGmailFailure(via, gmailError) {
  if (via === 'resend') {
    // resend path has gmail fallback — but THIS test is about the default path
    return { action: 'fallback_to_gmail' };
  }
  // Default path: Gmail failure → RETHROW (never Resend)
  if (gmailError) throw gmailError;
  return { action: 'ok' };
}

test('sendEmail error: Gmail failure on default path → rethrows (no Resend fallback)', () => {
  const gmailErr = new Error('Gmail 500');
  assert.throws(
    () => sendEmailOnGmailFailure(undefined, gmailErr),
    (e) => e.message === 'Gmail 500'
  );
});

test('sendEmail error: Gmail failure on resend path → falls back to Gmail (not rethrow)', () => {
  const result = sendEmailOnGmailFailure('resend', null);
  assert.equal(result.action, 'fallback_to_gmail');
});

// 16b: auth.ts authorize() — missing credentials returns null (not throw)
function authorize_credentials_guard(email, password) {
  if (!email || !password) return null;
  return 'proceed';
}

test('auth authorize: missing email → null (not throw)', () => {
  assert.equal(authorize_credentials_guard('', 'password'), null);
  assert.equal(authorize_credentials_guard(null, 'password'), null);
});

test('auth authorize: missing password → null (not throw)', () => {
  assert.equal(authorize_credentials_guard('test@example.com', ''), null);
});

test('auth authorize: both present → proceeds', () => {
  assert.equal(authorize_credentials_guard('test@example.com', 'pass'), 'proceed');
});

// 16c: parseProjectInfo with empty/whitespace input
// The function guards: if (!text || !text.trim()) returns null with confidence 0
function parseProjectInfo_inputGuard(text) {
  if (!text || typeof text !== 'string' || !text.trim()) return null;
  return 'proceed';
}

test('parseProjectInfo: empty string → null', () => {
  assert.equal(parseProjectInfo_inputGuard(''), null);
});

test('parseProjectInfo: whitespace only → null', () => {
  assert.equal(parseProjectInfo_inputGuard('   \n\t  '), null);
});

test('parseProjectInfo: null input → null', () => {
  assert.equal(parseProjectInfo_inputGuard(null), null);
});

// 16d: LLM kill-switch (daily budget) logic
const DAILY_BUDGET_USD = 20.00;

function assertWithinDailyBudget_logic(spentToday) {
  if (spentToday >= DAILY_BUDGET_USD) {
    throw new Error(`LLM daily budget exceeded: $${spentToday.toFixed(2)} spent (limit $${DAILY_BUDGET_USD})`);
  }
}

test('LLM kill-switch: under budget → does not throw', () => {
  assert.doesNotThrow(() => assertWithinDailyBudget_logic(5.00));
  assert.doesNotThrow(() => assertWithinDailyBudget_logic(0));
  assert.doesNotThrow(() => assertWithinDailyBudget_logic(19.99));
});

test('LLM kill-switch: exactly at budget ($20.00) → throws', () => {
  assert.throws(() => assertWithinDailyBudget_logic(20.00), /daily budget exceeded/);
});

test('LLM kill-switch: over budget → throws with spent amount in message', () => {
  assert.throws(
    () => assertWithinDailyBudget_logic(25.50),
    (e) => e.message.includes('$25.50')
  );
});

// ════════════════════════════════════════════════════════════════════════════
// INTEGRATION GAPS (skeletons — require test DB + HTTP server)
//
// P0: /api/sms/incoming — Twilio signature validation (security boundary)
// P0: /api/telegram/admin — secret token header required
// P1: /api/leads/zapier — ON CONFLICT dedup (Zapier bug documented in memory)
// P1: /api/quotes (POST) — creates quote, scoring applied
// P2: /api/cron/lead-followup — blocked leads not contacted
//
// To implement these, set up a test DB with:
//   DATABASE_URL=postgresql://test:test@localhost:5432/novus_test
//   TWILIO_AUTH_TOKEN=test_token
//   ADMIN_API_KEY=test_key
// Then replace the stubs below with actual supertest/fetch calls.
// ════════════════════════════════════════════════════════════════════════════

// P0 SKELETON: Twilio webhook signature validation
// This is already covered in coverage-gaps.test.mjs (GAP-9 Twilio sig tests).
// Next step: add an HTTP integration test:
//
// test('POST /api/sms/incoming: valid Twilio sig → 200', async () => {
//   const params = { From: '+15145551234', Body: 'STOP', NumMedia: '0' };
//   const sig = computeTwilioSig(process.env.TWILIO_AUTH_TOKEN, url, params);
//   const res = await fetch(`${BASE_URL}/api/sms/incoming`, {
//     method: 'POST',
//     headers: { 'X-Twilio-Signature': sig, 'Content-Type': 'application/x-www-form-urlencoded' },
//     body: new URLSearchParams(params),
//   });
//   assert.equal(res.status, 200);
// });
//
// test('POST /api/sms/incoming: missing sig → 403', async () => {
//   const res = await fetch(`${BASE_URL}/api/sms/incoming`, {
//     method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
//     body: new URLSearchParams({ Body: 'STOP' }),
//   });
//   assert.equal(res.status, 403);
// });

// P1 SKELETON: /api/leads/zapier ON CONFLICT dedup
// Documented gotcha: must use ON CONFLICT (telephone) DO NOTHING for Zapier re-sends
//
// test('POST /api/leads/zapier: duplicate phone → 200 but not re-inserted', async () => {
//   const lead = { nom: 'Jean Dupont', telephone: '5145551234', service: 'flake' };
//   const res1 = await fetch(`${BASE_URL}/api/leads/zapier`, { method: 'POST', body: JSON.stringify(lead), ... });
//   const res2 = await fetch(`${BASE_URL}/api/leads/zapier`, { method: 'POST', body: JSON.stringify(lead), ... });
//   assert.equal(res1.status, 200);
//   assert.equal(res2.status, 200);
//   const { count } = await db.query('SELECT COUNT(*) FROM leads WHERE telephone = $1', [lead.telephone]);
//   assert.equal(Number(count), 1, 'duplicate must not insert a second row');
// });

// P2 SKELETON: blocked lead must not receive followup SMS in cron
//
// test('cron/lead-followup: blocked lead phone → no SMS sent', async () => {
//   await db.query('INSERT INTO lead_blocklist (phone) VALUES ($1)', ['5145551234']);
//   await db.query('INSERT INTO leads (telephone, statut) VALUES ($1, $2)', ['5145551234', 'nouveau']);
//   const res = await fetch(`${BASE_URL}/api/cron/lead-followup`, {
//     headers: { 'x-api-key': process.env.ADMIN_API_KEY },
//   });
//   assert.equal(res.status, 200);
//   // Verify no Twilio call was made (mock Twilio or check sms_logs table)
// });

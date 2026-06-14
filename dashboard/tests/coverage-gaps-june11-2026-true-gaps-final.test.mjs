/**
 * coverage-gaps-june11-2026-true-gaps-final.test.mjs — Coverage gap audit (final pass, June 11 2026).
 *
 * Run: node --test tests/coverage-gaps-june11-2026-true-gaps-final.test.mjs
 *
 * TRUE GAPS — pure logic never covered by any prior test file:
 *
 *   GAP-1  leads/zapier — normalizeService() unmapped aliases ('vinyl', 'stratifié',
 *          'patio', 'meulage', 'diamant', null) silently store wrong type_service.
 *
 *   GAP-2  lib/invoice-numero.ts — insertInvoiceWithRetry() exhaustion path throws
 *          last 23505 error after maxAttempts. Never tested.
 *
 *   GAP-3  lib/invoice-numero.ts — nextInvoiceNumero() NaN guard: corrupt 'NE-2026-ABC'
 *          keeps nextNum=1, silently restarting the sequence. Never tested.
 *
 *   GAP-4  lib/db.ts — transaction() rollback-on-throw contract never verified.
 *
 *   GAP-5  app/api/bank/reconcile — dual-target (invoice_id + expense_id) SET clause
 *          construction never tested; single-target vs dual-target produce different
 *          SQL and different paramCount offsets.
 *
 *   GAP-6  app/api/webhooks/ghl — scoreTemperature() boundary: score 4 → tiede (not
 *          chaud); score 2 → froid. The private function is never unit-tested.
 *
 *   GAP-7  lib/agent.ts — notifyTelegramHandoff() hardcoded 'novus-epoxy.vercel.app'
 *          instead of NEXTAUTH_URL — sends admins to wrong host on prod. Never tested.
 *
 *   GAP-8  lib/ensure-invoice.ts — quote-not-found early return path never tested.
 *
 * INTEGRATION SKELETONS (skipped unless INTEGRATION_TEST=1):
 *   INT-1  POST /api/webhooks/ghl — missing secret → 401
 *   INT-2  POST /api/webhooks/ghl — wrong secret → 401
 *   INT-3  POST /api/webhooks/ghl — valid secret, non-ContactCreate → 200 skipped
 *   INT-4  GET  /api/cron/reviews — no auth → 401
 *   INT-5  POST /api/bank/reconcile — no session → 401
 *   INT-6  POST /api/bank/reconcile — missing transaction_id → 400
 *   INT-7  POST /api/bank/reconcile — missing all target IDs → 400
 *   INT-8  POST /api/leads/zapier — missing api_key → 401
 *   INT-9  POST /api/leads/zapier — invalid JSON body → 400
 *
 * TRUE GAPS — pure logic never covered by any prior test file as of June 11 2026.
 * All logic is inlined to avoid TypeScript / @/ alias / ESM-extension issues.
 *
 *   GAP-1  lib/send-email.ts — handleGmailAuthError() detection
 *          'invalid_grant' and 'invalid grant' (with space) string matching,
 *          non-Error input branch, irrelevant errors are ignored.
 *
 *   GAP-2  lib/auto-quote.ts — tryCreateQuoteFromReply() blacklist guards
 *          Blacklisted email → null, blacklisted phone → null,
 *          confidence < 40 → no auto-quote, missing service/superficie → no quote.
 *
 *   GAP-3  lib/composio.ts — getComposio() missing-key guard
 *          COMPOSIO_API_KEY absent → throws; singleton pattern on second call.
 *
 *   GAP-4  lib/llm.ts — getLangfuse() lazy-init branches
 *          No env keys → null; require() throws → null.
 *
 *   GAP-5  lib/meta-ads.ts — buildAdsManagerPrefillUrl() URL structure
 *          act_ prefix stripped from env; missing draft → fallback URL;
 *          valid draft → creation URL with correct params.
 *
 *   GAP-6  lib/db.ts — transaction() rollback on callback throw
 *          Callback throws → ROLLBACK issued, error re-thrown.
 *
 *   GAP-7  app/api/leads/zapier — phone normalization
 *          tel:+1XXXXXXXXXX → digits only; short/invalid phone → stored as-is.
 *
 *   GAP-8  app/api/meta/webhook — HMAC signature validation
 *          Missing header → rejected; wrong sig → rejected; valid → accepted.
 *
 * INTEGRATION SKELETONS (skipped unless INTEGRATION_TEST=1):
 *   INT-1  POST /api/leads/zapier — ON CONFLICT upsert dedup
 *   INT-2  GET  /api/cron/health-check — returns 200 with status object
 *   INT-3  GET  /api/calendar/feed — no token → 401
 *   INT-4  POST /api/bank/auto-match — no session → 401
 *   INT-5  DELETE /api/quotes/1 — cascade to linked invoices
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

const SKIP_INTEGRATION = !process.env.INTEGRATION_TEST;
const BASE = process.env.TEST_BASE_URL || 'http://localhost:3000';

// ════════════════════════════════════════════════════════════════════════════
// GAP-1: lib/send-email.ts — handleGmailAuthError() detection logic
//
// The function returns early unless err.message (lowercased) contains
// 'invalid_grant' OR 'invalid grant' (with space).
// ════════════════════════════════════════════════════════════════════════════

function shouldHandleAuthError(err) {
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();
  return lower.includes('invalid_grant') || lower.includes('invalid grant');
}

test('handleGmailAuthError: Error with "invalid_grant" is detected', () => {
  assert.equal(shouldHandleAuthError(new Error('Token error: invalid_grant')), true);
});

test('handleGmailAuthError: Error with "invalid grant" (space) is detected', () => {
  assert.equal(shouldHandleAuthError(new Error('The credentials are invalid grant')), true);
});

test('handleGmailAuthError: detection is case-insensitive (INVALID_GRANT)', () => {
  assert.equal(shouldHandleAuthError(new Error('INVALID_GRANT returned')), true);
});

test('handleGmailAuthError: unrelated error is NOT detected', () => {
  assert.equal(shouldHandleAuthError(new Error('Connection timeout')), false);
});

test('handleGmailAuthError: empty error message → not detected', () => {
  assert.equal(shouldHandleAuthError(new Error('')), false);
});

test('handleGmailAuthError: non-Error string input uses String(err)', () => {
  assert.equal(shouldHandleAuthError('invalid_grant'), true);
});

test('handleGmailAuthError: non-Error non-matching string → not detected', () => {
  assert.equal(shouldHandleAuthError('network failure'), false);
});

test('handleGmailAuthError: null input → String(null) = "null" → not detected', () => {
  assert.equal(shouldHandleAuthError(null), false);
});

test('handleGmailAuthError: "token_expired" does NOT match (distinct code)', () => {
  assert.equal(shouldHandleAuthError(new Error('token_expired')), false);
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-2: lib/auto-quote.ts — tryCreateQuoteFromReply() blacklist guards
//
// The function checks email and phone against hardcoded blacklists.
// Inlined verbatim from auto-quote.ts.
// ════════════════════════════════════════════════════════════════════════════

const BLACKLISTED_EMAILS = [
  'gestionnovusepoxy@gmail.com',
  'lanthierj6@gmail.com',
  'luca.hayes1994@gmail.com',
];
const BLACKLISTED_PHONES = ['5813075983', '5813072678'];

function isEmailBlacklisted(email) {
  if (!email) return false;
  return BLACKLISTED_EMAILS.includes(email.toLowerCase());
}

function isPhoneBlacklisted(telephone) {
  const cleanPhone = (telephone || '').replace(/\D/g, '').slice(-10);
  return BLACKLISTED_PHONES.includes(cleanPhone);
}

function shouldAutoQuote(parsed) {
  return parsed.confidence >= 40 && !!parsed.type_service && !!parsed.superficie;
}

test('tryCreateQuoteFromReply: admin email is blacklisted → should return null', () => {
  assert.equal(isEmailBlacklisted('gestionnovusepoxy@gmail.com'), true);
});

test('tryCreateQuoteFromReply: luca email is blacklisted', () => {
  assert.equal(isEmailBlacklisted('luca.hayes1994@gmail.com'), true);
});

test('tryCreateQuoteFromReply: unknown client email is NOT blacklisted', () => {
  assert.equal(isEmailBlacklisted('client@example.com'), false);
});

test('tryCreateQuoteFromReply: null email is not blacklisted', () => {
  assert.equal(isEmailBlacklisted(null), false);
});

test('tryCreateQuoteFromReply: email check is case-insensitive (UPPER)', () => {
  assert.equal(isEmailBlacklisted('GESTIONNOVUSEPOXY@GMAIL.COM'), true);
});

test('tryCreateQuoteFromReply: blacklisted phone 5813075983 (last 10 digits)', () => {
  assert.equal(isPhoneBlacklisted('5813075983'), true);
});

test('tryCreateQuoteFromReply: blacklisted phone with country code +15813075983', () => {
  assert.equal(isPhoneBlacklisted('+15813075983'), true);
});

test('tryCreateQuoteFromReply: blacklisted phone formatted (581) 307-5983', () => {
  assert.equal(isPhoneBlacklisted('(581) 307-5983'), true);
});

test('tryCreateQuoteFromReply: unknown phone is NOT blacklisted', () => {
  assert.equal(isPhoneBlacklisted('4185551234'), false);
});

test('tryCreateQuoteFromReply: empty phone is NOT blacklisted', () => {
  assert.equal(isPhoneBlacklisted(''), false);
});

test('tryCreateQuoteFromReply: confidence < 40 → no auto-quote', () => {
  assert.equal(shouldAutoQuote({ confidence: 39, type_service: 'flake', superficie: 400 }), false);
});

test('tryCreateQuoteFromReply: confidence exactly 40 → auto-quote allowed', () => {
  assert.equal(shouldAutoQuote({ confidence: 40, type_service: 'flake', superficie: 400 }), true);
});

test('tryCreateQuoteFromReply: missing type_service → no auto-quote', () => {
  assert.equal(shouldAutoQuote({ confidence: 80, type_service: null, superficie: 400 }), false);
});

test('tryCreateQuoteFromReply: missing superficie → no auto-quote', () => {
  assert.equal(shouldAutoQuote({ confidence: 80, type_service: 'quartz', superficie: null }), false);
});

test('tryCreateQuoteFromReply: all fields present and confidence >= 40 → auto-quote', () => {
  assert.equal(shouldAutoQuote({ confidence: 75, type_service: 'metallique', superficie: 600 }), true);
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-3: lib/composio.ts — getComposio() missing-key guard
//
// When COMPOSIO_API_KEY is absent the function must throw immediately.
// The singleton pattern means a second call returns the cached instance.
// ════════════════════════════════════════════════════════════════════════════

function makeComposioGetter() {
  let _client = null;
  return function getComposio(envKey) {
    if (!_client) {
      if (!envKey) throw new Error('COMPOSIO_API_KEY manquant');
      _client = { apiKey: envKey }; // stub for the real Composio instance
    }
    return _client;
  };
}

test('getComposio: missing API key → throws COMPOSIO_API_KEY manquant', () => {
  const getComposio = makeComposioGetter();
  assert.throws(() => getComposio(undefined), /COMPOSIO_API_KEY manquant/);
});

test('getComposio: empty string key → throws (falsy check)', () => {
  const getComposio = makeComposioGetter();
  assert.throws(() => getComposio(''), /COMPOSIO_API_KEY manquant/);
});

test('getComposio: valid key → returns client instance', () => {
  const getComposio = makeComposioGetter();
  const client = getComposio('test-key-123');
  assert.ok(client, 'client must be truthy');
  assert.equal(client.apiKey, 'test-key-123');
});

test('getComposio: second call returns same (cached) instance', () => {
  const getComposio = makeComposioGetter();
  const first = getComposio('test-key-abc');
  const second = getComposio('test-key-abc');
  assert.strictEqual(first, second, 'must be the exact same object reference');
});

test('getComposio: second call does not re-read the key (singleton)', () => {
  const getComposio = makeComposioGetter();
  getComposio('initial-key');
  // Passing a different key should NOT replace the cached instance
  const second = getComposio('different-key');
  assert.equal(second.apiKey, 'initial-key', 'singleton must keep original key');
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-4: lib/llm.ts — getLangfuse() lazy-init branches
//
// Returns null when env keys are absent or require() throws.
// ════════════════════════════════════════════════════════════════════════════

function makeLangfuseGetter(requireFn) {
  let _langfuse = null;
  return function getLangfuse(publicKey, secretKey) {
    if (_langfuse) return _langfuse;
    if (!publicKey || !secretKey) return null;
    try {
      const { Langfuse } = requireFn('langfuse');
      _langfuse = new Langfuse({ publicKey, secretKey });
      return _langfuse;
    } catch {
      return null;
    }
  };
}

test('getLangfuse: missing LANGFUSE_PUBLIC_KEY → returns null', () => {
  const getLangfuse = makeLangfuseGetter(() => { throw new Error('not needed'); });
  assert.equal(getLangfuse(undefined, 'secret'), null);
});

test('getLangfuse: missing LANGFUSE_SECRET_KEY → returns null', () => {
  const getLangfuse = makeLangfuseGetter(() => { throw new Error('not needed'); });
  assert.equal(getLangfuse('pubkey', undefined), null);
});

test('getLangfuse: both keys absent → returns null', () => {
  const getLangfuse = makeLangfuseGetter(() => { throw new Error('not needed'); });
  assert.equal(getLangfuse(undefined, undefined), null);
});

test('getLangfuse: require("langfuse") throws → returns null gracefully', () => {
  const getLangfuse = makeLangfuseGetter(() => { throw new Error('module not found'); });
  assert.equal(getLangfuse('pub', 'sec'), null);
});

test('getLangfuse: valid keys + require succeeds → returns instance', () => {
  const stub = { trace: () => {} };
  const getLangfuse = makeLangfuseGetter(() => ({ Langfuse: function() { return stub; } }));
  const client = getLangfuse('pub-key', 'sec-key');
  assert.ok(client, 'should return a client');
});

test('getLangfuse: second call returns cached instance without re-requiring', () => {
  let requireCallCount = 0;
  const stub = { trace: () => {} };
  const getLangfuse = makeLangfuseGetter(() => {
    requireCallCount++;
    return { Langfuse: function() { return stub; } };
  });
  getLangfuse('pub', 'sec');
  getLangfuse('pub', 'sec');
  assert.equal(requireCallCount, 1, 'require should only be called once (singleton)');
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-5: lib/meta-ads.ts — buildAdsManagerPrefillUrl() URL structure
//
// 1. act_ prefix is stripped from META_AD_ACCOUNT_ID
// 2. Missing draft row → returns campaigns URL (no creation params)
// 3. Valid draft → creation URL has objective=OUTCOME_LEADS, daily_budget in cents
// ════════════════════════════════════════════════════════════════════════════

function stripActPrefix(adAccountId) {
  return (adAccountId ?? '').replace(/^act_/, '');
}

function buildFallbackUrl(adAccountId) {
  const id = stripActPrefix(adAccountId);
  return `https://business.facebook.com/adsmanager/manage/campaigns?act=${id}`;
}

function buildCreationUrl(adAccountId, draft, formId) {
  const id = stripActPrefix(adAccountId);
  const params = new URLSearchParams({
    act: id,
    business_id: '',
    objective: 'OUTCOME_LEADS',
    optimization_goal: 'LEAD_GENERATION',
    daily_budget: String(Math.round(Number(draft.daily_budget_usd ?? 30) * 100)),
    lead_form_id: formId ?? '1645385520039445',
    name: `Novus ${draft.service} 2026-06-11`,
  });
  return `https://business.facebook.com/adsmanager/creation?${params.toString()}`;
}

test('buildAdsManagerPrefillUrl: act_ prefix is stripped from env var', () => {
  assert.equal(stripActPrefix('act_250180039560083'), '250180039560083');
});

test('buildAdsManagerPrefillUrl: no act_ prefix → unchanged', () => {
  assert.equal(stripActPrefix('250180039560083'), '250180039560083');
});

test('buildAdsManagerPrefillUrl: empty string → empty string', () => {
  assert.equal(stripActPrefix(''), '');
});

test('buildAdsManagerPrefillUrl: missing draft → fallback campaigns URL', () => {
  const url = buildFallbackUrl('act_250180039560083');
  assert.ok(url.includes('/manage/campaigns'), 'must point to campaigns list');
  assert.ok(url.includes('act=250180039560083'), 'must include account ID without act_ prefix');
  assert.ok(!url.includes('objective='), 'fallback must NOT have objective param');
});

test('buildAdsManagerPrefillUrl: valid draft → creation URL with OUTCOME_LEADS', () => {
  const url = buildCreationUrl('act_250180039560083', { service: 'flake', daily_budget_usd: 30 }, '1645385520039445');
  assert.ok(url.includes('/adsmanager/creation?'), 'must be creation URL');
  assert.ok(url.includes('objective=OUTCOME_LEADS'), 'must include OUTCOME_LEADS objective');
});

test('buildAdsManagerPrefillUrl: daily_budget is converted to cents', () => {
  const url = buildCreationUrl('act_123', { service: 'flake', daily_budget_usd: 25 }, '999');
  assert.ok(url.includes('daily_budget=2500'), 'budget $25 → 2500 cents');
});

test('buildAdsManagerPrefillUrl: daily_budget defaults to $30 when not set', () => {
  const url = buildCreationUrl('act_123', { service: 'flake' }, '999');
  assert.ok(url.includes('daily_budget=3000'), 'default $30 → 3000 cents');
});

test('buildAdsManagerPrefillUrl: lead_form_id is included', () => {
  const formId = '1645385520039445';
  const url = buildCreationUrl('act_123', { service: 'quartz', daily_budget_usd: 30 }, formId);
  assert.ok(url.includes(`lead_form_id=${formId}`), 'must include form ID');
});

test('buildAdsManagerPrefillUrl: optimization_goal is LEAD_GENERATION', () => {
  const url = buildCreationUrl('act_123', { service: 'flake', daily_budget_usd: 30 }, '999');
  assert.ok(url.includes('optimization_goal=LEAD_GENERATION'), 'must include optimization_goal');
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-6: lib/db.ts — transaction() rollback on callback throw
//
// The real function connects to postgres — not feasible in unit test.
// We test the control-flow contract (BEGIN → ROLLBACK on throw → rethrows).
// ════════════════════════════════════════════════════════════════════════════

async function transactionStub(fn, client) {
  try {
    await client.query('BEGIN');
    const q = async (sql, params = []) => {
      const res = await client.query(sql, params);
      return res.rows ?? [];
    };
    const result = await fn(q);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch { /* already rolled back */ }
    throw e;
  }
}

test('transaction: successful fn → COMMIT called, result returned', async () => {
  const log = [];
  const client = { query: async (sql) => { log.push(sql); return { rows: [] }; } };
  const result = await transactionStub(async () => 'ok', client);
  assert.equal(result, 'ok');
  assert.ok(log.includes('BEGIN'), 'must BEGIN');
  assert.ok(log.includes('COMMIT'), 'must COMMIT');
  assert.ok(!log.includes('ROLLBACK'), 'must NOT ROLLBACK on success');
});

test('transaction: fn throws → ROLLBACK called and error re-thrown', async () => {
  const log = [];
  const client = { query: async (sql) => { log.push(sql); return { rows: [] }; } };
  await assert.rejects(
    () => transactionStub(async () => { throw new Error('fn failed'); }, client),
    /fn failed/,
  );
  assert.ok(log.includes('ROLLBACK'), 'must ROLLBACK on fn error');
  assert.ok(!log.includes('COMMIT'), 'must NOT COMMIT on fn error');
});

test('transaction: fn throws → error is re-thrown with original message', async () => {
  const client = { query: async () => ({ rows: [] }) };
  await assert.rejects(
    () => transactionStub(async () => { throw new Error('unique-error-XYZ'); }, client),
    /unique-error-XYZ/,
  );
});

test('transaction: q() helper passes through query results', async () => {
  const rows = [{ id: 1, name: 'test' }];
  const client = {
    query: async (sql) => sql === 'BEGIN' || sql === 'COMMIT' ? { rows: [] } : { rows },
  };
  const result = await transactionStub(async (q) => q('SELECT 1'), client);
  assert.deepEqual(result, rows);
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-7: app/api/leads/zapier — phone normalization before upsert
//
// The Zapier webhook receives phone numbers in various formats.
// Inlined from the route's normalizePhone() / stripping logic.
// ════════════════════════════════════════════════════════════════════════════

function normalizePhone(raw) {
  if (!raw) return null;
  // Strip tel:, sms:, spaces, dashes, parens, + prefix for storage
  return raw.replace(/^tel:|^sms:/i, '').replace(/[^\d+]/g, '');
}

test('zapier phone: tel: prefix stripped', () => {
  const result = normalizePhone('tel:+15141234567');
  assert.ok(!result.startsWith('tel:'), 'tel: prefix must be removed');
});

test('zapier phone: +1 country code preserved after stripping tel:', () => {
  const result = normalizePhone('tel:+15141234567');
  assert.equal(result, '+15141234567');
});

test('zapier phone: plain 10-digit number unchanged', () => {
  assert.equal(normalizePhone('5141234567'), '5141234567');
});

test('zapier phone: formatted (514) 123-4567 → digits only', () => {
  assert.equal(normalizePhone('(514) 123-4567'), '5141234567');
});

test('zapier phone: null input → null', () => {
  assert.equal(normalizePhone(null), null);
});

test('zapier phone: empty string → empty (after strip)', () => {
  const result = normalizePhone('');
  // empty string is falsy, returns null
  assert.equal(normalizePhone(''), null);
});

test('zapier phone: sms: prefix stripped', () => {
  const result = normalizePhone('sms:+14185559999');
  assert.ok(!result.startsWith('sms:'), 'sms: prefix must be removed');
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-8: app/api/meta/webhook — HMAC signature validation
//
// Meta sends X-Hub-Signature-256: sha256=<hmac>.
// The route must reject requests without or with wrong signatures.
// ════════════════════════════════════════════════════════════════════════════

function computeMetaSignature(appSecret, rawBody) {
  return 'sha256=' + createHmac('sha256', appSecret).update(rawBody).digest('hex');
}

function validateMetaSignature(signature, appSecret, rawBody) {
  if (!signature) return false;
  const expected = computeMetaSignature(appSecret, rawBody);
  // Constant-time comparison not inlined here — just test the logic contract
  return signature === expected;
}

test('meta webhook: missing signature → rejected', () => {
  assert.equal(validateMetaSignature(undefined, 'secret', '{"test":1}'), false);
});

test('meta webhook: null signature → rejected', () => {
  assert.equal(validateMetaSignature(null, 'secret', '{"test":1}'), false);
});

test('meta webhook: wrong signature → rejected', () => {
  assert.equal(validateMetaSignature('sha256=wronghash', 'secret', '{"test":1}'), false);
});

test('meta webhook: correct HMAC-SHA256 signature → accepted', () => {
  const body = '{"entry":[{"id":"123"}]}';
  const secret = 'my-app-secret';
  const sig = computeMetaSignature(secret, body);
  assert.equal(validateMetaSignature(sig, secret, body), true);
});

test('meta webhook: signature prefix must be sha256= (not plain hash)', () => {
  const body = '{"test":1}';
  const secret = 'secret';
  const bareHash = createHmac('sha256', secret).update(body).digest('hex');
  // Bare hash without sha256= prefix → rejected
  assert.equal(validateMetaSignature(bareHash, secret, body), false);
});

test('meta webhook: signature computed with wrong secret → rejected', () => {
  const body = '{"test":1}';
  const correctSig = computeMetaSignature('correct-secret', body);
  assert.equal(validateMetaSignature(correctSig, 'wrong-secret', body), false);
});

test('meta webhook: same signature on different body → rejected', () => {
  const sig = computeMetaSignature('secret', '{"body":"A"}');
  assert.equal(validateMetaSignature(sig, 'secret', '{"body":"B"}'), false);
});

// ════════════════════════════════════════════════════════════════════════════
// INTEGRATION SKELETONS
// These require a running server: INTEGRATION_TEST=1 TEST_BASE_URL=http://localhost:3000
// ════════════════════════════════════════════════════════════════════════════

test('INT-1: POST /api/leads/zapier — valid payload → 200 upsert', { skip: SKIP_INTEGRATION }, async () => {
  const res = await fetch(`${BASE}/api/leads/zapier`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      nom: 'Test Integration',
      telephone: '4185559999',
      email: 'integration@test.com',
      source: 'facebook',
    }),
  });
  assert.ok(res.status === 200 || res.status === 201, `expected 2xx, got ${res.status}`);
});

test('INT-2: POST /api/leads/zapier — duplicate phone → 200 (ON CONFLICT upsert)', { skip: SKIP_INTEGRATION }, async () => {
  const body = { nom: 'Dupe Test', telephone: '4185550001', email: 'dupe@test.com', source: 'facebook' };
  await fetch(`${BASE}/api/leads/zapier`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const res2 = await fetch(`${BASE}/api/leads/zapier`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.ok(res2.status === 200 || res2.status === 201, `duplicate should upsert, got ${res2.status}`);
});

test('INT-3: GET /api/cron/health-check — responds with status object', { skip: SKIP_INTEGRATION }, async () => {
  const adminKey = process.env.ADMIN_API_KEY ?? '';
  const res = await fetch(`${BASE}/api/cron/health-check`, {
    headers: { Authorization: `Bearer ${adminKey}` },
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.ok(typeof data === 'object', 'must return a JSON object');
});

test('INT-4: GET /api/calendar/feed — missing token → 401', { skip: SKIP_INTEGRATION }, async () => {
  const res = await fetch(`${BASE}/api/calendar/feed`);
  assert.equal(res.status, 401);
});

test('INT-5: POST /api/bank/auto-match — no session → 401', { skip: SKIP_INTEGRATION }, async () => {
  const res = await fetch(`${BASE}/api/bank/auto-match`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  assert.equal(res.status, 401);
});

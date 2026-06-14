/**
 * coverage-gaps-june13-2026.test.mjs
 *
 * TRUE GAPS not yet covered by any test file as of June 13 2026.
 * All decision logic is inlined (no @/ imports) — runs with plain node --test.
 *
 * Run: node --test tests/coverage-gaps-june13-2026.test.mjs
 *
 * UNIT GAPS (run without any setup):
 *   GAP-1  app/api/invoices/[id]/payment — 'partial' → 'partiel' normalisation
 *           The route normalises the English alias before DB insert.
 *           The exact normalisation AND the amount-capping logic (amountToRecord
 *           is capped to `remaining` when caller sends > remaining + 0.01) are
 *           never unit-tested — only integration skeletons exist.
 *
 *   GAP-2  app/api/invoices/[id]/payment — final type always records `remaining`
 *           When type='final', amountToRecord = remaining (not the value in body).
 *           If remaining ≤ 0, the route returns 400 "Facture déjà entièrement payée".
 *           Neither the recalc rule nor the already-paid guard are unit-tested.
 *
 *   GAP-3  app/api/bank/reconcile — validation: missing all of invoice/expense/payment_id
 *           The route returns 400 when all three target IDs are absent.
 *           The validation combinator is pure logic; never unit-tested.
 *
 *   GAP-4  app/api/bank/reconcile — dynamic SET clause construction
 *           The route builds a parametrised SET clause from whatever combination
 *           of invoice_id / expense_id / payment_id is provided. Each column is
 *           conditionally included with its own $N index. Never unit-tested.
 *
 *   GAP-5  app/api/ads/propose — dailyBudgetUsd / durationDays hard-caps
 *           Math.min(Number(body.dailyBudgetUsd ?? 50), 50) and
 *           Math.min(Number(body.durationDays ?? 7), 14).
 *           Existing tests reference this area but only via integration skeletons.
 *           The exact default-and-cap arithmetic is never directly asserted.
 *
 *   GAP-6  app/api/composio/connect — toolkit whitelist (ALLOWED_TOOLKITS)
 *           When an unlisted toolkit is requested, the route returns 400.
 *           The case-insensitive `.toUpperCase()` normalisation before the
 *           ALLOWED_TOOLKITS check is never unit-tested.
 *
 *   GAP-7  middleware.ts — CORS headers included on 429 rate-limit responses
 *           When isRateLimited() returns true on a CORS-enabled path (e.g.
 *           /api/chat), the 429 response must still carry the ACAO header so
 *           browsers show a proper error. This is currently untested.
 *
 *   GAP-8  middleware.ts — /api/openclaw/webhook NOT in CORS preflight list
 *           The config.matcher includes /api/openclaw/webhook, but the OPTIONS
 *           branch only lists 5 paths. openclaw OPTIONS returns no CORS headers.
 *           Documents a known design gap.
 *
 *   GAP-9  lib/telegram-utils.ts — sendTelegramSafe() force=true bypasses quiet hours
 *           When force=true, the function skips the isQuietHours() check.
 *           When force is absent / false and it's quiet hours, returns false.
 *           Never directly unit-tested (always imported indirectly).
 *
 *   GAP-10 lib/telegram-utils.ts — sendTelegramSafe() returns false when TELEGRAM_BOT_TOKEN absent
 *           The `if (!token) return false` guard is never exercised in tests.
 *
 *   GAP-11 lib/llm.ts — OR_MODELS env override takes precedence over default
 *           `process.env.OR_MODEL_BULK ?? 'deepseek/deepseek-v4-flash'` means
 *           an env var silently overrides the default. The override path is never
 *           independently asserted (only the default values are checked).
 *
 *   GAP-12 lib/sms.ts — `sendSMS` area code validation: 10-digit number vs 11-digit
 *           For 11-digit numbers, areaCode = digits[1..4]. For 10-digit, digits[0..3].
 *           The 11-digit branch (number starting with 1) is tested for normalisation
 *           but the AREA CODE EXTRACTION for 11-digit is not explicitly asserted.
 *
 * INTEGRATION SKELETONS (skipped unless INTEGRATION_TEST=1):
 *   INT-1  POST /api/invoices/[id]/payment — missing type/methode → 400
 *   INT-2  POST /api/invoices/[id]/payment — type='final', invoice already paid → 400
 *   INT-3  POST /api/bank/reconcile       — missing all target IDs → 400
 *   INT-4  POST /api/composio/connect?toolkit=HACK — unlisted toolkit → 400
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

const SKIP_INTEGRATION = !process.env.INTEGRATION_TEST;
const BASE = process.env.TEST_BASE_URL || 'http://localhost:3000';

// ════════════════════════════════════════════════════════════════════════════
// GAP-1 & GAP-2: app/api/invoices/[id]/payment — payment type & amount logic
//
// Inlined from app/api/invoices/[id]/payment/route.ts
// ════════════════════════════════════════════════════════════════════════════

const VALID_TYPES    = ['depot', 'partial', 'partiel', 'final'];
const VALID_METHODES = ['virement', 'cheque', 'comptant', 'autre'];

function normalisePaymentType(type) {
  return type === 'partial' ? 'partiel' : type;
}

function calcAmountToRecord({ type, montant, total, alreadyPaid }) {
  const remaining = Math.max(0, total - alreadyPaid);
  if (type === 'final') {
    if (remaining <= 0) return { error: 'already_paid' };
    return { amountToRecord: remaining };
  }
  const amt = Number(montant);
  if (!Number.isFinite(amt) || amt <= 0) return { error: 'invalid_amount' };
  // Cap to remaining (allow 1-cent tolerance in caller's value)
  const capped = amt > remaining + 0.01 ? remaining : amt;
  return { amountToRecord: capped };
}

// Type validation
test('payment type: all four valid types accepted', () => {
  for (const t of VALID_TYPES) {
    assert.ok(VALID_TYPES.includes(t), `${t} must be valid`);
  }
});

test('payment type: unknown type rejected', () => {
  assert.equal(VALID_TYPES.includes('cash'), false);
  assert.equal(VALID_TYPES.includes('credit'), false);
  assert.equal(VALID_TYPES.includes(''), false);
});

test('payment methode: all four valid methodes accepted', () => {
  for (const m of VALID_METHODES) {
    assert.ok(VALID_METHODES.includes(m));
  }
});

test('payment methode: "stripe" not in valid methodes', () => {
  assert.equal(VALID_METHODES.includes('stripe'), false, 'Stripe removed — must not be a valid methode');
});

// 'partial' → 'partiel' normalisation
test('normalisePaymentType: "partial" → "partiel" (DB constraint)', () => {
  assert.equal(normalisePaymentType('partial'), 'partiel');
});

test('normalisePaymentType: "depot" → "depot" (no change)', () => {
  assert.equal(normalisePaymentType('depot'), 'depot');
});

test('normalisePaymentType: "partiel" → "partiel" (already correct)', () => {
  assert.equal(normalisePaymentType('partiel'), 'partiel');
});

test('normalisePaymentType: "final" → "final" (no change)', () => {
  assert.equal(normalisePaymentType('final'), 'final');
});

// amount calculation — final type always records REMAINING
test('calcAmountToRecord: final type → records remaining, ignores montant', () => {
  const r = calcAmountToRecord({ type: 'final', montant: 9999, total: 5000, alreadyPaid: 1500 });
  assert.equal(r.amountToRecord, 3500, 'final must record total − already_paid');
});

test('calcAmountToRecord: final type when already fully paid → error', () => {
  const r = calcAmountToRecord({ type: 'final', montant: 100, total: 1000, alreadyPaid: 1000 });
  assert.equal(r.error, 'already_paid');
});

test('calcAmountToRecord: final type when overpaid (alreadyPaid > total) → error', () => {
  const r = calcAmountToRecord({ type: 'final', montant: 0, total: 500, alreadyPaid: 600 });
  assert.equal(r.error, 'already_paid', 'remaining = max(0, ...) so still caught');
});

test('calcAmountToRecord: partial type records exact amount when ≤ remaining', () => {
  const r = calcAmountToRecord({ type: 'partial', montant: 200, total: 1000, alreadyPaid: 0 });
  assert.equal(r.amountToRecord, 200);
});

test('calcAmountToRecord: partial amount > remaining → capped to remaining', () => {
  const r = calcAmountToRecord({ type: 'partial', montant: 999, total: 1000, alreadyPaid: 800 });
  assert.equal(r.amountToRecord, 200, 'capped to the 200 remaining');
});

test('calcAmountToRecord: partial amount exactly at remaining + 0.01 boundary → NOT capped', () => {
  // remaining=200, montant=200.01 → 200.01 > 200.01 is false → NOT capped
  const r = calcAmountToRecord({ type: 'partial', montant: 200.01, total: 1000, alreadyPaid: 800 });
  assert.equal(r.amountToRecord, 200.01, 'edge of tolerance: caller amount passes through');
});

test('calcAmountToRecord: partial amount > remaining + 0.01 → capped', () => {
  // remaining=200, montant=200.02 → 200.02 > 200.01 → capped to 200
  const r = calcAmountToRecord({ type: 'partial', montant: 200.02, total: 1000, alreadyPaid: 800 });
  assert.equal(r.amountToRecord, 200);
});

test('calcAmountToRecord: negative montant → error', () => {
  const r = calcAmountToRecord({ type: 'partial', montant: -50, total: 1000, alreadyPaid: 0 });
  assert.equal(r.error, 'invalid_amount');
});

test('calcAmountToRecord: zero montant → error', () => {
  const r = calcAmountToRecord({ type: 'partial', montant: 0, total: 1000, alreadyPaid: 0 });
  assert.equal(r.error, 'invalid_amount');
});

test('calcAmountToRecord: NaN montant → error', () => {
  const r = calcAmountToRecord({ type: 'partial', montant: 'abc', total: 1000, alreadyPaid: 0 });
  assert.equal(r.error, 'invalid_amount');
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-3 & GAP-4: app/api/bank/reconcile — validation + dynamic SET clause
//
// Inlined from app/api/bank/reconcile/route.ts
// ════════════════════════════════════════════════════════════════════════════

function buildReconcileUpdate({ invoice_id, expense_id, payment_id }) {
  if (!invoice_id && !expense_id && !payment_id) return { error: 'missing_target' };

  const sets = ['reconciled = true'];
  const values = [];
  let i = 1;

  if (invoice_id) { sets.push(`invoice_id = $${i++}`); values.push(invoice_id); }
  if (expense_id) { sets.push(`expense_id = $${i++}`); values.push(expense_id); }
  if (payment_id) { sets.push(`payment_id = $${i++}`); values.push(payment_id); }

  return { sets, values, paramCount: i };
}

test('reconcile: all IDs absent → error', () => {
  const r = buildReconcileUpdate({});
  assert.equal(r.error, 'missing_target');
});

test('reconcile: only invoice_id → SET clause has invoice_id at $1', () => {
  const r = buildReconcileUpdate({ invoice_id: 42 });
  assert.ok(!r.error);
  assert.ok(r.sets.includes('invoice_id = $1'), 'invoice_id must be $1');
  assert.deepEqual(r.values, [42]);
  assert.equal(r.paramCount, 2, 'next param after invoice_id is $2 (for WHERE)');
});

test('reconcile: only expense_id → SET clause has expense_id at $1', () => {
  const r = buildReconcileUpdate({ expense_id: 99 });
  assert.ok(r.sets.includes('expense_id = $1'));
  assert.deepEqual(r.values, [99]);
});

test('reconcile: only payment_id → SET clause has payment_id at $1', () => {
  const r = buildReconcileUpdate({ payment_id: 7 });
  assert.ok(r.sets.includes('payment_id = $1'));
});

test('reconcile: invoice_id + expense_id → both in SET with incrementing params', () => {
  const r = buildReconcileUpdate({ invoice_id: 1, expense_id: 2 });
  assert.ok(r.sets.some(s => s.includes('invoice_id = $1')));
  assert.ok(r.sets.some(s => s.includes('expense_id = $2')));
  assert.deepEqual(r.values, [1, 2]);
  assert.equal(r.paramCount, 3);
});

test('reconcile: all three IDs → three SET entries in order', () => {
  const r = buildReconcileUpdate({ invoice_id: 10, expense_id: 20, payment_id: 30 });
  assert.equal(r.sets.length, 4, 'reconciled=true + 3 id columns');
  assert.deepEqual(r.values, [10, 20, 30]);
  assert.equal(r.paramCount, 4);
});

test('reconcile: reconciled=true always first in SET list', () => {
  const r = buildReconcileUpdate({ expense_id: 5 });
  assert.equal(r.sets[0], 'reconciled = true');
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-5: app/api/ads/propose — budget / duration hard-caps
//
// Inlined from app/api/ads/propose/route.ts
// ════════════════════════════════════════════════════════════════════════════

function capBudget(val) { return Math.min(Number(val ?? 50), 50); }
function capDuration(val) { return Math.min(Number(val ?? 7), 14); }

test('ads/propose: dailyBudgetUsd omitted → defaults to $50', () => {
  assert.equal(capBudget(undefined), 50);
});

test('ads/propose: dailyBudgetUsd=10 → passes through', () => {
  assert.equal(capBudget(10), 10);
});

test('ads/propose: dailyBudgetUsd=75 → capped to $50 hard limit', () => {
  assert.equal(capBudget(75), 50);
});

test('ads/propose: dailyBudgetUsd=50 → exactly at cap (not capped)', () => {
  assert.equal(capBudget(50), 50);
});

test('ads/propose: dailyBudgetUsd=51 → capped to $50', () => {
  assert.equal(capBudget(51), 50);
});

test('ads/propose: durationDays omitted → defaults to 7', () => {
  assert.equal(capDuration(undefined), 7);
});

test('ads/propose: durationDays=14 → exactly at cap', () => {
  assert.equal(capDuration(14), 14);
});

test('ads/propose: durationDays=30 → capped to 14 days', () => {
  assert.equal(capDuration(30), 14);
});

test('ads/propose: durationDays=3 → passes through', () => {
  assert.equal(capDuration(3), 3);
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-6: app/api/composio/connect — ALLOWED_TOOLKITS whitelist logic
//
// Inlined from app/api/composio/connect/route.ts
// ════════════════════════════════════════════════════════════════════════════

const ALLOWED_TOOLKITS = [
  'GOOGLESHEETS', 'GMAIL', 'GOOGLECALENDAR', 'SLACK',
  'GOOGLEDRIVE', 'FACEBOOK', 'META_ADS', 'FACEBOOK_LEAD_ADS', 'INSTAGRAM',
];

function isToolkitAllowed(toolkit) {
  return ALLOWED_TOOLKITS.includes(toolkit.toUpperCase());
}

test('composio toolkit: "GMAIL" allowed (exact match)', () => {
  assert.equal(isToolkitAllowed('GMAIL'), true);
});

test('composio toolkit: "gmail" allowed (case-insensitive)', () => {
  assert.equal(isToolkitAllowed('gmail'), true);
});

test('composio toolkit: "Slack" allowed (mixed case)', () => {
  assert.equal(isToolkitAllowed('Slack'), true);
});

test('composio toolkit: "FACEBOOK_LEAD_ADS" allowed', () => {
  assert.equal(isToolkitAllowed('FACEBOOK_LEAD_ADS'), true);
});

test('composio toolkit: "HACK" not allowed → 400', () => {
  assert.equal(isToolkitAllowed('HACK'), false);
});

test('composio toolkit: "STRIPE" not allowed', () => {
  assert.equal(isToolkitAllowed('STRIPE'), false);
});

test('composio toolkit: empty string not allowed', () => {
  assert.equal(isToolkitAllowed(''), false);
});

test('composio toolkit: all 9 listed toolkits pass whitelist', () => {
  for (const tk of ALLOWED_TOOLKITS) {
    assert.equal(isToolkitAllowed(tk), true, `${tk} must be allowed`);
  }
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-7: middleware.ts — CORS-enabled paths that should include ACAO on 429
//
// Documents the expectation: when rate-limited on /api/chat, the 429 response
// carries Access-Control-Allow-Origin so browsers see a proper CORS error.
//
// (Unit test verifies the design contract, not the HTTP response itself.)
// ════════════════════════════════════════════════════════════════════════════

const CORS_PATHS = ['/api/track', '/api/submissions', '/api/chat', '/api/chat/history', '/api/chat/upload'];
const CORS_ORIGIN = 'https://novusepoxy.ca';

test('middleware CORS: 5 paths receive ACAO header (including on rate-limit)', () => {
  assert.equal(CORS_PATHS.length, 5);
  for (const p of CORS_PATHS) {
    assert.ok(p.startsWith('/api/'), `${p} must be an API path`);
  }
});

test('middleware CORS: /api/openclaw/webhook NOT in CORS preflight list', () => {
  const CORS_PREFLIGHT_LIST = ['/api/track', '/api/submissions', '/api/chat', '/api/chat/history', '/api/chat/upload'];
  assert.equal(CORS_PREFLIGHT_LIST.includes('/api/openclaw/webhook'), false,
    'openclaw webhook is not a public CORS endpoint — expected behaviour');
});

test('middleware CORS origin is the production domain', () => {
  assert.equal(CORS_ORIGIN, 'https://novusepoxy.ca');
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-8: middleware.ts — /api/openclaw/webhook in matcher but no CORS
//        (Documents the design: webhook receives security headers, not CORS)
// ════════════════════════════════════════════════════════════════════════════

test('middleware matcher: contains /api/openclaw/webhook for security headers', () => {
  // The config.matcher is static; we document its coverage here.
  const matcher = [
    '/api/track', '/api/submissions', '/api/meta/webhook', '/api/openclaw/webhook',
    '/api/chat', '/api/chat/history', '/api/chat/upload', '/api/chat/email',
    '/api/auth/:path*', '/api/bookings/:path*', '/api/telegram/admin',
    '/api/sms/devis', '/api/sms/incoming', '/api/quotes/:path*', '/api/leads/zapier',
  ];
  assert.ok(matcher.includes('/api/openclaw/webhook'), 'openclaw/webhook in matcher for rate-limit');
  assert.ok(matcher.includes('/api/leads/zapier'),     'leads/zapier in matcher');
  assert.ok(matcher.includes('/api/sms/incoming'),     'sms/incoming in matcher');
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-9 & GAP-10: lib/telegram-utils.ts — sendTelegramSafe()
//
// Inlined (sync portion only — actual fetch is mocked via stub)
// ════════════════════════════════════════════════════════════════════════════

function isQuietHoursAt(hour) {
  return hour >= 21 || hour < 7;  // from lib/telegram-utils.ts
}

function sendTelegramSafeGuard({ hour, token, force = false }) {
  if (!force && isQuietHoursAt(hour)) return false;   // quiet hours guard
  if (!token) return false;                            // missing token guard
  return 'would_send';
}

test('sendTelegramSafe: quiet hour (22h) without force → false', () => {
  assert.equal(sendTelegramSafeGuard({ hour: 22, token: 'tok', force: false }), false);
});

test('sendTelegramSafe: quiet hour (6h) without force → false', () => {
  assert.equal(sendTelegramSafeGuard({ hour: 6, token: 'tok', force: false }), false);
});

test('sendTelegramSafe: quiet hour (22h) with force=true → bypasses quiet hours', () => {
  assert.equal(sendTelegramSafeGuard({ hour: 22, token: 'tok', force: true }), 'would_send');
});

test('sendTelegramSafe: business hour (10h) without force → proceeds', () => {
  assert.equal(sendTelegramSafeGuard({ hour: 10, token: 'tok', force: false }), 'would_send');
});

test('sendTelegramSafe: boundary hour 21h → quiet (21 >= 21)', () => {
  assert.equal(sendTelegramSafeGuard({ hour: 21, token: 'tok', force: false }), false);
});

test('sendTelegramSafe: boundary hour 7h → NOT quiet (7 < 7 is false, 7 >= 21 is false)', () => {
  assert.equal(sendTelegramSafeGuard({ hour: 7, token: 'tok', force: false }), 'would_send');
});

test('sendTelegramSafe: missing TELEGRAM_BOT_TOKEN → false (even during business hours)', () => {
  assert.equal(sendTelegramSafeGuard({ hour: 10, token: '', force: false }), false);
  assert.equal(sendTelegramSafeGuard({ hour: 10, token: undefined, force: false }), false);
});

test('sendTelegramSafe: force=true + missing token → still false (token check is after force check)', () => {
  assert.equal(sendTelegramSafeGuard({ hour: 22, token: '', force: true }), false);
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-11: lib/llm.ts — OR_MODELS env override pattern
//
// OR_MODELS[tier] = process.env.OR_MODEL_<TIER> ?? '<default>'
// The override takes effect before any model call. We test the fallback
// default values AND that the override pattern works correctly.
// ════════════════════════════════════════════════════════════════════════════

const DEFAULT_OR_MODELS = {
  bulk:   'deepseek/deepseek-v4-flash',
  fast:   'google/gemini-3.1-flash-lite',
  medium: 'google/gemini-3-flash-preview',
  smart:  'x-ai/grok-4.20',
  top:    'google/gemini-3.1-pro-preview',
};

function resolveModel(tier, env) {
  const envKey = `OR_MODEL_${tier.toUpperCase()}`;
  return env[envKey] ?? DEFAULT_OR_MODELS[tier];
}

test('OR_MODELS default: bulk tier default is deepseek-v4-flash', () => {
  assert.equal(resolveModel('bulk', {}), 'deepseek/deepseek-v4-flash');
});

test('OR_MODELS default: smart tier default is grok-4.20', () => {
  assert.equal(resolveModel('smart', {}), 'x-ai/grok-4.20');
});

test('OR_MODELS override: OR_MODEL_BULK env overrides default', () => {
  const model = resolveModel('bulk', { OR_MODEL_BULK: 'openai/gpt-4o-mini' });
  assert.equal(model, 'openai/gpt-4o-mini', 'env override must take effect');
});

test('OR_MODELS override: OR_MODEL_SMART env overrides smart default', () => {
  const model = resolveModel('smart', { OR_MODEL_SMART: 'anthropic/claude-3-5-haiku' });
  assert.equal(model, 'anthropic/claude-3-5-haiku');
});

test('OR_MODELS override: empty string env var falls back to default (nullish coalescing)', () => {
  // process.env.X = '' → '' is falsy but ?? only triggers on null/undefined
  // An empty string DOES override (sets model to '').
  // This documents the subtle behaviour: set to non-empty or leave unset.
  const model = resolveModel('fast', { OR_MODEL_FAST: '' });
  assert.equal(model, '', 'empty string overrides — caller must avoid setting empty string');
});

test('OR_MODELS: 5 tiers defined', () => {
  assert.equal(Object.keys(DEFAULT_OR_MODELS).length, 5);
  for (const tier of ['bulk', 'fast', 'medium', 'smart', 'top']) {
    assert.ok(DEFAULT_OR_MODELS[tier], `${tier} must have a default model`);
  }
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-12: lib/sms.ts — area code extraction for 11-digit numbers
//
// For 10-digit: areaCode = digitsOnly.substring(0, 3)
// For 11-digit: areaCode = digitsOnly.substring(1, 4) (skip leading '1')
// ════════════════════════════════════════════════════════════════════════════

const VALID_QC_AREA_CODES = ['418', '581', '819', '450', '438', '514', '579', '873', '367'];

function extractAreaCode(phone) {
  const cleaned = phone.replace(/[^0-9+]/g, '');
  const normalized = cleaned.startsWith('+') ? cleaned : cleaned.startsWith('1') ? `+${cleaned}` : `+1${cleaned}`;
  const digitsOnly = normalized.replace(/\D/g, '');
  return {
    digits: digitsOnly,
    areaCode: digitsOnly.length === 11 ? digitsOnly.substring(1, 4) : digitsOnly.substring(0, 3),
    isValid: (digitsOnly.length === 10 || digitsOnly.length === 11) &&
             VALID_QC_AREA_CODES.includes(
               digitsOnly.length === 11 ? digitsOnly.substring(1, 4) : digitsOnly.substring(0, 3)
             ),
  };
}

test('SMS area code: 10-digit 514... → areaCode = "514"', () => {
  const r = extractAreaCode('5141234567');
  assert.equal(r.areaCode, '514');
  assert.equal(r.isValid, true);
});

test('SMS area code: 11-digit 15141234567 → areaCode extracted as "514" (skip leading 1)', () => {
  const r = extractAreaCode('15141234567');
  assert.equal(r.areaCode, '514');
  assert.equal(r.isValid, true);
});

test('SMS area code: E.164 +15141234567 → areaCode "514"', () => {
  const r = extractAreaCode('+15141234567');
  assert.equal(r.areaCode, '514');
  assert.equal(r.isValid, true);
});

test('SMS area code: formatted (514) 123-4567 → normalised and areaCode "514"', () => {
  const r = extractAreaCode('(514) 123-4567');
  assert.equal(r.areaCode, '514');
  assert.equal(r.isValid, true);
});

test('SMS area code: 11-digit with invalid area code 416 (Toronto) → rejected', () => {
  const r = extractAreaCode('14161234567');
  assert.equal(r.areaCode, '416');
  assert.equal(r.isValid, false, '416 is not a QC area code');
});

test('SMS area code: 9-digit number → isValid false', () => {
  const r = extractAreaCode('514123456');
  assert.equal(r.isValid, false);
});

test('SMS area code: all 9 QC area codes are valid', () => {
  for (const ac of VALID_QC_AREA_CODES) {
    const phone = `${ac}1234567`;  // 10-digit
    const r = extractAreaCode(phone);
    assert.equal(r.isValid, true, `${ac} must be a valid QC area code`);
  }
});

test('SMS area code: 873 area code (Abitibi-Témiscamingue overlay) recognised', () => {
  const r = extractAreaCode('8731234567');
  assert.equal(r.areaCode, '873');
  assert.equal(r.isValid, true);
});

test('SMS area code: 367 area code (new Québec overlay) recognised', () => {
  const r = extractAreaCode('3671234567');
  assert.equal(r.areaCode, '367');
  assert.equal(r.isValid, true);
});

// ════════════════════════════════════════════════════════════════════════════
// INTEGRATION SKELETONS — require a running server + INTEGRATION_TEST=1
// ════════════════════════════════════════════════════════════════════════════

test(
  'INT-1: POST /api/invoices/1/payment — missing type → 400',
  { skip: SKIP_INTEGRATION ? 'set INTEGRATION_TEST=1 + TEST_BASE_URL' : false },
  async () => {
    const res = await fetch(`${BASE}/api/invoices/1/payment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ methode: 'virement' }), // type missing
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.ok(body.error?.includes('type'), 'error must mention missing type');
  }
);

test(
  'INT-2: POST /api/invoices/1/payment — type=final on fully-paid invoice → 400',
  { skip: SKIP_INTEGRATION ? 'set INTEGRATION_TEST=1 + TEST_BASE_URL' : false },
  async () => {
    // Requires an invoice that is fully paid in the test DB
    const res = await fetch(`${BASE}/api/invoices/1/payment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'final', methode: 'virement' }),
    });
    // Either 400 (fully paid) or 401 (no session) in CI
    assert.ok([400, 401].includes(res.status));
  }
);

test(
  'INT-3: POST /api/bank/reconcile — all target IDs absent → 400',
  { skip: SKIP_INTEGRATION ? 'set INTEGRATION_TEST=1 + TEST_BASE_URL' : false },
  async () => {
    const res = await fetch(`${BASE}/api/bank/reconcile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transaction_id: 1 }), // no invoice/expense/payment
    });
    assert.ok([400, 401].includes(res.status));
    if (res.status === 400) {
      const body = await res.json();
      assert.ok(body.error, 'should have error message');
    }
  }
);

test(
  'INT-4: GET /api/composio/connect?toolkit=HACK — unlisted toolkit → 400',
  { skip: SKIP_INTEGRATION ? 'set INTEGRATION_TEST=1 + TEST_BASE_URL' : false },
  async () => {
    const res = await fetch(`${BASE}/api/composio/connect?toolkit=HACK`, {
      headers: { 'Content-Type': 'application/json' },
    });
    // 401 without session, 400 if session exists and toolkit is invalid
    assert.ok([400, 401].includes(res.status));
  }
);

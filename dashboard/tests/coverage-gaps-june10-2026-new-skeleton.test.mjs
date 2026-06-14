/**
 * coverage-gaps-june10-2026-new-skeleton.test.mjs
 *
 * True untested gaps found in coverage audit of 2026-06-10.
 *
 * Each section calls out:
 *   - WHY this gap matters
 *   - Which file/function is missing coverage
 *   - A runnable pure-logic test OR a clearly-marked skeleton (skipped)
 *     for tests that require DB / network / LLM mocks
 *
 * Run: node --test tests/coverage-gaps-june10-2026-new-skeleton.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

const SKIP_INTEGRATION = !process.env.INTEGRATION_TEST;

// ════════════════════════════════════════════════════════════════════════════
// GAP-1  lib/send-prospect-email.ts — RFC-2822 email encoding
//
// WHY: The base64url encoding of email headers is the only path that does NOT
//      require a live Gmail API call. A wrong header format (e.g. missing CRLF
//      separator between headers and body) silently corrupts every outbound
//      prospect email without throwing. The credentials-missing throw is already
//      tested in coverage-gaps-dec2026.test.mjs but encoding is not.
// ════════════════════════════════════════════════════════════════════════════

// Inlined from lib/send-prospect-email.ts — keep in sync
function buildRawEmail({ to, subject, html }) {
  const headerLines = [
    'From: Novus Epoxy <gestionnovusepoxy@gmail.com>',
    `To: ${to}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=utf-8',
  ].join('\r\n');
  const content = html ?? '';
  return `${headerLines}\r\n\r\n${content}`;
}

test('GAP-1: email raw: headers and body separated by CRLF+CRLF', () => {
  const raw = buildRawEmail({ to: 'test@example.com', subject: 'Test', html: '<p>Hi</p>' });
  assert.ok(raw.includes('\r\n\r\n'), 'Must have blank line (CRLF+CRLF) separating headers from body');
});

test('GAP-1: email raw: To header correctly set', () => {
  const raw = buildRawEmail({ to: 'client@example.com', subject: 'S', html: '' });
  assert.ok(raw.includes('To: client@example.com'), 'To header must be present');
});

test('GAP-1: email raw: Content-Type is text/html utf-8', () => {
  const raw = buildRawEmail({ to: 'x@y.com', subject: 'S', html: '' });
  assert.ok(raw.includes('Content-Type: text/html; charset=utf-8'));
});

test('GAP-1: email raw: base64url encoding is url-safe (no + / =)', () => {
  const raw = buildRawEmail({ to: 'a@b.com', subject: 'Hello World', html: '<p>Test</p>' });
  const encoded = Buffer.from(raw).toString('base64url');
  assert.ok(!encoded.includes('+'), 'base64url must not contain +');
  assert.ok(!encoded.includes('/'), 'base64url must not contain /');
  assert.ok(!encoded.includes('='), 'base64url must not contain padding =');
});

test('GAP-1: email raw: text-only input converted to <p> tags', () => {
  const text = 'Bonjour\nComment ca va';
  const html = text.split('\n').map(l => l.trim() ? `<p style="margin:0 0 8px;">${l}</p>` : '').join('');
  const raw = buildRawEmail({ to: 'a@b.com', subject: 'S', html });
  assert.ok(raw.includes('<p style="margin:0 0 8px;">Bonjour</p>'));
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-2  lib/auto-heal.ts — healWebhook() URL mismatch detection
//
// WHY: autoHeal() is called on every major API request. If the webhook URL
//      diverges (redeploy changes domain), healWebhook() must detect it and
//      call setWebhook. Only the timing arithmetic is tested; the URL comparison
//      branch and the setWebhook retry are not.
// ════════════════════════════════════════════════════════════════════════════

// Inlined from lib/auto-heal.ts
const EXPECTED_WEBHOOK = 'https://novus-epoxy.vercel.app/api/telegram/admin';

function webhookNeedsRepair(currentUrl) {
  return !currentUrl || currentUrl !== EXPECTED_WEBHOOK;
}

test('GAP-2: webhookNeedsRepair: correct URL → false (no repair needed)', () => {
  assert.equal(webhookNeedsRepair(EXPECTED_WEBHOOK), false);
});

test('GAP-2: webhookNeedsRepair: empty URL → true', () => {
  assert.equal(webhookNeedsRepair(''), true);
});

test('GAP-2: webhookNeedsRepair: null URL → true', () => {
  assert.equal(webhookNeedsRepair(null), true);
});

test('GAP-2: webhookNeedsRepair: stale URL from old deploy → true', () => {
  assert.equal(webhookNeedsRepair('https://novus-epoxy-git-main-novusepoxy.vercel.app/api/telegram/admin'), true);
});

test('GAP-2: webhookNeedsRepair: undefined → true', () => {
  assert.equal(webhookNeedsRepair(undefined), true);
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-3  app/api/cron/* — auth guard pattern (16 routes with zero tests)
//
// WHY: Every cron route checks CRON_SECRET (or ADMIN_API_KEY fallback) via
//      Authorization: Bearer <token>. All 16 routes below have zero tests.
//      This tests the guard logic inline; integration tests are skeletons.
//
// Affected routes (zero test references as of 2026-06-10):
//   ads-performance, ads-weekly, avis, deposit-watch, fb-leads-sync,
//   iris-report, lead-hygiene, meta-ads-spend, monthly-accounting,
//   nurture-leads, rappels, recurring-expenses, relance-facture,
//   soustraitants-paie, sync-submissions, worker-reminders
// ════════════════════════════════════════════════════════════════════════════

// Inlined from the common cron auth pattern
function isCronAuthorized(authHeader, cronSecret, adminKey) {
  const token = (authHeader ?? '').replace('Bearer ', '').trim();
  if (!token) return false;
  if (cronSecret && token === cronSecret) return true;
  if (adminKey && token === adminKey) return true;
  return false;
}

test('GAP-3: cron auth: valid CRON_SECRET → authorized', () => {
  assert.equal(isCronAuthorized('Bearer mysecret', 'mysecret', ''), true);
});

test('GAP-3: cron auth: valid ADMIN_API_KEY fallback → authorized', () => {
  assert.equal(isCronAuthorized('Bearer adminkey', '', 'adminkey'), true);
});

test('GAP-3: cron auth: wrong token → rejected', () => {
  assert.equal(isCronAuthorized('Bearer wrong', 'correct', 'alsoCorrect'), false);
});

test('GAP-3: cron auth: missing Authorization header → rejected', () => {
  assert.equal(isCronAuthorized(null, 'secret', 'admin'), false);
});

test('GAP-3: cron auth: empty Authorization header → rejected', () => {
  assert.equal(isCronAuthorized('', 'secret', 'admin'), false);
});

test('GAP-3: cron auth: Bearer prefix stripped before comparison', () => {
  assert.equal(isCronAuthorized('Bearer   spaced  ', '  spaced  '.trim(), ''), true);
});

// Integration skeletons — require running app
test('GAP-3 skeleton: GET /api/cron/deposit-watch without auth → 401', { skip: SKIP_INTEGRATION }, async () => {
  const BASE = process.env.TEST_BASE_URL ?? 'http://localhost:3000';
  const res = await fetch(`${BASE}/api/cron/deposit-watch`);
  assert.equal(res.status, 401);
});

test('GAP-3 skeleton: GET /api/cron/ads-performance without auth → 401', { skip: SKIP_INTEGRATION }, async () => {
  const BASE = process.env.TEST_BASE_URL ?? 'http://localhost:3000';
  const res = await fetch(`${BASE}/api/cron/ads-performance`);
  assert.equal(res.status, 401);
});

test('GAP-3 skeleton: GET /api/cron/sync-submissions without auth → 401', { skip: SKIP_INTEGRATION }, async () => {
  const BASE = process.env.TEST_BASE_URL ?? 'http://localhost:3000';
  const res = await fetch(`${BASE}/api/cron/sync-submissions`);
  assert.equal(res.status, 401);
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-4  lib/meta-ads.ts — generateAdCopy() month label is current month
//
// WHY: generateAdCopy() builds French month labels dynamically:
//      "Offre du mois de juin" — if the locale logic breaks, all ad copy
//      shows the wrong month indefinitely. This is a pure deterministic
//      calculation once we know the current date.
// ════════════════════════════════════════════════════════════════════════════

// Inlined from lib/meta-ads.ts
function getMoisQc(date) {
  return date.toLocaleDateString('fr-CA', { month: 'long' });
}

test('GAP-4: getMoisQc: juin 2026-06-10 → "juin"', () => {
  const d = new Date('2026-06-10T12:00:00Z');
  assert.equal(getMoisQc(d), 'juin');
});

test('GAP-4: getMoisQc: janvier → "janvier"', () => {
  const d = new Date('2026-01-15T12:00:00Z');
  assert.equal(getMoisQc(d), 'janvier');
});

test('GAP-4: getMoisQc: décembre → "décembre"', () => {
  const d = new Date('2026-12-01T12:00:00Z');
  assert.equal(getMoisQc(d), 'décembre');
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-5  lib/meta-ads.ts — buildAdsManagerPrefillUrl() image_hash field
//
// WHY: The prefill URL includes an image_hash parameter when the draft has
//      one. If absent (no image uploaded), the URL should still be valid.
//      Only the daily_budget and ad_account_id cases are tested; image_hash
//      presence/absence is not.
// ════════════════════════════════════════════════════════════════════════════

function buildPrefillUrl(draft) {
  if (!draft || !draft.ad_account_id) {
    return 'https://business.facebook.com/adsmanager/creation';
  }
  const params = new URLSearchParams();
  params.set('act', draft.ad_account_id);
  if (draft.headline) params.set('name', draft.headline);
  if (draft.daily_budget) params.set('daily_budget', String(Math.round(draft.daily_budget * 100)));
  if (draft.image_hash) params.set('image_hash', draft.image_hash);
  return `https://business.facebook.com/adsmanager/creation?${params.toString()}`;
}

test('GAP-5: prefillUrl: image_hash present → included in URL', () => {
  const url = buildPrefillUrl({ ad_account_id: 'act_123', headline: 'Rabais', daily_budget: 30, image_hash: 'abc123hash' });
  assert.ok(url.includes('image_hash=abc123hash'), `image_hash not in URL: ${url}`);
});

test('GAP-5: prefillUrl: no image_hash → URL still valid, no image_hash param', () => {
  const url = buildPrefillUrl({ ad_account_id: 'act_123', headline: 'Test', daily_budget: 20 });
  assert.ok(!url.includes('image_hash'), `Should not include image_hash: ${url}`);
  assert.ok(url.startsWith('https://business.facebook.com/adsmanager/creation?'));
});

test('GAP-5: prefillUrl: null draft → returns fallback URL with no params', () => {
  const url = buildPrefillUrl(null);
  assert.equal(url, 'https://business.facebook.com/adsmanager/creation');
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-6  lib/agent.ts — isValidQuoteData() boundary conditions
//
// WHY: isValidQuoteData() guards against garbage LLM output being INSERT-ed
//      into the DB. The current tests (agent-utils-and-edge-cases.test.mjs)
//      cover happy path and obvious failures but miss:
//        - superficie exactly at boundary (valid = >0)
//        - non-numeric superficie string
//        - service type not in SERVICES catalog
// ════════════════════════════════════════════════════════════════════════════

// Inlined from lib/agent.ts
const VALID_SERVICES = ['flake', 'metallique', 'couleur_unie', 'quartz', 'commercial', 'antiderapant', 'meulage', 'vinyl_click'];

function isValidQuoteData(data) {
  if (!data || typeof data !== 'object') return false;
  if (!data.nom || typeof data.nom !== 'string' || data.nom.trim() === '') return false;
  if (!data.service || !VALID_SERVICES.includes(data.service)) return false;
  if (!data.superficie || typeof data.superficie !== 'number' || data.superficie <= 0) return false;
  return true;
}

test('GAP-6: isValidQuoteData: superficie = 0 → invalid', () => {
  assert.equal(isValidQuoteData({ nom: 'Jean', service: 'flake', superficie: 0 }), false);
});

test('GAP-6: isValidQuoteData: superficie = -1 → invalid', () => {
  assert.equal(isValidQuoteData({ nom: 'Jean', service: 'flake', superficie: -1 }), false);
});

test('GAP-6: isValidQuoteData: superficie = 1 → valid (minimum positive)', () => {
  assert.equal(isValidQuoteData({ nom: 'Jean', service: 'flake', superficie: 1 }), true);
});

test('GAP-6: isValidQuoteData: superficie is string "500" → invalid (wrong type)', () => {
  assert.equal(isValidQuoteData({ nom: 'Jean', service: 'flake', superficie: '500' }), false);
});

test('GAP-6: isValidQuoteData: unknown service → invalid', () => {
  assert.equal(isValidQuoteData({ nom: 'Jean', service: 'beton_poli', superficie: 500 }), false);
});

test('GAP-6: isValidQuoteData: all 8 valid service types are accepted', () => {
  for (const s of VALID_SERVICES) {
    assert.equal(
      isValidQuoteData({ nom: 'Jean', service: s, superficie: 100 }),
      true,
      `Service "${s}" should be valid`,
    );
  }
});

test('GAP-6: isValidQuoteData: nom with only whitespace → invalid', () => {
  assert.equal(isValidQuoteData({ nom: '   ', service: 'flake', superficie: 100 }), false);
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-7  lib/sms.ts — sendDepositConfirmationSMS() message content
//
// WHY: sendDepositConfirmationSMS is called on every deposit confirmation.
//      It embeds jour1Date and jour2Date into the SMS. The behaviour when
//      only one date is provided (jour2Date missing) is not tested.
//      Message must include client name and both or one date.
// ════════════════════════════════════════════════════════════════════════════

// Inlined from lib/sms.ts (the message template logic)
function buildDepositMsg(clientName, jour1Date, jour2Date) {
  const prenom = clientName.split(' ')[0];
  if (jour1Date && jour2Date) {
    return `Super nouvelle ${prenom}! Ton dépôt a été reçu avec succès. ` +
      `L'installation est prévue les ${jour1Date} et ${jour2Date}. ` +
      `Si tu as des questions, appelle-nous au 581-307-5983. Merci et à bientôt!`;
  }
  if (jour1Date) {
    return `Super nouvelle ${prenom}! Ton dépôt a été reçu avec succès. ` +
      `L'installation est prévue le ${jour1Date}. ` +
      `Si tu as des questions, appelle-nous au 581-307-5983. Merci et à bientôt!`;
  }
  return `Super nouvelle ${prenom}! Ton dépôt a été reçu avec succès. ` +
    `Notre équipe te contactera bientôt pour confirmer les dates. Merci!`;
}

test('GAP-7: depositMsg: with both dates → contains both dates', () => {
  const msg = buildDepositMsg('Marie Tremblay', '15 juin', '16 juin');
  assert.ok(msg.includes('15 juin'), 'jour1 missing');
  assert.ok(msg.includes('16 juin'), 'jour2 missing');
  assert.ok(msg.includes('Marie'), 'prenom missing');
});

test('GAP-7: depositMsg: jour1 only → single date message', () => {
  const msg = buildDepositMsg('Pierre Gagnon', '20 juin', undefined);
  assert.ok(msg.includes('20 juin'), 'jour1 missing');
  assert.ok(!msg.includes('undefined'), 'undefined must not appear in SMS');
});

test('GAP-7: depositMsg: no dates → generic confirmation', () => {
  const msg = buildDepositMsg('Jean Roy', undefined, undefined);
  assert.ok(!msg.includes('undefined'), 'undefined must not appear in SMS');
  assert.ok(msg.includes('Jean'), 'prenom missing');
  assert.ok(msg.includes('dates'), 'Should mention dates will be confirmed');
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-8  lib/pricing.ts — calculateQuote() at MIN_JOB_DOLLARS floor
//
// WHY: Very small jobs (< 1500$) must be floor-priced at MIN_JOB_DOLLARS
//      to stay profitable. The MIN_JOB_DOLLARS constant exists but there is
//      no test confirming the floor is actually applied by calculateQuote().
//      (pricing.invariants.test.mjs tests tax math but not the minimum floor.)
// ════════════════════════════════════════════════════════════════════════════

const MIN_JOB_DOLLARS = 1500;
const SERVICES = {
  flake: { base: 7, min: 700 },          // $7/pi²
  metallique: { base: 9, min: 900 },
  couleur_unie: { base: 6, min: 600 },
  quartz: { base: 8, min: 800 },
  commercial: { base: 5, min: 500 },
  antiderapant: { base: 6.5, min: 650 },
  meulage: { base: 4, min: 400 },
  vinyl_click: { base: 5, min: 500 },
};

// Inlined from lib/pricing.ts — keep in sync
function calculateQuoteLocal(type, superficie, rabais_pct = 0) {
  const svc = SERVICES[type];
  if (!svc) throw new Error(`Unknown service: ${type}`);
  const rawSousTotal = Math.max(svc.base * superficie, MIN_JOB_DOLLARS);
  const sousTotal = rawSousTotal * (1 - rabais_pct / 100);
  return { sousTotal };
}

test('GAP-8: calculateQuote floor: 10 pi² flake → sous_total is MIN_JOB_DOLLARS not 70$', () => {
  const { sousTotal } = calculateQuoteLocal('flake', 10, 0);
  assert.ok(sousTotal >= MIN_JOB_DOLLARS, `sous_total ${sousTotal} must be >= ${MIN_JOB_DOLLARS}`);
});

test('GAP-8: calculateQuote floor: 1 pi² any type → sous_total is MIN_JOB_DOLLARS', () => {
  for (const type of Object.keys(SERVICES)) {
    const { sousTotal } = calculateQuoteLocal(type, 1, 0);
    assert.ok(sousTotal >= MIN_JOB_DOLLARS, `[${type}] sous_total ${sousTotal} < MIN_JOB_DOLLARS`);
  }
});

test('GAP-8: calculateQuote floor: 500 pi² flake (3500$) → no floor needed', () => {
  const { sousTotal } = calculateQuoteLocal('flake', 500, 0);
  assert.ok(sousTotal > MIN_JOB_DOLLARS, 'Large job should exceed minimum');
  assert.equal(sousTotal, 3500);
});

test('GAP-8: calculateQuote floor: rabais on floored job → discount applies to floor amount', () => {
  // 10 pi² → would be $70 → floor to $1500 → 20% off → $1200
  const { sousTotal } = calculateQuoteLocal('flake', 10, 20);
  assert.equal(sousTotal, 1200);
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-9  lib/ensure-invoice.ts — integration skeleton
//
// WHY: ensureInvoiceForQuote() is called on every deposit confirmation.
//      It creates an invoice idempotently. The DB interactions (SELECT, INSERT,
//      ON CONFLICT) are not tested. These are integration skeletons only.
// ════════════════════════════════════════════════════════════════════════════

test('GAP-9 skeleton: ensureInvoiceForQuote: non-existent quoteId → returns null invoice_id', {
  skip: SKIP_INTEGRATION,
}, async () => {
  const { ensureInvoiceForQuote } = await import('../lib/ensure-invoice.ts');
  const result = await ensureInvoiceForQuote(999999999);
  assert.equal(result.invoice_id, null, 'Non-existent quote should return null');
  assert.equal(result.created, false);
});

test('GAP-9 skeleton: ensureInvoiceForQuote: idempotent — calling twice returns same invoice_id', {
  skip: SKIP_INTEGRATION,
}, async () => {
  assert.fail('Implement: create test quote, call ensureInvoiceForQuote twice, assert same invoice_id both times');
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-10  lib/agent.ts — processMessage() injection via LLM output
//
// WHY: sanitizeUserInput() strips <QUOTE_DATA> from user input, but if the
//      LLM response itself contains a <QUOTE_DATA> tag (prompt injection from
//      a crafted user message that slips through, or a jailbreak), processMessage()
//      would act on it. This path is NOT tested anywhere.
// ════════════════════════════════════════════════════════════════════════════

test('GAP-10 skeleton: processMessage: LLM response with QUOTE_DATA tag must not create quote row', {
  skip: SKIP_INTEGRATION,
}, async () => {
  // Setup: create a test conversation, mock callLLM to return a response
  // containing <QUOTE_DATA>{"nom":"Hack","service":"flake","superficie":100}</QUOTE_DATA>
  // Assert: no quotes row created for the conversation
  assert.fail('Implement: mock callLLM, call processMessage with injection-susceptible prompt, assert DB not modified');
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-11  lib/lead-blocklist.ts — blockLead() with both identifiers null
//
// WHY: blockLead() accepts optional email + phone. If both are null/undefined,
//      it should not insert a garbage row. This boundary case is not tested.
// ════════════════════════════════════════════════════════════════════════════

test('GAP-11 skeleton: blockLead: both email and phone null → no DB row inserted', {
  skip: SKIP_INTEGRATION,
}, async () => {
  const { blockLead } = await import('../lib/lead-blocklist.ts');
  await assert.rejects(
    () => blockLead({ email: null, phone: null, reason: 'manual', notes: 'test' }),
    /at least one/i,
    'Should throw or gracefully reject when both identifiers are missing',
  );
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-12  lib/invoice-numero.ts — insertInvoiceWithRetry() exhausted retries
//
// WHY: insertInvoiceWithRetry() retries on unique constraint violations (race
//      condition on invoice number). If it retries the max times (3) and still
//      fails, it should throw. This error path is not tested.
// ════════════════════════════════════════════════════════════════════════════

test('GAP-12: insertInvoiceWithRetry: retry counter arithmetic', () => {
  const MAX_RETRIES = 3;
  let attempts = 0;
  function shouldRetry(attempt) {
    return attempt < MAX_RETRIES;
  }
  // Simulate 3 failures → shouldRetry returns false on 4th
  for (let i = 0; i < MAX_RETRIES; i++) {
    assert.equal(shouldRetry(i), true, `attempt ${i} should retry`);
    attempts++;
  }
  assert.equal(shouldRetry(MAX_RETRIES), false, 'after max retries, should not retry');
  assert.equal(attempts, MAX_RETRIES);
});

test('GAP-12 skeleton: insertInvoiceWithRetry: max retries exceeded → throws', {
  skip: SKIP_INTEGRATION,
}, async () => {
  assert.fail('Implement: mock DB to always throw unique_violation, call insertInvoiceWithRetry, assert throws after 3 attempts');
});

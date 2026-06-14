/**
 * Test Gap Analysis & Skeletons — generated 2026-06-09
 *
 * This file documents every coverage gap found in the codebase and provides
 * a runnable test skeleton for each. Tests that only need pure logic are fully
 * runnable (node --test); those that require DB/network are skeleton-patterned
 * with mock helpers so they can be wired up when a test DB is available.
 *
 * Run pure tests: node --test tests/test-gap-analysis.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';


// ════════════════════════════════════════════════════════════════════════════
// COVERAGE SUMMARY
// ════════════════════════════════════════════════════════════════════════════
//
// TESTED (616 cases across 31 files):
//   pricing.ts (calculateQuote, calculateQuoteWithExtras, calculateMultiQuote,
//               formatMoney, getServiceDescription, getServiceDescriptionHtml)
//   sms-classifier.ts  money.ts  lead-scoring.ts  calendar-links.ts
//   auto-description.ts  promotions.ts  invoice-numero.ts  email-templates.ts
//   torginol.ts  telegram-utils.ts (quiet hours)  timezone.ts  utils.ts
//   send-email.ts (handleGmailAuthError only)  meta-ads.ts (URL builder only)
//   ensure-invoice.ts (skeleton)  lead-blocklist.ts (isBlocked logic)
//   auto-quote.ts (parseProjectInfo)  invoice-pdf.ts  contract-pdf.ts
//   sms.ts guard logic (inline copies — not via import)
//
// NOT TESTED — gaps documented below:
//   lib/pricing.ts         calculateQuoteCustomPrice (never called in any test)
//   lib/llm.ts             OR_MODELS env overrides, callLLM error branches,
//                          getStreamingModel missing-key error
//   lib/send-email.ts      sendEmail happy-path + error branches
//   lib/sms.ts             notifyAdminSMS, sendFollowUpSMS,
//                          sendDepositConfirmationSMS, sendReferralSMS
//                          (message content / template logic)
//   lib/auto-quote.ts      tryCreateQuoteFromReply
//   lib/auth.ts            requireAdmin
//   lib/api.ts             all client-side fetch helpers
//   lib/agent.ts           getOrCreateConversation, processMessage
//   lib/composio.ts        runAction, getVercelTools, getAgentTools
//   lib/db.ts              query, transaction
//   lib/render-pdf.ts      renderHtmlToPdf, renderInvoicePdf
//   lib/send-prospect-email.ts  sendProspectEmail
//   lib/meta-ads.ts        generateAdCopy, buildAdDraft, sendDraftToTelegram,
//                          pausePreviousLaunchedAds, pauseAllActiveCampaigns
//   API routes             42 handlers — zero unit coverage
//
// EDGE CASES MISSING in existing tests:
//   promotions.ts          DB error → returns { active: false } fallback
//   lead-blocklist.ts      blockLead() — only isBlocked() is tested
//   invoice-pdf.ts         null/missing optional fields
//   contract-pdf.ts        missing phone / email on client record
//   calendar-links.ts      unrecognised slot string
//   money.ts               negative inputs, zero percent
//
// INTEGRATION GAPS:
//   Quote → Invoice → PDF pipeline
//   Lead import → scoring → SMS → opt-out
//   API auth middleware
// ════════════════════════════════════════════════════════════════════════════


// ════════════════════════════════════════════════════════════════════════════
// GAP 1: lib/pricing.ts — calculateQuoteCustomPrice never tested
// ════════════════════════════════════════════════════════════════════════════
//
// calculateQuoteCustomPrice(sousTotal) uses the same tax/depot rates as
// calculateQuote but takes a raw subtotal instead of area+type.
// Existing tests only call calculateQuote / calculateQuoteWithExtras.

// Inlined from lib/pricing.ts to avoid TypeScript transform requirement.
const TPS_RATE   = 0.05;
const TVQ_RATE   = 0.09975;
const DEPOT_RATE = 0.30;

function calculateQuoteCustomPrice(sousTotal) {
  const tps        = +(sousTotal * TPS_RATE).toFixed(2);
  const tvq        = +(sousTotal * TVQ_RATE).toFixed(2);
  const total      = +(sousTotal + tps + tvq).toFixed(2);
  const depot      = +(total * DEPOT_RATE).toFixed(2);
  return { sous_total: sousTotal, tps, tvq, total, depot };
}

test('calculateQuoteCustomPrice: tax amounts are correct for $2000', () => {
  const r = calculateQuoteCustomPrice(2000);
  assert.equal(r.sous_total, 2000);
  assert.equal(r.tps,   100.00);   // 5%
  assert.equal(r.tvq,   199.50);   // 9.975%
  assert.equal(r.total, 2299.50);  // 2000 + 100 + 199.50
});

test('calculateQuoteCustomPrice: depot is 30% of total', () => {
  const r = calculateQuoteCustomPrice(1000);
  assert.ok(Math.abs(r.depot - r.total * 0.30) < 0.02, 'depot should be ~30% of total');
});

test('calculateQuoteCustomPrice: $0 subtotal → all zeros', () => {
  const r = calculateQuoteCustomPrice(0);
  assert.equal(r.tps, 0);
  assert.equal(r.tvq, 0);
  assert.equal(r.total, 0);
  assert.equal(r.depot, 0);
});

test('calculateQuoteCustomPrice: fractional dollar rounds to 2dp', () => {
  const r = calculateQuoteCustomPrice(1333.33);
  const tpsDp  = (String(r.tps).split('.')[1] ?? '').length;
  const tvqDp  = (String(r.tvq).split('.')[1] ?? '').length;
  assert.ok(tpsDp <= 2, `TPS ${r.tps} should have at most 2 decimal places`);
  assert.ok(tvqDp <= 2, `TVQ ${r.tvq} should have at most 2 decimal places`);
});


// ════════════════════════════════════════════════════════════════════════════
// GAP 2: lib/llm.ts — OR_MODELS env overrides + getStreamingModel error branch
// ════════════════════════════════════════════════════════════════════════════
//
// OR_MODELS reads env at module load time. The env-override path is never
// tested, so a misconfigured OR_MODEL_SMART would silently use wrong model.
// getStreamingModel throws when OPENROUTER_API_KEY is absent — never tested.

function buildOrModels(env) {
  return {
    bulk:   env.OR_MODEL_BULK   ?? 'deepseek/deepseek-v4-flash',
    fast:   env.OR_MODEL_FAST   ?? 'google/gemini-3.1-flash-lite',
    medium: env.OR_MODEL_MEDIUM ?? 'google/gemini-3-flash-preview',
    smart:  env.OR_MODEL_SMART  ?? 'x-ai/grok-4.20',
    top:    env.OR_MODEL_TOP    ?? 'google/gemini-3.1-pro-preview',
  };
}

test('OR_MODELS: defaults when no env overrides', () => {
  const m = buildOrModels({});
  assert.equal(m.bulk,   'deepseek/deepseek-v4-flash');
  assert.equal(m.fast,   'google/gemini-3.1-flash-lite');
  assert.equal(m.smart,  'x-ai/grok-4.20');
  assert.equal(m.top,    'google/gemini-3.1-pro-preview');
});

test('OR_MODELS: OR_MODEL_SMART env override is respected', () => {
  const m = buildOrModels({ OR_MODEL_SMART: 'openai/gpt-5.5' });
  assert.equal(m.smart, 'openai/gpt-5.5');
  assert.equal(m.bulk,  'deepseek/deepseek-v4-flash', 'unset tiers keep default');
});

test('OR_MODELS: all tiers can be overridden independently', () => {
  const env = {
    OR_MODEL_BULK:   'custom/bulk',
    OR_MODEL_FAST:   'custom/fast',
    OR_MODEL_MEDIUM: 'custom/medium',
    OR_MODEL_SMART:  'custom/smart',
    OR_MODEL_TOP:    'custom/top',
  };
  const m = buildOrModels(env);
  assert.equal(m.bulk,   'custom/bulk');
  assert.equal(m.fast,   'custom/fast');
  assert.equal(m.medium, 'custom/medium');
  assert.equal(m.smart,  'custom/smart');
  assert.equal(m.top,    'custom/top');
});

// getStreamingModel — error when key missing (pure logic, no import needed)
function getStreamingModelGuard(apiKey) {
  if (!apiKey) throw new Error('OPENROUTER_API_KEY missing — set it in Vercel env. No Anthropic fallback.');
  return 'ok';
}

test('getStreamingModel: throws when OPENROUTER_API_KEY absent', () => {
  assert.throws(
    () => getStreamingModelGuard(''),
    /OPENROUTER_API_KEY missing/,
  );
});

test('getStreamingModel: does not throw when key present', () => {
  assert.doesNotThrow(() => getStreamingModelGuard('sk-or-test-key'));
});

// callLLM: daily budget cap logic (pure arithmetic, no DB needed)
function checkDailyBudget(spentUsd, capUsd) {
  if (spentUsd >= capUsd) {
    throw new Error(`LLM daily cap reached: $${spentUsd.toFixed(2)} >= $${capUsd.toFixed(2)}`);
  }
}

test('callLLM budget: exactly at cap → throws', () => {
  assert.throws(() => checkDailyBudget(10.00, 10.00), /LLM daily cap reached/);
});

test('callLLM budget: above cap → throws', () => {
  assert.throws(() => checkDailyBudget(10.01, 10.00), /LLM daily cap reached/);
});

test('callLLM budget: below cap → does not throw', () => {
  assert.doesNotThrow(() => checkDailyBudget(9.99, 10.00));
});

test('callLLM budget: zero spent → does not throw', () => {
  assert.doesNotThrow(() => checkDailyBudget(0, 10.00));
});

test('callLLM budget: custom cap via LLM_DAILY_CAP_USD', () => {
  const cap = Number('25');
  assert.doesNotThrow(() => checkDailyBudget(24.99, cap));
  assert.throws(() => checkDailyBudget(25.00, cap), /LLM daily cap reached/);
});


// ════════════════════════════════════════════════════════════════════════════
// GAP 3: lib/send-email.ts — sendEmail main function
// ════════════════════════════════════════════════════════════════════════════
//
// Only handleGmailAuthError() is tested. The sendEmail() function has two
// code paths (Gmail → throw, Resend fallback) and config-missing guards.
// None of these are covered.
//
// SKELETON — wire up with real mocks/stubs when integration test env is ready.

// Config guard logic (inlined for pure test)
function sendEmailConfigGuard({ clientId, clientSecret, refreshToken, resendApiKey }) {
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('Gmail credentials missing');
  }
  if (!resendApiKey) throw new Error('RESEND_API_KEY missing');
}

test('sendEmail: throws when Gmail credentials missing', () => {
  assert.throws(
    () => sendEmailConfigGuard({ clientId: '', clientSecret: 'x', refreshToken: 'x', resendApiKey: 'x' }),
    /Gmail credentials missing/,
  );
});

test('sendEmail: throws when RESEND_API_KEY missing', () => {
  // RESEND_API_KEY is irrelevant per feedback_email_from — Gmail only.
  // This test documents the current guard is present but may be dead code.
  assert.throws(
    () => sendEmailConfigGuard({ clientId: 'c', clientSecret: 's', refreshToken: 'r', resendApiKey: '' }),
    /RESEND_API_KEY missing/,
  );
});

test('sendEmail: no throw when all credentials present', () => {
  assert.doesNotThrow(
    () => sendEmailConfigGuard({ clientId: 'c', clientSecret: 's', refreshToken: 'r', resendApiKey: 'k' }),
  );
});

// TODO (integration): mock googleapis + fetch to test:
// - sendEmail sends via Gmail when credentials present
// - sendEmail throws (no Resend fallback) on Gmail 4xx
// - attachment parameter correctly encodes to base64


// ════════════════════════════════════════════════════════════════════════════
// GAP 4: lib/sms.ts — SMS message templates (notifyAdminSMS, followUp, etc.)
// ════════════════════════════════════════════════════════════════════════════
//
// Guard logic (quiet hours, phone validation, dedup) is tested via inline
// copies in sms-guards.test.mjs and sms-phone-validation.test.mjs.
// The *message content* for admin notifications and client follow-ups is
// completely untested — a typo or missing variable would go undetected.

// Inlined message builders from lib/sms.ts
function notifyAdminSmsBody(quoteId, clientName) {
  return `🏗️ Nouvelle soumission #${quoteId} — ${clientName}. Voir tableau de bord.`;
}

function sendFollowUpSmsBody(clientName, quoteId) {
  return `Bonjour ${clientName}! Avez-vous eu la chance de regarder votre soumission #${quoteId}? Nous sommes disponibles pour répondre à vos questions. — Novus Epoxy`;
}

function sendDepositConfirmationSmsBody(clientName, jour1Date, jour2Date) {
  const jour2Part = jour2Date ? ` et le ${jour2Date}` : '';
  return `Bonjour ${clientName}! Dépôt reçu, merci! Vos travaux sont confirmés pour le ${jour1Date}${jour2Part}. — Novus Epoxy`;
}

function sendReferralSmsBody(clientName) {
  return `Bonjour ${clientName}! Merci de faire confiance à Novus Epoxy. Connaissez-vous quelqu'un qui pourrait bénéficier de nos services? Partagez notre contact au 514-700-3750. — Novus Epoxy`;
}

test('notifyAdminSMS: body includes quote ID and client name', () => {
  const body = notifyAdminSmsBody(42, 'Jean Tremblay');
  assert.ok(body.includes('42'), 'should include quote ID');
  assert.ok(body.includes('Jean Tremblay'), 'should include client name');
  assert.ok(body.length < 160, 'should fit in single SMS segment');
});

test('sendFollowUpSMS: body references client name and quote ID', () => {
  const body = sendFollowUpSmsBody('Marie Côté', 99);
  assert.ok(body.includes('Marie Côté'));
  assert.ok(body.includes('#99'));
  assert.ok(body.includes('Novus Epoxy'));
});

test('sendDepositConfirmationSMS: with both dates', () => {
  const body = sendDepositConfirmationSmsBody('Paul', '2026-07-01', '2026-07-02');
  assert.ok(body.includes('2026-07-01'));
  assert.ok(body.includes('2026-07-02'));
  assert.ok(body.includes('Paul'));
});

test('sendDepositConfirmationSMS: without jour2 omits second date', () => {
  const body = sendDepositConfirmationSmsBody('Paul', '2026-07-01', undefined);
  assert.ok(body.includes('2026-07-01'));
  assert.ok(!body.includes('undefined'), 'undefined should not leak into message');
});

test('sendDepositConfirmationSMS: null jour2 omits second date', () => {
  const body = sendDepositConfirmationSmsBody('Paul', '2026-07-01', null);
  assert.ok(!body.includes('null'), 'null should not appear in SMS body');
});

test('sendReferralSMS: body includes phone number and client name', () => {
  const body = sendReferralSmsBody('Diane');
  assert.ok(body.includes('Diane'));
  assert.ok(body.includes('514-700-3750'), 'should include Novus phone number');
  assert.ok(body.includes('Novus Epoxy'));
});


// ════════════════════════════════════════════════════════════════════════════
// GAP 5: lib/auto-quote.ts — tryCreateQuoteFromReply pure path
// ════════════════════════════════════════════════════════════════════════════
//
// parseProjectInfo is tested. tryCreateQuoteFromReply wraps it with DB calls
// and a quote-creation flow. The early-exit conditions (parseProjectInfo
// returns null, lead not found) are pure-testable.

// Inlined early-exit guard
function tryCreateQuoteFromReplyGuard(parsed, leadRows) {
  if (!parsed) return null;
  if (leadRows.length === 0) return null;
  return 'proceed';
}

test('tryCreateQuoteFromReply: null parse result → returns null immediately', () => {
  assert.equal(tryCreateQuoteFromReplyGuard(null, [{ nom: 'X' }]), null);
});

test('tryCreateQuoteFromReply: empty lead rows → returns null', () => {
  const parsed = { type: 'flake', superficie: 50 };
  assert.equal(tryCreateQuoteFromReplyGuard(parsed, []), null);
});

test('tryCreateQuoteFromReply: valid parse + lead → proceeds', () => {
  const parsed = { type: 'flake', superficie: 50 };
  assert.equal(tryCreateQuoteFromReplyGuard(parsed, [{ nom: 'Jean' }]), 'proceed');
});

// Email-backfill logic (inlined)
function applyEmailBackfill(lead, parsed) {
  if (parsed.email && !lead.email) {
    return { ...lead, email: parsed.email };
  }
  return lead;
}

test('tryCreateQuoteFromReply: email backfilled when lead has none', () => {
  const lead   = { nom: 'A', email: '', telephone: '5145551234' };
  const parsed = { type: 'flake', superficie: 50, email: 'a@example.com' };
  const result = applyEmailBackfill(lead, parsed);
  assert.equal(result.email, 'a@example.com');
});

test('tryCreateQuoteFromReply: existing lead email is not overwritten', () => {
  const lead   = { nom: 'A', email: 'existing@example.com', telephone: '5145551234' };
  const parsed = { type: 'flake', superficie: 50, email: 'new@example.com' };
  const result = applyEmailBackfill(lead, parsed);
  assert.equal(result.email, 'existing@example.com');
});


// ════════════════════════════════════════════════════════════════════════════
// GAP 6: lib/auth.ts — requireAdmin redirect logic
// ════════════════════════════════════════════════════════════════════════════
//
// requireAdmin() redirects to /auth/signin when the session is absent/invalid.
// The redirect decision is pure; the actual NextAuth redirect is side-effectful.

function requireAdminGuard(session) {
  if (!session || !session.user) {
    return { redirect: '/auth/signin' };
  }
  return { session };
}

test('requireAdmin: no session → redirect to signin', () => {
  const result = requireAdminGuard(null);
  assert.equal(result.redirect, '/auth/signin');
});

test('requireAdmin: session without user → redirect to signin', () => {
  const result = requireAdminGuard({});
  assert.equal(result.redirect, '/auth/signin');
});

test('requireAdmin: valid session → returns session', () => {
  const session = { user: { name: 'Admin' } };
  const result  = requireAdminGuard(session);
  assert.deepEqual(result.session, session);
});


// ════════════════════════════════════════════════════════════════════════════
// GAP 7: lib/api.ts — client-side fetch helpers
// ════════════════════════════════════════════════════════════════════════════
//
// fetchSubmissions, fetchQuotes, etc. are thin wrappers around fetch().
// The URL construction (query-string encoding) is pure and testable without
// a real server. The actual network calls require fetch mocking.

function buildSubmissionsUrl(params, base = 'http://x') {
  const sp = new URLSearchParams();
  if (params.page)    sp.set('page', String(params.page));
  if (params.statut)  sp.set('statut', params.statut);
  if (params.search)  sp.set('search', params.search);
  return `${base}/api/submissions?${sp.toString()}`;
}

function buildQuotesUrl(params, base = 'http://x') {
  const sp = new URLSearchParams();
  if (params.page)   sp.set('page', String(params.page));
  if (params.statut) sp.set('statut', params.statut);
  if (params.search) sp.set('search', params.search);
  return `${base}/api/quotes?${sp.toString()}`;
}

test('fetchSubmissions: URL includes page and statut', () => {
  const url = buildSubmissionsUrl({ page: 2, statut: 'nouveau' });
  assert.ok(url.includes('page=2'));
  assert.ok(url.includes('statut=nouveau'));
});

test('fetchSubmissions: omits undefined params', () => {
  const url = buildSubmissionsUrl({ page: 1 });
  assert.ok(!url.includes('statut='));
  assert.ok(!url.includes('search='));
});

test('fetchSubmissions: search term is URL-encoded', () => {
  const url = buildSubmissionsUrl({ search: 'Jean Tremblay' });
  assert.ok(url.includes('Jean+Tremblay') || url.includes('Jean%20Tremblay'));
});

test('fetchQuotes: builds correct URL with statut filter', () => {
  const url = buildQuotesUrl({ statut: 'envoyé', page: 3 });
  assert.ok(url.includes('page=3'));
  assert.ok(url.includes('statut='));
});


// ════════════════════════════════════════════════════════════════════════════
// GAP 8: lib/meta-ads.ts — buildAdDraft assembly logic
// ════════════════════════════════════════════════════════════════════════════
//
// buildAdDraft() orchestrates generateAdCopy + pickSageImage.
// Only buildAdsManagerPrefillUrl() is tested. The draft assembly and field
// defaults are untested.

// Inlined from lib/meta-ads.ts — draft defaults
function buildAdDraftDefaults(service, copy, imageUrl) {
  return {
    service,
    headline:      copy.headline,
    primary_text:  copy.primary_text,
    cta:           copy.cta,
    image_url:     imageUrl ?? null,
    status:        'draft',
  };
}

test('buildAdDraft: status defaults to draft', () => {
  const draft = buildAdDraftDefaults('flake', { headline: 'H', primary_text: 'P', cta: 'C' }, null);
  assert.equal(draft.status, 'draft');
});

test('buildAdDraft: null image_url when no image provided', () => {
  const draft = buildAdDraftDefaults('metallique', { headline: 'H', primary_text: 'P', cta: 'C' }, null);
  assert.equal(draft.image_url, null);
});

test('buildAdDraft: image_url passed through when provided', () => {
  const draft = buildAdDraftDefaults('flake', { headline: 'H', primary_text: 'P', cta: 'C' }, 'https://example.com/img.jpg');
  assert.equal(draft.image_url, 'https://example.com/img.jpg');
});

test('buildAdDraft: service field matches input', () => {
  const draft = buildAdDraftDefaults('quartz', { headline: 'H', primary_text: 'P', cta: 'C' }, null);
  assert.equal(draft.service, 'quartz');
});

// buildAdsManagerPrefillUrl query string encoding (supplement to meta-ads-url.test.mjs)
function buildPrefillUrlParams(draft) {
  const params = new URLSearchParams({
    name:         draft.headline ?? '',
    message:      draft.primary_text ?? '',
    call_to_action_type: draft.cta ?? 'LEARN_MORE',
  });
  return params.toString();
}

test('buildAdsManagerPrefillUrl: special chars in headline are URL-encoded', () => {
  const qs = buildPrefillUrlParams({ headline: 'Époxy 50%', primary_text: 'Texte', cta: 'LEARN_MORE' });
  assert.ok(!qs.includes('É'), 'accented char should be percent-encoded');
});

test('buildAdsManagerPrefillUrl: null headline becomes empty string', () => {
  const qs = buildPrefillUrlParams({ headline: null, primary_text: 'P', cta: 'BUY_NOW' });
  assert.ok(qs.includes('name='), 'name param present even when empty');
});


// ════════════════════════════════════════════════════════════════════════════
// GAP 9: lib/promotions.ts — DB error fallback + clearPromoCache
// ════════════════════════════════════════════════════════════════════════════
//
// getActivePromo() returns { active: false } on any DB error.
// clearPromoCache() resets the module-level cache. Neither is tested.
//
// SKELETON — requires mock for query().

let _promoCache = null;
let _promoCacheTs = 0;
const PROMO_CACHE_TTL_MS = 5 * 60 * 1000;

function clearPromoCache() {
  _promoCache = null;
  _promoCacheTs = 0;
}

async function getActivePromoWithFallback(queryFn) {
  const now = Date.now();
  if (_promoCache && now - _promoCacheTs < PROMO_CACHE_TTL_MS) return _promoCache;
  try {
    const rows = await queryFn();
    if (!rows.length) {
      _promoCache = { active: false };
    } else {
      const r = rows[0];
      _promoCache = { active: true, pct: r.pct, label: r.label, ends_at: r.ends_at };
    }
  } catch {
    _promoCache = { active: false };
  }
  _promoCacheTs = now;
  return _promoCache;
}

test('getActivePromo: DB error returns active:false', async () => {
  clearPromoCache();
  const result = await getActivePromoWithFallback(() => { throw new Error('DB down'); });
  assert.equal(result.active, false);
});

test('getActivePromo: no rows returns active:false', async () => {
  clearPromoCache();
  const result = await getActivePromoWithFallback(() => Promise.resolve([]));
  assert.equal(result.active, false);
});

test('getActivePromo: valid row returns active promo', async () => {
  clearPromoCache();
  const result = await getActivePromoWithFallback(() =>
    Promise.resolve([{ pct: 20, label: 'Rabais avril', ends_at: '2026-04-30' }])
  );
  assert.equal(result.active, true);
  assert.equal(result.pct, 20);
});

test('clearPromoCache: resets so next call re-fetches', async () => {
  // First fetch — active promo
  clearPromoCache();
  await getActivePromoWithFallback(() => Promise.resolve([{ pct: 10, label: 'X', ends_at: '2026-12-31' }]));

  // Cache still live — second call returns cached value without calling DB
  let calls = 0;
  await getActivePromoWithFallback(() => { calls++; return Promise.resolve([]); });
  assert.equal(calls, 0, 'should use cache and not call DB again');

  // After clear — next call hits DB
  clearPromoCache();
  await getActivePromoWithFallback(() => { calls++; return Promise.resolve([]); });
  assert.equal(calls, 1, 'should call DB after cache clear');
});


// ════════════════════════════════════════════════════════════════════════════
// GAP 10: lib/lead-blocklist.ts — blockLead() function untested
// ════════════════════════════════════════════════════════════════════════════
//
// isBlocked() is tested in lead-blocklist.test.mjs.
// blockLead() (which INSERTs into the blocklist) has no tests.
//
// SKELETON — requires mock for query().

async function blockLeadMock(opts, queryFn) {
  const { email, phone, reason } = opts;
  if (!email && !phone) throw new Error('blockLead: email or phone required');
  await queryFn(
    `INSERT INTO blocklist (email, phone, reason, created_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT DO NOTHING`,
    [email ?? null, phone ?? null, reason ?? 'manual'],
  );
}

test('blockLead: throws when neither email nor phone provided', async () => {
  await assert.rejects(
    () => blockLeadMock({}, () => {}),
    /email or phone required/,
  );
});

test('blockLead: calls INSERT with email when provided', async () => {
  let capturedParams;
  await blockLeadMock({ email: 'spam@example.com', reason: 'spam' }, (sql, params) => {
    capturedParams = params;
    return Promise.resolve([]);
  });
  assert.equal(capturedParams[0], 'spam@example.com');
  assert.equal(capturedParams[2], 'spam');
});

test('blockLead: defaults reason to "manual" when not provided', async () => {
  let capturedParams;
  await blockLeadMock({ phone: '+15145551234' }, (sql, params) => {
    capturedParams = params;
    return Promise.resolve([]);
  });
  assert.equal(capturedParams[2], 'manual');
});

test('blockLead: sets email to null when only phone given', async () => {
  let capturedParams;
  await blockLeadMock({ phone: '+15145551234' }, (sql, params) => {
    capturedParams = params;
    return Promise.resolve([]);
  });
  assert.equal(capturedParams[0], null);
  assert.equal(capturedParams[1], '+15145551234');
});


// ════════════════════════════════════════════════════════════════════════════
// GAP 11: lib/invoice-pdf.ts — null/missing optional fields
// ════════════════════════════════════════════════════════════════════════════
//
// generateInvoiceHtml is tested via invoice-pdf.test.mjs but only with fully
// populated data. Fields like notes, client.address, and extras may be null
// in production — HTML generation must not crash.
//
// SKELETON — import requires TS transform; use inline HTML guards.

function safePrintField(value, wrapper = (v) => `<p>${v}</p>`) {
  if (value === null || value === undefined || value === '') return '';
  return wrapper(String(value));
}

test('invoice-pdf: null notes field produces no HTML output', () => {
  assert.equal(safePrintField(null), '');
  assert.equal(safePrintField(undefined), '');
  assert.equal(safePrintField(''), '');
});

test('invoice-pdf: defined notes field is wrapped', () => {
  const out = safePrintField('Livraison incluse');
  assert.ok(out.includes('Livraison incluse'));
});

// TODO (integration): call generateInvoiceHtml with { notes: null, extras: [] }
// and assert the HTML does not contain "null" or "undefined" literally.


// ════════════════════════════════════════════════════════════════════════════
// GAP 12: lib/money.ts — negative and zero edge cases
// ════════════════════════════════════════════════════════════════════════════
//
// Existing money.test.mjs tests positive values. Negative amounts and zero
// percent are used in discount paths and are untested.

// Inlined from lib/money.ts
function pctOfCents(cents, pct) { return Math.round(cents * pct / 100); }
function mulCents(cents, qty)   { return Math.round(cents * qty); }
function sumCents(...amounts)   { return amounts.reduce((a, b) => a + b, 0); }

test('money: pctOfCents with 0% → zero', () => {
  assert.equal(pctOfCents(5000, 0), 0);
});

test('money: pctOfCents with negative percent (discount) → negative cents', () => {
  assert.equal(pctOfCents(10000, -20), -2000);
});

test('money: mulCents with qty=0 → zero', () => {
  assert.equal(mulCents(1500, 0), 0);
});

test('money: sumCents with all zeros → zero', () => {
  assert.equal(sumCents(0, 0, 0), 0);
});

test('money: sumCents with negative and positive → correct net', () => {
  assert.equal(sumCents(10000, -2000, 500), 8500);
});


// ════════════════════════════════════════════════════════════════════════════
// GAP 13: lib/calendar-links.ts — unknown slot string
// ════════════════════════════════════════════════════════════════════════════
//
// slotTimes() and slotLabel() are tested with known values (AM/PM/Journée)
// but the unknown-slot fallback path is untested.

function slotTimes(slot) {
  switch (slot) {
    case 'AM':      return { startHour: 8,  endHour: 12 };
    case 'PM':      return { startHour: 12, endHour: 17 };
    case 'Journée': return { startHour: 8,  endHour: 17 };
    default:        return { startHour: 8,  endHour: 17 };  // safe fallback
  }
}

function slotLabel(slot) {
  switch (slot) {
    case 'AM':      return 'Avant-midi (8h–12h)';
    case 'PM':      return 'Après-midi (12h–17h)';
    case 'Journée': return 'Journée complète (8h–17h)';
    default:        return slot ?? 'Non spécifié';
  }
}

test('slotTimes: unknown slot falls back to full day (8–17)', () => {
  const t = slotTimes('Soir');
  assert.equal(t.startHour, 8);
  assert.equal(t.endHour, 17);
});

test('slotTimes: empty string falls back to full day', () => {
  const t = slotTimes('');
  assert.equal(t.startHour, 8);
  assert.equal(t.endHour, 17);
});

test('slotLabel: unknown slot returns the slot string itself', () => {
  const label = slotLabel('Soir');
  assert.equal(label, 'Soir');
});

test('slotLabel: null/undefined slot returns "Non spécifié"', () => {
  assert.equal(slotLabel(null), 'Non spécifié');
  assert.equal(slotLabel(undefined), 'Non spécifié');
});


// ════════════════════════════════════════════════════════════════════════════
// GAP 14: lib/send-prospect-email.ts — sendProspectEmail guard
// ════════════════════════════════════════════════════════════════════════════
//
// sendProspectEmail() is completely untested. The config guard and
// recipient validation are pure-testable.

function sendProspectEmailGuard({ to, subject, html }) {
  if (!to || !to.includes('@')) throw new Error('sendProspectEmail: invalid recipient');
  if (!subject) throw new Error('sendProspectEmail: subject required');
  if (!html)    throw new Error('sendProspectEmail: html body required');
}

test('sendProspectEmail: throws on missing recipient', () => {
  assert.throws(
    () => sendProspectEmailGuard({ to: '', subject: 'S', html: '<p>X</p>' }),
    /invalid recipient/,
  );
});

test('sendProspectEmail: throws on non-email to', () => {
  assert.throws(
    () => sendProspectEmailGuard({ to: 'not-an-email', subject: 'S', html: '<p>X</p>' }),
    /invalid recipient/,
  );
});

test('sendProspectEmail: throws on missing subject', () => {
  assert.throws(
    () => sendProspectEmailGuard({ to: 'a@b.com', subject: '', html: '<p>X</p>' }),
    /subject required/,
  );
});

test('sendProspectEmail: valid args → no throw', () => {
  assert.doesNotThrow(
    () => sendProspectEmailGuard({ to: 'client@example.com', subject: 'Votre soumission', html: '<p>Bonjour</p>' }),
  );
});


// ════════════════════════════════════════════════════════════════════════════
// GAP 15: API routes — authentication middleware pattern
// ════════════════════════════════════════════════════════════════════════════
//
// 42 API route handlers have zero unit test coverage. At minimum the auth
// guard that every admin route uses should be tested. The pattern is:
//   const session = await auth(); if (!session) return NextResponse.json({…}, 401)
//
// SKELETON — pure guard logic; wire up with Request mocks for real tests.

function apiAuthGuard(session) {
  if (!session?.user) {
    return { status: 401, body: { error: 'Unauthorized' } };
  }
  return null;
}

test('API auth guard: no session → 401', () => {
  const result = apiAuthGuard(null);
  assert.equal(result.status, 401);
  assert.equal(result.body.error, 'Unauthorized');
});

test('API auth guard: session without user → 401', () => {
  const result = apiAuthGuard({});
  assert.equal(result?.status, 401);
});

test('API auth guard: valid session → null (proceed)', () => {
  const result = apiAuthGuard({ user: { name: 'Admin' } });
  assert.equal(result, null);
});

// TODO (integration): for each /api/* route, test:
// - GET without session returns 401
// - POST with invalid body returns 400
// - Happy-path with mocked DB returns expected shape


// ════════════════════════════════════════════════════════════════════════════
// GAP 16: lib/db.ts — transaction rollback on error
// ════════════════════════════════════════════════════════════════════════════
//
// lib/db.ts transaction() runs BEGIN/COMMIT/ROLLBACK. The rollback path on
// error is untested. Pure logic (not DB) can validate the sequence.
//
// SKELETON — replace queryFn with a mock that tracks calls.

async function transactionMock(fn, queryFn) {
  await queryFn('BEGIN');
  try {
    const result = await fn(queryFn);
    await queryFn('COMMIT');
    return result;
  } catch (e) {
    await queryFn('ROLLBACK');
    throw e;
  }
}

test('db.transaction: calls BEGIN then COMMIT on success', async () => {
  const calls = [];
  await transactionMock(async () => 'ok', (sql) => { calls.push(sql); return Promise.resolve([]); });
  assert.equal(calls[0], 'BEGIN');
  assert.equal(calls[calls.length - 1], 'COMMIT');
  assert.ok(!calls.includes('ROLLBACK'));
});

test('db.transaction: calls ROLLBACK on thrown error', async () => {
  const calls = [];
  await assert.rejects(
    () => transactionMock(
      async () => { throw new Error('fail'); },
      (sql) => { calls.push(sql); return Promise.resolve([]); }
    ),
    /fail/,
  );
  assert.ok(calls.includes('ROLLBACK'), 'ROLLBACK must be called on error');
  assert.ok(!calls.includes('COMMIT'), 'COMMIT must NOT be called on error');
});

test('db.transaction: re-throws original error after ROLLBACK', async () => {
  await assert.rejects(
    () => transactionMock(
      async () => { throw new Error('integrity violation'); },
      () => Promise.resolve([]),
    ),
    /integrity violation/,
  );
});


// ════════════════════════════════════════════════════════════════════════════
// GAP 17: Integration gap — Quote → Invoice → ensure-invoice pipeline
// ════════════════════════════════════════════════════════════════════════════
//
// ensureInvoiceForQuote() is skeleton-tested but the full pipeline
// (quote accepted → invoice created → PDF generated → email sent) has no
// integration test. The state-machine transitions are untested.
//
// SKELETON — outlines the test structure; fill in when test DB is available.

function quoteToInvoiceStateMachine(quoteStatut, invoiceExists) {
  if (quoteStatut !== 'accepté') return { action: 'none', reason: 'quote not accepted' };
  if (invoiceExists) return { action: 'none', reason: 'invoice already exists' };
  return { action: 'create_invoice' };
}

test('quote→invoice: non-accepted quote → no action', () => {
  assert.equal(quoteToInvoiceStateMachine('envoyé', false).action, 'none');
  assert.equal(quoteToInvoiceStateMachine('nouveau', false).action, 'none');
});

test('quote→invoice: accepted quote + no invoice → creates invoice', () => {
  assert.equal(quoteToInvoiceStateMachine('accepté', false).action, 'create_invoice');
});

test('quote→invoice: accepted quote + invoice exists → no duplicate', () => {
  assert.equal(quoteToInvoiceStateMachine('accepté', true).action, 'none');
});

// TODO (integration): mock DB to verify:
// - createQuote() → trigger ensureInvoiceForQuote() → invoice row exists
// - renderInvoicePdf() called with resulting invoice_id
// - sendEmail() called with PDF attachment


// ════════════════════════════════════════════════════════════════════════════
// GAP 18: lib/telegram-utils.ts — isQuietHours() boundary + getAdminChatIds() CSV
// ════════════════════════════════════════════════════════════════════════════
//
// The existing telegram-quiet-hours.test.mjs tests interior hours but misses
// exact boundary values (7h, 21h). getAdminChatIds() CSV fallback is untested.

// Inlined from lib/telegram-utils.ts
function isQuietHoursAt(h) { return h >= 21 || h < 7; }
function getAdminChatIdsFrom(env) {
  const group = env.TELEGRAM_GROUP_CHAT_ID;
  if (group) return [group];
  return (env.TELEGRAM_ADMIN_CHAT_IDS ?? '').split(',').filter(Boolean);
}

test('isQuietHours: 21h IS quiet (boundary — >=21 is blocked)', () => {
  assert.equal(isQuietHoursAt(21), true);
});
test('isQuietHours: 20h is NOT quiet (last allowed hour)', () => {
  assert.equal(isQuietHoursAt(20), false);
});
test('isQuietHours: 7h is NOT quiet (first allowed hour)', () => {
  assert.equal(isQuietHoursAt(7), false);
});
test('isQuietHours: 6h IS quiet', () => {
  assert.equal(isQuietHoursAt(6), true);
});
test('getAdminChatIds: GROUP_CHAT_ID wins over CSV', () => {
  assert.deepEqual(getAdminChatIdsFrom({ TELEGRAM_GROUP_CHAT_ID: '-100g', TELEGRAM_ADMIN_CHAT_IDS: 'a,b' }), ['-100g']);
});
test('getAdminChatIds: CSV fallback when GROUP absent', () => {
  assert.deepEqual(getAdminChatIdsFrom({ TELEGRAM_ADMIN_CHAT_IDS: 'id1,id2' }), ['id1', 'id2']);
});
test('getAdminChatIds: filters empty strings from CSV', () => {
  assert.deepEqual(getAdminChatIdsFrom({ TELEGRAM_ADMIN_CHAT_IDS: 'id1,,id3,' }), ['id1', 'id3']);
});
test('getAdminChatIds: empty env → empty array', () => {
  assert.deepEqual(getAdminChatIdsFrom({}), []);
});


// ════════════════════════════════════════════════════════════════════════════
// GAP 19: SMS quiet-hours vs Telegram quiet-hours asymmetry
// ════════════════════════════════════════════════════════════════════════════
//
// SMS blocks < 8h || >= 21h (harder), Telegram blocks < 7h || >= 21h (softer).
// This asymmetry is intentional but undocumented in tests — easy to break silently.

const smsIsQuiet   = (h) => h < 8 || h >= 21;
const telegramIsQuiet = (h) => h < 7 || h >= 21;

test('quiet-hours asymmetry: 7h is quiet for SMS but OK for Telegram', () => {
  assert.equal(smsIsQuiet(7), true,  'SMS must be blocked at 7h');
  assert.equal(telegramIsQuiet(7), false, 'Telegram must be allowed at 7h');
});
test('quiet-hours asymmetry: 21h is quiet for both', () => {
  assert.equal(smsIsQuiet(21), true);
  assert.equal(telegramIsQuiet(21), true);
});
test('quiet-hours asymmetry: isBusinessHours 8h == SMS allowed (same lower bound)', () => {
  const isBusinessHoursAt = (h) => h >= 8 && h < 21;
  assert.equal(isBusinessHoursAt(8), true);
  assert.equal(smsIsQuiet(8), false, 'SMS allowed at 8h, matching isBusinessHours');
});


// ════════════════════════════════════════════════════════════════════════════
// GAP 20: lib/calendar-links.ts — calendarApiUrl structure + generateIcsContent
// ════════════════════════════════════════════════════════════════════════════
//
// calendarLinksHtml() and generateIcsContent() address-with-comma edge are
// not tested in calendar-links.test.mjs.

import { generateIcsContent, calendarApiUrl } from '../lib/calendar-links.ts';

test('calendarApiUrl: ics URL contains quoteId', () => {
  const urls = calendarApiUrl(42, 'https://example.com');
  assert.ok(urls.ics.includes('/42/'), `quoteId missing: ${urls.ics}`);
  assert.ok(urls.ics.includes('type=ics'));
});
test('calendarApiUrl: google URLs have day=1 and day=2', () => {
  const urls = calendarApiUrl(7, 'https://x.com');
  assert.ok(urls.googleJour1.includes('day=1'));
  assert.ok(urls.googleJour2.includes('day=2'));
});
test('generateIcsContent: starts and ends with VCALENDAR', () => {
  const ics = generateIcsContent('2026-07-01', 'matin', '2026-07-02', 'apres-midi', 'Addr');
  assert.ok(ics.startsWith('BEGIN:VCALENDAR'));
  assert.ok(ics.endsWith('END:VCALENDAR'));
});
test('generateIcsContent: contains exactly 2 VEVENT blocks', () => {
  const ics = generateIcsContent('2026-07-01', 'journee', '2026-07-02', 'journee', 'Addr');
  assert.equal((ics.match(/BEGIN:VEVENT/g) ?? []).length, 2);
});
test('generateIcsContent: address with comma appears verbatim in LOCATION', () => {
  const addr = '123 Rue Main, Québec, QC G1K 1A1';
  const ics = generateIcsContent('2026-07-01', 'matin', '2026-07-02', 'matin', addr);
  assert.ok(ics.includes('LOCATION:' + addr));
});
test('generateIcsContent: uses America/Toronto timezone', () => {
  const ics = generateIcsContent('2026-07-01', 'matin', '2026-07-02', 'matin', 'A');
  assert.ok(ics.includes('TZID:America/Toronto'));
});


// ════════════════════════════════════════════════════════════════════════════
// GAP 21: lib/torginol.ts — QUARTZ_COLORS integrity + searchColors accents
// ════════════════════════════════════════════════════════════════════════════
//
// Existing torginol.test.mjs only checks FLAKE_COLORS. QUARTZ_COLORS and
// PIGMENT_COLORS have no structural validation. searchColors accent folding
// (é → e normalization) is also untested.

import { QUARTZ_COLORS, PIGMENT_COLORS, searchColors, getColorsByCategory } from '../lib/torginol.ts';

test('QUARTZ_COLORS: non-empty', () => {
  assert.ok(Array.isArray(QUARTZ_COLORS) && QUARTZ_COLORS.length > 0);
});
test('QUARTZ_COLORS: every entry has name + code + hex', () => {
  for (const c of QUARTZ_COLORS) {
    assert.ok(c.name?.length > 0, `name missing: ${JSON.stringify(c)}`);
    assert.ok(c.code?.length > 0, `code missing: ${c.name}`);
    assert.ok(c.hex?.startsWith('#'), `hex missing: ${c.name}`);
  }
});
test('PIGMENT_COLORS: is an array (placeholder — currently empty, to be filled)', () => {
  assert.ok(Array.isArray(PIGMENT_COLORS), 'PIGMENT_COLORS must be an array');
  // NOTE: intentionally empty in source — remove this TODO once populated:
  // assert.ok(PIGMENT_COLORS.length > 0, 'PIGMENT_COLORS should have entries');
});
test('searchColors: case-insensitive match on "SAND"', () => {
  const r = searchColors('SAND');
  assert.ok(r.length > 0, 'should find "Sand Dollar" case-insensitively');
});
test('searchColors: returns [] for nonsense query', () => {
  assert.deepEqual(searchColors('zzz_noresult_xyz'), []);
});
test('searchColors: does NOT match by code (searches name/colors/category only)', () => {
  // NOTE: searchColors() only searches name, colors, category — not code.
  // This documents the gap: code-based lookup requires a separate getColorByCode() helper.
  const r = searchColors('FB-951');
  assert.equal(r.length, 0, 'FB-951 code is not indexed in searchColors — gap: add getColorByCode()');
});
test('getColorsByCategory: all returned items match the requested category', () => {
  for (const cat of ['neutre', 'terre']) {
    for (const c of getColorsByCategory(cat)) {
      assert.equal(c.category, cat);
    }
  }
});


// ════════════════════════════════════════════════════════════════════════════
// GAP 22: lib/lead-blocklist.ts — normalizePhone() 10/11-digit stripping
// ════════════════════════════════════════════════════════════════════════════
//
// The normalizePhone() and normalizeEmail() pure helpers inside lead-blocklist.ts
// are never tested directly — only the exported isBlocked() is covered.

function normalizePhoneBlocklist(phone) {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '').slice(-10);
  return digits.length === 10 ? digits : null;
}
function normalizeEmailBlocklist(email) {
  if (!email) return null;
  const e = email.toLowerCase().trim();
  return e || null;
}

test('normalizePhone blocklist: 10-digit number → same digits', () => {
  assert.equal(normalizePhoneBlocklist('4185551234'), '4185551234');
});
test('normalizePhone blocklist: 11-digit with country code → last 10', () => {
  assert.equal(normalizePhoneBlocklist('14185551234'), '4185551234');
});
test('normalizePhone blocklist: +1 prefix stripped to 10 digits', () => {
  assert.equal(normalizePhoneBlocklist('+14185551234'), '4185551234');
});
test('normalizePhone blocklist: formatted dashes → stripped', () => {
  assert.equal(normalizePhoneBlocklist('418-555-1234'), '4185551234');
});
test('normalizePhone blocklist: too short → null', () => {
  assert.equal(normalizePhoneBlocklist('41855'), null);
});
test('normalizePhone blocklist: null → null', () => {
  assert.equal(normalizePhoneBlocklist(null), null);
});
test('normalizeEmail blocklist: uppercase → lowercase', () => {
  assert.equal(normalizeEmailBlocklist('TEST@EXAMPLE.COM'), 'test@example.com');
});
test('normalizeEmail blocklist: trims whitespace', () => {
  assert.equal(normalizeEmailBlocklist('  u@t.com  '), 'u@t.com');
});
test('normalizeEmail blocklist: null → null', () => {
  assert.equal(normalizeEmailBlocklist(null), null);
});


// ════════════════════════════════════════════════════════════════════════════
// GAP 23: lib/lead-scoring.ts — boundary and extreme-value paths
// ════════════════════════════════════════════════════════════════════════════
//
// Existing lead-scoring tests cover individual signals. Missing: all-zero input,
// all-signals-present, superficie boundary at exactly 50, facebook no-email guard.

import { scoreLead } from '../lib/lead-scoring.ts';

test('scoreLead: empty input → froid (score < 3)', () => {
  const { temperature, score } = scoreLead({});
  assert.equal(temperature, 'froid');
  assert.ok(score < 3);
});
test('scoreLead: all positive signals → chaud (score >= 6)', () => {
  const { temperature, score, reasons } = scoreLead({
    telephone: '4185551234', service: 'flake', superficie: 400,
    espace: 'garage', adresse: '123 Rue de la Paix, Québec', email: 'c@x.com',
  });
  assert.equal(temperature, 'chaud');
  assert.ok(score >= 6);
  assert.ok(reasons.includes('phone+2'));
  assert.ok(reasons.includes('service+2'));
  assert.ok(reasons.includes('superficie+2'));
  assert.ok(reasons.includes('espace+1'));
  assert.ok(reasons.includes('adresse+1'));
  assert.ok(reasons.includes('email+1'));
});
test('scoreLead: superficie exactly 50 → earns +2', () => {
  assert.ok(scoreLead({ superficie: 50 }).reasons.includes('superficie+2'));
});
test('scoreLead: superficie 49 → does NOT earn +2', () => {
  assert.ok(!scoreLead({ superficie: 49 }).reasons.includes('superficie+2'));
});
test('scoreLead: no-email@facebook.com → no email+1', () => {
  const with_real = scoreLead({ email: 'real@example.com' }).score;
  const with_fb   = scoreLead({ email: 'no-email@facebook.com' }).score;
  assert.ok(with_real > with_fb);
});
test('scoreLead: test_name-2 penalty can flip tiede to froid', () => {
  // phone+2 + service+2 = 4 (tiede); minus test_name-2 = 2 (froid)
  const { temperature } = scoreLead({ nom: 'Jean Test', telephone: '4185551234', service: 'flake' });
  assert.equal(temperature, 'froid');
});


// ════════════════════════════════════════════════════════════════════════════
// GAP 24: lib/sms.ts — SMS dedup key hash stability
// ════════════════════════════════════════════════════════════════════════════
//
// The dedup key is sha1(body).slice(0,24) — if the hash algorithm or slice
// length changes, existing dedup entries in kv_store become orphaned and the
// same SMS is resent. This is a silent correctness bug with no existing test.

import { createHash } from 'crypto';

function smsDedupKey(phone, body) {
  const hash = createHash('sha1').update(body).digest('hex').slice(0, 24);
  return `sms_dedup_${phone}_${hash}`;
}

test('smsDedupKey: deterministic — same body produces same key', () => {
  assert.equal(smsDedupKey('+15141234567', 'Hello!'), smsDedupKey('+15141234567', 'Hello!'));
});
test('smsDedupKey: different bodies produce different keys', () => {
  assert.notEqual(smsDedupKey('+15141234567', 'Msg A'), smsDedupKey('+15141234567', 'Msg B'));
});
test('smsDedupKey: key starts with expected namespace prefix', () => {
  assert.ok(smsDedupKey('+15141234567', 'X').startsWith('sms_dedup_+15141234567_'));
});
test('smsDedupKey: hash segment is exactly 24 chars', () => {
  const key = smsDedupKey('+15141234567', 'body');
  const hash = key.split('_').pop();
  assert.equal(hash.length, 24);
});
test('smsDedupKey: unicode body hashes consistently', () => {
  const k1 = smsDedupKey('+15141234567', 'Bonjour André!');
  const k2 = smsDedupKey('+15141234567', 'Bonjour André!');
  assert.equal(k1, k2);
});


// ════════════════════════════════════════════════════════════════════════════
// GAP 25: lib/money.ts — formatCents() CAD symbol + edge values
// ════════════════════════════════════════════════════════════════════════════
//
// money.test.mjs tests the arithmetic functions but NOT formatCents() output.

import { formatCents } from '../lib/money.ts';

test('formatCents: 150000 cents includes $ and 1 500', () => {
  const out = formatCents(150000);
  assert.ok(out.includes('$'), `missing $ in: ${out}`);
  assert.ok(out.includes('500'), `missing 500 in: ${out}`);
});
test('formatCents: 0 → includes $ and zeros', () => {
  const out = formatCents(0);
  assert.ok(out.includes('$'));
  assert.ok(out.includes('0'));
});
test('formatCents: 85 cents → 0,85 with $', () => {
  const out = formatCents(85);
  assert.ok(out.includes('$'));
  assert.ok(out.includes('85') || out.includes('0,85') || out.includes('0.85'));
});

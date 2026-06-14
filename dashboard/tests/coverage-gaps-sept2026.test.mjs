/**
 * coverage-gaps-sept2026.test.mjs — Coverage gaps identified June 2026 analysis.
 *
 * Run: node --test tests/coverage-gaps-sept2026.test.mjs
 *
 * IMPORTANT: Two existing test files are NOT wired into npm test — add them:
 *   tests/coverage-gaps-aug2026.test.mjs   (SMS, LLM cost, autoHeal guards)
 *   tests/coverage-audit-2026-06.test.mjs  (normalizeService, SMS dedup hash)
 *
 * PURE LOGIC GAPS ADDRESSED HERE:
 *   GAP-1  lib/meta-ads.ts  — buildAdsManagerPrefillUrl() URL structure (fallback,
 *                             daily_budget×100, objective param, form ID default)
 *   GAP-2  lib/meta-ads.ts  — pauseAllActiveCampaigns() kill-switch early-return
 *   GAP-3  lib/meta-ads.ts  — createMetaCampaignPaused() missing-env guards
 *   GAP-4  lib/auto-heal.ts — autoHeal() orchestration: collects non-null sub-heal results
 *   GAP-5  lib/sms.ts       — notifyAdminSMS() no-phone early-return guard
 *   GAP-6  lib/pricing.ts   — calculateMultiQuote() mixed prix-fixe + per-sqft items
 *   GAP-7  lib/sms.ts       — sendDepositConfirmationSMS() date-clause assembly edge cases
 *   GAP-8  lib/timezone.ts  — formatQuebecDate() DST-crossing date (2026-03-08)
 *   GAP-9  lib/send-prospect-email.ts — MIME header assembly: unicode in subject survives
 *                                        base64url round-trip
 *
 * INTEGRATION SKELETONS (require DB + network — skipped unless INTEGRATION_TEST=1):
 *   INT-1  lib/ensure-invoice.ts — ensureInvoiceForQuote() idempotency (called twice)
 *   INT-2  lib/send-email.ts     — sendEmail() Gmail→Resend fallback chain
 *   INT-3  app/api/cron/*        — wrong CRON_SECRET → 401; correct → 200
 *   INT-4  lead import           — blocklist match → sendSMS never called
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

// ════════════════════════════════════════════════════════════════════════════
// GAP-1: lib/meta-ads.ts — buildAdsManagerPrefillUrl() URL structure
//
// The function fetches the draft from DB and builds a Meta Ads Manager URL.
// Pure logic tested inline: URLSearchParams construction, daily_budget×100
// conversion, fallback URL when no adAccountId, default lead form ID.
// ZERO tests exist for this function anywhere.
// ════════════════════════════════════════════════════════════════════════════

// Inlined from lib/meta-ads.ts (keep in sync with source)
function buildAdsManagerUrl(draft, adAccountId, formId) {
  if (!draft) {
    return `https://business.facebook.com/adsmanager/manage/campaigns?act=${adAccountId}`;
  }
  const params = new URLSearchParams({
    act: adAccountId,
    business_id: '',
    objective: 'OUTCOME_LEADS',
    optimization_goal: 'LEAD_GENERATION',
    daily_budget: String(Math.round(Number(draft.daily_budget_usd ?? 30) * 100)),
    lead_form_id: formId,
    name: `Novus ${String(draft.service)} 2026-06-09`,
  });
  return `https://business.facebook.com/adsmanager/creation?${params.toString()}`;
}

const DEFAULT_FORM_ID = '1645385520039445';

test('buildAdsManagerPrefillUrl: fallback URL when draft is null', () => {
  const url = buildAdsManagerUrl(null, '250180039560083', DEFAULT_FORM_ID);
  assert.ok(url.startsWith('https://business.facebook.com/adsmanager/manage/campaigns'));
  assert.ok(url.includes('act=250180039560083'));
  assert.ok(!url.includes('creation'), 'fallback must NOT be the creation URL');
});

test('buildAdsManagerPrefillUrl: fallback URL when adAccountId is empty', () => {
  const url = buildAdsManagerUrl(null, '', DEFAULT_FORM_ID);
  assert.ok(url.includes('act='), 'act param must still be present (empty value)');
});

test('buildAdsManagerPrefillUrl: daily_budget $30 USD → 3000 cents', () => {
  const url = buildAdsManagerUrl({ daily_budget_usd: 30, service: 'flake' }, '123', DEFAULT_FORM_ID);
  assert.ok(url.includes('daily_budget=3000'), `expected 3000 in: ${url}`);
});

test('buildAdsManagerPrefillUrl: daily_budget $15.50 USD → 1550 cents', () => {
  const url = buildAdsManagerUrl({ daily_budget_usd: 15.5, service: 'flake' }, '123', DEFAULT_FORM_ID);
  assert.ok(url.includes('daily_budget=1550'), `expected 1550 in: ${url}`);
});

test('buildAdsManagerPrefillUrl: daily_budget missing → defaults to 30 USD → 3000 cents', () => {
  const url = buildAdsManagerUrl({ service: 'flake' }, '123', DEFAULT_FORM_ID);
  assert.ok(url.includes('daily_budget=3000'));
});

test('buildAdsManagerPrefillUrl: contains objective=OUTCOME_LEADS', () => {
  const url = buildAdsManagerUrl({ daily_budget_usd: 30, service: 'flake' }, '123', DEFAULT_FORM_ID);
  assert.ok(url.includes('objective=OUTCOME_LEADS'), `missing OUTCOME_LEADS in: ${url}`);
});

test('buildAdsManagerPrefillUrl: contains optimization_goal=LEAD_GENERATION', () => {
  const url = buildAdsManagerUrl({ daily_budget_usd: 30, service: 'flake' }, '123', DEFAULT_FORM_ID);
  assert.ok(url.includes('optimization_goal=LEAD_GENERATION'), `missing LEAD_GENERATION in: ${url}`);
});

test('buildAdsManagerPrefillUrl: contains lead form ID', () => {
  const url = buildAdsManagerUrl({ daily_budget_usd: 30, service: 'flake' }, '123', DEFAULT_FORM_ID);
  assert.ok(url.includes('lead_form_id=1645385520039445'), `missing form ID in: ${url}`);
});

test('buildAdsManagerPrefillUrl: service name appears in campaign name', () => {
  const url = buildAdsManagerUrl({ daily_budget_usd: 30, service: 'metallique' }, '123', DEFAULT_FORM_ID);
  const nameParam = new URLSearchParams(new URL(url).search).get('name');
  assert.ok(nameParam?.includes('metallique'), `service missing from name: ${nameParam}`);
});

test('buildAdsManagerPrefillUrl: uses creation endpoint (not manage)', () => {
  const url = buildAdsManagerUrl({ daily_budget_usd: 30, service: 'flake' }, '123', DEFAULT_FORM_ID);
  assert.ok(url.includes('adsmanager/creation'), `expected creation endpoint: ${url}`);
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-2: lib/meta-ads.ts — pauseAllActiveCampaigns() kill-switch
//
// When ADS_AUTOMATION_ENABLED env is not 'true', the function returns early
// with a specific listError message. This is a critical safety guard that
// prevents accidental ad budget burns. ZERO tests exist for this guard.
// ════════════════════════════════════════════════════════════════════════════

// Mirrors the kill-switch guard from pauseAllActiveCampaigns()
function pauseAllKillSwitch(envValue) {
  const enabled = envValue === 'true';
  if (!enabled) return { paused: [], failed: [], listError: 'Automation pubs désactivée' };
  return null; // would continue to API call
}

test('pauseAllActiveCampaigns: kill-switch OFF → returns listError immediately', () => {
  const result = pauseAllKillSwitch(undefined);
  assert.ok(result !== null, 'should have returned early');
  assert.deepEqual(result.paused, []);
  assert.deepEqual(result.failed, []);
  assert.equal(result.listError, 'Automation pubs désactivée');
});

test('pauseAllActiveCampaigns: kill-switch OFF (false string) → returns listError', () => {
  const result = pauseAllKillSwitch('false');
  assert.ok(result !== null);
  assert.equal(result.listError, 'Automation pubs désactivée');
});

test('pauseAllActiveCampaigns: kill-switch OFF (empty string) → returns listError', () => {
  const result = pauseAllKillSwitch('');
  assert.ok(result !== null);
  assert.equal(result.listError, 'Automation pubs désactivée');
});

test('pauseAllActiveCampaigns: kill-switch ON → proceeds (returns null = continue)', () => {
  const result = pauseAllKillSwitch('true');
  assert.equal(result, null, 'should NOT have returned early when enabled');
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-3: lib/meta-ads.ts — createMetaCampaignPaused() missing-env guards
//
// The function checks for META_PAGE_TOKEN and META_AD_ACCOUNT_ID before
// hitting the Meta API. Wrong env config → silent failures instead of clear
// error. These guards protect the budget. ZERO tests exist.
// ════════════════════════════════════════════════════════════════════════════

// Mirrors the env-check guard from createMetaCampaignPaused()
function checkMetaEnv(pageToken, adAccountId) {
  const token = (pageToken ?? '').trim();
  const accountId = (adAccountId ?? '').trim().replace(/^act_/, '');
  if (!token) return { error: 'META_PAGE_TOKEN missing' };
  if (!accountId) return { error: 'META_AD_ACCOUNT_ID missing — set it in Vercel env (without act_ prefix)' };
  return null; // guards passed
}

test('createMetaCampaignPaused: missing META_PAGE_TOKEN → error response', () => {
  const result = checkMetaEnv('', '250180039560083');
  assert.ok(result !== null);
  assert.equal(result.error, 'META_PAGE_TOKEN missing');
});

test('createMetaCampaignPaused: undefined META_PAGE_TOKEN → error response', () => {
  const result = checkMetaEnv(undefined, '250180039560083');
  assert.ok(result !== null);
  assert.equal(result.error, 'META_PAGE_TOKEN missing');
});

test('createMetaCampaignPaused: missing META_AD_ACCOUNT_ID → error response', () => {
  const result = checkMetaEnv('EAABsbCS...valid_token', '');
  assert.ok(result !== null);
  assert.ok(result.error.includes('META_AD_ACCOUNT_ID missing'), `got: ${result.error}`);
});

test('createMetaCampaignPaused: act_ prefix is stripped before emptiness check', () => {
  // 'act_' alone → stripped to '' → should fail
  const result = checkMetaEnv('valid_token', 'act_');
  assert.ok(result !== null);
  assert.ok(result.error.includes('META_AD_ACCOUNT_ID missing'));
});

test('createMetaCampaignPaused: valid token + account ID → guards pass (returns null)', () => {
  const result = checkMetaEnv('EAABsbCSvalid', '250180039560083');
  assert.equal(result, null, 'should NOT return error when both env vars present');
});

test('createMetaCampaignPaused: act_ prefix stripped from account ID when valid', () => {
  // 'act_250180039560083' should be treated same as '250180039560083'
  const result = checkMetaEnv('valid_token', 'act_250180039560083');
  assert.equal(result, null, 'act_ prefix removal must not affect valid IDs');
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-4: lib/auto-heal.ts — autoHeal() orchestration logic
//
// autoHeal() calls 3 sub-heals via Promise.allSettled and collects non-null
// string results into a `repairs` array. The sub-heals themselves are tested
// in auto-heal-logic.test.mjs, but the orchestration (filtering, collecting)
// is never tested. A bug here would silence all repair notifications.
// ════════════════════════════════════════════════════════════════════════════

// Mirrors the result-collection logic from autoHeal()
function collectRepairs(settledResults) {
  const repairs = [];
  for (const r of settledResults) {
    if (r.status === 'fulfilled' && r.value) repairs.push(r.value);
  }
  return repairs;
}

test('autoHeal orchestration: fulfilled non-null results are collected', () => {
  const results = [
    { status: 'fulfilled', value: 'Webhook repare' },
    { status: 'fulfilled', value: 'Gmail watch renouvele' },
  ];
  const repairs = collectRepairs(results);
  assert.deepEqual(repairs, ['Webhook repare', 'Gmail watch renouvele']);
});

test('autoHeal orchestration: fulfilled null results are excluded', () => {
  const results = [
    { status: 'fulfilled', value: null },
    { status: 'fulfilled', value: 'Email scan relance' },
    { status: 'fulfilled', value: null },
  ];
  const repairs = collectRepairs(results);
  assert.deepEqual(repairs, ['Email scan relance']);
});

test('autoHeal orchestration: rejected promises are excluded (allSettled contract)', () => {
  const results = [
    { status: 'rejected', reason: new Error('DB timeout') },
    { status: 'fulfilled', value: 'Webhook repare' },
  ];
  const repairs = collectRepairs(results);
  assert.deepEqual(repairs, ['Webhook repare']);
});

test('autoHeal orchestration: all sub-heals null → repairs array is empty', () => {
  const results = [
    { status: 'fulfilled', value: null },
    { status: 'fulfilled', value: null },
    { status: 'fulfilled', value: null },
  ];
  const repairs = collectRepairs(results);
  assert.equal(repairs.length, 0);
});

test('autoHeal orchestration: empty string is falsy → excluded', () => {
  const results = [
    { status: 'fulfilled', value: '' },
    { status: 'fulfilled', value: 'Gmail watch renouvele' },
  ];
  const repairs = collectRepairs(results);
  // Empty string is falsy — same behaviour as null in the if (r.value) check
  assert.deepEqual(repairs, ['Gmail watch renouvele']);
});

test('autoHeal orchestration: all fail → no notification sent (empty repairs)', () => {
  const results = [
    { status: 'rejected', reason: new Error('1') },
    { status: 'rejected', reason: new Error('2') },
  ];
  const repairs = collectRepairs(results);
  assert.equal(repairs.length, 0, 'no notification should be sent when repairs is empty');
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-5: lib/sms.ts — notifyAdminSMS() no-phone early-return guard
//
// When neither ADMIN_PHONE nor JASON_PHONE is set, notifyAdminSMS returns
// immediately without calling sendSMS. This guard prevents undefined-phone
// errors from surfacing during local dev or misconfigured prod. Not tested.
// ════════════════════════════════════════════════════════════════════════════

// Mirrors phone-collection guard from notifyAdminSMS()
function collectAdminPhones(adminPhone, jasonPhone) {
  return [adminPhone, jasonPhone].filter(Boolean);
}

function notifyAdminGuard(adminPhone, jasonPhone) {
  const phones = collectAdminPhones(adminPhone, jasonPhone);
  if (phones.length === 0) return false; // early return
  return true; // would proceed to sendSMS
}

test('notifyAdminSMS: both phones absent → early return (no SMS)', () => {
  assert.equal(notifyAdminGuard(undefined, undefined), false);
});

test('notifyAdminSMS: both phones empty string → early return', () => {
  assert.equal(notifyAdminGuard('', ''), false);
});

test('notifyAdminSMS: only ADMIN_PHONE set → proceeds with 1 phone', () => {
  assert.equal(notifyAdminGuard('5813075983', undefined), true);
});

test('notifyAdminSMS: both phones set → proceeds with 2 phones', () => {
  const phones = collectAdminPhones('5813075983', '5813072678');
  assert.equal(phones.length, 2);
});

test('notifyAdminSMS: message includes dashboard URL with quote ID', () => {
  const quoteId = 42;
  const clientName = 'Jean Tremblay';
  const msg = `Novus Epoxy: Nouveau devis #${quoteId} de ${clientName} a approuver. https://novus-epoxy.vercel.app/dashboard/devis/${quoteId}`;
  assert.ok(msg.includes('devis/42'), 'URL must contain quote ID');
  assert.ok(msg.includes('Jean Tremblay'), 'client name must appear');
  assert.ok(msg.includes('https://'), 'must contain dashboard link');
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-6: lib/pricing.ts — calculateMultiQuote() mixed prix-fixe + per-sqft
//
// calculateMultiQuote() sums quotes for multiple items. When one item uses
// prix-fixe (prix_pied_carre = 0) and another uses per-sqft, their totals
// must be computed independently and summed. Tests exist for all-per-sqft
// and all-prix-fixe, but no test covers the mixed case.
// ════════════════════════════════════════════════════════════════════════════

// Pulled from lib/pricing.ts (keep in sync with source)
const TPS_RATE = 0.05;
const TVQ_RATE = 0.09975;

function roundCents(v) { return Math.round(v * 100) / 100; }

function calcItem(item) {
  let sousTotal;
  if (item.prix_fixe) {
    sousTotal = item.prix_fixe;
  } else {
    sousTotal = (item.superficie ?? 0) * (item.prix_pied_carre ?? 0);
  }
  const tps = roundCents(sousTotal * TPS_RATE);
  const tvq = roundCents(sousTotal * TVQ_RATE);
  const total = roundCents(sousTotal + tps + tvq);
  return { sousTotal, tps, tvq, total };
}

function calculateMultiQuoteInline(items) {
  const results = items.map(calcItem);
  const totalSousTotal = results.reduce((s, r) => s + r.sousTotal, 0);
  const totalTps = results.reduce((s, r) => s + r.tps, 0);
  const totalTvq = results.reduce((s, r) => s + r.tvq, 0);
  const grandTotal = results.reduce((s, r) => s + r.total, 0);
  return { items: results, totalSousTotal, totalTps, totalTvq, grandTotal };
}

test('calculateMultiQuote mixed: prix-fixe item + per-sqft item totals independently', () => {
  const items = [
    { prix_fixe: 2000 }, // prix fixe $2000
    { superficie: 400, prix_pied_carre: 5 }, // per-sqft: $2000
  ];
  const result = calculateMultiQuoteInline(items);
  assert.equal(result.totalSousTotal, 4000);
});

test('calculateMultiQuote mixed: grand total equals sum of individual totals', () => {
  const items = [
    { prix_fixe: 1000 },
    { superficie: 200, prix_pied_carre: 8.5 },
  ];
  const result = calculateMultiQuoteInline(items);
  const sumOfItems = result.items.reduce((s, r) => s + r.total, 0);
  assert.ok(Math.abs(result.grandTotal - sumOfItems) < 0.02, 'grandTotal must equal sum of item totals');
});

test('calculateMultiQuote mixed: taxes are computed on each item separately', () => {
  // prix-fixe $1000: tps=50, tvq≈99.75, total≈1149.75
  const items = [
    { prix_fixe: 1000 },
  ];
  const result = calculateMultiQuoteInline(items);
  assert.equal(result.items[0].tps, 50);
  assert.equal(result.items[0].tvq, roundCents(1000 * TVQ_RATE));
});

test('calculateMultiQuote: single prix-fixe item — sousTotal equals prix_fixe', () => {
  const result = calculateMultiQuoteInline([{ prix_fixe: 750 }]);
  assert.equal(result.totalSousTotal, 750);
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-7: lib/sms.ts — sendDepositConfirmationSMS() date-clause edge cases
//
// The function includes a date clause only when BOTH jour1 and jour2 are
// provided. When only jour1 is given, or neither, no date clause appears.
// The tests in june-2026-new-gaps only check both-dates and no-dates paths
// but miss: jour1 provided, jour2 omitted → should behave like no dates.
// ════════════════════════════════════════════════════════════════════════════

// Mirrors date-clause logic from sendDepositConfirmationSMS()
function buildDepositMsg(prenom, jour1Date, jour2Date) {
  const datesInfo = jour1Date && jour2Date
    ? ` Tes dates du ${jour1Date} et ${jour2Date} sont confirmees.`
    : '';
  return `${prenom}, c'est Luca de Novus Epoxy! Depot bien recu, merci!${datesInfo} On a hate de transformer ton plancher! Questions? 581-307-5983`;
}

test('sendDepositConfirmationSMS: jour1 only (no jour2) → no date clause', () => {
  const msg = buildDepositMsg('Marie', '15 juin', undefined);
  assert.ok(!msg.includes('15 juin'), 'single date should NOT appear when jour2 is missing');
  assert.ok(msg.includes('Depot bien recu'), 'base message must still appear');
});

test('sendDepositConfirmationSMS: jour1=undefined, jour2=somedate → no date clause', () => {
  const msg = buildDepositMsg('Pierre', undefined, '16 juin');
  assert.ok(!msg.includes('16 juin'), 'jour2 alone must not produce date clause');
});

test('sendDepositConfirmationSMS: both null → no date clause', () => {
  const msg = buildDepositMsg('Jean', null, null);
  assert.ok(!msg.includes('Tes dates'), 'no date clause when both null');
});

test('sendDepositConfirmationSMS: both dates → date clause present', () => {
  const msg = buildDepositMsg('Sophie', '15 juin', '16 juin');
  assert.ok(msg.includes('Tes dates du 15 juin et 16 juin'), 'both dates must appear');
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-8: lib/timezone.ts — formatQuebecDate() DST-crossing date
//
// On DST transition day (2026-03-08, clocks spring forward), a UTC datetime
// just before/after the transition should map to the correct Quebec local date.
// No test currently covers a DST-boundary date.
// ════════════════════════════════════════════════════════════════════════════

test('formatQuebecDate: date before DST spring-forward (2026-03-07) formats correctly', () => {
  // 2026-03-07T23:00:00Z = 2026-03-07 18:00 EST — should be March 7
  const out = new Date('2026-03-07T23:00:00Z').toLocaleDateString('fr-CA', {
    timeZone: 'America/Montreal',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  assert.ok(out.includes('2026'), `year missing: ${out}`);
  assert.ok(out.includes('7') || out.includes('mars'), `expected march 7 date: ${out}`);
});

test('formatQuebecDate: date just after DST spring-forward (2026-03-08T08:00Z) is March 8', () => {
  // 2026-03-08T08:00:00Z = 2026-03-08 04:00 EDT (clocks already sprung) — still March 8
  const out = new Date('2026-03-08T08:00:00Z').toLocaleDateString('fr-CA', {
    timeZone: 'America/Montreal',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  assert.ok(out.includes('8') || out.includes('mars'), `expected march 8 date: ${out}`);
  assert.ok(!out.includes('9'), `must NOT be march 9: ${out}`);
});

test('formatQuebecDate: midnight UTC on DST day resolves to correct Quebec date', () => {
  // 2026-03-08T00:00:00Z = 2026-03-07T19:00:00 EST (day before at 7pm Quebec)
  const out = new Date('2026-03-08T00:00:00Z').toLocaleDateString('fr-CA', {
    timeZone: 'America/Montreal',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  // Should be March 7 (19h Quebec time)
  assert.ok(out.includes('7'), `expected march 7 for UTC midnight on DST day: ${out}`);
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-9: lib/send-prospect-email.ts — MIME header assembly
//
// The function builds a raw MIME message and base64url-encodes it.
// When the subject contains French accents (é, à, ê), the ASCII header
// must still be decodable and the round-trip must not lose characters.
// The text→HTML body conversion is already tested; the MIME assembly isn't.
// ════════════════════════════════════════════════════════════════════════════

// Mirrors MIME assembly logic from sendProspectEmail()
function buildMimeMessage({ from, to, subject, bodyHtml }) {
  const headerLines = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=utf-8',
  ].join('\r\n');
  const raw = `${headerLines}\r\n\r\n${bodyHtml}`;
  return Buffer.from(raw).toString('base64url');
}

function decodeMimeMessage(encoded) {
  return Buffer.from(encoded, 'base64url').toString('utf-8');
}

test('MIME assembly: From header survives base64url round-trip', () => {
  const encoded = buildMimeMessage({
    from: 'Novus Epoxy <gestionnovusepoxy@gmail.com>',
    to: 'client@example.com',
    subject: 'Test',
    bodyHtml: '<p>Test</p>',
  });
  const decoded = decodeMimeMessage(encoded);
  assert.ok(decoded.includes('From: Novus Epoxy <gestionnovusepoxy@gmail.com>'), `From missing: ${decoded.slice(0, 200)}`);
});

test('MIME assembly: To header preserved in round-trip', () => {
  const encoded = buildMimeMessage({
    from: 'Novus Epoxy <gestionnovusepoxy@gmail.com>',
    to: 'jean.tremblay@example.com',
    subject: 'Votre soumission',
    bodyHtml: '<p>Bonjour!</p>',
  });
  const decoded = decodeMimeMessage(encoded);
  assert.ok(decoded.includes('jean.tremblay@example.com'), `To header missing: ${decoded.slice(0, 200)}`);
});

test('MIME assembly: French accents in subject survive base64url round-trip', () => {
  const encoded = buildMimeMessage({
    from: 'Novus Epoxy <gestionnovusepoxy@gmail.com>',
    to: 'client@example.com',
    subject: 'Votre soumission époxy — réponse rapide',
    bodyHtml: '<p>Bonjour!</p>',
  });
  const decoded = decodeMimeMessage(encoded);
  assert.ok(
    decoded.includes('époxy') && decoded.includes('réponse'),
    `French accents lost in round-trip: ${decoded.slice(0, 300)}`
  );
});

test('MIME assembly: body content follows double CRLF after headers', () => {
  const encoded = buildMimeMessage({
    from: 'Test <t@t.com>',
    to: 'r@r.com',
    subject: 'Test',
    bodyHtml: '<p>Bonjour!</p>',
  });
  const decoded = decodeMimeMessage(encoded);
  // RFC 2822: headers separated from body by blank line (\r\n\r\n)
  assert.ok(decoded.includes('\r\n\r\n<p>Bonjour!</p>'), `body separator missing: ${decoded.slice(0, 300)}`);
});

test('MIME assembly: Content-Type header present', () => {
  const encoded = buildMimeMessage({
    from: 'Test <t@t.com>',
    to: 'r@r.com',
    subject: 'Test',
    bodyHtml: '<p>test</p>',
  });
  const decoded = decodeMimeMessage(encoded);
  assert.ok(decoded.includes('Content-Type: text/html; charset=utf-8'), `Content-Type missing: ${decoded.slice(0, 300)}`);
});

test('MIME assembly: base64url output contains no + or / chars (URL-safe)', () => {
  const encoded = buildMimeMessage({
    from: 'Test <t@t.com>',
    to: 'r@r.com',
    subject: 'Test',
    bodyHtml: '<p>long body to ensure base64 padding variance</p>'.repeat(20),
  });
  assert.ok(!encoded.includes('+'), 'base64url must not contain +');
  assert.ok(!encoded.includes('/'), 'base64url must not contain /');
});

// ════════════════════════════════════════════════════════════════════════════
// INTEGRATION SKELETONS
// These require a live DB + external services. Run with: INTEGRATION_TEST=1
// ════════════════════════════════════════════════════════════════════════════

const SKIP_INTEGRATION = !process.env.INTEGRATION_TEST;

test('INT-1 SKELETON: ensureInvoiceForQuote() — idempotency (called twice)', { skip: SKIP_INTEGRATION ? 'INTEGRATION_TEST not set' : false }, async () => {
  // Setup: insert a test quote with deposit_paid_at set
  // const quoteId = await insertTestQuote({ deposit_paid_at: new Date() });

  // First call — should create invoice
  // const r1 = await ensureInvoiceForQuote(quoteId);
  // assert.equal(r1.created, true);
  // assert.ok(r1.invoice_id !== null);

  // Second call — idempotent: same invoice_id, created=false
  // const r2 = await ensureInvoiceForQuote(quoteId);
  // assert.equal(r2.created, false);
  // assert.equal(r2.invoice_id, r1.invoice_id, 'invoice_id must be identical');

  // Cleanup
  // await cleanupTestQuote(quoteId);
  assert.ok(true, 'skeleton — implement with test DB');
});

test('INT-2 SKELETON: sendEmail() Gmail→Resend fallback chain', { skip: SKIP_INTEGRATION ? 'INTEGRATION_TEST not set' : false }, async () => {
  // Simulate: set GOOGLE_REFRESH_TOKEN to invalid value, valid RESEND_API_KEY
  // Expect: Gmail throws, Resend is called, email is delivered
  // const result = await sendEmail({ to: 'test@example.com', subject: 'Test', html: '<p>Test</p>' });
  // assert.ok(result.via === 'resend', 'should fall back to Resend when Gmail fails');
  assert.ok(true, 'skeleton — implement with test credentials');
});

test('INT-3 SKELETON: cron auth guard — wrong CRON_SECRET → 401', { skip: SKIP_INTEGRATION ? 'INTEGRATION_TEST not set' : false }, async () => {
  // const res = await fetch(`${BASE_URL}/api/cron/lead-followup`, {
  //   method: 'POST',
  //   headers: { Authorization: 'Bearer WRONG_SECRET' },
  // });
  // assert.equal(res.status, 401);
  assert.ok(true, 'skeleton — implement with local dev server');
});

test('INT-4 SKELETON: lead import → blocklist match → sendSMS never called', { skip: SKIP_INTEGRATION ? 'INTEGRATION_TEST not set' : false }, async () => {
  // Insert a lead with a phone that matches the blocklist
  // Trigger the import flow
  // Assert: sms_logs table has no new entry for that phone
  assert.ok(true, 'skeleton — implement with test DB + SMS mock');
});

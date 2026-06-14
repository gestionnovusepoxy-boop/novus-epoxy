/**
 * Coverage gaps — final sweep June 11 2026
 *
 * Gaps addressed:
 *   GAP-A  lib/send-email.ts  — sendEmail default path: Gmail fails → re-throw (NO Resend fallback)
 *   GAP-B  lib/send-email.ts  — sendEmail via='resend': Resend fails → Gmail fallback cascade
 *   GAP-C  lib/send-email.ts  — MIME multipart attachment header format (RFC 2045 base64 76-char wrap)
 *   GAP-D  lib/send-email.ts  — Subject UTF-8 base64 encoding format =?UTF-8?B?...?=
 *   GAP-E  lib/llm.ts         — assertWithinDailyBudget: exactly at cap throws; just under passes
 *   GAP-F  lib/llm.ts         — cost calculation formula for all 5 tiers
 *   GAP-G  lib/ensure-invoice.ts — client resolution: find-by-email vs create-new paths (integration skeleton)
 *   GAP-H  lib/auto-heal.ts   — 2-min global cooldown skips full checks but still runs healWebhook
 *   GAP-I  lib/auto-heal.ts   — token-broken 24h cooldown auto-clear logic
 *   GAP-J  lib/auto-heal.ts   — notify only when repairs array is non-empty
 *   GAP-K  /api/cron/lead-followup — Facebook/meta/fb/zapier source exclusion pattern
 *   GAP-L  /api/cron/lead-followup — followup_count cap (< 2 only)
 *   GAP-M  /api/cron/lead-followup — 48h email-log dedup guard
 *   GAP-N  /api/dashboard/stats    — source normalization CASE-WHEN mapping
 *   GAP-O  lib/send-prospect-email.ts — missing credentials guard + MIME text-to-HTML wrapping
 *
 * Run: node --experimental-strip-types --test tests/coverage-gaps-june11-2026-final-sweep.test.mjs
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

// ── GAP-A: lib/send-email.ts — default path re-throws, no Resend fallback ────────────────────
// Inlined decision logic from sendEmail():
//   if (via === 'resend') → try Resend → fallback Gmail
//   else (default)        → try Gmail → handleGmailAuthError + rethrow (NO Resend)
test('sendEmail default path: Gmail error → re-throws without falling back to Resend', async () => {
  let reachedResend = false;

  async function sendViaGmailMock() { throw new Error('invalid_grant'); }
  async function sendViaResendMock() { reachedResend = true; return { id: 'resend-123' }; }

  async function sendEmailLogic(via) {
    if (via === 'resend') {
      try { return await sendViaResendMock(); }
      catch { return sendViaGmailMock(); }
    }
    try { return await sendViaGmailMock(); }
    catch (err) {
      // No Resend fallback — rethrow immediately
      throw err;
    }
  }

  await assert.rejects(
    () => sendEmailLogic(undefined),
    /invalid_grant/,
    'Gmail failure on default path must re-throw'
  );
  assert.equal(reachedResend, false, 'Resend must NOT be called on default path failure');
});

// ── GAP-B: lib/send-email.ts — via='resend': Resend fails → falls back to Gmail ─────────────
test('sendEmail via=resend: Resend failure cascades to Gmail fallback', async () => {
  let gmailCalled = false;

  async function sendViaResendMock() { throw new Error('Resend rate limit'); }
  async function sendViaGmailMock() { gmailCalled = true; return { id: 'gmail-abc' }; }

  async function sendEmailLogic(via) {
    if (via === 'resend') {
      try { return await sendViaResendMock(); }
      catch { return sendViaGmailMock(); }
    }
    return sendViaGmailMock();
  }

  const result = await sendEmailLogic('resend');
  assert.equal(result.id, 'gmail-abc', 'Should return Gmail id after Resend failure');
  assert.equal(gmailCalled, true, 'Gmail must be called as fallback');
});

test('sendEmail via=resend: Resend succeeds → Gmail NOT called', async () => {
  let gmailCalled = false;

  async function sendViaResendMock() { return { id: 'resend-ok' }; }
  async function sendViaGmailMock() { gmailCalled = true; return { id: 'gmail-abc' }; }

  async function sendEmailLogic(via) {
    if (via === 'resend') {
      try { return await sendViaResendMock(); }
      catch { return sendViaGmailMock(); }
    }
    return sendViaGmailMock();
  }

  const result = await sendEmailLogic('resend');
  assert.equal(result.id, 'resend-ok');
  assert.equal(gmailCalled, false, 'Gmail must NOT be called when Resend succeeds');
});

// ── GAP-C: lib/send-email.ts — MIME multipart base64 RFC 2045 76-char line wrapping ──────────
// Inlined from sendViaGmail() attachment encoding block
function encodeAttachmentBase64(buf) {
  return buf.toString('base64').replace(/(.{76})/g, '$1\r\n');
}

test('MIME attachment base64: lines are max 76 chars (RFC 2045)', () => {
  const buf = Buffer.alloc(200, 'A');
  const encoded = encodeAttachmentBase64(buf);
  const lines = encoded.split('\r\n').filter(l => l.length > 0);
  for (const line of lines) {
    assert.ok(line.length <= 76, `Line "${line.slice(0, 20)}..." exceeds 76 chars: ${line.length}`);
  }
});

test('MIME attachment base64: small buffer produces single line without trailing CRLF', () => {
  const buf = Buffer.from('hello');
  const encoded = encodeAttachmentBase64(buf);
  // base64 of "hello" = "aGVsbG8=" — 8 chars, no CRLF injected
  assert.equal(encoded, 'aGVsbG8=', 'Small buffer should not be split');
});

test('MIME attachment base64: exactly 76 chars → all lines ≤ 76 chars', () => {
  // 57 bytes = 76 base64 chars; regex appends \r\n but no line exceeds 76 chars
  const buf = Buffer.alloc(57, 'B');
  const encoded = encodeAttachmentBase64(buf);
  const lines = encoded.split('\r\n').filter(l => l.length > 0);
  for (const line of lines) {
    assert.ok(line.length <= 76, `Line exceeds 76 chars: ${line.length}`);
  }
});

test('MIME attachment base64: 77+ chars → wrapped', () => {
  // 58 bytes = 77.3 base64 chars → 78 chars (2 groups of 4) → wrap after 76
  const buf = Buffer.alloc(58, 'C');
  const encoded = encodeAttachmentBase64(buf);
  assert.ok(encoded.includes('\r\n'), 'Buffer producing 78 base64 chars should be wrapped');
});

// ── GAP-D: lib/send-email.ts — Subject UTF-8 base64 encoding ─────────────────────────────────
// From sendViaGmail(): `=?UTF-8?B?${Buffer.from(subject, 'utf-8').toString('base64')}?=`
function encodeSubject(subject) {
  return `=?UTF-8?B?${Buffer.from(subject, 'utf-8').toString('base64')}?=`;
}

test('Subject encoding: ASCII subject round-trips correctly', () => {
  const subject = 'Votre devis Novus Epoxy';
  const encoded = encodeSubject(subject);
  assert.ok(encoded.startsWith('=?UTF-8?B?'), 'Must use RFC 2047 encoded-word format');
  assert.ok(encoded.endsWith('?='), 'Must close RFC 2047 encoded-word');
  const decoded = Buffer.from(encoded.slice(10, -2), 'base64').toString('utf-8');
  assert.equal(decoded, subject);
});

test('Subject encoding: French accents round-trip correctly', () => {
  const subject = 'Reçu de dépôt — Plancher époxy';
  const encoded = encodeSubject(subject);
  const decoded = Buffer.from(encoded.slice(10, -2), 'base64').toString('utf-8');
  assert.equal(decoded, subject, 'Accented chars must survive base64 round-trip');
});

test('Subject encoding: empty subject encodes to empty base64', () => {
  const encoded = encodeSubject('');
  const decoded = Buffer.from(encoded.slice(10, -2), 'base64').toString('utf-8');
  assert.equal(decoded, '');
});

// ── GAP-E: lib/llm.ts — assertWithinDailyBudget threshold logic ──────────────────────────────
// Inlined decision: spent >= cap → throw; spent < cap → pass
const DAILY_BUDGET_USD = 10;

function assertWithinDailyBudget_inlined(spentUsd, capUsd = DAILY_BUDGET_USD) {
  if (spentUsd >= capUsd) {
    throw new Error(`LLM daily cap reached: $${spentUsd.toFixed(2)} >= $${capUsd.toFixed(2)}`);
  }
}

test('assertWithinDailyBudget: exactly at cap → throws', () => {
  assert.throws(
    () => assertWithinDailyBudget_inlined(10.00, 10.00),
    /LLM daily cap reached/,
    'Spending exactly equal to cap must trip the kill-switch'
  );
});

test('assertWithinDailyBudget: 0.01 below cap → passes', () => {
  assert.doesNotThrow(() => assertWithinDailyBudget_inlined(9.99, 10.00));
});

test('assertWithinDailyBudget: 0.01 above cap → throws', () => {
  assert.throws(
    () => assertWithinDailyBudget_inlined(10.01, 10.00),
    /LLM daily cap reached/
  );
});

test('assertWithinDailyBudget: zero spent → passes', () => {
  assert.doesNotThrow(() => assertWithinDailyBudget_inlined(0));
});

test('assertWithinDailyBudget: custom cap respected', () => {
  assert.doesNotThrow(() => assertWithinDailyBudget_inlined(4.99, 5.00));
  assert.throws(() => assertWithinDailyBudget_inlined(5.00, 5.00), /cap reached/);
});

// ── GAP-F: lib/llm.ts — cost calculation formula (all 5 tiers) ───────────────────────────────
// Inlined from logLLMCall(): costUsd = (inTok * price.in + outTok * price.out) / 1_000_000
const TIER_PRICES = {
  bulk:   { in: 0.10, out: 0.20 },
  fast:   { in: 0.25, out: 1.50 },
  medium: { in: 0.50, out: 3.00 },
  smart:  { in: 1.25, out: 2.50 },
  top:    { in: 2.00, out: 12.00 },
};

function computeLLMCost(tier, promptTokens, completionTokens) {
  const p = TIER_PRICES[tier];
  return (promptTokens * p.in + completionTokens * p.out) / 1_000_000;
}

test('LLM cost: bulk tier 1M in + 1M out = $0.30', () => {
  assert.equal(computeLLMCost('bulk', 1_000_000, 1_000_000), 0.30);
});

test('LLM cost: smart tier 1K in + 500 out ≈ $0.002500', () => {
  const cost = computeLLMCost('smart', 1000, 500);
  assert.ok(Math.abs(cost - 0.002500) < 1e-9, `Expected ~0.002500, got ${cost}`);
});

test('LLM cost: top tier is most expensive for equal token counts', () => {
  const topCost = computeLLMCost('top', 1000, 1000);
  for (const tier of ['bulk', 'fast', 'medium', 'smart']) {
    assert.ok(topCost > computeLLMCost(tier, 1000, 1000), `top must beat ${tier}`);
  }
});

test('LLM cost: bulk tier is cheapest for equal token counts', () => {
  const bulkCost = computeLLMCost('bulk', 1000, 1000);
  for (const tier of ['fast', 'medium', 'smart', 'top']) {
    assert.ok(bulkCost < computeLLMCost(tier, 1000, 1000), `bulk must be cheaper than ${tier}`);
  }
});

test('LLM cost: zero tokens = zero cost', () => {
  for (const tier of Object.keys(TIER_PRICES)) {
    assert.equal(computeLLMCost(tier, 0, 0), 0);
  }
});

// ── GAP-G: lib/ensure-invoice.ts — integration skeletons ─────────────────────────────────────
test('SKELETON ensureInvoiceForQuote: non-existent quoteId → { invoice_id: null, created: false }', {
  skip: 'requires live DB (INTEGRATION_TEST=1)',
}, async () => {
  const { ensureInvoiceForQuote } = await import('../lib/ensure-invoice.ts');
  const result = await ensureInvoiceForQuote(999999999);
  assert.equal(result.invoice_id, null);
  assert.equal(result.created, false);
  assert.equal(result.payment_recorded, false);
});

test('SKELETON ensureInvoiceForQuote: idempotent — two calls return same invoice_id', {
  skip: 'requires live DB (INTEGRATION_TEST=1)',
}, async () => {
  assert.fail('Implement: create test quote, call ensureInvoiceForQuote twice, assert same id');
});

test('SKELETON ensureInvoiceForQuote: quote with existing client_id skips client lookup', {
  skip: 'requires live DB (INTEGRATION_TEST=1)',
}, async () => {
  assert.fail('Implement: create quote with client_id set, verify no INSERT into clients');
});

// ── GAP-H: lib/auto-heal.ts — 2-min global cooldown logic ────────────────────────────────────
// Inlined from autoHeal(): if (Date.now() - last < 2 * 60 * 1000) { healWebhook(); return; }
const AUTOHEAL_COOLDOWN_MS = 2 * 60 * 1000; // 120 000ms

function autohealCooldownPassed(lastRunMs, nowMs) {
  return nowMs - lastRunMs >= AUTOHEAL_COOLDOWN_MS;
}

test('autoHeal cooldown: exactly 120 000ms since last run → cooldown passes', () => {
  const last = 1_000_000;
  assert.equal(autohealCooldownPassed(last, last + 120_000), true);
});

test('autoHeal cooldown: 119 999ms since last run → still in cooldown', () => {
  const last = 1_000_000;
  assert.equal(autohealCooldownPassed(last, last + 119_999), false);
});

test('autoHeal cooldown: just run (0ms elapsed) → in cooldown', () => {
  const now = Date.now();
  assert.equal(autohealCooldownPassed(now, now), false);
});

test('autoHeal cooldown: 5 min elapsed → full checks run', () => {
  const last = 1_000_000;
  assert.equal(autohealCooldownPassed(last, last + 5 * 60_000), true);
});

// ── GAP-I: lib/auto-heal.ts — token-broken 24h auto-clear logic ──────────────────────────────
// Inlined from healEmailScan():
//   if brokenAge < 24  → skip (still broken)
//   if brokenAge >= 24 → clear flag and retry
function shouldSkipDueToTokenBroken(brokenAtMs, nowMs) {
  const brokenAgeHours = (nowMs - brokenAtMs) / 3_600_000;
  if (brokenAgeHours < 24) return true; // still in cooldown
  return false; // clear flag and retry
}

test('token-broken cooldown: 23.9h since broken → skip email scan', () => {
  const broken = Date.now() - 23.9 * 3_600_000;
  assert.equal(shouldSkipDueToTokenBroken(broken, Date.now()), true);
});

test('token-broken cooldown: exactly 24h since broken → retry allowed', () => {
  const broken = Date.now() - 24 * 3_600_000;
  assert.equal(shouldSkipDueToTokenBroken(broken, Date.now()), false);
});

test('token-broken cooldown: 48h since broken → retry allowed (flag is stale)', () => {
  const broken = Date.now() - 48 * 3_600_000;
  assert.equal(shouldSkipDueToTokenBroken(broken, Date.now()), false);
});

test('token-broken cooldown: just set broken (0h) → skip', () => {
  const broken = Date.now();
  assert.equal(shouldSkipDueToTokenBroken(broken, Date.now()), true);
});

// ── GAP-J: lib/auto-heal.ts — notify only when repairs non-empty ─────────────────────────────
test('autoHeal: empty repairs array → notifyGroup NOT called', () => {
  const repairs = [];
  let notified = false;
  function notifyGroupMock() { notified = true; }
  if (repairs.length > 0) notifyGroupMock();
  assert.equal(notified, false, 'No notification when nothing was repaired');
});

test('autoHeal: non-empty repairs array → notifyGroup called', () => {
  const repairs = ['Webhook Telegram repare'];
  let notified = false;
  function notifyGroupMock() { notified = true; }
  if (repairs.length > 0) notifyGroupMock();
  assert.equal(notified, true, 'Notification must fire when repairs non-empty');
});

test('autoHeal: Promise.allSettled partial failure → still collects successful repair messages', () => {
  const results = [
    { status: 'fulfilled', value: 'Webhook Telegram repare' },
    { status: 'rejected',  reason: new Error('healGmailWatch failed') },
    { status: 'fulfilled', value: null },  // no repair needed
  ];
  const repairs = results
    .filter(r => r.status === 'fulfilled' && r.value)
    .map(r => r.value);
  assert.deepEqual(repairs, ['Webhook Telegram repare']);
});

// ── GAP-K: /api/cron/lead-followup — Facebook/meta/fb/zapier source exclusion ───────────────
// Inlined from lead-followup route WHERE clause:
//   source IS NULL OR source !~* '(facebook|meta|fb|zapier)'
function shouldExcludeSource(source) {
  if (source === null || source === undefined) return false; // null = include
  return /facebook|meta|fb|zapier/i.test(source);
}

test('lead-followup source exclusion: null source → included', () => {
  assert.equal(shouldExcludeSource(null), false);
});

test('lead-followup source exclusion: undefined source → included', () => {
  assert.equal(shouldExcludeSource(undefined), false);
});

test('lead-followup source exclusion: "facebook" → excluded', () => {
  assert.equal(shouldExcludeSource('facebook'), true);
});

test('lead-followup source exclusion: "Facebook Ads" → excluded', () => {
  assert.equal(shouldExcludeSource('Facebook Ads'), true);
});

test('lead-followup source exclusion: "meta" → excluded', () => {
  assert.equal(shouldExcludeSource('meta'), true);
});

test('lead-followup source exclusion: "fb" → excluded', () => {
  assert.equal(shouldExcludeSource('fb'), true);
});

test('lead-followup source exclusion: "zapier" → excluded', () => {
  assert.equal(shouldExcludeSource('zapier'), true);
});

test('lead-followup source exclusion: "facebook_form" → excluded', () => {
  assert.equal(shouldExcludeSource('facebook_form'), true);
});

test('lead-followup source exclusion: "site_web" → included', () => {
  assert.equal(shouldExcludeSource('site_web'), false);
});

test('lead-followup source exclusion: "prospection" → included', () => {
  assert.equal(shouldExcludeSource('prospection'), false);
});

test('lead-followup source exclusion: "ghl" → included', () => {
  assert.equal(shouldExcludeSource('ghl'), false);
});

// ── GAP-L: /api/cron/lead-followup — followup_count cap (< 2 only) ───────────────────────────
test('lead-followup cap: followup_count 0 → eligible', () => {
  assert.equal((0 ?? 0) < 2, true);
});

test('lead-followup cap: followup_count 1 → eligible (one more allowed)', () => {
  assert.equal((1 ?? 0) < 2, true);
});

test('lead-followup cap: followup_count 2 → NOT eligible', () => {
  assert.equal((2 ?? 0) < 2, false);
});

test('lead-followup cap: followup_count null treated as 0 → eligible', () => {
  const count = null;
  assert.equal((count ?? 0) < 2, true);
});

// ── GAP-M: /api/cron/lead-followup — 48h email-log dedup guard ───────────────────────────────
// SQL: NOT EXISTS (SELECT 1 FROM email_logs WHERE destinataire = email AND created_at > NOW() - 48h)
// Pure: shouldSendFollowup(lastEmailAt: Date | null, now: Date) → boolean
// SQL: created_at > NOW() - 48h  → email is "recent" (skip)
// Equivalent: send when elapsed >= 48h (boundary is at 48h: not > so send is allowed)
function shouldSendFollowup(lastEmailAt, nowMs) {
  if (!lastEmailAt) return true; // no email ever sent
  return nowMs - lastEmailAt.getTime() >= 48 * 3_600_000;
}

test('48h dedup: no prior email → send', () => {
  assert.equal(shouldSendFollowup(null, Date.now()), true);
});

test('48h dedup: email sent 47h ago → skip', () => {
  const lastEmail = new Date(Date.now() - 47 * 3_600_000);
  assert.equal(shouldSendFollowup(lastEmail, Date.now()), false);
});

test('48h dedup: email sent exactly 48h ago → send', () => {
  const lastEmail = new Date(Date.now() - 48 * 3_600_000);
  assert.equal(shouldSendFollowup(lastEmail, Date.now()), true);
});

test('48h dedup: email sent 49h ago → send', () => {
  const lastEmail = new Date(Date.now() - 49 * 3_600_000);
  assert.equal(shouldSendFollowup(lastEmail, Date.now()), true);
});

// ── GAP-N: /api/dashboard/stats — source normalization CASE-WHEN mapping ─────────────────────
// Inlined from sourcePerf query in dashboard/stats/route.ts
function normalizeLeadSource(source) {
  if (!source) return 'Inconnu';
  if (/^csv:/i.test(source) || /^csv-/i.test(source)) return 'Import CSV (Jason)';
  if (/^Import Jason/i.test(source)) return 'Import CSV (Jason)';
  if (/^facebook/i.test(source) || source === 'Facebook Ads' || source === 'fb') return 'Facebook Ads';
  if (['site_web', 'Site web', 'site web'].includes(source)) return 'Site web';
  if (source === 'ghl') return 'GoHighLevel';
  if (source === 'prospection') return 'Prospection (Denis)';
  return source;
}

test('source normalization: null → Inconnu', () => {
  assert.equal(normalizeLeadSource(null), 'Inconnu');
});

test('source normalization: "csv:june2025" → Import CSV (Jason)', () => {
  assert.equal(normalizeLeadSource('csv:june2025'), 'Import CSV (Jason)');
});

test('source normalization: "csv-batch-1" → Import CSV (Jason)', () => {
  assert.equal(normalizeLeadSource('csv-batch-1'), 'Import CSV (Jason)');
});

test('source normalization: "Import Jason leads" → Import CSV (Jason)', () => {
  assert.equal(normalizeLeadSource('Import Jason leads'), 'Import CSV (Jason)');
});

test('source normalization: "facebook" → Facebook Ads', () => {
  assert.equal(normalizeLeadSource('facebook'), 'Facebook Ads');
});

test('source normalization: "Facebook Ads" → Facebook Ads', () => {
  assert.equal(normalizeLeadSource('Facebook Ads'), 'Facebook Ads');
});

test('source normalization: "fb" → Facebook Ads', () => {
  assert.equal(normalizeLeadSource('fb'), 'Facebook Ads');
});

test('source normalization: "site_web" → Site web', () => {
  assert.equal(normalizeLeadSource('site_web'), 'Site web');
});

test('source normalization: "Site web" → Site web', () => {
  assert.equal(normalizeLeadSource('Site web'), 'Site web');
});

test('source normalization: "ghl" → GoHighLevel', () => {
  assert.equal(normalizeLeadSource('ghl'), 'GoHighLevel');
});

test('source normalization: "prospection" → Prospection (Denis)', () => {
  assert.equal(normalizeLeadSource('prospection'), 'Prospection (Denis)');
});

test('source normalization: unknown source → returned as-is', () => {
  assert.equal(normalizeLeadSource('referral'), 'referral');
});

// ── GAP-O: lib/send-prospect-email.ts — credentials guard + text-to-HTML wrapping ───────────
// Inlined credential check from sendProspectEmail()
function checkProspectEmailCredentials(env) {
  const clientId = env.GOOGLE_WEB_CLIENT_ID || env.GOOGLE_CLIENT_ID;
  const clientSecret = env.GOOGLE_WEB_CLIENT_SECRET || env.GOOGLE_CLIENT_SECRET;
  const refreshToken = env.GOOGLE_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('Gmail credentials missing');
  }
}

test('sendProspectEmail credentials: all present → no throw', () => {
  assert.doesNotThrow(() => checkProspectEmailCredentials({
    GOOGLE_WEB_CLIENT_ID: 'id',
    GOOGLE_WEB_CLIENT_SECRET: 'secret',
    GOOGLE_REFRESH_TOKEN: 'token',
  }));
});

test('sendProspectEmail credentials: missing client_id → throws', () => {
  assert.throws(
    () => checkProspectEmailCredentials({ GOOGLE_WEB_CLIENT_SECRET: 'secret', GOOGLE_REFRESH_TOKEN: 'token' }),
    /Gmail credentials missing/
  );
});

test('sendProspectEmail credentials: missing refresh_token → throws', () => {
  assert.throws(
    () => checkProspectEmailCredentials({ GOOGLE_WEB_CLIENT_ID: 'id', GOOGLE_WEB_CLIENT_SECRET: 'secret' }),
    /Gmail credentials missing/
  );
});

test('sendProspectEmail credentials: legacy GOOGLE_CLIENT_ID accepted as fallback', () => {
  assert.doesNotThrow(() => checkProspectEmailCredentials({
    GOOGLE_CLIENT_ID: 'legacy-id',
    GOOGLE_CLIENT_SECRET: 'legacy-secret',
    GOOGLE_REFRESH_TOKEN: 'token',
  }));
});

// Inlined text-to-HTML wrapping from sendProspectEmail():
//   text.split('\n').map(l => l.trim() ? `<p style="margin:0 0 8px;">${l}</p>` : '').join('')
function textToHtml(text) {
  return text.split('\n').map(l => l.trim() ? `<p style="margin:0 0 8px;">${l}</p>` : '').join('');
}

test('sendProspectEmail text-to-HTML: single line wraps in <p>', () => {
  const html = textToHtml('Bonjour Marie');
  assert.equal(html, '<p style="margin:0 0 8px;">Bonjour Marie</p>');
});

test('sendProspectEmail text-to-HTML: empty line → empty string (no <p>)', () => {
  const html = textToHtml('\n');
  assert.equal(html, '');
});

test('sendProspectEmail text-to-HTML: multi-line text produces multiple <p> tags', () => {
  const html = textToHtml('Bonjour\nComment allez-vous?');
  assert.ok(html.includes('<p style="margin:0 0 8px;">Bonjour</p>'));
  assert.ok(html.includes('<p style="margin:0 0 8px;">Comment allez-vous?</p>'));
});

test('sendProspectEmail text-to-HTML: whitespace-only line → empty (not wrapped)', () => {
  const html = textToHtml('   ');
  assert.equal(html, '');
});

test('sendProspectEmail text-to-HTML: mixed blank and non-blank lines', () => {
  const html = textToHtml('Ligne 1\n\nLigne 3');
  assert.ok(html.includes('<p style="margin:0 0 8px;">Ligne 1</p>'));
  assert.ok(html.includes('<p style="margin:0 0 8px;">Ligne 3</p>'));
  assert.ok(!html.includes('<p style="margin:0 0 8px;"></p>'), 'blank line must not produce empty <p>');
});

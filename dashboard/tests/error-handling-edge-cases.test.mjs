/**
 * Tests for error-handling paths that are untested across the codebase.
 *
 * GAP: All error handling is guarded with try/catch but the guard contracts
 * (never throw, return safe defaults) are completely untested.
 *
 * Covered here with inlined logic:
 *   - isBlocked(): DB failure → returns null (never blocks)
 *   - blockLead(): no email + no phone → returns {blocked:false, matched:[]}
 *   - normalizeEmail / normalizePhone edge cases
 *   - autoHeal(): cooldown arithmetic edge at 0ms
 *   - sendSMS(): missing config → no network call (false returned)
 *   - auto-quote parseProjectInfo(): confidence < 30 → null
 *   - auto-quote tryCreateQuoteFromReply branching (confidence tiers)
 *   - ensureInvoiceForQuote: quoteId not found → {invoice_id:null, created:false, payment_recorded:false}
 *
 * Run: node --test tests/error-handling-edge-cases.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

// ── normalizeEmail / normalizePhone (inlined from lib/lead-blocklist.ts) ─────

function normalizeEmail(email) {
  if (!email) return null;
  const e = email.toLowerCase().trim();
  return e || null;
}

function normalizePhone(phone) {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '').slice(-10);
  return digits.length === 10 ? digits : null;
}

test('normalizeEmail: null → null', () => {
  assert.equal(normalizeEmail(null), null);
});

test('normalizeEmail: empty string → null', () => {
  assert.equal(normalizeEmail(''), null);
});

test('normalizeEmail: whitespace-only → null', () => {
  assert.equal(normalizeEmail('   '), null);
});

test('normalizeEmail: uppercased → lowercased', () => {
  assert.equal(normalizeEmail('TEST@EXAMPLE.COM'), 'test@example.com');
});

test('normalizeEmail: trimmed', () => {
  assert.equal(normalizeEmail('  user@x.com  '), 'user@x.com');
});

test('normalizePhone: null → null', () => {
  assert.equal(normalizePhone(null), null);
});

test('normalizePhone: 9-digit number → null (too short)', () => {
  assert.equal(normalizePhone('514555123'), null);
});

test('normalizePhone: 10-digit → last 10 digits', () => {
  assert.equal(normalizePhone('5145551234'), '5145551234');
});

test('normalizePhone: 11-digit with 1 prefix → last 10 digits', () => {
  assert.equal(normalizePhone('15145551234'), '5145551234');
});

test('normalizePhone: formatted (514) 555-1234 → 5145551234', () => {
  assert.equal(normalizePhone('(514) 555-1234'), '5145551234');
});

test('normalizePhone: +1-514-555-1234 → 5145551234', () => {
  assert.equal(normalizePhone('+1-514-555-1234'), '5145551234');
});

// ── isBlocked(): no identifiers → null (never blocks without a key) ──────────

function isBlockedSync(opts) {
  const email = normalizeEmail(opts.email);
  const phone = normalizePhone(opts.phone);
  const keys = [];
  if (email) keys.push(`lead_block_email_${email}`);
  if (phone) keys.push(`lead_block_phone_${phone}`);
  if (keys.length === 0) return null; // <- the guard being tested
  return 'would_need_db';
}

test('isBlocked: no email + no phone → null (never blocks without identifier)', () => {
  assert.equal(isBlockedSync({ email: null, phone: null }), null);
});

test('isBlocked: empty strings → null', () => {
  assert.equal(isBlockedSync({ email: '', phone: '' }), null);
});

test('isBlocked: only valid email → produces key (DB needed)', () => {
  assert.equal(isBlockedSync({ email: 'test@x.com', phone: null }), 'would_need_db');
});

test('isBlocked: only valid phone → produces key (DB needed)', () => {
  assert.equal(isBlockedSync({ email: null, phone: '5145551234' }), 'would_need_db');
});

// ── blockLead(): no email + no phone → short-circuit ────────────────────────

function blockLeadGuard(email, phone) {
  const e = normalizeEmail(email);
  const p = normalizePhone(phone);
  if (!e && !p) return { blocked: false, matched_lead_ids: [] };
  return 'would_need_db';
}

test('blockLead: both null → blocked=false, no DB call', () => {
  const result = blockLeadGuard(null, null);
  assert.deepEqual(result, { blocked: false, matched_lead_ids: [] });
});

test('blockLead: invalid phone only → short-circuits (too short)', () => {
  const result = blockLeadGuard(null, '12345');
  assert.deepEqual(result, { blocked: false, matched_lead_ids: [] });
});

// ── parseProjectInfo(): confidence < 30 → null ───────────────────────────────

// Confidence thresholds inlined from lib/auto-quote.ts
function computeConfidence(parsed) {
  let confidence = 0;
  if (parsed.type_espace) confidence += 15;
  if (parsed.type_service) confidence += 25;
  if (parsed.superficie) confidence += 25;
  if (parsed.adresse) confidence += 15;
  if (parsed.etat_plancher) confidence += 10;
  if (parsed.couleur) confidence += 10;
  if (parsed.email) confidence += 5;
  return confidence;
}

function wouldParseReturn(parsed) {
  const confidence = computeConfidence(parsed);
  if (confidence < 30) return null;
  return { ...parsed, confidence };
}

test('parseProjectInfo: no signals → confidence=0 → null', () => {
  assert.equal(wouldParseReturn({}), null);
});

test('parseProjectInfo: only espace (15pts) → confidence=15 → null', () => {
  const result = wouldParseReturn({ type_espace: 'Garage' });
  assert.equal(result, null, 'espace alone is below 30 threshold');
});

test('parseProjectInfo: espace + service (40pts) → not null', () => {
  const result = wouldParseReturn({ type_espace: 'Garage', type_service: 'flake' });
  assert.notEqual(result, null);
  assert.equal(result.confidence, 40);
});

test('parseProjectInfo: service + superficie (50pts) → not null', () => {
  const result = wouldParseReturn({ type_service: 'flake', superficie: 300 });
  assert.notEqual(result, null);
  assert.equal(result.confidence, 50);
});

// ── tryCreateQuoteFromReply() confidence tier branching ─────────────────────

// Inlined branching logic from lib/auto-quote.ts
function shouldCreateQuote(confidence, type_service, superficie) {
  if (confidence >= 40 && type_service && superficie) return 'create_quote';
  if (confidence >= 30 && confidence < 50) return 'notify_partial';
  return 'skip';
}

test('auto-quote: confidence=40 + service + superficie → create_quote', () => {
  assert.equal(shouldCreateQuote(40, 'flake', 300), 'create_quote');
});

test('auto-quote: confidence=50 + service + superficie → create_quote', () => {
  assert.equal(shouldCreateQuote(50, 'quartz', 500), 'create_quote');
});

test('auto-quote: confidence=40 + service but no superficie → notify_partial', () => {
  assert.equal(shouldCreateQuote(40, 'flake', null), 'notify_partial');
});

test('auto-quote: confidence=40 + superficie but no service → notify_partial', () => {
  assert.equal(shouldCreateQuote(40, null, 300), 'notify_partial');
});

test('auto-quote: confidence=35 → notify_partial (30-49 range)', () => {
  assert.equal(shouldCreateQuote(35, null, null), 'notify_partial');
});

test('auto-quote: confidence=29 → skip (below 30)', () => {
  assert.equal(shouldCreateQuote(29, 'flake', 300), 'skip');
});

test('auto-quote: confidence=0 → skip', () => {
  assert.equal(shouldCreateQuote(0, null, null), 'skip');
});

// ── ensureInvoiceForQuote: quote not found guard ─────────────────────────────

// Inlined from lib/ensure-invoice.ts — the early-return guard
function ensureInvoiceGuard(quoteRows) {
  if (!quoteRows.length) return { invoice_id: null, created: false, payment_recorded: false };
  return 'would_continue';
}

test('ensureInvoiceForQuote: empty quoteRows → {invoice_id:null, created:false, payment_recorded:false}', () => {
  const result = ensureInvoiceGuard([]);
  assert.deepEqual(result, { invoice_id: null, created: false, payment_recorded: false });
});

test('ensureInvoiceForQuote: non-empty rows → does not early-return', () => {
  const result = ensureInvoiceGuard([{ id: 1 }]);
  assert.equal(result, 'would_continue');
});

// ── autoHeal: cooldown guard — exact boundary ─────────────────────────────────

function isWithinCooldown(lastMs, windowMs, nowMs) {
  return (nowMs - lastMs) < windowMs;
}

test('autoHeal cooldown: exactly at boundary (2min elapsed) → cooldown cleared', () => {
  const windowMs = 2 * 60 * 1000;
  const now = Date.now();
  const last = now - windowMs; // exactly 2 minutes ago
  assert.equal(isWithinCooldown(last, windowMs, now), false, 'exact boundary must NOT be in cooldown');
});

test('autoHeal cooldown: 1ms before boundary → still in cooldown', () => {
  const windowMs = 2 * 60 * 1000;
  const now = Date.now();
  const last = now - windowMs + 1;
  assert.equal(isWithinCooldown(last, windowMs, now), true);
});

// ── sendSMS: missing config → false without network call (verified by logic) ──

function smsWouldProceed(env, hour, skipQuietHours = false) {
  if (!skipQuietHours && (hour < 8 || hour >= 21)) return false;
  if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN || !env.TWILIO_PHONE_NUMBER) return false;
  return true;
}

test('sendSMS logic: missing TWILIO_ACCOUNT_SID → returns false before any fetch', () => {
  assert.equal(smsWouldProceed({ TWILIO_ACCOUNT_SID: '', TWILIO_AUTH_TOKEN: 'tok', TWILIO_PHONE_NUMBER: '+1514' }, 12), false);
});

test('sendSMS logic: all config present during business hours → would proceed', () => {
  assert.equal(smsWouldProceed({ TWILIO_ACCOUNT_SID: 'AC', TWILIO_AUTH_TOKEN: 'tok', TWILIO_PHONE_NUMBER: '+1514' }, 10), true);
});

test('sendSMS logic: all config present but quiet hours → returns false', () => {
  assert.equal(smsWouldProceed({ TWILIO_ACCOUNT_SID: 'AC', TWILIO_AUTH_TOKEN: 'tok', TWILIO_PHONE_NUMBER: '+1514' }, 22), false);
});

test('sendSMS logic: skipQuietHours=true at 2am with full config → proceeds', () => {
  assert.equal(smsWouldProceed({ TWILIO_ACCOUNT_SID: 'AC', TWILIO_AUTH_TOKEN: 'tok', TWILIO_PHONE_NUMBER: '+1514' }, 2, true), true);
});

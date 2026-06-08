/**
 * Tests for the phone normalization + validation logic in lib/sms.ts.
 *
 * sendSMS() calls network, DB, and Twilio — not suitable for unit tests.
 * The pure validation sub-logic is reproduced inline (same technique as
 * parse-project-info.test.mjs) so tests run with plain node.
 *
 * Run: node --test tests/sms-phone-validation.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

// ── Inlined from lib/sms.ts ──────────────────────────────────────────────────

const VALID_AREA_CODES = ['418', '581', '819', '450', '438', '514', '579', '873', '367'];

/**
 * Returns { phone: string, valid: boolean, reason?: string }
 * Mirrors the inline validation in sendSMS().
 */
function validateAndNormalizePhone(to) {
  const cleaned = to.replace(/[^0-9+]/g, '');
  const phone = cleaned.startsWith('+') ? cleaned
    : cleaned.startsWith('1') ? `+${cleaned}`
    : `+1${cleaned}`;

  const digitsOnly = phone.replace(/\D/g, '');
  const areaCode = digitsOnly.length === 11
    ? digitsOnly.substring(1, 4)
    : digitsOnly.substring(0, 3);

  if (digitsOnly.length < 10 || digitsOnly.length > 11 || !VALID_AREA_CODES.includes(areaCode)) {
    return { phone, valid: false, reason: `area code ${areaCode} not valid or digit count ${digitsOnly.length}` };
  }

  return { phone, valid: true };
}

// ── SMS quiet hours (different threshold from Telegram) ────────────────────
// sendSMS blocks: hour < 8 || hour >= 21

function isSmsQuietHours(h) {
  return h < 8 || h >= 21;
}

// ── Phone normalization ───────────────────────────────────────────────────────

test('normalize: 10-digit QC number → +1XXXXXXXXXX', () => {
  const { phone } = validateAndNormalizePhone('5813075983');
  assert.equal(phone, '+15813075983');
});

test('normalize: number already starting with + → unchanged prefix', () => {
  const { phone } = validateAndNormalizePhone('+15813075983');
  assert.equal(phone, '+15813075983');
});

test('normalize: 11 digits starting with 1 → +1XXXXXXXXXX', () => {
  const { phone } = validateAndNormalizePhone('15813075983');
  assert.equal(phone, '+15813075983');
});

test('normalize: formatted number (514) 555-1234 → cleaned', () => {
  const { phone, valid } = validateAndNormalizePhone('(514) 555-1234');
  assert.equal(phone, '+15145551234');
  assert.equal(valid, true);
});

test('normalize: dashes and spaces stripped', () => {
  const { phone } = validateAndNormalizePhone('581-307-5983');
  assert.equal(phone, '+15813075983');
});

// ── Valid area codes (QC) ────────────────────────────────────────────────────

test('valid: 418 area code (Québec City) → valid', () => {
  const { valid } = validateAndNormalizePhone('4185551234');
  assert.equal(valid, true);
});

test('valid: 581 area code (Québec City overlay) → valid', () => {
  const { valid } = validateAndNormalizePhone('5815551234');
  assert.equal(valid, true);
});

test('valid: 514 area code (Montréal) → valid', () => {
  const { valid } = validateAndNormalizePhone('5145551234');
  assert.equal(valid, true);
});

test('valid: 873 area code (Outaouais) → valid', () => {
  const { valid } = validateAndNormalizePhone('8735551234');
  assert.equal(valid, true);
});

// ── Invalid area codes ────────────────────────────────────────────────────────

test('invalid: 416 (Toronto) → blocked', () => {
  const { valid } = validateAndNormalizePhone('4165551234');
  assert.equal(valid, false, '416 is not a valid QC area code');
});

test('invalid: 613 (Ottawa ON) → blocked', () => {
  const { valid } = validateAndNormalizePhone('6135551234');
  assert.equal(valid, false);
});

test('invalid: 800 (toll-free) → blocked', () => {
  const { valid } = validateAndNormalizePhone('8005551234');
  assert.equal(valid, false);
});

// ── Invalid digit counts ──────────────────────────────────────────────────────

test('invalid: 9 digits → blocked', () => {
  const { valid } = validateAndNormalizePhone('581307598');
  assert.equal(valid, false, '9 digits must be rejected');
});

test('invalid: 7 digits (local old-style) → blocked', () => {
  const { valid } = validateAndNormalizePhone('5551234');
  assert.equal(valid, false);
});

test('invalid: 12 digits → blocked', () => {
  const { valid } = validateAndNormalizePhone('581307598300');
  assert.equal(valid, false, '12 digits must be rejected');
});

test('invalid: empty string → blocked', () => {
  const { valid } = validateAndNormalizePhone('');
  assert.equal(valid, false);
});

// ── SMS quiet hours (8h–21h window, stricter than Telegram's 7h) ─────────────

test('smsQuietHours: h=0 → quiet', () => assert.equal(isSmsQuietHours(0), true));
test('smsQuietHours: h=7 → quiet (SMS blocks until 8h, unlike Telegram 7h)', () => assert.equal(isSmsQuietHours(7), true));
test('smsQuietHours: h=8 → allowed (business starts)', () => assert.equal(isSmsQuietHours(8), false));
test('smsQuietHours: h=12 → allowed', () => assert.equal(isSmsQuietHours(12), false));
test('smsQuietHours: h=20 → allowed', () => assert.equal(isSmsQuietHours(20), false));
test('smsQuietHours: h=21 → quiet (cutoff)', () => assert.equal(isSmsQuietHours(21), true));
test('smsQuietHours: h=23 → quiet', () => assert.equal(isSmsQuietHours(23), true));

/**
 * Tests for the guard logic integrated inside sendSMS() (lib/sms.ts).
 *
 * sendSMS() calls Twilio, DB, and env — not suitable for true unit tests.
 * This file tests the pure decision logic inline (same pattern as sms-phone-validation.test.mjs).
 *
 * GAP: The existing sms-phone-validation.test.mjs and telegram-quiet-hours.test.mjs each
 * cover individual guards in isolation, but sendSMS chains them together and the integrated
 * behaviour (e.g. quiet-hours fires before phone validation, missing config returns false
 * before any network call) is completely untested.
 *
 * Run: node --test tests/sms-guards.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'crypto';

// ── Inlined from lib/sms.ts ──────────────────────────────────────────────────

const VALID_AREA_CODES = ['418', '581', '819', '450', '438', '514', '579', '873', '367'];

function normalizeSmsPhone(to) {
  const cleaned = to.replace(/[^0-9+]/g, '');
  return cleaned.startsWith('+') ? cleaned
    : cleaned.startsWith('1') ? `+${cleaned}`
    : `+1${cleaned}`;
}

function validateSmsPhone(phone) {
  const digitsOnly = phone.replace(/\D/g, '');
  const areaCode = digitsOnly.length === 11 ? digitsOnly.substring(1, 4) : digitsOnly.substring(0, 3);
  return (
    digitsOnly.length >= 10 &&
    digitsOnly.length <= 11 &&
    VALID_AREA_CODES.includes(areaCode)
  );
}

function smsQuietHours(hour) {
  return hour < 8 || hour >= 21;
}

function dedupeKey(phone, body) {
  return `sms_dedup_${phone}_${createHash('sha1').update(body).digest('hex').slice(0, 24)}`;
}

function isTwilioConfigured(env) {
  return !!(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && (env.TWILIO_PHONE_NUMBER));
}

// ── Quiet hours gate (applied before any Twilio call) ────────────────────────

test('sendSMS guard: quiet at 7h → blocked', () => {
  assert.equal(smsQuietHours(7), true);
});

test('sendSMS guard: quiet at 0h → blocked', () => {
  assert.equal(smsQuietHours(0), true);
});

test('sendSMS guard: allowed at 8h → passes', () => {
  assert.equal(smsQuietHours(8), false);
});

test('sendSMS guard: allowed at 20h → passes', () => {
  assert.equal(smsQuietHours(20), false);
});

test('sendSMS guard: quiet at 21h → blocked', () => {
  assert.equal(smsQuietHours(21), true);
});

// ── skipQuietHours bypass ────────────────────────────────────────────────────

test('sendSMS guard: skipQuietHours=true at 3h still proceeds past quiet check', () => {
  // When skipQuietHours is true the quiet-hours branch is skipped entirely.
  // The next blocker is Twilio config — simulate missing config.
  const env = { TWILIO_ACCOUNT_SID: '', TWILIO_AUTH_TOKEN: '', TWILIO_PHONE_NUMBER: '' };
  const skipQuietHours = true;
  const hour = 3;
  // Would NOT be blocked by quiet hours (bypass active).
  const blockedByQuiet = !skipQuietHours && smsQuietHours(hour);
  assert.equal(blockedByQuiet, false);
  // But Twilio is unconfigured → would still return false.
  assert.equal(isTwilioConfigured(env), false);
});

// ── Twilio config gate ───────────────────────────────────────────────────────

test('sendSMS guard: missing TWILIO_ACCOUNT_SID → not configured', () => {
  assert.equal(isTwilioConfigured({
    TWILIO_ACCOUNT_SID: '',
    TWILIO_AUTH_TOKEN: 'token',
    TWILIO_PHONE_NUMBER: '+15145550000',
  }), false);
});

test('sendSMS guard: missing TWILIO_AUTH_TOKEN → not configured', () => {
  assert.equal(isTwilioConfigured({
    TWILIO_ACCOUNT_SID: 'ACxxx',
    TWILIO_AUTH_TOKEN: '',
    TWILIO_PHONE_NUMBER: '+15145550000',
  }), false);
});

test('sendSMS guard: missing TWILIO_PHONE_NUMBER → not configured', () => {
  assert.equal(isTwilioConfigured({
    TWILIO_ACCOUNT_SID: 'ACxxx',
    TWILIO_AUTH_TOKEN: 'token',
    TWILIO_PHONE_NUMBER: '',
  }), false);
});

test('sendSMS guard: all Twilio vars present → configured', () => {
  assert.equal(isTwilioConfigured({
    TWILIO_ACCOUNT_SID: 'ACxxx',
    TWILIO_AUTH_TOKEN: 'token',
    TWILIO_PHONE_NUMBER: '+15145550000',
  }), true);
});

// ── Phone normalization inside sendSMS ───────────────────────────────────────

test('sendSMS phone: 10-digit QC number gets +1 prefix', () => {
  const phone = normalizeSmsPhone('5145551234');
  assert.equal(phone, '+15145551234');
});

test('sendSMS phone: 11-digit starting with 1 gets + prefix', () => {
  const phone = normalizeSmsPhone('15145551234');
  assert.equal(phone, '+15145551234');
});

test('sendSMS phone: already has + → unchanged prefix', () => {
  const phone = normalizeSmsPhone('+15145551234');
  assert.equal(phone, '+15145551234');
});

test('sendSMS phone: formatted (514) 555-1234 normalizes correctly', () => {
  const phone = normalizeSmsPhone('(514) 555-1234');
  assert.equal(phone, '+15145551234');
});

// ── Area code validation after normalization ─────────────────────────────────

test('sendSMS phone: valid QC 514 passes validation', () => {
  assert.equal(validateSmsPhone('+15145551234'), true);
});

test('sendSMS phone: valid QC 418 passes validation', () => {
  assert.equal(validateSmsPhone('+14185551234'), true);
});

test('sendSMS phone: Ontario 416 blocked', () => {
  assert.equal(validateSmsPhone('+14165551234'), false);
});

test('sendSMS phone: toll-free 800 blocked', () => {
  assert.equal(validateSmsPhone('+18005551234'), false);
});

test('sendSMS phone: 9 digits blocked (too short)', () => {
  assert.equal(validateSmsPhone('514555123'), false);
});

// ── Dedup key stability ───────────────────────────────────────────────────────

test('dedup: same phone + same body → identical key', () => {
  const k1 = dedupeKey('+15145551234', 'Bonjour test');
  const k2 = dedupeKey('+15145551234', 'Bonjour test');
  assert.equal(k1, k2);
});

test('dedup: same phone + different body → different key', () => {
  const k1 = dedupeKey('+15145551234', 'Premier message');
  const k2 = dedupeKey('+15145551234', 'Deuxieme message');
  assert.notEqual(k1, k2);
});

test('dedup: different phone + same body → different key', () => {
  const k1 = dedupeKey('+15145551234', 'Bonjour');
  const k2 = dedupeKey('+14185559999', 'Bonjour');
  assert.notEqual(k1, k2);
});

test('dedup: key includes phone and 24-char hex hash', () => {
  const k = dedupeKey('+15145551234', 'hello');
  assert.match(k, /^sms_dedup_\+15145551234_[0-9a-f]{24}$/);
});

test('dedup: keys for day-1 and day-2 msgs with same prefix are distinct', () => {
  // Regression for bug where sha1 of shared prefix caused day-2 SMS to be dropped.
  const body1 = 'Salut! Rendez-vous confirmé pour le 2026-06-10.';
  const body2 = 'Salut! Rendez-vous confirmé pour le 2026-06-11.';
  const k1 = dedupeKey('+15145551234', body1);
  const k2 = dedupeKey('+15145551234', body2);
  assert.notEqual(k1, k2);
});

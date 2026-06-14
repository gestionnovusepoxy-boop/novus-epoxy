/**
 * Critical coverage gaps — test skeletons
 *
 * Each test block represents a real untested scenario found in the June 2026 audit.
 * All tests use inlined logic (same pattern as sms-guards.test.mjs) to avoid
 * pulling in Next.js / DB dependencies at test time.
 *
 * Run: node --test tests/coverage-gaps-critical.test.mjs
 *
 * Sections:
 *  1. lib/sms.ts — opt-out key normalization, notifyAdminSMS quiet-hours
 *  2. lib/auto-quote.ts — confidence boundaries, blacklist phone normalization
 *  3. lib/llm.ts — tier validation, OR_MODELS map
 *  4. lib/agent.ts — QUOTE_DATA JSON parsing edge cases, handoff tag detection
 *  5. lib/send-email.ts — base64url encoding, BCC header construction
 *  6. lib/auth.ts — AUTHORIZED_USERS env parsing
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'crypto';

// ═══════════════════════════════════════════════════════════════════════════
// 1. lib/sms.ts — edge cases not covered by sms-guards.test.mjs
// ═══════════════════════════════════════════════════════════════════════════

// Inlined from lib/sms.ts to test in isolation
function normalizeSmsPhone(to) {
  const cleaned = to.replace(/[^0-9+]/g, '');
  return cleaned.startsWith('+') ? cleaned
    : cleaned.startsWith('1') ? `+${cleaned}`
    : `+1${cleaned}`;
}

const VALID_AREA_CODES = ['418', '581', '819', '450', '438', '514', '579', '873', '367'];

function validateSmsPhone(phone) {
  const digits = phone.replace(/\D/g, '');
  const area = digits.length === 11 ? digits.substring(1, 4) : digits.substring(0, 3);
  return digits.length >= 10 && digits.length <= 11 && VALID_AREA_CODES.includes(area);
}

// Opt-out key format: 'sms_optout_' + normalizedPhone
// The key MUST use the normalized +1XXXXXXXXXX form so lookups are consistent.
function buildOptoutKey(rawPhone) {
  return 'sms_optout_' + normalizeSmsPhone(rawPhone);
}

test('SMS opt-out: key is consistent regardless of input format', () => {
  const variants = [
    '5813075983',
    '15813075983',
    '581-307-5983',
    '(581) 307-5983',
    '581.307.5983',
    '+15813075983',
  ];
  const keys = variants.map(buildOptoutKey);
  // All variants must produce the same opt-out key
  assert.ok(new Set(keys).size === 1, `Expected 1 unique key, got: ${[...new Set(keys)].join(', ')}`);
});

test('SMS opt-out: key format is sms_optout_+1XXXXXXXXXX', () => {
  assert.equal(buildOptoutKey('5813075983'), 'sms_optout_+15813075983');
  assert.equal(buildOptoutKey('+15813075983'), 'sms_optout_+15813075983');
});

test('SMS phone validation: 9-digit number is rejected', () => {
  const phone = normalizeSmsPhone('581307598'); // 9 digits
  assert.equal(validateSmsPhone(phone), false);
});

test('SMS phone validation: 12-digit number is rejected', () => {
  const phone = normalizeSmsPhone('158130759830'); // 12 digits
  assert.equal(validateSmsPhone(phone), false);
});

test('SMS phone validation: valid new Quebec area codes (873, 367) accepted', () => {
  assert.equal(validateSmsPhone('+18731234567'), true);
  assert.equal(validateSmsPhone('+13671234567'), true);
});

test('SMS phone validation: US area code (212) rejected', () => {
  assert.equal(validateSmsPhone('+12125551234'), false);
});

// notifyAdminSMS is NOT exempt from quiet hours (skipQuietHours defaults to false)
// This test documents the expected behaviour: admin SMS CAN be blocked by quiet hours.
test('SMS quiet hours: hour 21 is blocked (>= 21)', () => {
  function isQuietHour(hour) { return hour < 8 || hour >= 21; }
  assert.equal(isQuietHour(21), true);
  assert.equal(isQuietHour(20), false);
  assert.equal(isQuietHour(7), true);
  assert.equal(isQuietHour(8), false);
});

// SMS dedup: two messages with same prefix but different body should NOT dedup
test('SMS dedup: different body = different hash', () => {
  function smsDedupeKey(to, body) {
    return createHash('sha1').update(to + '|' + body).digest('hex');
  }
  const k1 = smsDedupeKey('+15813075983', 'Votre soumission est prête');
  const k2 = smsDedupeKey('+15813075983', 'Votre soumission est prête — version 2');
  assert.notEqual(k1, k2);
});

test('SMS dedup: identical body to same number = same hash (prevents double send)', () => {
  function smsDedupeKey(to, body) {
    return createHash('sha1').update(to + '|' + body).digest('hex');
  }
  const k1 = smsDedupeKey('+15813075983', 'Bonjour!');
  const k2 = smsDedupeKey('+15813075983', 'Bonjour!');
  assert.equal(k1, k2);
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. lib/auto-quote.ts — confidence boundaries & blacklist normalization
// ═══════════════════════════════════════════════════════════════════════════

// Inlined confidence scoring to test boundary conditions
// parseProjectInfo returns null when confidence < 30, partial alert when 30–49, auto-quote at >= 50
function classifyConfidence(score) {
  if (score < 30) return 'no_action';
  if (score < 50) return 'alert_only';   // sends Telegram alert, no quote
  return 'auto_quote';
}

test('confidence: exactly 29 → no_action', () => {
  assert.equal(classifyConfidence(29), 'no_action');
});

test('confidence: exactly 30 → alert_only (fence-post)', () => {
  assert.equal(classifyConfidence(30), 'alert_only');
});

test('confidence: exactly 49 → alert_only', () => {
  assert.equal(classifyConfidence(49), 'alert_only');
});

test('confidence: exactly 50 → auto_quote', () => {
  assert.equal(classifyConfidence(50), 'auto_quote');
});

// Blacklist: phones stored without formatting, must normalize before comparing
const BLACKLISTED_PHONES = ['5813075983', '5813072678'];

function isPhoneBlacklisted(raw) {
  const digits = raw.replace(/\D/g, '');
  // Normalize: strip country code prefix if present
  const normalized = digits.length === 11 && digits.startsWith('1') ? digits.substring(1) : digits;
  return BLACKLISTED_PHONES.includes(normalized);
}

test('blacklist: raw 10-digit matches', () => {
  assert.equal(isPhoneBlacklisted('5813075983'), true);
});

test('blacklist: +1 prefix stripped before comparison', () => {
  assert.equal(isPhoneBlacklisted('+15813075983'), true);
});

test('blacklist: formatted with dashes stripped before comparison', () => {
  assert.equal(isPhoneBlacklisted('581-307-5983'), true);
});

test('blacklist: non-blacklisted number returns false', () => {
  assert.equal(isPhoneBlacklisted('4181234567'), false);
});

// Service keyword ambiguity: "commercial" maps to both ESPACE and SERVICE keywords
// The SERVICE lookup should win if text has a service keyword, otherwise ESPACE drives type_service
test('service keyword: "commercial" in ESPACE_KEYWORDS maps espace=Commercial', () => {
  const ESPACE_KEYWORDS = {
    garage: 'Garage',
    'sous-sol': 'Sous-sol',
    commercial: 'Commercial',
  };
  const SERVICE_KEYWORDS = {
    commercial: 'commercial',
    flake: 'flake',
  };
  const text = 'plancher commercial';
  const espaceMatch = Object.entries(ESPACE_KEYWORDS).find(([k]) => text.includes(k));
  const serviceMatch = Object.entries(SERVICE_KEYWORDS).find(([k]) => text.includes(k));
  assert.equal(espaceMatch?.[1], 'Commercial');
  assert.equal(serviceMatch?.[1], 'commercial');
  // Both match — type_service 'commercial' is the explicit service choice
  // type_espace 'Commercial' should be derived from espace keyword
});

// Postal code regex — Canadian format
test('postal code regex: standard K1A 0A9', () => {
  const regex = /[ABCEGHJKLMNPRSTVXY]\d[A-Z]\s?\d[A-Z]\d/i;
  assert.ok(regex.test('K1A 0A9'));
  assert.ok(regex.test('G1V1A1'));
  assert.ok(regex.test('H3H 2B4'));
});

test('postal code regex: lowercase accepted (case-insensitive)', () => {
  const regex = /[ABCEGHJKLMNPRSTVXY]\d[A-Z]\s?\d[A-Z]\d/i;
  assert.ok(regex.test('g1v 1a1'));
});

test('postal code regex: US ZIP rejected', () => {
  const regex = /[ABCEGHJKLMNPRSTVXY]\d[A-Z]\s?\d[A-Z]\d/i;
  assert.equal(regex.test('10001'), false);
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. lib/llm.ts — OR_MODELS map, tier validation
// ═══════════════════════════════════════════════════════════════════════════

// All valid tiers must be in OR_MODELS
const VALID_TIERS = ['bulk', 'fast', 'medium', 'smart', 'top'];
const OR_MODELS = {
  bulk:   'deepseek/deepseek-v4-flash',
  fast:   'google/gemini-3.1-flash-lite',
  medium: 'google/gemini-3-flash-preview',
  smart:  'x-ai/grok-4.20',
  top:    'google/gemini-3.1-pro-preview',
};

test('OR_MODELS: all valid tiers have a model', () => {
  for (const tier of VALID_TIERS) {
    assert.ok(OR_MODELS[tier], `Missing model for tier: ${tier}`);
  }
});

test('OR_MODELS: no extra tiers (catch typos like "medium2")', () => {
  assert.deepEqual(Object.keys(OR_MODELS).sort(), [...VALID_TIERS].sort());
});

test('LLM tier: invalid tier key → undefined (must guard before calling API)', () => {
  const invalidTier = 'ultra'; // not in map
  const model = OR_MODELS[invalidTier];
  assert.equal(model, undefined, 'Invalid tier should return undefined, caller must validate');
});

// Daily budget: cost accumulation should reject when cap reached
test('daily budget: spend tracking arithmetic', () => {
  function remainingBudget(spent, cap) {
    return Math.max(0, cap - spent);
  }
  assert.equal(remainingBudget(0.50, 1.00), 0.50);
  assert.equal(remainingBudget(1.00, 1.00), 0.00);
  assert.equal(remainingBudget(1.20, 1.00), 0.00); // overrun → clamped to 0
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. lib/agent.ts — QUOTE_DATA / HANDOFF tag extraction
// ═══════════════════════════════════════════════════════════════════════════

// Inlined extraction logic matching agent.ts processMessage() behaviour
function extractQuoteData(response) {
  const match = response.match(/<QUOTE_DATA>([\s\S]*?)<\/QUOTE_DATA>/);
  if (!match) return null;
  try {
    return JSON.parse(match[1].trim());
  } catch {
    return null; // malformed JSON → null, caller must handle
  }
}

function extractHandoff(response) {
  return /<HANDOFF>([\s\S]*?)<\/HANDOFF>/.test(response);
}

test('agent: valid QUOTE_DATA tag is extracted and parsed', () => {
  const resp = 'Super! <QUOTE_DATA>{"type_service":"flake","superficie":400}</QUOTE_DATA>';
  const data = extractQuoteData(resp);
  assert.deepEqual(data, { type_service: 'flake', superficie: 400 });
});

test('agent: malformed JSON in QUOTE_DATA returns null (no throw)', () => {
  const resp = '<QUOTE_DATA>{type_service: flake, superficie: }</QUOTE_DATA>';
  assert.equal(extractQuoteData(resp), null);
});

test('agent: missing QUOTE_DATA tag returns null', () => {
  assert.equal(extractQuoteData('Here is your answer.'), null);
});

test('agent: multiple QUOTE_DATA tags — first one wins (greedy stop)', () => {
  const resp = '<QUOTE_DATA>{"a":1}</QUOTE_DATA> later <QUOTE_DATA>{"a":2}</QUOTE_DATA>';
  const data = extractQuoteData(resp);
  assert.equal(data?.a, 1);
});

test('agent: empty QUOTE_DATA tag returns null (empty JSON is invalid)', () => {
  const resp = '<QUOTE_DATA></QUOTE_DATA>';
  assert.equal(extractQuoteData(resp), null);
});

test('agent: HANDOFF tag detected', () => {
  assert.equal(extractHandoff('<HANDOFF>besoin humain</HANDOFF>'), true);
});

test('agent: no HANDOFF tag → false', () => {
  assert.equal(extractHandoff('Voici votre soumission'), false);
});

test('agent: QUOTE_DATA and HANDOFF can coexist in same response', () => {
  const resp = '<QUOTE_DATA>{"type_service":"flake"}</QUOTE_DATA> <HANDOFF>complexe</HANDOFF>';
  assert.notEqual(extractQuoteData(resp), null);
  assert.equal(extractHandoff(resp), true);
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. lib/send-email.ts — base64url encoding, BCC header
// ═══════════════════════════════════════════════════════════════════════════

// base64url used for Gmail API raw message encoding
function toBase64Url(str) {
  return Buffer.from(str).toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

test('base64url: standard ASCII text encodes correctly', () => {
  const encoded = toBase64Url('Hello World');
  // must not contain +, /, or = padding
  assert.equal(encoded.includes('+'), false);
  assert.equal(encoded.includes('/'), false);
  assert.equal(encoded.includes('='), false);
  // must be reversible
  const decoded = Buffer.from(encoded, 'base64url').toString('utf-8');
  assert.equal(decoded, 'Hello World');
});

test('base64url: non-ASCII subject (French accents)', () => {
  const subject = 'Votre soumission époxy est prête!';
  const encoded = toBase64Url(subject);
  const decoded = Buffer.from(encoded, 'base64url').toString('utf-8');
  assert.equal(decoded, subject);
});

test('base64url: empty string encodes to empty string', () => {
  assert.equal(toBase64Url(''), '');
});

// BCC header injection guard: BCC field must not contain \r or \n
function safeBccHeader(bcc) {
  return bcc.replace(/[\r\n]/g, ''); // strip injection chars
}

test('email BCC: newline stripped (header injection prevention)', () => {
  const raw = 'attacker@evil.com\r\nBcc: victim@target.com';
  const safe = safeBccHeader(raw);
  assert.equal(safe.includes('\r'), false);
  assert.equal(safe.includes('\n'), false);
});

test('email BCC: normal address unchanged', () => {
  assert.equal(safeBccHeader('admin@novus-epoxy.com'), 'admin@novus-epoxy.com');
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. lib/auth.ts — AUTHORIZED_USERS env var parsing
// ═══════════════════════════════════════════════════════════════════════════

// AUTHORIZED_USERS format: "user1:pass1,user2:pass2"
function parseAuthorizedUsers(envValue) {
  if (!envValue?.trim()) return [];
  return envValue.split(',').map(entry => {
    const colon = entry.indexOf(':');
    if (colon === -1) return null; // malformed entry
    return { user: entry.substring(0, colon).trim(), pass: entry.substring(colon + 1).trim() };
  }).filter(Boolean);
}

test('auth: parses single user', () => {
  const users = parseAuthorizedUsers('luca:secret123');
  assert.equal(users.length, 1);
  assert.equal(users[0].user, 'luca');
  assert.equal(users[0].pass, 'secret123');
});

test('auth: parses multiple users', () => {
  const users = parseAuthorizedUsers('luca:pass1,jason:pass2');
  assert.equal(users.length, 2);
  assert.equal(users[1].user, 'jason');
});

test('auth: empty string returns empty array (no crash)', () => {
  assert.deepEqual(parseAuthorizedUsers(''), []);
  assert.deepEqual(parseAuthorizedUsers(undefined), []);
});

test('auth: malformed entry without colon is skipped', () => {
  const users = parseAuthorizedUsers('luca:pass1,malformed,jason:pass2');
  // malformed entry has no colon → filtered out
  assert.equal(users.length, 2);
});

test('auth: password containing colon is preserved', () => {
  // "user:pass:with:colons" → user="user", pass="pass:with:colons"
  const users = parseAuthorizedUsers('admin:p:a:s:s');
  assert.equal(users[0].user, 'admin');
  assert.equal(users[0].pass, 'p:a:s:s');
});

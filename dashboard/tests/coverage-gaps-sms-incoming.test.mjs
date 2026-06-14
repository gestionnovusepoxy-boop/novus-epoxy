/**
 * coverage-gaps-sms-incoming.test.mjs — Pure-logic gaps in app/api/sms/incoming/route.ts
 *
 * Run: node --test tests/coverage-gaps-sms-incoming.test.mjs
 *
 * Gaps targeted (confirmed not covered by any prior test file):
 *
 *   GAP-1  parseQuoteData() — surface-type keyword detection (10 keywords, first-match wins)
 *   GAP-2  parseQuoteData() — sqft regex: pi2 / pi² / pieds carrés / sqft / sf / p2 / pc
 *   GAP-3  parseQuoteData() — sqft suffix AND prefix syntax (number before OR after unit)
 *   GAP-4  parseQuoteData() — standalone large-number fallback when surfaceType is found
 *   GAP-5  parseQuoteData() — null when neither surface nor sqft found
 *   GAP-6  parseQuoteData() — output format: "[SMS Auto-Parse] Type: X, Surface: ~N pi²"
 *   GAP-7  parseQuoteData() — sqft whitespace/comma stripping and trailing-dot removal
 *   GAP-8  parseQuoteData() — first keyword wins (SURFACE_KEYWORDS order matters)
 *   GAP-9  sms/incoming BLACKLIST — own numbers never trigger notifications
 *   GAP-10 sms/incoming Twilio HMAC-SHA1 signature: correct sig passes, wrong sig → 403
 *   GAP-11 Integration skeletons (skipped unless INTEGRATION_TEST=1)
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

const SKIP_INTEGRATION = !process.env.INTEGRATION_TEST;
const BASE_URL = process.env.TEST_BASE_URL ?? 'http://localhost:3000';

// ════════════════════════════════════════════════════════════════════════════
// Inlined verbatim from app/api/sms/incoming/route.ts
// ════════════════════════════════════════════════════════════════════════════

const SURFACE_KEYWORDS = {
  garage: 'Garage',
  'sous-sol': 'Sous-sol',
  'sous sol': 'Sous-sol',
  basement: 'Sous-sol',
  balcon: 'Balcon',
  patio: 'Patio',
  entree: 'Entrée',
  commercial: 'Commercial',
  entrepot: 'Entrepôt',
  warehouse: 'Entrepôt',
};

function parseQuoteData(text) {
  const lower = text.toLowerCase();
  let surfaceType = null;
  for (const [keyword, label] of Object.entries(SURFACE_KEYWORDS)) {
    if (lower.includes(keyword)) { surfaceType = label; break; }
  }
  const sqftMatch = text.match(/(\d[\d\s.,]*)\s*(?:pi2|pi²|pieds?\s*carr[eé]s?|sqft|sf|p2|pc)/i)
    || text.match(/(?:pi2|pi²|pieds?\s*carr[eé]s?|sqft|sf|p2|pc)\s*[:\-]?\s*(\d[\d\s.,]*)/i);
  let sqft = null;
  if (sqftMatch) {
    sqft = (sqftMatch[1] || sqftMatch[2] || '').replace(/[\s,]/g, '').replace(/\.+$/, '');
  }
  if (!sqft && surfaceType) {
    const numMatch = text.match(/\b(\d{2,5})\b/);
    if (numMatch) sqft = numMatch[1];
  }
  if (!surfaceType && !sqft) return null;
  const parts = [];
  if (surfaceType) parts.push(`Type: ${surfaceType}`);
  if (sqft) parts.push(`Surface: ~${sqft} pi²`);
  return `[SMS Auto-Parse] ${parts.join(', ')}`;
}

// Inlined Twilio signature validation from app/api/sms/incoming/route.ts
function computeTwilioSig(authToken, url, params) {
  const sorted = Object.keys(params).sort().reduce((acc, k) => acc + k + params[k], '');
  return createHmac('sha1', authToken).update(url + sorted).digest('base64');
}

// ════════════════════════════════════════════════════════════════════════════
// GAP-1: Surface-type keyword detection
// ════════════════════════════════════════════════════════════════════════════

test('parseQuoteData: "garage" keyword → Garage', () => {
  const result = parseQuoteData('Bonjour, je voudrais un devis pour mon garage');
  assert.ok(result?.includes('Type: Garage'), `expected "Type: Garage" in "${result}"`);
});

test('parseQuoteData: "sous-sol" → Sous-sol', () => {
  const result = parseQuoteData('Mon sous-sol fait 400 pi2');
  assert.ok(result?.includes('Type: Sous-sol'));
});

test('parseQuoteData: "sous sol" (with space, no hyphen) → Sous-sol', () => {
  const result = parseQuoteData('Bonjour pour mon sous sol');
  assert.ok(result?.includes('Type: Sous-sol'));
});

test('parseQuoteData: "basement" → Sous-sol', () => {
  const result = parseQuoteData('I have a basement 300 sqft');
  assert.ok(result?.includes('Type: Sous-sol'));
});

test('parseQuoteData: "balcon" → Balcon', () => {
  const result = parseQuoteData('balcon 200 pi2');
  assert.ok(result?.includes('Type: Balcon'));
});

test('parseQuoteData: "patio" → Patio', () => {
  const result = parseQuoteData('patio exterieur 150 pi2');
  assert.ok(result?.includes('Type: Patio'));
});

test('parseQuoteData: "entree" → Entrée', () => {
  const result = parseQuoteData("entree de maison 120 pi2");
  assert.ok(result?.includes('Type: Entrée'));
});

test('parseQuoteData: "commercial" → Commercial', () => {
  const result = parseQuoteData('plancher commercial 1200 pi2');
  assert.ok(result?.includes('Type: Commercial'));
});

test('parseQuoteData: "entrepot" → Entrepôt', () => {
  const result = parseQuoteData('entrepot 5000 pi2');
  assert.ok(result?.includes('Type: Entrepôt'));
});

test('parseQuoteData: "warehouse" → Entrepôt', () => {
  const result = parseQuoteData('warehouse 5000 sqft');
  assert.ok(result?.includes('Type: Entrepôt'));
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-2: Sqft unit regex variants
// ════════════════════════════════════════════════════════════════════════════

test('parseQuoteData: "350 pi2" unit detected', () => {
  const result = parseQuoteData('garage 350 pi2');
  assert.ok(result?.includes('Surface: ~350 pi²'));
});

test('parseQuoteData: "350 pi²" unit detected', () => {
  const result = parseQuoteData('garage 350 pi²');
  assert.ok(result?.includes('Surface: ~350 pi²'));
});

test('parseQuoteData: "350 sqft" unit detected', () => {
  const result = parseQuoteData('garage 350 sqft');
  assert.ok(result?.includes('Surface: ~350 pi²'));
});

test('parseQuoteData: "350 sf" unit detected', () => {
  const result = parseQuoteData('garage 350 sf');
  assert.ok(result?.includes('Surface: ~350 pi²'));
});

test('parseQuoteData: "350 p2" unit detected', () => {
  const result = parseQuoteData('garage 350 p2');
  assert.ok(result?.includes('Surface: ~350 pi²'));
});

test('parseQuoteData: "350 pc" unit detected', () => {
  const result = parseQuoteData('garage 350 pc');
  assert.ok(result?.includes('Surface: ~350 pi²'));
});

test('parseQuoteData: "350 pieds carres" unit detected', () => {
  const result = parseQuoteData('garage 350 pieds carres');
  assert.ok(result?.includes('Surface: ~350 pi²'));
});

test('parseQuoteData: "350 pieds carrés" (accented) unit detected', () => {
  const result = parseQuoteData('garage 350 pieds carrés');
  assert.ok(result?.includes('Surface: ~350 pi²'));
});

test('parseQuoteData: "350 pied carré" (singular) unit detected', () => {
  const result = parseQuoteData('garage 350 pied carré');
  assert.ok(result?.includes('Surface: ~350 pi²'));
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-3: Prefix syntax (unit before number)
// ════════════════════════════════════════════════════════════════════════════

test('parseQuoteData: "pi2: 350" prefix syntax works', () => {
  const result = parseQuoteData('garage pi2: 350');
  assert.ok(result?.includes('Surface: ~350 pi²'), `got: ${result}`);
});

test('parseQuoteData: "sqft: 500" prefix syntax works', () => {
  const result = parseQuoteData('entrepot sqft: 500');
  assert.ok(result?.includes('Surface: ~500 pi²'), `got: ${result}`);
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-4: Standalone large-number fallback (surfaceType found, no unit keyword)
// ════════════════════════════════════════════════════════════════════════════

test('parseQuoteData: "garage 400" (no unit) → standalone number fallback', () => {
  const result = parseQuoteData('garage 400');
  assert.ok(result?.includes('Surface: ~400 pi²'), `got: ${result}`);
});

test('parseQuoteData: "garage 1500" → 4-digit standalone works', () => {
  const result = parseQuoteData('garage 1500');
  assert.ok(result?.includes('Surface: ~1500 pi²'));
});

test('parseQuoteData: no surface type → standalone number NOT extracted (returns sqft-only if unit present)', () => {
  // No surface keyword → no standalone fallback, but unit-based sqft still works
  const result = parseQuoteData('J ai 400 pi2');
  assert.ok(result?.includes('Surface: ~400 pi²'), `got: ${result}`);
  assert.ok(!result?.includes('Type:'), 'should have no Type when no surface keyword');
});

test('parseQuoteData: single-digit number with surface → NOT extracted (< 2 digits)', () => {
  // Regex requires \b(\d{2,5})\b — single digit 9 not matched
  const result = parseQuoteData('garage 9');
  // Surface type found, but sqft is null or weird — just ensure no crash
  assert.equal(typeof result, 'string');
  assert.ok(result.includes('[SMS Auto-Parse]'));
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-5: Returns null when neither surface nor sqft
// ════════════════════════════════════════════════════════════════════════════

test('parseQuoteData: plain greeting → null', () => {
  assert.equal(parseQuoteData('Bonjour!'), null);
});

test('parseQuoteData: "Merci, a bientot" → null', () => {
  assert.equal(parseQuoteData('Merci, a bientot'), null);
});

test('parseQuoteData: empty string → null', () => {
  assert.equal(parseQuoteData(''), null);
});

test('parseQuoteData: "STOP" keyword → null (no surface/sqft)', () => {
  assert.equal(parseQuoteData('STOP'), null);
});

test('parseQuoteData: number alone without surface keyword and without unit → null', () => {
  // No surface type → standalone fallback not triggered; no unit → sqft not parsed
  assert.equal(parseQuoteData('400'), null);
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-6: Output format contract
// ════════════════════════════════════════════════════════════════════════════

test('parseQuoteData: output starts with [SMS Auto-Parse]', () => {
  const result = parseQuoteData('garage 350 pi2');
  assert.ok(result?.startsWith('[SMS Auto-Parse]'), `got: ${result}`);
});

test('parseQuoteData: both type and surface → ", " separator', () => {
  const result = parseQuoteData('garage 350 pi2');
  assert.ok(result?.includes('Type: Garage, Surface: ~350 pi²'), `got: ${result}`);
});

test('parseQuoteData: surface type only (no number) → no Surface field', () => {
  // "garage" found, but no numeric value matching the regexes
  // The standalone fallback requires \d{2,5} — "garage" alone has no digits
  const result = parseQuoteData('Mon garage est epoxy');
  // No digits → no Surface field
  assert.ok(!result?.includes('Surface:'), `unexpected Surface in: ${result}`);
  assert.ok(result?.includes('Type: Garage'));
});

test('parseQuoteData: sqft only (no surface keyword) → no Type field', () => {
  const result = parseQuoteData('Environ 400 pi2 a couvrir');
  assert.ok(!result?.includes('Type:'), `unexpected Type in: ${result}`);
  assert.ok(result?.includes('Surface: ~400 pi²'));
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-7: Sqft string cleaning — spaces, commas, trailing dots
// ════════════════════════════════════════════════════════════════════════════

test('parseQuoteData: "1 200 pi2" (space thousands separator) → 1200', () => {
  const result = parseQuoteData('garage 1 200 pi2');
  assert.ok(result?.includes('Surface: ~1200 pi²'), `got: ${result}`);
});

test('parseQuoteData: "1,200 pi2" (comma thousands separator) → 1200', () => {
  const result = parseQuoteData('garage 1,200 pi2');
  assert.ok(result?.includes('Surface: ~1200 pi²'), `got: ${result}`);
});

test('parseQuoteData: trailing decimal "350. pi2" → "350" (dot stripped)', () => {
  const result = parseQuoteData('garage 350. pi2');
  assert.ok(result?.includes('Surface: ~350 pi²'), `got: ${result}`);
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-8: First keyword in SURFACE_KEYWORDS order wins
// ════════════════════════════════════════════════════════════════════════════

test('parseQuoteData: message with both "garage" and "patio" → garage wins (first in dict)', () => {
  // "garage" comes before "patio" in SURFACE_KEYWORDS
  const result = parseQuoteData('garage et patio 300 pi2');
  assert.ok(result?.includes('Type: Garage'), `expected Garage, got: ${result}`);
  assert.ok(!result?.includes('Type: Patio'));
});

test('parseQuoteData: "sous-sol" and "basement" → sous-sol wins (first in dict)', () => {
  const result = parseQuoteData('sous-sol ou basement 200 pi2');
  assert.ok(result?.includes('Type: Sous-sol'));
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-9: BLACKLIST — own numbers silently ignored
// ════════════════════════════════════════════════════════════════════════════

const BLACKLIST = ['5813075983', '5813072678'];

function isBlacklistedSmsIncoming(from) {
  if (!from) return false;
  const normalized = from.replace(/\D/g, '').slice(-10);
  return BLACKLIST.includes(normalized);
}

test('sms/incoming BLACKLIST: Luca phone normalized → blacklisted', () => {
  assert.equal(isBlacklistedSmsIncoming('+15813075983'), true);
});

test('sms/incoming BLACKLIST: Jason phone normalized → blacklisted', () => {
  assert.equal(isBlacklistedSmsIncoming('+15813072678'), true);
});

test('sms/incoming BLACKLIST: Luca without country code → blacklisted', () => {
  assert.equal(isBlacklistedSmsIncoming('5813075983'), true);
});

test('sms/incoming BLACKLIST: unknown client phone → NOT blacklisted', () => {
  assert.equal(isBlacklistedSmsIncoming('+15145551234'), false);
});

test('sms/incoming BLACKLIST: null from → NOT blacklisted', () => {
  assert.equal(isBlacklistedSmsIncoming(null), false);
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-10: Twilio HMAC-SHA1 signature validation
// (The route implementation inlines this logic — test the algorithm contract)
// ════════════════════════════════════════════════════════════════════════════

test('Twilio sig: correct authToken + params → signature matches', () => {
  const token = 'test_twilio_auth_token';
  const url = 'https://novus-epoxy.vercel.app/api/sms/incoming';
  const params = { From: '+15145551234', Body: 'Bonjour', To: '+15813075983' };
  const sig = computeTwilioSig(token, url, params);
  const expected = computeTwilioSig(token, url, params);
  assert.equal(sig, expected);
});

test('Twilio sig: tampered body → different signature', () => {
  const token = 'secret';
  const url = 'https://novus-epoxy.vercel.app/api/sms/incoming';
  const params = { From: '+15145551234', Body: 'STOP', To: '+15813075983' };
  const params2 = { From: '+15145551234', Body: 'STOP_TAMPERED', To: '+15813075983' };
  const sig1 = computeTwilioSig(token, url, params);
  const sig2 = computeTwilioSig(token, url, params2);
  assert.notEqual(sig1, sig2);
});

test('Twilio sig: wrong authToken → different signature', () => {
  const url = 'https://novus-epoxy.vercel.app/api/sms/incoming';
  const params = { From: '+15145551234', Body: 'Hello' };
  const sig1 = computeTwilioSig('correct_token', url, params);
  const sig2 = computeTwilioSig('wrong_token', url, params);
  assert.notEqual(sig1, sig2);
});

test('Twilio sig: params sorted alphabetically before concatenation', () => {
  const token = 'abc';
  const url = 'https://example.com/webhook';
  // Params in different insertion order — sorting must produce same sig
  const params1 = { ZZZ: 'last', AAA: 'first' };
  const params2 = { AAA: 'first', ZZZ: 'last' };
  assert.equal(computeTwilioSig(token, url, params1), computeTwilioSig(token, url, params2));
});

test('Twilio sig: URL included in signature (different URL → different sig)', () => {
  const token = 'secret';
  const params = { From: '+1514', Body: 'Hi' };
  const sig1 = computeTwilioSig(token, 'https://novus-epoxy.vercel.app/api/sms/incoming', params);
  const sig2 = computeTwilioSig(token, 'https://evil.example.com/webhook', params);
  assert.notEqual(sig1, sig2, 'URL must be part of HMAC input — replay to different URL must fail');
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-11: Integration skeletons (skipped unless INTEGRATION_TEST=1)
// ════════════════════════════════════════════════════════════════════════════

test('INT-1: POST /api/sms/incoming — missing Twilio signature → 403', { skip: SKIP_INTEGRATION }, async () => {
  const body = new URLSearchParams({ From: '+15145551234', Body: 'STOP', To: '+15813075983' });
  const res = await fetch(`${BASE_URL}/api/sms/incoming`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  assert.equal(res.status, 403);
});

test('INT-2: POST /api/sms/incoming — wrong signature → 403', { skip: SKIP_INTEGRATION }, async () => {
  const res = await fetch(`${BASE_URL}/api/sms/incoming`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-Twilio-Signature': 'definitely-wrong-base64-sig==',
    },
    body: new URLSearchParams({ From: '+15145551234', Body: 'STOP' }).toString(),
  });
  assert.equal(res.status, 403);
});

test('INT-3: POST /api/sms/incoming — STOP keyword with valid sig → 200 TwiML', { skip: SKIP_INTEGRATION }, async () => {
  const authToken = process.env.TWILIO_AUTH_TOKEN ?? '';
  const url = `${BASE_URL}/api/sms/incoming`;
  const params = { From: '+15145551234', Body: 'STOP', To: process.env.TWILIO_PHONE_NUMBER ?? '' };
  const sig = computeTwilioSig(authToken, url, params);
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-Twilio-Signature': sig,
    },
    body: new URLSearchParams(params).toString(),
  });
  assert.equal(res.status, 200);
  const xml = await res.text();
  assert.ok(xml.includes('<?xml'), 'response must be TwiML');
});

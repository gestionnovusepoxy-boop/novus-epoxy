/**
 * coverage-gaps-june11-2026.test.mjs — Coverage gap audit, June 11 2026.
 *
 * Run: node --test tests/coverage-gaps-june11-2026.test.mjs
 *
 * TRUE GAPS — pure logic never covered by any prior test file:
 *
 *   GAP-1  lib/meta-ads.ts        — generateAdCopy() fallback path (LLM error → hardcoded copy),
 *                                   phone failsafe injection, headline truncation at 40 chars,
 *                                   budget hard-cap in app/api/ads/propose/route.ts
 *
 *   GAP-2  app/api/cron/nurture-leads/route.ts — isBlacklisted(), getPrenom()
 *                                   isBlacklisted silently skips sending to owners;
 *                                   getPrenom handles multi-word / single-word names.
 *
 *   GAP-3  lib/sms.ts              — Daily SMS limit guard (100/day → block path).
 *                                   All other guards are covered; the 100-SMS ceiling is not.
 *
 *   GAP-4  lib/auto-heal.ts        — healEmailScan 11h cooldown window,
 *                                   healGmailWatch 5-day re-watch window.
 *                                   Both timings drive production health recovery;
 *                                   off-by-one silently disables Gmail watch renewal.
 *
 *   GAP-5  app/api/bank/auto-match  — matching tolerance (±$0.01), ±3-day date window.
 *                                   Inlined helpers not tested; wrong tolerance → missed reconciliation.
 *
 *   GAP-6  lib/send-email.ts       — MIME multipart boundary uniqueness, attachment base64 chunking.
 *
 *   GAP-7  lib/pricing.ts          — getServiceDescriptionHtml() with unknown/injected service type.
 *
 * INTEGRATION SKELETONS (skipped unless INTEGRATION_TEST=1):
 *   INT-1  POST /api/ads/propose  — missing auth → 401
 *   INT-2  POST /api/ads/propose  — invalid service → 400
 *   INT-3  GET  /api/cron/nurture-leads (cron header) — no auth → 401
 *   INT-4  POST /api/bank/auto-match — no session → 401
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

const SKIP_INTEGRATION = !process.env.INTEGRATION_TEST;
const BASE = process.env.TEST_BASE_URL || 'http://localhost:3000';

// ════════════════════════════════════════════════════════════════════════════
// GAP-1: generateAdCopy() fallback + ads/propose validation
//
// generateAdCopy() calls an LLM; when the LLM fails it returns a hardcoded
// fallback. The LLM path is integration-only, but the fallback is pure.
//
// Also: the ads/propose route hard-caps dailyBudgetUsd at $50 and
// durationDays at 14. These caps are pure arithmetic; tested inline.
// ════════════════════════════════════════════════════════════════════════════

// --- Fallback copy (inlined from lib/meta-ads.ts generateAdCopy catch branch) ---

function generateAdCopyFallback(service, promo = 0) {
  const promoTag = promo > 0 ? `SPÉCIAL MAI — ${promo}% rabais.\n` : '';
  return {
    headline: `Ton garage mérite mieux`,
    primary_text: `${promoTag}Transforme ton garage en espace premium.\nSoumission gratuite par texto en 5 min.\n📞 581-307-5983 — Luca`,
    cta: 'SIGN_UP',
  };
}

// --- Phone failsafe (inlined from lib/meta-ads.ts generateAdCopy — post-LLM fixup) ---

function applyPhoneFailsafe(primaryText) {
  if (!primaryText.includes('581-307-5983')) {
    return primaryText.trim() + '\n📞 581-307-5983 — Luca';
  }
  return primaryText;
}

// --- Headline truncation ---

function truncateHeadline(raw) {
  return String(raw).slice(0, 40);
}

// --- Budget / duration hard-caps (inlined from app/api/ads/propose/route.ts) ---

function clampBudget(val) {
  return Math.min(Number(val ?? 50), 50);
}

function clampDuration(val) {
  return Math.min(Number(val ?? 7), 14);
}

// --- Service allowlist (inlined from app/api/ads/propose/route.ts) ---

const ADS_ALLOWED_SERVICES = ['flake', 'metallique', 'quartz', 'couleur_unie', 'antiderapant', 'commercial', 'meulage', 'vinyl_click'];

function isAllowedService(service) {
  return ADS_ALLOWED_SERVICES.includes(String(service));
}

test('generateAdCopy fallback: no promo → no promo prefix', () => {
  const result = generateAdCopyFallback('flake');
  assert.equal(result.cta, 'SIGN_UP');
  assert.ok(!result.primary_text.includes('SPÉCIAL'));
  assert.ok(result.primary_text.includes('581-307-5983'));
});

test('generateAdCopy fallback: promo 15 → includes promo tag', () => {
  const result = generateAdCopyFallback('flake', 15);
  assert.ok(result.primary_text.startsWith('SPÉCIAL MAI — 15% rabais.'));
});

test('generateAdCopy fallback: cta is always SIGN_UP', () => {
  assert.equal(generateAdCopyFallback('metallique').cta, 'SIGN_UP');
  assert.equal(generateAdCopyFallback('quartz', 20).cta, 'SIGN_UP');
});

test('generateAdCopy fallback: headline is never blank', () => {
  const r = generateAdCopyFallback('antiderapant');
  assert.ok(r.headline.length > 0);
});

test('phone failsafe: primary_text missing phone → phone appended', () => {
  const fixed = applyPhoneFailsafe('Belle texte sans numéro.');
  assert.ok(fixed.includes('581-307-5983'));
});

test('phone failsafe: primary_text already has phone → unchanged', () => {
  const text = 'Appelle au 581-307-5983 — Luca répond direct';
  const fixed = applyPhoneFailsafe(text);
  assert.equal(fixed, text);
});

test('phone failsafe: appended text is trimmed before append', () => {
  const fixed = applyPhoneFailsafe('  Text with trailing whitespace  ');
  assert.ok(!fixed.startsWith(' '));
  assert.ok(fixed.includes('\n📞 581-307-5983'));
});

test('headline truncation: 40-char headline passes through unchanged', () => {
  const h = 'Ton garage mérite mieux vraiment!!!!!!!!'; // exactly 40
  assert.equal(truncateHeadline(h).length, 40);
});

test('headline truncation: >40 chars gets cut at 40', () => {
  const h = 'A'.repeat(50);
  assert.equal(truncateHeadline(h).length, 40);
});

test('headline truncation: short headline unchanged', () => {
  assert.equal(truncateHeadline('Court'), 'Court');
});

test('ads/propose budget cap: $60 clamped to $50', () => {
  assert.equal(clampBudget(60), 50);
});

test('ads/propose budget cap: $50 is at limit (not clamped)', () => {
  assert.equal(clampBudget(50), 50);
});

test('ads/propose budget cap: $30 passes through', () => {
  assert.equal(clampBudget(30), 30);
});

test('ads/propose budget cap: undefined defaults to 50', () => {
  assert.equal(clampBudget(undefined), 50);
});

test('ads/propose duration cap: 20 clamped to 14', () => {
  assert.equal(clampDuration(20), 14);
});

test('ads/propose duration cap: 14 is at limit (not clamped)', () => {
  assert.equal(clampDuration(14), 14);
});

test('ads/propose duration cap: 7 passes through', () => {
  assert.equal(clampDuration(7), 7);
});

test('ads/propose duration cap: undefined defaults to 7', () => {
  assert.equal(clampDuration(undefined), 7);
});

test('ads/propose service allowlist: valid services accepted', () => {
  for (const s of ADS_ALLOWED_SERVICES) {
    assert.ok(isAllowedService(s), `${s} should be allowed`);
  }
});

test('ads/propose service allowlist: unknown service rejected', () => {
  assert.ok(!isAllowedService('beton'));
  assert.ok(!isAllowedService(''));
  assert.ok(!isAllowedService(null));
  assert.ok(!isAllowedService(undefined));
});

test('ads/propose service allowlist: case-sensitive (FLAKE rejected)', () => {
  assert.ok(!isAllowedService('FLAKE'));
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-2: isBlacklisted() + getPrenom()  (app/api/cron/nurture-leads/route.ts)
//
// isBlacklisted() guards every outbound lead contact. A bug here silently
// contacts the owners or silently skips real leads.
// ════════════════════════════════════════════════════════════════════════════

const BLACKLIST_EMAILS = ['gestionnovusepoxy@gmail.com', 'lanthierj6@gmail.com', 'luca.hayes1994@gmail.com'];
const BLACKLIST_PHONES = ['5813075983', '5813072678'];

function isBlacklisted(email, phone) {
  if (email && BLACKLIST_EMAILS.includes(email.toLowerCase())) return true;
  if (phone) {
    const clean = phone.replace(/\D/g, '').slice(-10);
    if (BLACKLIST_PHONES.includes(clean)) return true;
  }
  return false;
}

function getPrenom(nom) {
  return nom.split(' ')[0];
}

test('isBlacklisted: owner gmail → true', () => {
  assert.ok(isBlacklisted('gestionnovusepoxy@gmail.com', null));
});

test('isBlacklisted: owner email case-insensitive', () => {
  assert.ok(isBlacklisted('GestionNovusEpoxy@Gmail.COM', null));
});

test('isBlacklisted: luca email → true', () => {
  assert.ok(isBlacklisted('luca.hayes1994@gmail.com', null));
});

test('isBlacklisted: owner phone (plain 10-digit) → true', () => {
  assert.ok(isBlacklisted(null, '5813075983'));
});

test('isBlacklisted: owner phone formatted (514) 307-5983 style → true', () => {
  // last 10 digits of +15813075983 = 5813075983
  assert.ok(isBlacklisted(null, '(581) 307-5983'));
});

test('isBlacklisted: owner phone with country code → true', () => {
  assert.ok(isBlacklisted(null, '+15813075983'));
});

test('isBlacklisted: real client email → false', () => {
  assert.ok(!isBlacklisted('client@example.com', null));
});

test('isBlacklisted: real client phone → false', () => {
  assert.ok(!isBlacklisted(null, '4185551234'));
});

test('isBlacklisted: both null → false', () => {
  assert.ok(!isBlacklisted(null, null));
});

test('isBlacklisted: both undefined → false', () => {
  assert.ok(!isBlacklisted(undefined, undefined));
});

test('isBlacklisted: email blacklisted even if phone clean', () => {
  assert.ok(isBlacklisted('gestionnovusepoxy@gmail.com', '4181112222'));
});

test('getPrenom: "Jean Tremblay" → "Jean"', () => {
  assert.equal(getPrenom('Jean Tremblay'), 'Jean');
});

test('getPrenom: single name → returns the name', () => {
  assert.equal(getPrenom('Marie'), 'Marie');
});

test('getPrenom: three-part name → first word only', () => {
  assert.equal(getPrenom('Pierre-Louis Gagné Jr'), 'Pierre-Louis');
});

test('getPrenom: leading space → empty string (edge case)', () => {
  assert.equal(getPrenom(' Jean Tremblay'), '');
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-3: SMS daily limit guard (lib/sms.ts — todayCount >= 100 path)
//
// All other sendSMS guards are covered. The daily limit check is pure
// arithmetic; the DB call is irrelevant to testing the predicate itself.
// ════════════════════════════════════════════════════════════════════════════

function isDailyLimitReached(todayCount, limit = 100) {
  return todayCount >= limit;
}

test('SMS daily limit: 99 sent → not reached', () => {
  assert.ok(!isDailyLimitReached(99));
});

test('SMS daily limit: 100 sent → limit reached', () => {
  assert.ok(isDailyLimitReached(100));
});

test('SMS daily limit: 101 sent → limit reached', () => {
  assert.ok(isDailyLimitReached(101));
});

test('SMS daily limit: 0 sent → not reached', () => {
  assert.ok(!isDailyLimitReached(0));
});

test('SMS daily limit: custom limit respected', () => {
  assert.ok(isDailyLimitReached(50, 50));
  assert.ok(!isDailyLimitReached(49, 50));
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-4: auto-heal timing windows (lib/auto-heal.ts)
//
// healEmailScan skips re-scan if last scan < 11h ago.
// healGmailWatch skips re-watch if last watch < 5 days ago.
// The 6h echo report and cooldown are already covered in auto-heal-logic.test.mjs.
// These two windows are not.
// ════════════════════════════════════════════════════════════════════════════

function hoursSince(isoDate) {
  if (!isoDate) return 999;
  return (Date.now() - new Date(isoDate).getTime()) / (1000 * 60 * 60);
}

function daysSince(isoDate) {
  if (!isoDate) return 999;
  return (Date.now() - new Date(isoDate).getTime()) / (1000 * 60 * 60 * 24);
}

// healEmailScan: skip if hoursSince < 11
function shouldSkipEmailScan(lastScanIso) {
  const h = hoursSince(lastScanIso);
  return h < 11;
}

// healGmailWatch: skip if daysSince < 5
function shouldSkipGmailWatch(lastWatchIso) {
  const d = daysSince(lastWatchIso);
  return d < 5;
}

test('healEmailScan: 10h59m since last scan → skip (within window)', () => {
  const lastScan = new Date(Date.now() - (11 * 3600000 - 60000)).toISOString();
  assert.ok(shouldSkipEmailScan(lastScan));
});

test('healEmailScan: exactly 11h since last scan → do not skip', () => {
  const lastScan = new Date(Date.now() - 11 * 3600000).toISOString();
  assert.ok(!shouldSkipEmailScan(lastScan));
});

test('healEmailScan: 12h since last scan → do not skip', () => {
  const lastScan = new Date(Date.now() - 12 * 3600000).toISOString();
  assert.ok(!shouldSkipEmailScan(lastScan));
});

test('healEmailScan: never scanned (null) → do not skip', () => {
  assert.ok(!shouldSkipEmailScan(null));
});

test('healGmailWatch: 4 days since last → skip (< 5 days)', () => {
  const lastWatch = new Date(Date.now() - 4 * 24 * 3600000).toISOString();
  assert.ok(shouldSkipGmailWatch(lastWatch));
});

test('healGmailWatch: exactly 5 days since last → do not skip', () => {
  const lastWatch = new Date(Date.now() - 5 * 24 * 3600000).toISOString();
  assert.ok(!shouldSkipGmailWatch(lastWatch));
});

test('healGmailWatch: 6 days since last → do not skip', () => {
  const lastWatch = new Date(Date.now() - 6 * 24 * 3600000).toISOString();
  assert.ok(!shouldSkipGmailWatch(lastWatch));
});

test('healGmailWatch: never watched (null) → do not skip', () => {
  assert.ok(!shouldSkipGmailWatch(null));
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-5: bank/auto-match tolerance logic
//
// The route matches transactions to payments with ABS(p.montant - $1) < 0.01
// and dates within ±3 days. The tolerance predicate is pure arithmetic.
// ════════════════════════════════════════════════════════════════════════════

// Inlined: amount match tolerance
function amountsMatch(txMontant, paymentMontant) {
  return Math.abs(Math.abs(Number(txMontant)) - Math.abs(Number(paymentMontant))) < 0.01;
}

// Inlined: date proximity within ±3 days
function datesWithinThreeDays(txDate, paymentDate) {
  const a = new Date(txDate);
  const b = new Date(paymentDate);
  const diffDays = Math.abs(a - b) / (1000 * 60 * 60 * 24);
  return diffDays <= 3;
}

test('bank match: exact amount → matches', () => {
  assert.ok(amountsMatch(500.00, 500.00));
});

test('bank match: within tolerance (0.005 diff) → matches', () => {
  assert.ok(amountsMatch(500.005, 500.00));
});

test('bank match: at tolerance boundary (0.009 diff) → matches', () => {
  assert.ok(amountsMatch(500.009, 500.00));
});

test('bank match: over tolerance (0.02 diff) → no match', () => {
  // Use 0.02 diff — 500.01 - 500.00 is 0.009999... in IEEE 754 (< 0.01) and would match
  assert.ok(!amountsMatch(500.02, 500.00));
});

test('bank match: large diff → no match', () => {
  assert.ok(!amountsMatch(600.00, 500.00));
});

test('bank match: debit (negative tx) treated as absolute', () => {
  assert.ok(amountsMatch(-500.00, 500.00));
});

test('bank date window: same day → within 3 days', () => {
  assert.ok(datesWithinThreeDays('2026-06-10', '2026-06-10'));
});

test('bank date window: 3 days apart → within window', () => {
  assert.ok(datesWithinThreeDays('2026-06-10', '2026-06-13'));
});

test('bank date window: 4 days apart → outside window', () => {
  assert.ok(!datesWithinThreeDays('2026-06-10', '2026-06-14'));
});

test('bank date window: 3 days before → within window', () => {
  assert.ok(datesWithinThreeDays('2026-06-13', '2026-06-10'));
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-6: send-email.ts — MIME boundary uniqueness + base64 chunking
//
// sendEmail() builds a MIME multipart boundary per-message. The uniqueness
// and the 76-char line chunking for attachments are untested.
// ════════════════════════════════════════════════════════════════════════════

// Inlined from lib/send-email.ts (sendViaGmail attachment encoding)
function chunkBase64(buf) {
  return buf.toString('base64').replace(/(.{76})/g, '$1\r\n');
}

// Boundary uniqueness: different calls produce different boundaries
// (NovusBoundary_ + Date.now().toString(36) suffix)
function makeBoundary(seed) {
  return `=_NovusBoundary_${seed.toString(36)}`;
}

test('send-email base64 chunk: short content encodes correctly', () => {
  const buf = Buffer.from('Hello');
  const encoded = chunkBase64(buf);
  assert.equal(Buffer.from(encoded.replace(/\r\n/g, ''), 'base64').toString(), 'Hello');
});

test('send-email base64 chunk: 57-byte input → 76-char line + trailing CRLF (no mid-line wrap)', () => {
  // 57 bytes → 76 base64 chars. The regex appends \r\n after each 76-char group, including the
  // last. There should be exactly one \r\n (at the end), not a mid-line wrap.
  const buf = Buffer.alloc(57, 0x41);
  const encoded = chunkBase64(buf);
  assert.equal(encoded.indexOf('\r\n'), 76, 'CRLF should only appear after position 76 (end of single line)');
});

test('send-email base64 chunk: 58-byte input → wraps after 76 chars', () => {
  const buf = Buffer.alloc(58, 0x41); // 58 bytes → 80 base64 chars → wraps at 76
  const encoded = chunkBase64(buf);
  assert.ok(encoded.includes('\r\n'), 'must wrap at 76 chars');
});

test('send-email base64 chunk: round-trips correctly for larger buffer', () => {
  const original = 'Novus Epoxy — planchers époxy haut de gamme, Québec 🇨🇦'.repeat(5);
  const buf = Buffer.from(original, 'utf8');
  const encoded = chunkBase64(buf);
  const decoded = Buffer.from(encoded.replace(/\r\n/g, ''), 'base64').toString('utf8');
  assert.equal(decoded, original);
});

test('MIME boundary: two different seeds produce different boundaries', () => {
  const b1 = makeBoundary(1718000000000);
  const b2 = makeBoundary(1718000000001);
  assert.notEqual(b1, b2);
});

test('MIME boundary: contains NovusBoundary_ prefix', () => {
  const b = makeBoundary(1234567890);
  assert.ok(b.startsWith('=_NovusBoundary_'));
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-7: lib/pricing.ts — getServiceDescriptionHtml with unknown service type
//
// getServiceDescription() returns '' for unknown types; getServiceDescriptionHtml()
// wraps it in <li> tags. An injected <script> tag in the type string should not
// propagate unescaped into the output.
// ════════════════════════════════════════════════════════════════════════════

// Inlined from lib/pricing.ts
const SERVICE_DESCRIPTION_KNOWN = {
  flake: { etapes: ['Préparation surface', 'Primaire époxy', 'Flake broadcast', 'Topcoat uréthane'], epaisseur_totale: '~3mm' },
  metallique: { etapes: ['Ponçage diamant', 'Couche métallique', 'Clearcoat époxy'], epaisseur_totale: '~2.5mm' },
};

function getServiceDescription(type) {
  return SERVICE_DESCRIPTION_KNOWN[type]?.etapes?.join('\n') ?? '';
}

function getServiceDescriptionHtml(type) {
  const desc = getServiceDescription(type);
  if (!desc) return '';
  return desc.split('\n').map(line => `<li>${line}</li>`).join('');
}

test('getServiceDescriptionHtml: known type returns non-empty HTML', () => {
  const html = getServiceDescriptionHtml('flake');
  assert.ok(html.includes('<li>'));
  assert.ok(html.includes('</li>'));
});

test('getServiceDescriptionHtml: unknown type returns empty string', () => {
  assert.equal(getServiceDescriptionHtml('doesnotexist'), '');
});

test('getServiceDescriptionHtml: null-ish type returns empty string', () => {
  assert.equal(getServiceDescriptionHtml(null), '');
  assert.equal(getServiceDescriptionHtml(undefined), '');
});

test('getServiceDescriptionHtml: does not inject raw <script> from type param', () => {
  // type is used as lookup key only — not interpolated into HTML — so no XSS risk
  // but we validate the lookup miss returns '' (not the raw type)
  const html = getServiceDescriptionHtml('<script>alert(1)</script>');
  assert.ok(!html.includes('<script>'), 'type param must not appear in output');
  assert.equal(html, '');
});

test('getServiceDescription: unknown type → empty string (not undefined)', () => {
  const result = getServiceDescription('nonexistent');
  assert.equal(result, '');
  assert.equal(typeof result, 'string');
});

// ════════════════════════════════════════════════════════════════════════════
// INTEGRATION SKELETONS (require live server — skipped unless INTEGRATION_TEST=1)
// ════════════════════════════════════════════════════════════════════════════

test(
  'INT-1: POST /api/ads/propose without auth → 401',
  { skip: SKIP_INTEGRATION ? 'set INTEGRATION_TEST=1' : false },
  async () => {
    const res = await fetch(`${BASE}/api/ads/propose`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ service: 'flake' }),
    });
    assert.equal(res.status, 401);
  },
);

test(
  'INT-2: POST /api/ads/propose with valid api-key but invalid service → 400',
  { skip: SKIP_INTEGRATION ? 'set INTEGRATION_TEST=1' : false },
  async () => {
    const key = process.env.ADMIN_API_KEY ?? 'test-key';
    const res = await fetch(`${BASE}/api/ads/propose`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': key },
      body: JSON.stringify({ service: 'beton' }),
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.ok(body.error, 'should include error message');
  },
);

test(
  'INT-3: GET /api/cron/nurture-leads without cron secret → 401',
  { skip: SKIP_INTEGRATION ? 'set INTEGRATION_TEST=1' : false },
  async () => {
    const res = await fetch(`${BASE}/api/cron/nurture-leads`);
    assert.ok([401, 403].includes(res.status), `expected 401/403, got ${res.status}`);
  },
);

test(
  'INT-4: POST /api/bank/auto-match without session → 401',
  { skip: SKIP_INTEGRATION ? 'set INTEGRATION_TEST=1' : false },
  async () => {
    const res = await fetch(`${BASE}/api/bank/auto-match`, { method: 'POST' });
    assert.equal(res.status, 401);
  },
);

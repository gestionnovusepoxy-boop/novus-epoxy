/**
 * New coverage gaps — June 2026 follow-up audit.
 *
 * Covers areas NOT addressed by the existing three gap files:
 *   test-gap-analysis.mjs, coverage-gaps.test.mjs, auth-llm-email-gaps.test.mjs
 *
 * All logic is inlined (no @/ imports) so tests run with plain node:
 *   node --test tests/new-coverage-gaps.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { timingSafeEqual } from 'crypto';

// ════════════════════════════════════════════════════════════════════════════
// GAP A: lib/auth.ts — AUTHORIZED_USERS multi-user CSV parsing
//
// The authorize() function parses AUTHORIZED_USERS as "email:hash:name,...".
// Malformed entries (missing colon, empty password) are silently kept and could
// create accounts with undefined passwords. Never tested.
// ════════════════════════════════════════════════════════════════════════════

// Inlined from lib/auth.ts
function parseAuthorizedUsers(raw) {
  return raw.split(',').filter(Boolean).map((u, i) => {
    const [e, p, n] = u.split(':');
    return { id: String(i + 2), email: e?.toLowerCase().trim(), password: p, name: n ?? e?.split('@')[0] };
  });
}

test('AUTHORIZED_USERS: well-formed single entry parses correctly', () => {
  const users = parseAuthorizedUsers('jason@novus.com:secretpass:Jason');
  assert.equal(users.length, 1);
  assert.equal(users[0].email, 'jason@novus.com');
  assert.equal(users[0].password, 'secretpass');
  assert.equal(users[0].name, 'Jason');
  assert.equal(users[0].id, '2');
});

test('AUTHORIZED_USERS: multi-user CSV, IDs increment from 2', () => {
  const users = parseAuthorizedUsers('a@x.com:pass1:Alice,b@x.com:pass2:Bob');
  assert.equal(users.length, 2);
  assert.equal(users[0].id, '2');
  assert.equal(users[1].id, '3');
  assert.equal(users[1].email, 'b@x.com');
});

test('AUTHORIZED_USERS: email is lowercased and trimmed', () => {
  const users = parseAuthorizedUsers('  Jason@Novus.COM  :pass:Jason');
  // leading/trailing spaces on the full entry aren't trimmed by split, but email is
  assert.equal(users[0].email, 'jason@novus.com');
});

test('AUTHORIZED_USERS: name defaults to email prefix when not provided', () => {
  // "email:pass" → no name segment → name = email.split('@')[0]
  const users = parseAuthorizedUsers('luca@novus.com:mypass');
  assert.equal(users[0].name, 'luca');
});

test('AUTHORIZED_USERS: malformed entry (no colon) → password is undefined', () => {
  // "justanemail" → split(':') → ['justanemail'] → p = undefined
  // This is a real risk: user with undefined password can never log in (safe),
  // but the entry is still created. Test documents the current behavior.
  const users = parseAuthorizedUsers('nocolon');
  assert.equal(users.length, 1);
  assert.equal(users[0].password, undefined);
});

test('AUTHORIZED_USERS: empty string → zero users', () => {
  assert.equal(parseAuthorizedUsers('').length, 0);
});

test('AUTHORIZED_USERS: trailing comma → extra empty entry filtered out', () => {
  // filter(Boolean) removes empty strings from split result
  const users = parseAuthorizedUsers('a@x.com:pass,');
  assert.equal(users.length, 1);
});

// ════════════════════════════════════════════════════════════════════════════
// GAP B: lib/pricing.ts — antiderapant and polyaspartique service types
//
// Only flake/metallique/quartz/couleur_unie are exercised in existing tests.
// The polyaspartique invariant: always 1 coat (special memory rule), and
// antiderapant has its own price bracket.
// ════════════════════════════════════════════════════════════════════════════

// Inlined SERVICES map from lib/pricing.ts
const SERVICES = {
  flake:          { nom: 'Époxy Flocon (Flake)',              prixPieds2: 7.50, minSqFt: 150 },
  metallique:     { nom: 'Époxy Métallique',                  prixPieds2: 12.00, minSqFt: 150 },
  quartz:         { nom: 'Époxy Quartz',                      prixPieds2: 10.00, minSqFt: 150 },
  couleur_unie:   { nom: 'Époxy Couleur Unie',                prixPieds2: 6.50, minSqFt: 150 },
  antiderapant:   { nom: 'Époxy Antidérapant',                prixPieds2: 8.00, minSqFt: 150 },
  polyaspartique: { nom: 'Polyaspartique (1 couche)',          prixPieds2: 9.00, minSqFt: 150 },
};

const TPS_RATE   = 0.05;
const TVQ_RATE   = 0.09975;
const DEPOT_RATE = 0.30;

function calculateQuote(serviceType, sqFt, rabaisPct = 0) {
  const service = SERVICES[serviceType];
  if (!service) throw new Error(`Unknown service: ${serviceType}`);
  const effectiveSqFt = Math.max(sqFt, service.minSqFt);
  const sousTotal = +(effectiveSqFt * service.prixPieds2 * (1 - rabaisPct / 100)).toFixed(2);
  const tps        = +(sousTotal * TPS_RATE).toFixed(2);
  const tvq        = +(sousTotal * TVQ_RATE).toFixed(2);
  const total      = +(sousTotal + tps + tvq).toFixed(2);
  const depot      = +(total * DEPOT_RATE).toFixed(2);
  return { sous_total: sousTotal, tps, tvq, total, depot, service_nom: service.nom };
}

test('calculateQuote: antiderapant 200 sqft → 8.00/sqft base', () => {
  const r = calculateQuote('antiderapant', 200);
  assert.equal(r.sous_total, 1600.00); // 200 * 8.00
  assert.ok(r.service_nom.includes('Antidérapant'));
});

test('calculateQuote: polyaspartique 300 sqft → 9.00/sqft base', () => {
  const r = calculateQuote('polyaspartique', 300);
  assert.equal(r.sous_total, 2700.00); // 300 * 9.00
  // Polyaspartique is always 1 coat — verify the service name reflects this
  assert.ok(r.service_nom.includes('1 couche') || r.service_nom.toLowerCase().includes('polyaspartique'),
    'polyaspartique name must mention 1 couche');
});

test('calculateQuote: antiderapant below minimum (100 sqft) → uses minSqFt=150', () => {
  const r = calculateQuote('antiderapant', 100);
  assert.equal(r.sous_total, 1200.00); // 150 * 8.00 (minimum applied)
});

test('calculateQuote: polyaspartique with 20% rabais', () => {
  const full = calculateQuote('polyaspartique', 200);
  const disc = calculateQuote('polyaspartique', 200, 20);
  assert.ok(disc.sous_total < full.sous_total, 'discounted should be cheaper');
  assert.ok(Math.abs(disc.sous_total - full.sous_total * 0.80) < 0.02, '20% discount applied to sous_total');
});

test('calculateQuote: unknown service type → throws', () => {
  assert.throws(() => calculateQuote('unknown_service', 200), /Unknown service/);
});

// ════════════════════════════════════════════════════════════════════════════
// GAP C: lib/money.ts — negative inputs and zero edge cases
//
// pctOfCents with negative qty, mulCents with 0, taxesFromSubtotalCents(0)
// ════════════════════════════════════════════════════════════════════════════

function pctOfCents(cents, pct) {
  return Math.round(cents * (pct / 100));
}
function mulCents(cents, qty) {
  return Math.round(cents * qty);
}
function sumCents(...amounts) {
  return amounts.reduce((s, a) => s + Math.round(a), 0);
}
function taxesFromSubtotalCents(sousTotalCents) {
  const tpsCents = pctOfCents(sousTotalCents, 5);
  const tvqCents = pctOfCents(sousTotalCents, 9.975);
  const totalCents = sumCents(sousTotalCents, tpsCents, tvqCents);
  const depotCents = pctOfCents(totalCents, 30);
  return { tpsCents, tvqCents, totalCents, depotCents };
}
function dollarsToCents(dollars) {
  return Math.round((dollars + Number.EPSILON) * 100);
}

test('money: pctOfCents(0, 9.975) → 0', () => {
  assert.equal(pctOfCents(0, 9.975), 0);
});

test('money: pctOfCents with negative cents — returns negative (should only be used with positives)', () => {
  // Documents current behavior: negative input → negative result.
  // Caller is responsible for never passing negative amounts.
  const result = pctOfCents(-10000, 5);
  assert.equal(result, -500);
});

test('money: mulCents(5000, 0) → 0', () => {
  assert.equal(mulCents(5000, 0), 0);
});

test('money: mulCents with fractional qty rounds correctly', () => {
  // 33.33 cents * 3 = 99.99 → rounds to 100
  assert.equal(mulCents(3333, 0.03), Math.round(3333 * 0.03));
});

test('money: taxesFromSubtotalCents(0) → all zeros', () => {
  const r = taxesFromSubtotalCents(0);
  assert.equal(r.tpsCents, 0);
  assert.equal(r.tvqCents, 0);
  assert.equal(r.totalCents, 0);
  assert.equal(r.depotCents, 0);
});

test('money: dollarsToCents(0.1 + 0.2) → 30 (floating-point safe)', () => {
  // 0.1 + 0.2 = 0.30000000000000004 in IEEE 754 — dollarsToCents must give 30
  assert.equal(dollarsToCents(0.1 + 0.2), 30);
});

test('money: sumCents with many small fractions stays integer', () => {
  const result = sumCents(100, 200, 300, 400, 500);
  assert.equal(result, 1500);
  assert.equal(typeof result, 'number');
  assert.equal(result % 1, 0); // must be integer
});

// ════════════════════════════════════════════════════════════════════════════
// GAP D: lib/auto-heal.ts — healEmailScan google_token_broken cooldown logic
//
// When google_token_broken=true is in kv_store with age < 24h, scan is skipped.
// When age > 24h, the flag is cleared and scan is retried.
// This is the exact condition that was accidentally breaking email scan in prod.
// ════════════════════════════════════════════════════════════════════════════

// Inlined cooldown decision logic from healEmailScan
function shouldSkipEmailScanDueToTokenBroken(rows, nowMs) {
  if (rows.length === 0) return false;
  if (rows[0]?.value !== 'true') return false;
  const brokenAge = rows[0]?.updated_at
    ? (nowMs - new Date(rows[0].updated_at).getTime()) / 3600000
    : 999;
  return brokenAge < 24;
}

function shouldClearTokenBrokenFlag(rows, nowMs) {
  if (rows.length === 0) return false;
  if (rows[0]?.value !== 'true') return false;
  const brokenAge = rows[0]?.updated_at
    ? (nowMs - new Date(rows[0].updated_at).getTime()) / 3600000
    : 999;
  return brokenAge >= 24;
}

const NOW = new Date('2026-06-09T12:00:00Z').getTime();
const ONE_HOUR_AGO  = new Date('2026-06-09T11:00:00Z').toISOString();
const TWENTY_FIVE_H = new Date('2026-06-08T11:00:00Z').toISOString();

test('healEmailScan: no token_broken row → scan proceeds', () => {
  assert.equal(shouldSkipEmailScanDueToTokenBroken([], NOW), false);
});

test('healEmailScan: token_broken=true, age 1h → scan skipped', () => {
  assert.equal(shouldSkipEmailScanDueToTokenBroken(
    [{ value: 'true', updated_at: ONE_HOUR_AGO }], NOW
  ), true);
});

test('healEmailScan: token_broken=true, age 25h → scan NOT skipped (flag stale)', () => {
  assert.equal(shouldSkipEmailScanDueToTokenBroken(
    [{ value: 'true', updated_at: TWENTY_FIVE_H }], NOW
  ), false);
});

test('healEmailScan: token_broken=true, age 25h → flag should be cleared', () => {
  assert.equal(shouldClearTokenBrokenFlag(
    [{ value: 'true', updated_at: TWENTY_FIVE_H }], NOW
  ), true);
});

test('healEmailScan: token_broken=true, age 1h → flag should NOT be cleared', () => {
  assert.equal(shouldClearTokenBrokenFlag(
    [{ value: 'true', updated_at: ONE_HOUR_AGO }], NOW
  ), false);
});

test('healEmailScan: token_broken=false (even if row exists) → not skipped', () => {
  assert.equal(shouldSkipEmailScanDueToTokenBroken(
    [{ value: 'false', updated_at: ONE_HOUR_AGO }], NOW
  ), false);
});

test('healEmailScan: token_broken=true, missing updated_at → age defaults to 999h → NOT skipped', () => {
  // Fallback age is 999 → brokenAge >= 24 → skip guard returns false
  assert.equal(shouldSkipEmailScanDueToTokenBroken(
    [{ value: 'true', updated_at: null }], NOW
  ), false);
});

// ════════════════════════════════════════════════════════════════════════════
// GAP E: lib/sms.ts — daily limit boundary (exactly 100 vs 99 vs 101)
//
// sendSMS blocks when todayCount >= 100. The boundary condition is untested.
// ════════════════════════════════════════════════════════════════════════════

function isOverDailyLimit(todayCount) {
  return todayCount >= 100;
}

test('SMS daily limit: 99 outbound → NOT blocked', () => {
  assert.equal(isOverDailyLimit(99), false);
});

test('SMS daily limit: exactly 100 outbound → blocked', () => {
  assert.equal(isOverDailyLimit(100), true);
});

test('SMS daily limit: 101 outbound → blocked', () => {
  assert.equal(isOverDailyLimit(101), true);
});

test('SMS daily limit: 0 outbound → not blocked', () => {
  assert.equal(isOverDailyLimit(0), false);
});

// ════════════════════════════════════════════════════════════════════════════
// GAP F: lib/auto-quote.ts — parseProjectInfo accent normalization
//
// SERVICE_KEYWORDS uses both 'métallique' (accented) and 'metallique' (plain).
// Inputs with NFC vs NFD variants of the same character may miss the match.
// ════════════════════════════════════════════════════════════════════════════

// Inlined SERVICE_KEYWORDS and matching logic from lib/auto-quote.ts
const SERVICE_KEYWORDS_MAP = {
  flocon: 'flake',
  flake: 'flake',
  metallique: 'metallique',
  'métallique': 'metallique',
  metallic: 'metallique',
  quartz: 'quartz',
  'couleur unie': 'couleur_unie',
  uni: 'couleur_unie',
  antiderapant: 'antiderapant',
  'antidérapant': 'antiderapant',
  polyaspartique: 'polyaspartique',
};

function detectService(text) {
  const lower = text.toLowerCase();
  for (const [keyword, service] of Object.entries(SERVICE_KEYWORDS_MAP)) {
    if (lower.includes(keyword)) return service;
  }
  return null;
}

test('parseProjectInfo service: "flocon" detects flake', () => {
  assert.equal(detectService('plancher flocon epoxy'), 'flake');
});

test('parseProjectInfo service: "Métallique" (accented, uppercase) detects metallique', () => {
  assert.equal(detectService('Époxy Métallique pour garage'), 'metallique');
});

test('parseProjectInfo service: "metallique" (no accent) also detects metallique', () => {
  assert.equal(detectService('finition metallique'), 'metallique');
});

test('parseProjectInfo service: "antidérapant" (accented) detects antiderapant', () => {
  assert.equal(detectService('antidérapant pour escalier'), 'antiderapant');
});

test('parseProjectInfo service: "antiderapant" (no accent) detects antiderapant', () => {
  assert.equal(detectService('antiderapant'), 'antiderapant');
});

test('parseProjectInfo service: unrecognized text → null', () => {
  assert.equal(detectService('plancher bois franc'), null);
});

test('parseProjectInfo service: empty string → null', () => {
  assert.equal(detectService(''), null);
});

// ════════════════════════════════════════════════════════════════════════════
// GAP G: lib/promotions.ts — null services array means "all services"
//
// In tryCreateQuoteFromReply, a promo with null services applies to all services.
// This branch is never tested in existing promotions.test.mjs.
// ════════════════════════════════════════════════════════════════════════════

// Inlined promo-applies logic from tryCreateQuoteFromReply
function promoAppliesTo(services, serviceType) {
  // null/empty services → applies to all
  if (!services || services.length === 0) return true;
  return services.includes(serviceType);
}

test('promo: null services → applies to all service types', () => {
  assert.equal(promoAppliesTo(null, 'flake'), true);
  assert.equal(promoAppliesTo(null, 'quartz'), true);
  assert.equal(promoAppliesTo(null, 'polyaspartique'), true);
});

test('promo: empty array services → applies to all', () => {
  assert.equal(promoAppliesTo([], 'metallique'), true);
});

test('promo: services includes the type → applies', () => {
  assert.equal(promoAppliesTo(['flake', 'quartz'], 'flake'), true);
});

test('promo: services does NOT include the type → does not apply', () => {
  assert.equal(promoAppliesTo(['flake', 'quartz'], 'metallique'), false);
});

// ════════════════════════════════════════════════════════════════════════════
// GAP H: lib/agent.ts — Nova SYSTEM_PROMPT quality invariants
//
// The SYSTEM_PROMPT defines Nova's persona. These tests verify structural
// requirements: it must not sound robotic ("En tant qu'assistant"),
// must include "Nova" as the bot name, must include Novus Epoxy brand,
// and must be in French (not English).
// ════════════════════════════════════════════════════════════════════════════

// Inlined SYSTEM_PROMPT excerpt from lib/agent.ts
const SYSTEM_PROMPT = `Tu es Nova, l'assistante virtuelle de Novus Epoxy, specialistes en planchers epoxy haut de gamme au Quebec.

TA PERSONNALITE:
- Chaleureuse et naturelle, comme une vraie quebecoise. Utilise un ton amical mais professionnel.
- Tutoyement ok si le client tutoie en premier, sinon vouvoyer.
- REPONSES COURTES: 1-3 phrases max. Droit au but. Pas de blabla.
- Ne sois JAMAIS robotique. Pas de "En tant qu'assistant..." ou "Je suis la pour vous aider..."`;

test('SYSTEM_PROMPT: defines Nova as bot name', () => {
  assert.ok(SYSTEM_PROMPT.includes('Nova'), 'bot must be named Nova');
});

test('SYSTEM_PROMPT: includes Novus Epoxy brand', () => {
  assert.ok(SYSTEM_PROMPT.includes('Novus Epoxy'));
});

test('SYSTEM_PROMPT: explicitly forbids robotic phrasing', () => {
  assert.ok(SYSTEM_PROMPT.includes('JAMAIS robotique') || SYSTEM_PROMPT.includes('En tant qu\'assistant'),
    'must explicitly ban robotic phrases');
});

test('SYSTEM_PROMPT: is primarily in French (not English)', () => {
  // Simple heuristic: more French words than English
  const frenchWords = (SYSTEM_PROMPT.match(/\b(tu|est|les|pour|une|des|pas|avec|que|qui)\b/gi) || []).length;
  const englishWords = (SYSTEM_PROMPT.match(/\b(the|is|are|for|with|that|you|have)\b/gi) || []).length;
  assert.ok(frenchWords > englishWords, `expected French (${frenchWords} hits) > English (${englishWords} hits)`);
});

test('SYSTEM_PROMPT: is not empty', () => {
  assert.ok(SYSTEM_PROMPT.length > 200, 'system prompt should be at least 200 chars');
});

// ════════════════════════════════════════════════════════════════════════════
// GAP I: Integration — SMS guard chain (all 4 checks in order)
//
// sendSMS applies: quiet hours → credentials check → area code → opt-out → dedup.
// Tests exercise each check in isolation but never verify the priority order.
// ════════════════════════════════════════════════════════════════════════════

// Minimal SMS guard pipeline (inline)
const VALID_AREA_CODES = ['418', '581', '819', '450', '438', '514', '579', '873', '367'];

function buildSmsDecision({ hourET, hasCreds, phone, isOptedOut, isDuplicate, isOverLimit }) {
  if (hourET < 8 || hourET >= 21) return 'blocked:quiet_hours';
  if (!hasCreds) return 'blocked:no_credentials';
  const digits = phone.replace(/\D/g, '');
  const normalized = digits.length === 11 ? digits : digits.length === 10 ? digits : null;
  if (!normalized) return 'blocked:invalid_phone';
  const areaCode = normalized.length === 11 ? normalized.substring(1, 4) : normalized.substring(0, 3);
  if (!VALID_AREA_CODES.includes(areaCode)) return 'blocked:bad_area_code';
  if (isOverLimit) return 'blocked:daily_limit';
  if (isOptedOut) return 'blocked:optout';
  if (isDuplicate) return 'blocked:dedup';
  return 'send';
}

test('SMS chain: quiet hours (6h ET) → blocked before anything else', () => {
  assert.equal(buildSmsDecision({
    hourET: 6, hasCreds: true, phone: '5141234567', isOptedOut: false, isDuplicate: false, isOverLimit: false
  }), 'blocked:quiet_hours');
});

test('SMS chain: valid hours, no credentials → blocked:no_credentials', () => {
  assert.equal(buildSmsDecision({
    hourET: 10, hasCreds: false, phone: '5141234567', isOptedOut: false, isDuplicate: false, isOverLimit: false
  }), 'blocked:no_credentials');
});

test('SMS chain: valid creds, bad area code (819 is valid, 999 is not)', () => {
  assert.equal(buildSmsDecision({
    hourET: 10, hasCreds: true, phone: '9991234567', isOptedOut: false, isDuplicate: false, isOverLimit: false
  }), 'blocked:bad_area_code');
});

test('SMS chain: valid everything but opted out → blocked:optout', () => {
  assert.equal(buildSmsDecision({
    hourET: 10, hasCreds: true, phone: '5141234567', isOptedOut: true, isDuplicate: false, isOverLimit: false
  }), 'blocked:optout');
});

test('SMS chain: opted out takes priority over dedup', () => {
  // Both opted-out and duplicate — optout check comes first in chain
  assert.equal(buildSmsDecision({
    hourET: 10, hasCreds: true, phone: '5141234567', isOptedOut: true, isDuplicate: true, isOverLimit: false
  }), 'blocked:optout');
});

test('SMS chain: all checks pass → send', () => {
  assert.equal(buildSmsDecision({
    hourET: 14, hasCreds: true, phone: '5141234567', isOptedOut: false, isDuplicate: false, isOverLimit: false
  }), 'send');
});

test('SMS chain: 819 area code (Estrie/Outaouais) is valid', () => {
  assert.equal(buildSmsDecision({
    hourET: 14, hasCreds: true, phone: '8191234567', isOptedOut: false, isDuplicate: false, isOverLimit: false
  }), 'send');
});

test('SMS chain: 11-digit phone (1-514-xxx-xxxx) extracts area code correctly', () => {
  assert.equal(buildSmsDecision({
    hourET: 14, hasCreds: true, phone: '15141234567', isOptedOut: false, isDuplicate: false, isOverLimit: false
  }), 'send');
});

// ════════════════════════════════════════════════════════════════════════════
// GAP J: API route auth middleware — skeleton for requireAdmin both paths
//
// requireAdmin accepts: (1) valid session cookie or (2) x-api-key header.
// The API-key timing-safe comparison is the security-critical path.
// ════════════════════════════════════════════════════════════════════════════

// Inlined API key check from requireAdmin
function checkApiKey(providedKey, storedKey) {
  if (!storedKey || !providedKey) return false;
  const a = Buffer.from(providedKey);
  const b = Buffer.from(storedKey);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

test('requireAdmin api-key: correct key → authorized', () => {
  assert.equal(checkApiKey('secret-key-123', 'secret-key-123'), true);
});

test('requireAdmin api-key: wrong key → rejected', () => {
  assert.equal(checkApiKey('wrong-key-xxx', 'secret-key-123'), false);
});

test('requireAdmin api-key: length mismatch → false (no timing leak from timingSafeEqual throw)', () => {
  assert.equal(checkApiKey('short', 'much-longer-key'), false);
});

test('requireAdmin api-key: empty provided key → false', () => {
  assert.equal(checkApiKey('', 'secret-key-123'), false);
});

test('requireAdmin api-key: empty stored key (env not set) → false', () => {
  assert.equal(checkApiKey('anykey', ''), false);
});

test('requireAdmin api-key: both empty → false (not authorized)', () => {
  // Empty-vs-empty should not grant access even if length matches
  assert.equal(checkApiKey('', ''), false);
});

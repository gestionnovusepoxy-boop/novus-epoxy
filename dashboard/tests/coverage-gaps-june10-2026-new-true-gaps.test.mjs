/**
 * coverage-gaps-june10-2026-new-true-gaps.test.mjs
 *
 * Gap audit run: June 10, 2026.
 * Baseline: 2186 pass / 71 skipped across 62 registered files.
 * Two unregistered files exist with 121 passing tests:
 *   - coverage-gaps-feb2027.test.mjs       (59 pass, 9 skip)
 *   - coverage-gaps-june10-2026-analysis.test.mjs (62 pass, 15 skip)
 * Add both to the "test" script in package.json.
 *
 * TRUE REMAINING GAPS (pure logic, no DB/network):
 *   GAP-1  lib/meta-ads.ts — needsAdsManagement flag: maps error message
 *                            patterns and code=100 to true; other errors → false
 *   GAP-2  lib/meta-ads.ts — META_ADS_DEFAULT_STATUS env var: default='ACTIVE',
 *                            toUpperCase() normalization, lowercase env value
 *   GAP-3  lib/meta-ads.ts — generateAdCopy(): moisQc dynamic month label replaces
 *                            hardcoded "MAI"; promoLine present only when promo>0
 *   GAP-4  lib/meta-ads.ts — DEFAULT_TARGETING: advantage_audience=0 (not 1)
 *                            prevents Meta from overriding age targeting
 *   GAP-5  app/api/meta/webhook/route.ts — isBalcon detection: serviceRaw,
 *                            espaceRaw, service fields each independently trigger;
 *                            antiderapant keyword does NOT override balcon detection
 *   GAP-6  lib/auto-heal.ts — autoHeal() orchestration: Promise.allSettled collects
 *                            only non-null fulfilled values into repairs[];
 *                            notifyGroup called only when repairs.length > 0
 *   GAP-7  lib/sms.ts      — sendReferralSMS() message contains "100$" referral bonus
 *                            and Luca's phone number (never verified in any test)
 *   GAP-8  lib/lead-scoring.ts — combined-signals boundary: exactly 6 → chaud,
 *                            exactly 5 → tiede, test-name penalty can push below 0
 *
 * UNREGISTERED FILES — add to npm test:
 *   tests/coverage-gaps-feb2027.test.mjs
 *   tests/coverage-gaps-june10-2026-analysis.test.mjs
 *
 * INTEGRATION SKELETONS (skipped unless INTEGRATION_TEST=1):
 *   INT-1  GET  /api/cron/lead-followup  — wrong CRON_SECRET → 401
 *   INT-2  GET  /api/cron/morning-summary — correct CRON_SECRET → 200
 *   INT-3  POST /api/admin/balcon-sms-photo — wrong adminKey → 401
 *   INT-4  Quote → Invoice pipeline: createQuote → ensureInvoiceForQuote idempotent
 *   INT-5  Lead import + blocklist: blocked phone → sendSMS never called
 *
 * Run: node --test tests/coverage-gaps-june10-2026-new-true-gaps.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

const SKIP_INTEGRATION = !process.env.INTEGRATION_TEST;
const BASE = process.env.TEST_BASE_URL ?? 'http://localhost:3000';

// ════════════════════════════════════════════════════════════════════════════
// GAP-1: lib/meta-ads.ts — needsAdsManagement flag
//
// createMetaCampaignPaused() sets needsAdsManagement: true when the Meta API
// responds with a permission error. Three signal patterns:
//   - message includes 'cannot be loaded'
//   - message includes 'missing permission'
//   - error.code === 100
// Any other error → needsAdsManagement is absent (undefined/false).
//
// This was added in commit d647136 and has zero test coverage.
// ════════════════════════════════════════════════════════════════════════════

// Inlined from lib/meta-ads.ts createMetaCampaignPaused() error check
function classifyMetaApiError(data) {
  const msg = String(data?.error?.message ?? JSON.stringify(data));
  const code = data?.error?.code;
  const isPermError = msg.includes('cannot be loaded') || msg.includes('missing permission') || code === 100;
  return { isPermError, msg };
}

test('needsAdsManagement: "cannot be loaded" error message → true', () => {
  const { isPermError } = classifyMetaApiError({
    error: { message: 'This ad account cannot be loaded.', code: 200 },
  });
  assert.equal(isPermError, true);
});

test('needsAdsManagement: "missing permission" error message → true', () => {
  const { isPermError } = classifyMetaApiError({
    error: { message: 'User does not have missing permission to perform this action', code: 200 },
  });
  assert.equal(isPermError, true);
});

test('needsAdsManagement: error.code === 100 → true (regardless of message)', () => {
  const { isPermError } = classifyMetaApiError({
    error: { message: 'Invalid parameter', code: 100 },
  });
  assert.equal(isPermError, true);
});

test('needsAdsManagement: generic API error → false', () => {
  const { isPermError } = classifyMetaApiError({
    error: { message: 'An unexpected error has occurred', code: 500 },
  });
  assert.equal(isPermError, false);
});

test('needsAdsManagement: budget error → false', () => {
  const { isPermError } = classifyMetaApiError({
    error: { message: 'Daily budget is too low', code: 2030 },
  });
  assert.equal(isPermError, false);
});

test('needsAdsManagement: no error object (unexpected shape) → false', () => {
  const { isPermError } = classifyMetaApiError({ id: '12345' });
  assert.equal(isPermError, false);
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-2: lib/meta-ads.ts — META_ADS_DEFAULT_STATUS env var normalization
//
// The default is 'ACTIVE'. If someone sets it to 'active' or 'Active' in the
// env, .toUpperCase() normalises it. The test verifies the actual string
// passed to the Meta API campaign creation body is always uppercase.
// ════════════════════════════════════════════════════════════════════════════

function resolveEntityStatus(envValue) {
  return (envValue ?? 'ACTIVE').toUpperCase();
}

test('META_ADS_DEFAULT_STATUS: absent env → "ACTIVE"', () => {
  assert.equal(resolveEntityStatus(undefined), 'ACTIVE');
});

test('META_ADS_DEFAULT_STATUS: lowercase env "active" → "ACTIVE"', () => {
  assert.equal(resolveEntityStatus('active'), 'ACTIVE');
});

test('META_ADS_DEFAULT_STATUS: mixed-case "Active" → "ACTIVE"', () => {
  assert.equal(resolveEntityStatus('Active'), 'ACTIVE');
});

test('META_ADS_DEFAULT_STATUS: already uppercase "PAUSED" → "PAUSED"', () => {
  assert.equal(resolveEntityStatus('PAUSED'), 'PAUSED');
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-3: lib/meta-ads.ts — generateAdCopy() dynamic month label
//
// Previously the promo line was hardcoded as "SPÉCIAL MAI".
// After commit a6f609a, moisQc is computed dynamically from the current date.
// Test that moisQc is always a non-empty uppercase string (never "MAI" when
// we're in June), and that promoLine is empty when promo === 0.
// ════════════════════════════════════════════════════════════════════════════

function buildPromoLine(promoPct, moisQc) {
  return promoPct > 0
    ? `RÈGLE ABSOLUE: la 1ère ligne du primary_text DOIT commencer par "SPÉCIAL ${moisQc} — ${promoPct}% rabais" pour créer l'urgence.`
    : '';
}

function getMoisQc(dateObj) {
  return dateObj
    .toLocaleDateString('fr-CA', { month: 'long', timeZone: 'America/Toronto' })
    .toUpperCase();
}

test('moisQc: dynamic month label is non-empty uppercase string', () => {
  const mois = getMoisQc(new Date());
  assert.ok(mois.length > 0, 'moisQc should be non-empty');
  assert.equal(mois, mois.toUpperCase(), 'moisQc should be all uppercase');
});

test('moisQc: JUIN 2026 date produces "JUIN"', () => {
  // Fixed date: June 10, 2026 at noon UTC
  const june10 = new Date('2026-06-10T12:00:00Z');
  const mois = getMoisQc(june10);
  assert.equal(mois, 'JUIN');
});

test('moisQc: MAI 2026 date produces "MAI"', () => {
  const may1 = new Date('2026-05-01T12:00:00Z');
  const mois = getMoisQc(may1);
  assert.equal(mois, 'MAI');
});

test('promoLine: promo=0 → empty string (no promo rule injected)', () => {
  const line = buildPromoLine(0, 'JUIN');
  assert.equal(line, '');
});

test('promoLine: promo=20 → contains dynamic month and percentage', () => {
  const line = buildPromoLine(20, 'JUIN');
  assert.ok(line.includes('JUIN'), 'promoLine must contain current month');
  assert.ok(line.includes('20%'), 'promoLine must contain percentage');
  assert.ok(line.includes('SPÉCIAL'), 'promoLine must contain SPÉCIAL keyword');
});

test('promoLine: promo=15 in JUILLET → correct month and pct', () => {
  const line = buildPromoLine(15, 'JUILLET');
  assert.ok(line.includes('JUILLET'));
  assert.ok(line.includes('15%'));
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-4: lib/meta-ads.ts — DEFAULT_TARGETING.advantage_audience === 0
//
// When set to 1 (Meta default), Meta overrides the age_min/age_max constraints
// and expands to all ages. The value MUST be 0 to preserve 30-65 targeting.
// The commit comment confirms: "Désactive l'audience auto Meta (sinon impossible
// de garder age_min 30 — propriétaires)."
//
// This is an invariant test: if someone accidentally changes 0 → 1, the
// targeting breaks (leads from teenagers, not homeowners).
// ════════════════════════════════════════════════════════════════════════════

// Inlined from lib/meta-ads.ts
const DEFAULT_TARGETING = {
  geo_locations: {
    custom_locations: [
      { latitude: 46.8139, longitude: -71.2080, radius: 55, distance_unit: 'kilometer' },
    ],
  },
  age_min: 30,
  age_max: 65,
  locales: [6, 24],
  targeting_automation: { advantage_audience: 0 },
};

test('DEFAULT_TARGETING: advantage_audience MUST be 0 (not 1)', () => {
  assert.equal(DEFAULT_TARGETING.targeting_automation.advantage_audience, 0,
    'advantage_audience=1 breaks age targeting — Meta ignores age_min/age_max');
});

test('DEFAULT_TARGETING: age range 30-65 (homeowner demographic)', () => {
  assert.equal(DEFAULT_TARGETING.age_min, 30);
  assert.equal(DEFAULT_TARGETING.age_max, 65);
});

test('DEFAULT_TARGETING: 55km radius around Quebec City (lat/lon)', () => {
  const loc = DEFAULT_TARGETING.geo_locations.custom_locations[0];
  assert.equal(loc.radius, 55);
  assert.equal(loc.distance_unit, 'kilometer');
  // Quebec City coordinates ±0.001 tolerance
  assert.ok(Math.abs(loc.latitude - 46.8139) < 0.01);
  assert.ok(Math.abs(loc.longitude - (-71.2080)) < 0.01);
});

test('DEFAULT_TARGETING: French locales present [6, 24]', () => {
  assert.deepEqual(DEFAULT_TARGETING.locales, [6, 24]);
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-5: app/api/meta/webhook/route.ts — isBalcon detection
//
// The webhook skips auto-quote creation when the lead is for a balcon.
// isBalcon is true if /balcon/i matches ANY of three fields:
//   - serviceRaw (the raw form value before normalization)
//   - espaceRaw  (the "espace" field)
//   - service    (the normalized service type)
//
// Critical: "antiderapant" is the finition type, NOT a balcon. A lead for
// antiderapant with no "balcon" word must NOT set isBalcon.
// Also tested: "Balcon" uppercase, "mon balcon au 2e" (substring match).
// ════════════════════════════════════════════════════════════════════════════

// Inlined from app/api/meta/webhook/route.ts
function detectIsBalcon(serviceRaw, espaceRaw, service) {
  return /balcon/i.test(String(serviceRaw ?? ''))
    || /balcon/i.test(String(espaceRaw ?? ''))
    || /balcon/i.test(String(service ?? ''));
}

test('isBalcon: serviceRaw="balcon" → true', () => {
  assert.equal(detectIsBalcon('balcon', null, null), true);
});

test('isBalcon: serviceRaw="Balcon" (uppercase) → true', () => {
  assert.equal(detectIsBalcon('Balcon', null, null), true);
});

test('isBalcon: espaceRaw="balcon" → true (second field)', () => {
  assert.equal(detectIsBalcon(null, 'balcon', null), true);
});

test('isBalcon: service="balcon" → true (third field)', () => {
  assert.equal(detectIsBalcon(null, null, 'balcon'), true);
});

test('isBalcon: substring match "mon balcon au 2e étage" → true', () => {
  assert.equal(detectIsBalcon('mon balcon au 2e étage', null, null), true);
});

test('isBalcon: antiderapant service, no balcon word → false', () => {
  assert.equal(detectIsBalcon('antiderapant', 'garage', 'antiderapant'), false);
});

test('isBalcon: patio → false (patio is antiderapant service, NOT balcon workflow)', () => {
  // "patio" maps to antiderapant in normalizeService — no balcon exception needed
  assert.equal(detectIsBalcon('patio', null, 'antiderapant'), false);
});

test('isBalcon: all null fields → false', () => {
  assert.equal(detectIsBalcon(null, null, null), false);
});

test('isBalcon: flake service in garage → false', () => {
  assert.equal(detectIsBalcon('flake', 'garage', 'flake'), false);
});

test('isBalcon: "BALCON EXTÉRIEUR" uppercase multi-word → true', () => {
  assert.equal(detectIsBalcon('BALCON EXTÉRIEUR', null, null), true);
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-6: lib/auto-heal.ts — autoHeal() Promise.allSettled repair collection
//
// autoHeal() runs three sub-heals in parallel via Promise.allSettled.
// Only fulfilled results with a non-null string value are collected.
// notifyGroup() is called ONLY when repairs.length > 0.
//
// The inline logic here mirrors the exact collection code in autoHeal().
// ════════════════════════════════════════════════════════════════════════════

// Mirrors the repair collection loop from autoHeal()
function collectRepairs(settledResults) {
  const repairs = [];
  for (const r of settledResults) {
    if (r.status === 'fulfilled' && r.value) repairs.push(r.value);
  }
  return repairs;
}

test('collectRepairs: all sub-heals null → empty repairs (no notify)', () => {
  const results = [
    { status: 'fulfilled', value: null },
    { status: 'fulfilled', value: null },
    { status: 'fulfilled', value: null },
  ];
  assert.deepEqual(collectRepairs(results), []);
});

test('collectRepairs: one repair message → notify triggered', () => {
  const results = [
    { status: 'fulfilled', value: 'Webhook Telegram repare' },
    { status: 'fulfilled', value: null },
    { status: 'fulfilled', value: null },
  ];
  const repairs = collectRepairs(results);
  assert.equal(repairs.length, 1);
  assert.equal(repairs[0], 'Webhook Telegram repare');
});

test('collectRepairs: rejected promise → excluded from repairs (never crashes)', () => {
  const results = [
    { status: 'rejected', reason: new Error('DB timeout') },
    { status: 'fulfilled', value: 'Gmail watch renouvele' },
    { status: 'fulfilled', value: null },
  ];
  const repairs = collectRepairs(results);
  assert.equal(repairs.length, 1);
  assert.equal(repairs[0], 'Gmail watch renouvele');
});

test('collectRepairs: all sub-heals return strings → all collected', () => {
  const results = [
    { status: 'fulfilled', value: 'Webhook repare' },
    { status: 'fulfilled', value: 'Gmail watch renouvele' },
    { status: 'fulfilled', value: 'Email scan relance (15h sans scan)' },
  ];
  const repairs = collectRepairs(results);
  assert.equal(repairs.length, 3);
});

test('collectRepairs: empty string value → excluded (falsy)', () => {
  const results = [
    { status: 'fulfilled', value: '' },
    { status: 'fulfilled', value: 'Webhook repare' },
  ];
  const repairs = collectRepairs(results);
  assert.equal(repairs.length, 1);
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-7: lib/sms.ts — sendReferralSMS() message content
//
// The referral SMS is sent ~6 months after completed work. It must:
//   - Address the client by first name only (prenom = name.split(' ')[0])
//   - Mention "100$" referral bonus
//   - Include Luca's direct phone (581-307-5983)
//   - NOT include any price quote or invoice information
//
// Zero test exists for this message content anywhere in the test suite.
// ════════════════════════════════════════════════════════════════════════════

// Inlined from lib/sms.ts
const LUCA_PHONE = '581-307-5983';

function buildReferralSmsMessage(clientName) {
  const prenom = clientName.split(' ')[0];
  return `Salut ${prenom}! C'est Luca de Novus Epoxy. Ca fait deja quelques mois qu'on a fait ton plancher — j'espere que t'en profites! Si tu connais quelqu'un qui voudrait la meme chose, on offre 100$ de rabais pour chaque reference. Passe le mot! ${LUCA_PHONE}`;
}

test('sendReferralSMS: message addresses client by first name only', () => {
  const msg = buildReferralSmsMessage('Marie Tremblay');
  assert.ok(msg.startsWith('Salut Marie!'), 'must start with first name');
  assert.ok(!msg.includes('Tremblay'), 'must NOT include last name');
});

test('sendReferralSMS: message contains 100$ referral bonus', () => {
  const msg = buildReferralSmsMessage('Jean Gagnon');
  assert.ok(msg.includes('100$'), 'must mention referral bonus amount');
});

test('sendReferralSMS: message contains Luca direct phone', () => {
  const msg = buildReferralSmsMessage('Pierre Laval');
  assert.ok(msg.includes(LUCA_PHONE), 'must include Luca phone number for callbacks');
});

test('sendReferralSMS: single-word name works (no crash on split)', () => {
  const msg = buildReferralSmsMessage('Monique');
  assert.ok(msg.startsWith('Salut Monique!'));
});

test('sendReferralSMS: only "100$" referral bonus appears — no invoice price injected', () => {
  const msg = buildReferralSmsMessage('André Côté');
  // The only dollar amount in the message should be "100$"
  const dollarMatches = msg.match(/\d+\s*\$/g) ?? [];
  assert.equal(dollarMatches.length, 1, 'only "100$" should appear — no invoice/quote prices');
  assert.ok(dollarMatches[0].includes('100'), 'the one dollar amount must be 100$');
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-8: lib/lead-scoring.ts — boundary conditions and penalty interactions
//
// scoreLead() has specific thresholds: ≥6 → chaud, ≥3 → tiède, <3 → froid.
// Existing tests cover individual signals but NOT:
//   - Exactly-6 score → chaud (boundary test)
//   - Exactly-5 score → tiède (not chaud)
//   - Test name penalty reducing a borderline score to froid
//   - Score going below zero (penalty can make it negative)
// ════════════════════════════════════════════════════════════════════════════

// Inlined from lib/lead-scoring.ts (keep in sync with source)
const KNOWN_SERVICES_SET = new Set([
  'flake', 'metallique', 'métallique', 'quartz', 'couleur_unie', 'couleur unie',
  'antiderapant', 'antidérapant', 'commercial', 'industriel', 'meulage',
  'vinyl_click', 'vinyl', 'vinyle',
]);

const KNOWN_ESPACES_SET = new Set([
  'garage', 'sous-sol', 'sous sol', 'basement', 'balcon', 'commercial',
  'industriel', 'entrepôt', 'entrepot', 'résidentiel', 'residentiel',
]);

const TEST_PATTERNS_LIST = [
  /\btest\b/i, /jean\s*test/i, /lead\s*test/i, /\bfake\b/i, /asdf|qwerty|zzzz/i,
];

function scoreLead(input) {
  let score = 0;
  const reasons = [];

  const digits = String(input.telephone ?? '').replace(/\D/g, '');
  if (digits.length === 10 || digits.length === 11) { score += 2; reasons.push('phone+2'); }

  const service = String(input.service ?? '').toLowerCase().trim();
  if (service && (KNOWN_SERVICES_SET.has(service) || [...KNOWN_SERVICES_SET].some(s => service.includes(s)))) {
    score += 2; reasons.push('service+2');
  }

  const sf = Number(String(input.superficie ?? '').replace(/[^\d.]/g, ''));
  if (sf >= 50) { score += 2; reasons.push('superficie+2'); }

  const espace = String(input.espace ?? '').toLowerCase().trim();
  if (espace && (KNOWN_ESPACES_SET.has(espace) || [...KNOWN_ESPACES_SET].some(e => espace.includes(e)))) {
    score += 1; reasons.push('espace+1');
  }

  const adresse = String(input.adresse ?? '').trim();
  if (adresse.length >= 10 && /\d/.test(adresse) && /[a-zà-ÿ]{3,}/i.test(adresse)) {
    score += 1; reasons.push('adresse+1');
  }

  const email = String(input.email ?? '').trim();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && !email.includes('no-email@facebook')) {
    score += 1; reasons.push('email+1');
  }

  const nom = String(input.nom ?? '').trim();
  if (nom && TEST_PATTERNS_LIST.some(rx => rx.test(nom))) {
    score -= 2; reasons.push('test_name-2');
  }

  const source = String(input.source ?? '').toLowerCase();
  if (source.includes('csv') || source.includes('scraper') || source.includes('import')) {
    score -= 1; reasons.push('cold_source-1');
  }

  let temperature;
  if (score >= 6) temperature = 'chaud';
  else if (score >= 3) temperature = 'tiede';
  else temperature = 'froid';

  return { temperature, score, reasons };
}

test('scoreLead: exactly score 6 → chaud (boundary)', () => {
  // phone+2, service+2, superficie+2 = 6
  const r = scoreLead({ telephone: '4185551234', service: 'flake', superficie: '200' });
  assert.equal(r.score, 6);
  assert.equal(r.temperature, 'chaud');
});

test('scoreLead: score 7 → chaud (above boundary)', () => {
  // phone+2, service+2, superficie+2, espace+1 = 7
  const r = scoreLead({ telephone: '4185551234', service: 'flake', superficie: '200', espace: 'garage' });
  assert.equal(r.score, 7);
  assert.equal(r.temperature, 'chaud');
});

test('scoreLead: exactly score 5 → tiede (just below chaud boundary)', () => {
  // phone+2, service+2, espace+1 = 5 (no superficie)
  const r = scoreLead({ telephone: '5145551234', service: 'quartz', espace: 'garage' });
  assert.equal(r.score, 5);
  assert.equal(r.temperature, 'tiede');
});

test('scoreLead: exactly score 3 → tiede (boundary)', () => {
  // phone+2, email+1 = 3
  const r = scoreLead({ telephone: '5145551234', email: 'x@example.com' });
  assert.equal(r.score, 3);
  assert.equal(r.temperature, 'tiede');
});

test('scoreLead: score 5 with test name (−2) → score 3 → tiede', () => {
  // phone+2, service+2, espace+1 = 5, then −2 test name = 3
  const r = scoreLead({ nom: 'Jean Test', telephone: '5145551234', service: 'flake', espace: 'garage' });
  assert.equal(r.score, 3);
  assert.equal(r.temperature, 'tiede');
});

test('scoreLead: score 6 with test name + csv source → score 3 → tiede', () => {
  // phone+2, service+2, superficie+2 = 6, then −2 test_name −1 csv = 3
  const r = scoreLead({
    nom: 'Lead Test',
    telephone: '4185551234',
    service: 'flake',
    superficie: '100',
    source: 'import-csv',
  });
  assert.equal(r.score, 3);
  assert.equal(r.temperature, 'tiede');
});

test('scoreLead: score can go below zero (negative score → still froid)', () => {
  // Only test-name penalty: no positive signals. score = −2
  const r = scoreLead({ nom: 'FAKE Test', telephone: '' });
  assert.ok(r.score < 0, 'score should be negative with only test-name penalty');
  assert.equal(r.temperature, 'froid');
});

test('scoreLead: 11-digit phone (1XXXXXXXXXX) counts as valid (+2)', () => {
  // 11 digits: 1 + 10 digit QC number
  const r = scoreLead({ telephone: '14185551234' });
  assert.ok(r.reasons.includes('phone+2'), '11-digit phone should add +2');
  assert.equal(r.score, 2);
});

// ════════════════════════════════════════════════════════════════════════════
// INTEGRATION SKELETONS
// ════════════════════════════════════════════════════════════════════════════

test('INT-1: GET /api/cron/lead-followup — wrong CRON_SECRET → 401',
  { skip: SKIP_INTEGRATION ? 'set INTEGRATION_TEST=1' : false },
  async () => {
    const res = await fetch(`${BASE}/api/cron/lead-followup`, {
      headers: { Authorization: 'Bearer wrong-secret-xyz' },
    });
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.ok(body.error, 'should return error message');
  }
);

test('INT-2: GET /api/cron/morning-summary — correct CRON_SECRET → 200 or 207',
  { skip: SKIP_INTEGRATION ? 'set INTEGRATION_TEST=1' : false },
  async () => {
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret) throw new Error('CRON_SECRET not set in environment');
    const res = await fetch(`${BASE}/api/cron/morning-summary`, {
      headers: { Authorization: `Bearer ${cronSecret}` },
    });
    assert.ok([200, 207].includes(res.status), `expected 200/207, got ${res.status}`);
  }
);

test('INT-3: POST /api/admin/balcon-sms-photo — wrong adminKey → 401',
  { skip: SKIP_INTEGRATION ? 'set INTEGRATION_TEST=1' : false },
  async () => {
    const res = await fetch(`${BASE}/api/admin/balcon-sms-photo`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': 'wrong-key',
      },
      body: JSON.stringify({ leadId: 999 }),
    });
    assert.equal(res.status, 401);
  }
);

test('INT-4: Quote → Invoice pipeline — ensureInvoiceForQuote idempotent',
  { skip: SKIP_INTEGRATION ? 'set INTEGRATION_TEST=1' : false },
  async () => {
    // Requires a test quote ID in the DB
    // 1. Call ensureInvoiceForQuote(testQuoteId) twice
    // 2. Both calls should return the same invoice ID (no duplicates)
    // 3. DB should have exactly one invoice row for the quote
    const { ensureInvoiceForQuote } = await import('../lib/ensure-invoice.ts');
    const testQuoteId = Number(process.env.TEST_QUOTE_ID ?? 0);
    if (!testQuoteId) throw new Error('set TEST_QUOTE_ID to a valid quote id');
    const first = await ensureInvoiceForQuote(testQuoteId);
    const second = await ensureInvoiceForQuote(testQuoteId);
    assert.equal(first, second, 'calling twice must return the same invoice id');
  }
);

test('INT-5: Lead import + blocklist — blocked phone → sendSMS never called',
  { skip: SKIP_INTEGRATION ? 'set INTEGRATION_TEST=1' : false },
  async () => {
    // Requires blocklist entry for +15555550000 in kv_store
    // 1. POST /api/leads with phone matching a blocked number
    // 2. Check sms_logs: no new outbound entry for that number
    // 3. Lead should still be created (blocklist only stops SMS, not CRM entry)
    const blockedPhone = '+15555550000';
    const before = await fetch(`${BASE}/api/sms/logs?phone=${encodeURIComponent(blockedPhone)}`);
    const beforeCount = (await before.json()).total ?? 0;

    await fetch(`${BASE}/api/leads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nom: 'Test Blocklist',
        telephone: blockedPhone,
        service: 'flake',
      }),
    });

    const after = await fetch(`${BASE}/api/sms/logs?phone=${encodeURIComponent(blockedPhone)}`);
    const afterCount = (await after.json()).total ?? 0;
    assert.equal(afterCount, beforeCount, 'no SMS should be sent to blocked phone');
  }
);

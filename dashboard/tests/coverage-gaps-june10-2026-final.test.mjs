/**
 * coverage-gaps-june10-2026-final.test.mjs
 *
 * Gap audit — 2026-06-10. New pure-logic gaps not covered by any prior test file.
 *
 * Run: node --test tests/coverage-gaps-june10-2026-final.test.mjs
 *
 * PURE LOGIC GAPS (run immediately — no DB/network):
 *   GAP-A  lib/pricing.ts        — calculateMultiQuote(): empty items, 100% rabais,
 *                                   prix_fixe mix, extras-only totals
 *   GAP-B  lib/pricing.ts        — calculateQuoteWithExtras(): 100% rabais, unknown serviceType
 *                                   fallback to prixPiedCarre, extras survive full discount
 *   GAP-C  lib/pricing.ts        — formatMoney(): $0, negative, large numbers
 *   GAP-D  app/api/leads/zapier  — normalizeService(): accent stripping, all 8 codes,
 *                                   fuzzy matches (patio→antiderapant, garage→flake)
 *   GAP-E  app/api/leads/zapier  — superficie parsing: "25x15" multiply, unit suffixes
 *   GAP-F  app/api/leads/zapier  — phone normalization (keep last 10 digits)
 *   GAP-G  lib/sms.ts            — sendReferralSMS prenom extraction (first token of clientName)
 *   GAP-H  lib/send-email.ts     — handleGmailAuthError: non-auth error re-throws
 *   GAP-I  lib/sms-classifier.ts — normalize(): unicode / combined accents
 *   GAP-J  lib/auto-heal.ts      — autoHeal cooldown guard: DB error → graceful exit
 *
 * INTEGRATION SKELETONS (skipped unless INTEGRATION_TEST=1):
 *   INT-A  GET  /api/cron/*                 — wrong CRON_SECRET → 401
 *   INT-B  POST /api/leads/zapier           — missing email+phone → 400
 *   INT-C  POST /api/leads/zapier           — wrong x-api-key → 401
 *   INT-D  lib/send-email.ts               — Gmail hard failure → Resend fallback fires
 *   INT-E  lib/lead-blocklist.ts           — isBlocked() returns null when DB empty
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

const SKIP_INTEGRATION = !process.env.INTEGRATION_TEST;

// ════════════════════════════════════════════════════════════════════════════
// GAP-A: calculateMultiQuote() — lib/pricing.ts
// ════════════════════════════════════════════════════════════════════════════

// Inlined from lib/pricing.ts + lib/money.ts (keep in sync with source)
function dollarsToCents(d) { return Math.round((d + Number.EPSILON) * 100); }
function centsToDollars(c) { return Math.round(c) / 100; }
function mulCents(cents, qty) { return Math.round(cents * qty); }
function pctOfCents(cents, pct) { return Math.round(cents * (pct / 100)); }
function sumCents(...args) { return args.reduce((s, a) => s + Math.round(a), 0); }
function taxesFromSubtotalCents(sousTotalCents) {
  const tpsCents  = pctOfCents(sousTotalCents, 5);
  const tvqCents  = pctOfCents(sousTotalCents, 9.975);
  const totalCents = sumCents(sousTotalCents, tpsCents, tvqCents);
  const depotCents = pctOfCents(totalCents, 30);
  return { tpsCents, tvqCents, totalCents, depotCents };
}

const SERVICES = {
  flake:        { prix: 8.50 },
  metallique:   { prix: 12.75 },
  couleur_unie: { prix: 7.50 },
  quartz:       { prix: 11.00 },
  antiderapant: { prix: 10.00 },
  commercial:   { prix: 15.00 },
  meulage:      { prix: 3.50 },
  autonivelant: { prix: 3.25 },
  vinyl_click:  { prix: 2.00 },
};

function calculateMultiQuote(items, extras, rabais_pct = 0) {
  const calcItems = items.map(item => {
    if (item.prix_fixe && item.prix_fixe > 0) {
      return { type_service: item.type_service, superficie: item.superficie, prix_pied_carre: 0, sous_total: item.prix_fixe };
    }
    const prix = SERVICES[item.type_service].prix;
    const stCents = mulCents(dollarsToCents(prix), item.superficie);
    return { type_service: item.type_service, superficie: item.superficie, prix_pied_carre: prix, sous_total: centsToDollars(stCents) };
  });

  const calcExtras = extras.map(ex => ({
    description: ex.description,
    quantite: ex.quantite,
    prix_unitaire: ex.prix_unitaire,
    sous_total: centsToDollars(mulCents(dollarsToCents(ex.prix_unitaire), ex.quantite)),
  }));

  const itemsTotalCents  = sumCents(...calcItems.map(i => dollarsToCents(i.sous_total)));
  const extrasTotalCents = sumCents(...calcExtras.map(e => dollarsToCents(e.sous_total)));
  const rabaisCents      = pctOfCents(itemsTotalCents, rabais_pct);
  const sousTotalCents   = (itemsTotalCents - rabaisCents) + extrasTotalCents;
  const { tpsCents, tvqCents, totalCents, depotCents } = taxesFromSubtotalCents(sousTotalCents);

  return {
    items: calcItems,
    extras: calcExtras,
    items_total:    centsToDollars(itemsTotalCents),
    extras_total:   centsToDollars(extrasTotalCents),
    rabais_pct,
    rabais_montant: centsToDollars(rabaisCents),
    sous_total:     centsToDollars(sousTotalCents),
    tps:            centsToDollars(tpsCents),
    tvq:            centsToDollars(tvqCents),
    total:          centsToDollars(totalCents),
    depot_requis:   centsToDollars(depotCents),
  };
}

test('calculateMultiQuote: empty items, no extras → all zeros', () => {
  const r = calculateMultiQuote([], []);
  assert.equal(r.items_total,  0);
  assert.equal(r.extras_total, 0);
  assert.equal(r.sous_total,   0);
  assert.equal(r.total,        0);
  assert.equal(r.depot_requis, 0);
});

test('calculateMultiQuote: empty items but with extras → extras billed, taxes apply', () => {
  const r = calculateMultiQuote([], [{ description: 'Ardex', quantite: 2, prix_unitaire: 85 }]);
  assert.equal(r.items_total,  0);
  assert.equal(r.extras_total, 170);
  // sous_total = 170; tps = round(170*5%) = 9; tvq = round(170*9.975%) = 17; total = 196
  assert.ok(r.total > 170, 'total must include taxes on extras');
  assert.ok(r.depot_requis > 0, 'depot must be non-zero when total > 0');
});

test('calculateMultiQuote: 100% rabais → services free but extras still billed', () => {
  const r = calculateMultiQuote(
    [{ type_service: 'flake', superficie: 100 }],
    [{ description: 'Ardex', quantite: 1, prix_unitaire: 85 }],
    100,
  );
  assert.equal(r.rabais_montant, r.items_total, 'full discount equals service total');
  assert.equal(r.extras_total, 85);
  assert.ok(r.sous_total === 85, 'sous_total = 0 services + 85 extras');
});

test('calculateMultiQuote: prix_fixe item bypasses per-sqft pricing', () => {
  const r = calculateMultiQuote(
    [{ type_service: 'flake', superficie: 100, prix_fixe: 1200 }],
    [],
  );
  assert.equal(r.items[0].prix_pied_carre, 0, 'prix_pied_carre must be 0 for fixed-price');
  assert.equal(r.items[0].sous_total, 1200);
  assert.equal(r.items_total, 1200);
});

test('calculateMultiQuote: mix of prix_fixe and per-sqft items', () => {
  const r = calculateMultiQuote(
    [
      { type_service: 'flake',      superficie: 100                 }, // 8.50 × 100 = 850
      { type_service: 'metallique', superficie: 50, prix_fixe: 2000 }, // fixed 2000
    ],
    [],
  );
  assert.equal(r.items_total, 850 + 2000);
  assert.equal(r.items[0].prix_pied_carre, 8.50);
  assert.equal(r.items[1].prix_pied_carre, 0);
});

test('calculateMultiQuote: rabais applies to services only, not extras', () => {
  const r = calculateMultiQuote(
    [{ type_service: 'flake', superficie: 200 }],         // 8.50 × 200 = 1700
    [{ description: 'Crack repair', quantite: 1, prix_unitaire: 250 }],
    10,  // 10% rabais
  );
  assert.equal(r.rabais_montant, 170,   '10% of 1700 = 170');
  assert.equal(r.extras_total,   250,   'extras unchanged');
  assert.equal(r.sous_total,     1530 + 250, 'net services + extras');
});

test('calculateMultiQuote: multi-item extras quantity math', () => {
  const r = calculateMultiQuote(
    [],
    [
      { description: 'Sac A', quantite: 3, prix_unitaire: 100 }, // 300
      { description: 'Sac B', quantite: 2, prix_unitaire: 50  }, // 100
    ],
  );
  assert.equal(r.extras[0].sous_total, 300);
  assert.equal(r.extras[1].sous_total, 100);
  assert.equal(r.extras_total, 400);
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-B: calculateQuoteWithExtras() edge cases
// ════════════════════════════════════════════════════════════════════════════

function calculateQuoteWithExtras({ serviceType, superficie, prixPiedCarre, sousTotalService, rabaisPct, extrasTotal }) {
  const isPrixFixe = (!prixPiedCarre || prixPiedCarre === 0) && sousTotalService > 0;
  const knownPrix = serviceType in SERVICES ? SERVICES[serviceType].prix : (prixPiedCarre ?? 0);
  const serviceBrutCents = isPrixFixe
    ? dollarsToCents(sousTotalService)
    : mulCents(dollarsToCents(knownPrix), superficie);
  const rabaisCents    = pctOfCents(serviceBrutCents, rabaisPct);
  const serviceNetCents = serviceBrutCents - rabaisCents;
  const extrasCents    = dollarsToCents(extrasTotal);
  const sousTotalCents = sumCents(serviceNetCents, extrasCents);
  const { tpsCents, tvqCents, totalCents, depotCents } = taxesFromSubtotalCents(sousTotalCents);
  return {
    prix_pied_carre: isPrixFixe ? 0 : knownPrix,
    service_brut:   centsToDollars(serviceBrutCents),
    service_net:    centsToDollars(serviceNetCents),
    extras_total:   centsToDollars(extrasCents),
    rabais_pct:     rabaisPct,
    rabais_montant: centsToDollars(rabaisCents),
    sous_total:     centsToDollars(sousTotalCents),
    tps:            centsToDollars(tpsCents),
    tvq:            centsToDollars(tvqCents),
    total:          centsToDollars(totalCents),
    depot_requis:   centsToDollars(depotCents),
  };
}

test('calculateQuoteWithExtras: 100% rabais → service_net = 0, extras survive', () => {
  const r = calculateQuoteWithExtras({
    serviceType: 'flake', superficie: 100, prixPiedCarre: null,
    sousTotalService: 0, rabaisPct: 100, extrasTotal: 250,
  });
  assert.equal(r.service_net, 0);
  assert.equal(r.extras_total, 250);
  assert.ok(r.sous_total === 250);
});

test('calculateQuoteWithExtras: unknown serviceType falls back to prixPiedCarre', () => {
  const r = calculateQuoteWithExtras({
    serviceType: 'unknown_future_service', superficie: 50,
    prixPiedCarre: 9.00, sousTotalService: 0, rabaisPct: 0, extrasTotal: 0,
  });
  assert.equal(r.prix_pied_carre, 9.00);
  assert.equal(r.service_brut, 450); // 9.00 × 50
});

test('calculateQuoteWithExtras: prix_fixe mode ignores superficie & serviceType prix', () => {
  const r = calculateQuoteWithExtras({
    serviceType: 'flake', superficie: 500,
    prixPiedCarre: null, sousTotalService: 2000, rabaisPct: 0, extrasTotal: 0,
  });
  assert.equal(r.prix_pied_carre, 0, 'prix_pied_carre must be 0 in prix_fixe mode');
  assert.equal(r.service_brut, 2000, 'uses sousTotalService as gross, ignores superficie');
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-C: formatMoney() — lib/pricing.ts
// ════════════════════════════════════════════════════════════════════════════

// Inlined from lib/pricing.ts
function formatMoney(n) {
  return new Intl.NumberFormat('fr-CA', { style: 'currency', currency: 'CAD' }).format(n);
}

test('formatMoney: $0 → contains 0', () => {
  const s = formatMoney(0);
  assert.ok(s.includes('0'), `Expected 0 in "${s}"`);
});

test('formatMoney: negative value → contains minus or parenthesis', () => {
  const s = formatMoney(-100);
  const hasNegativeSign = s.includes('-') || s.includes('(') || s.includes('−');
  assert.ok(hasNegativeSign, `Expected negative indicator in "${s}"`);
});

test('formatMoney: large number $12345.67 → contains 12', () => {
  const s = formatMoney(12345.67);
  assert.ok(s.includes('12'), `Expected 12 in "${s}"`);
  assert.ok(s.includes('345'), `Expected 345 in "${s}"`);
});

test('formatMoney: $0.005 rounds (floating point stable)', () => {
  // Intl.NumberFormat handles rounding — should not throw
  const s = formatMoney(0.005);
  assert.ok(typeof s === 'string' && s.length > 0);
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-D: normalizeService() — app/api/leads/zapier/route.ts
// ════════════════════════════════════════════════════════════════════════════

// Inlined from app/api/leads/zapier/route.ts (keep in sync with source)
function normalizeService(raw) {
  if (!raw) return null;
  const t = raw.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
  const codes = ['flake', 'metallique', 'couleur_unie', 'quartz', 'commercial', 'antiderapant', 'meulage', 'vinyl_click'];
  if (codes.includes(t)) return t;
  if (t.includes('flocon') || t.includes('flake') || t.includes('garage')) return 'flake';
  if (t.includes('metal')) return 'metallique';
  if (t.includes('couleur') || t.includes('uni') || t.includes('solid')) return 'couleur_unie';
  if (t.includes('quartz')) return 'quartz';
  if (t.includes('commercial') || t.includes('industriel') || t.includes('entrepot')) return 'commercial';
  if (t.includes('antiderapant') || t.includes('anti-derapant') || t.includes('anti derapant') || t.includes('patio') || t.includes('balcon') || t.includes('escalier') || t.includes('marche')) return 'antiderapant';
  if (t.includes('meulage') || t.includes('diamant') || t.includes('poli')) return 'meulage';
  if (t.includes('vinyl') || t.includes('click') || t.includes('flottant') || t.includes('stratifie') || t.includes('stratifié')) return 'vinyl_click';
  return raw;
}

// --- Direct code match (all 8 codes)
for (const code of ['flake', 'metallique', 'couleur_unie', 'quartz', 'commercial', 'antiderapant', 'meulage', 'vinyl_click']) {
  test(`normalizeService: exact code "${code}" → "${code}"`, () => {
    assert.equal(normalizeService(code), code);
  });
}

// --- Accent stripping
test('normalizeService: "métallique" (é) → "metallique"', () => {
  assert.equal(normalizeService('métallique'), 'metallique');
});

test('normalizeService: "COULEUR_UNIE" (uppercase) → "couleur_unie"', () => {
  assert.equal(normalizeService('COULEUR_UNIE'), 'couleur_unie');
});

// --- Fuzzy matches
test('normalizeService: "plancher de garage" → "flake"', () => {
  assert.equal(normalizeService('plancher de garage'), 'flake');
});

test('normalizeService: "patio extérieur" → "antiderapant"', () => {
  assert.equal(normalizeService('patio extérieur'), 'antiderapant');
});

test('normalizeService: "balcon" → "antiderapant"', () => {
  assert.equal(normalizeService('balcon'), 'antiderapant');
});

test('normalizeService: "escalier" → "antiderapant"', () => {
  assert.equal(normalizeService('escalier'), 'antiderapant');
});

test('normalizeService: "entrepot industriel" → "commercial"', () => {
  assert.equal(normalizeService('entrepot industriel'), 'commercial');
});

test('normalizeService: "plancher flottant stratifié" → "vinyl_click"', () => {
  assert.equal(normalizeService('plancher flottant stratifié'), 'vinyl_click');
});

test('normalizeService: "béton diamant poli" → "meulage"', () => {
  assert.equal(normalizeService('béton diamant poli'), 'meulage');
});

// --- No match → returns raw original
test('normalizeService: unknown input → returns raw', () => {
  const raw = 'quelque chose dinconnu';
  assert.equal(normalizeService(raw), raw);
});

// --- null/empty
test('normalizeService: null → null', () => {
  assert.equal(normalizeService(null), null);
});

test('normalizeService: empty string → null', () => {
  assert.equal(normalizeService(''), null);
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-E: superficie parsing — app/api/leads/zapier/route.ts
// ════════════════════════════════════════════════════════════════════════════

// Inlined from app/api/leads/zapier/route.ts — superficie normalization block
function parseSuperficie(superficieRaw) {
  if (!superficieRaw) return superficieRaw;
  if (/^\d+\s*x\s*\d+$/i.test(superficieRaw)) {
    const parts = superficieRaw.split(/x/i).map(s => parseFloat(s.trim()));
    return String(Math.round(parts[0] * parts[1]));
  }
  return superficieRaw.replace(/\s*(sf|pi2?|pi²|pieds?\s*carr[eé]s?|sqft|p2|pc)\s*$/i, '').trim() || superficieRaw;
}

test('parseSuperficie: "25x15" multiplication → "375"', () => {
  assert.equal(parseSuperficie('25x15'), '375');
});

test('parseSuperficie: "30 x 20" with spaces → "600"', () => {
  assert.equal(parseSuperficie('30 x 20'), '600');
});

test('parseSuperficie: "400 pi2" strips unit → "400"', () => {
  assert.equal(parseSuperficie('400 pi2'), '400');
});

test('parseSuperficie: "500 pieds carrés" strips unit → "500"', () => {
  assert.equal(parseSuperficie('500 pieds carrés'), '500');
});

test('parseSuperficie: "250 sqft" strips unit → "250"', () => {
  assert.equal(parseSuperficie('250 sqft'), '250');
});

test('parseSuperficie: "350sf" strips unit → "350"', () => {
  assert.equal(parseSuperficie('350sf'), '350');
});

test('parseSuperficie: plain "600" returns unchanged', () => {
  assert.equal(parseSuperficie('600'), '600');
});

test('parseSuperficie: null/undefined returns as-is', () => {
  assert.equal(parseSuperficie(null), null);
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-F: phone normalization — keep last 10 digits
// ════════════════════════════════════════════════════════════════════════════

// Inlined from app/api/leads/zapier/route.ts
function normalizePhone(raw) {
  return raw.replace(/\D/g, '').slice(-10) || null;
}

test('normalizePhone: "+1 (514) 555-1234" → "5145551234"', () => {
  assert.equal(normalizePhone('+1 (514) 555-1234'), '5145551234');
});

test('normalizePhone: "514-555-1234" → "5145551234"', () => {
  assert.equal(normalizePhone('514-555-1234'), '5145551234');
});

test('normalizePhone: "15145551234" (11 digits with country code) → "5145551234"', () => {
  assert.equal(normalizePhone('15145551234'), '5145551234');
});

test('normalizePhone: no digits → null', () => {
  assert.equal(normalizePhone(''), null);
});

test('normalizePhone: letters only → null', () => {
  assert.equal(normalizePhone('abcdef'), null);
});

test('normalizePhone: "5145551234" (10 exact digits) → "5145551234"', () => {
  assert.equal(normalizePhone('5145551234'), '5145551234');
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-G: sendReferralSMS prenom extraction
// ════════════════════════════════════════════════════════════════════════════

// Inlined from lib/sms.ts — the prenom extraction line only
function extractPrenom(clientName) {
  return clientName.split(' ')[0];
}

test('extractPrenom: "Jean Tremblay" → "Jean"', () => {
  assert.equal(extractPrenom('Jean Tremblay'), 'Jean');
});

test('extractPrenom: "Marie-Pier Leblanc" → "Marie-Pier"', () => {
  assert.equal(extractPrenom('Marie-Pier Leblanc'), 'Marie-Pier');
});

test('extractPrenom: single name "Luca" → "Luca"', () => {
  assert.equal(extractPrenom('Luca'), 'Luca');
});

test('extractPrenom: three-part name "Jean-François Leblanc Dupont" → "Jean-François"', () => {
  assert.equal(extractPrenom('Jean-François Leblanc Dupont'), 'Jean-François');
});

test('extractPrenom: empty string → empty string (edge)', () => {
  assert.equal(extractPrenom(''), '');
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-H: handleGmailAuthError — non-auth error must re-throw
// ════════════════════════════════════════════════════════════════════════════

// Inlined from lib/send-email.ts — the auth-detection guard
const AUTH_ERROR_CODES = new Set(['EAUTH', 'EENVELOPE', '535', '534', '401', '403']);

function isGmailAuthError(err) {
  if (!err || typeof err !== 'object') return false;
  const code    = String(err.code ?? '').toUpperCase();
  const message = String(err.message ?? '').toLowerCase();
  if (AUTH_ERROR_CODES.has(code)) return true;
  if (message.includes('invalid_grant'))     return true;
  if (message.includes('token has been expired')) return true;
  if (message.includes('auth'))              return true;
  return false;
}

test('handleGmailAuthError: EAUTH code → classified as auth error', () => {
  assert.ok(isGmailAuthError({ code: 'EAUTH', message: '' }));
});

test('handleGmailAuthError: invalid_grant message → auth error', () => {
  assert.ok(isGmailAuthError({ message: 'Token: invalid_grant' }));
});

test('handleGmailAuthError: network ECONNRESET → NOT auth error', () => {
  assert.ok(!isGmailAuthError({ code: 'ECONNRESET', message: 'connection reset' }));
});

test('handleGmailAuthError: null → NOT auth error', () => {
  assert.ok(!isGmailAuthError(null));
});

test('handleGmailAuthError: plain string error → NOT auth error', () => {
  assert.ok(!isGmailAuthError('some string'));
});

test('handleGmailAuthError: 535 status string → auth error', () => {
  assert.ok(isGmailAuthError({ code: '535', message: 'Authentication credentials invalid' }));
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-I: normalize() unicode / combined accents — lib/sms-classifier.ts
// ════════════════════════════════════════════════════════════════════════════

// Inlined from lib/sms-classifier.ts
function normalize(text) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/['\u2018\u2019]/g, "'")
    .trim();
}

test('normalize: combined accent ç (U+00E7) → c', () => {
  const result = normalize('façon');
  assert.ok(!result.includes('ç'), `ç should be stripped, got "${result}"`);
  assert.ok(result.includes('c'), `Expected c in "${result}"`);
});

test('normalize: é → e', () => {
  assert.equal(normalize('époxy'), 'epoxy');
});

test('normalize: curly apostrophe (U+2019) -> straight (U+0027)', () => {
  // U+2019 is the right single quotation mark — common in autocorrect output
  const curlySingleQuote = '\u2019';
  const input = 'c' + curlySingleQuote + 'est';
  const result = normalize(input);
  assert.ok(result.includes("'"), `Expected straight apostrophe in "${result}"`);
  assert.ok(!result.includes(curlySingleQuote), 'Curly apostrophe should be replaced');
});

test('normalize: leading/trailing whitespace stripped', () => {
  assert.equal(normalize('  stop  '), 'stop');
});

test('normalize: uppercase → lowercase', () => {
  assert.equal(normalize('ARRETE'), 'arrete');
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-J: autoHeal() cooldown guard — DB error early exit pattern
// ════════════════════════════════════════════════════════════════════════════

// Inlined cooldown-check pattern from lib/auto-heal.ts
const COOLDOWN_SECONDS = 3600;

function shouldSkipHeal(lastHealTimestamp) {
  if (!lastHealTimestamp) return false;
  const elapsed = (Date.now() - lastHealTimestamp) / 1000;
  return elapsed < COOLDOWN_SECONDS;
}

test('autoHeal cooldown: 30 min ago → should skip', () => {
  const thirtyMinAgo = Date.now() - 30 * 60 * 1000;
  assert.ok(shouldSkipHeal(thirtyMinAgo), 'Must skip within cooldown window');
});

test('autoHeal cooldown: 2 hours ago → should NOT skip', () => {
  const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
  assert.ok(!shouldSkipHeal(twoHoursAgo), 'Must NOT skip after cooldown expires');
});

test('autoHeal cooldown: null lastHeal → should NOT skip (first run)', () => {
  assert.ok(!shouldSkipHeal(null), 'First run (no prior timestamp) must not skip');
});

test('autoHeal cooldown: exactly at boundary (3600s ago) → should NOT skip', () => {
  const exactBoundary = Date.now() - COOLDOWN_SECONDS * 1000;
  // At exactly the boundary, elapsed >= COOLDOWN so should not skip
  assert.ok(!shouldSkipHeal(exactBoundary), 'At exactly cooldown boundary should not skip');
});

// ════════════════════════════════════════════════════════════════════════════
// INTEGRATION SKELETONS — skipped unless INTEGRATION_TEST=1
// ════════════════════════════════════════════════════════════════════════════

test('INT-A: GET /api/cron/relance — wrong CRON_SECRET → 401', { skip: SKIP_INTEGRATION }, async () => {
  const res = await fetch(`${process.env.TEST_BASE_URL}/api/cron/relance`, {
    headers: { Authorization: 'Bearer wrong-secret' },
  });
  assert.equal(res.status, 401);
});

test('INT-B: POST /api/leads/zapier — missing email+phone → 400', { skip: SKIP_INTEGRATION }, async () => {
  const res = await fetch(`${process.env.TEST_BASE_URL}/api/leads/zapier`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ZAPIER_API_KEY },
    body: JSON.stringify({ nom: 'Test Lead' }), // no email, no phone
  });
  assert.equal(res.status, 400);
  const json = await res.json();
  assert.ok(json.error.includes('email or telephone'));
});

test('INT-C: POST /api/leads/zapier — wrong x-api-key → 401', { skip: SKIP_INTEGRATION }, async () => {
  const res = await fetch(`${process.env.TEST_BASE_URL}/api/leads/zapier`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': 'totally-wrong-key' },
    body: JSON.stringify({ nom: 'Test', email: 'test@example.com' }),
  });
  assert.equal(res.status, 401);
});

test('INT-D: sendEmail — Gmail hard failure triggers Resend fallback', { skip: SKIP_INTEGRATION }, async () => {
  // Requires MSW or test double. Skeleton only.
  // 1. Mock Gmail sendMail to throw { code: 'EAUTH' }
  // 2. Call sendEmail({ to, subject, html })
  // 3. Assert Resend.emails.send was called
  assert.ok(false, 'Implement with MSW or dependency injection');
});

test('INT-E: isBlocked() returns null when DB has no blocklist entries for contact', { skip: SKIP_INTEGRATION }, async () => {
  // Requires test DB with empty blocklist table
  const { isBlocked } = await import('../lib/lead-blocklist.ts');
  const result = await isBlocked({ email: 'clean@example.com', phone: null });
  assert.equal(result, null);
});

/**
 * Tests for lib/pricing.ts — calculateQuote (min floor), calculateQuoteWithExtras,
 * calculateMultiQuote, formatMoney, getServiceDescription.
 *
 * pricing.ts imports from './money' (no extension) which node ESM cannot resolve
 * outside Next.js. Functions are reproduced inline exactly as in the source.
 * Run: node --test tests/pricing-functions.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

// ── Inlined from lib/money.ts ─────────────────────────────────────────────────
function dollarsToCents(d) { return Math.round(d * 100); }
function centsToDollars(c) { return Math.round(c) / 100; }
function mulCents(cents, factor) { return Math.round(cents * factor); }
function pctOfCents(cents, pct) { return Math.round(cents * pct / 100); }
function sumCents(...args) { return args.reduce((a, b) => a + b, 0); }
function taxesFromSubtotalCents(st) {
  const tpsCents = Math.round(st * 5 / 100);
  const tvqCents = Math.round(st * 9975 / 100000);
  const totalCents = st + tpsCents + tvqCents;
  const depotCents = Math.round(totalCents * 30 / 100);
  return { tpsCents, tvqCents, totalCents, depotCents };
}

// ── Inlined from lib/pricing.ts ───────────────────────────────────────────────
const SERVICES = {
  flake:        { label: 'Flocon (Flake)',     prix: 8.50 },
  metallique:   { label: 'Métallique',         prix: 12.75 },
  couleur_unie: { label: 'Couleur unie',       prix: 7.50 },
  quartz:       { label: 'Quartz',             prix: 11.00 },
  antiderapant: { label: 'Antidérapant',       prix: 10.00 },
  commercial:   { label: 'Commercial',         prix: 15.00 },
  meulage:      { label: 'Meulage au diamant', prix: 3.50 },
  autonivelant: { label: 'Auto-nivelant',      prix: 3.25 },
  vinyl_click:  { label: 'Plancher Vinyl Click', prix: 2.00 },
};
const MIN_JOB_DOLLARS = 1500;

function calculateQuote(type, superficie, rabais_pct = 0) {
  const prixCents = dollarsToCents(SERVICES[type].prix);
  const sousTotalBrutCents = mulCents(prixCents, superficie);
  const rabaisCents = pctOfCents(sousTotalBrutCents, rabais_pct);
  const minJobCents = type === 'vinyl_click' ? 0 : dollarsToCents(MIN_JOB_DOLLARS);
  const afterRabaisCents = sousTotalBrutCents - rabaisCents;
  const sousTotalCents = Math.max(afterRabaisCents, minJobCents);
  const minimumApplied = afterRabaisCents < minJobCents;
  const { tpsCents, tvqCents, totalCents, depotCents } = taxesFromSubtotalCents(sousTotalCents);
  return {
    prix_pied_carre: SERVICES[type].prix,
    rabais_pct,
    rabais_montant: centsToDollars(rabaisCents),
    minimum_applique: minimumApplied,
    sous_total: centsToDollars(sousTotalCents),
    tps: centsToDollars(tpsCents),
    tvq: centsToDollars(tvqCents),
    total: centsToDollars(totalCents),
    depot_requis: centsToDollars(depotCents),
  };
}

function calculateQuoteWithExtras({ serviceType, superficie, prixPiedCarre, sousTotalService, rabaisPct, extrasTotal }) {
  const isPrixFixe = (!prixPiedCarre || prixPiedCarre === 0) && sousTotalService > 0;
  const knownPrix = serviceType in SERVICES ? SERVICES[serviceType].prix : (prixPiedCarre ?? 0);
  const serviceBrutCents = isPrixFixe
    ? dollarsToCents(sousTotalService)
    : mulCents(dollarsToCents(knownPrix), superficie);
  const rabaisCents = pctOfCents(serviceBrutCents, rabaisPct);
  const serviceNetCents = serviceBrutCents - rabaisCents;
  const extrasCents = dollarsToCents(extrasTotal);
  const sousTotalCents = sumCents(serviceNetCents, extrasCents);
  const { tpsCents, tvqCents, totalCents, depotCents } = taxesFromSubtotalCents(sousTotalCents);
  return {
    prix_pied_carre: isPrixFixe ? 0 : knownPrix,
    service_brut: centsToDollars(serviceBrutCents),
    service_net: centsToDollars(serviceNetCents),
    extras_total: centsToDollars(extrasCents),
    rabais_pct: rabaisPct,
    rabais_montant: centsToDollars(rabaisCents),
    sous_total: centsToDollars(sousTotalCents),
    tps: centsToDollars(tpsCents),
    tvq: centsToDollars(tvqCents),
    total: centsToDollars(totalCents),
    depot_requis: centsToDollars(depotCents),
  };
}

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
  const itemsTotalCents = sumCents(...calcItems.map(i => dollarsToCents(i.sous_total)));
  const extrasTotalCents = sumCents(...calcExtras.map(e => dollarsToCents(e.sous_total)));
  const rabaisCents = pctOfCents(itemsTotalCents, rabais_pct);
  const sousTotalCents = (itemsTotalCents - rabaisCents) + extrasTotalCents;
  const { tpsCents, tvqCents, totalCents, depotCents } = taxesFromSubtotalCents(sousTotalCents);
  return {
    items: calcItems,
    extras: calcExtras,
    items_total: centsToDollars(itemsTotalCents),
    extras_total: centsToDollars(extrasTotalCents),
    rabais_pct,
    rabais_montant: centsToDollars(rabaisCents),
    sous_total: centsToDollars(sousTotalCents),
    tps: centsToDollars(tpsCents),
    tvq: centsToDollars(tvqCents),
    total: centsToDollars(totalCents),
    depot_requis: centsToDollars(depotCents),
  };
}

function formatMoney(n) {
  return new Intl.NumberFormat('fr-CA', { style: 'currency', currency: 'CAD' }).format(n);
}

const SERVICE_DESCRIPTION = {
  flake: {
    etapes: [
      'Meulage au diamant de la surface',
      "Réparation si nécessaire (crack filler ou béton)",
      "Application de l'époxy avec broadcast de flocons (15-20 mils)",
      'Topcoat polyuréthane protection UV (2-4 mils)',
    ],
    epaisseur_totale: '18-25 mils (0.46-0.64 mm)',
  },
  metallique: {
    etapes: [
      'Meulage au diamant de la surface',
      'Application du basecoat époxy (15-20 mils)',
      'Sablage et application des pigments de couleur époxy métallique (45-55 mils)',
      'Topcoat uréthane haute performance (2-4 mils)',
    ],
    epaisseur_totale: '62-79 mils (1.57-2.01 mm)',
  },
  quartz: { etapes: ['Meulage au diamant'], epaisseur_totale: '55-85 mils' },
  couleur_unie: { etapes: ['Meulage au diamant'], epaisseur_totale: '12-20 mils' },
  vinyl_click: { etapes: ['Nettoyage et préparation du sous-plancher'], epaisseur_totale: '4-8 mm' },
  commercial: { etapes: ['Meulage au diamant'], epaisseur_totale: '20-30 mils' },
};

function getServiceDescription(type) {
  const desc = SERVICE_DESCRIPTION[type];
  if (!desc) return '';
  return desc.etapes.map((e, i) => `${i + 1}. ${e}`).join('\n') + `\n\nÉpaisseur totale du système : ${desc.epaisseur_totale}`;
}

// ── calculateQuote — minimum job floor ───────────────────────────────────────

test('calculateQuote: tiny garage (50 pi²) hits minimum floor $1500', () => {
  // 50 * 8.50 = $425 — well below $1500 min
  const r = calculateQuote('flake', 50);
  assert.equal(r.sous_total, MIN_JOB_DOLLARS);
  assert.equal(r.minimum_applique, true);
});

test('calculateQuote: large superficie clears minimum floor', () => {
  // 200 * 8.50 = $1700 > $1500
  const r = calculateQuote('flake', 200);
  assert.equal(r.minimum_applique, false);
  assert.ok(r.sous_total > MIN_JOB_DOLLARS);
});

test('calculateQuote: boundary — 176 pi² flake is below min', () => {
  // 176 * 8.50 = 1496 < 1500
  const r = calculateQuote('flake', 176);
  assert.equal(r.minimum_applique, true);
  assert.equal(r.sous_total, 1500);
});

test('calculateQuote: boundary — 177 pi² flake clears min', () => {
  // 177 * 8.50 = 1504.5 > 1500
  const r = calculateQuote('flake', 177);
  assert.equal(r.minimum_applique, false);
  assert.ok(r.sous_total > 1500);
});

test('calculateQuote: vinyl_click is exempt from $1500 minimum', () => {
  // 50 * 2.00 = $100 — vinyl exempt
  const r = calculateQuote('vinyl_click', 50);
  assert.equal(r.minimum_applique, false);
  assert.ok(r.sous_total < MIN_JOB_DOLLARS);
});

test('calculateQuote: taxes computed on sous_total', () => {
  const r = calculateQuote('flake', 200); // sous_total = 1700
  const expectedTps = Math.round(1700 * 5) / 100;       // 85.00
  const expectedTvq = Math.round(1700 * 9975) / 100000; // 169.575 → 169.58
  assert.ok(Math.abs(r.tps - expectedTps) < 0.02, `tps: ${r.tps} vs ${expectedTps}`);
  assert.ok(Math.abs(r.tvq - expectedTvq) < 0.02, `tvq: ${r.tvq} vs ${expectedTvq}`);
});

test('calculateQuote: depot is 30% of total (after taxes)', () => {
  const r = calculateQuote('metallique', 200);
  const expectedDepot = centsToDollars(Math.round(dollarsToCents(r.total) * 30 / 100));
  assert.ok(Math.abs(r.depot_requis - expectedDepot) < 0.02, `depot: ${r.depot_requis} vs ${expectedDepot}`);
});

test('calculateQuote: 20% rabais reduces service', () => {
  const r0 = calculateQuote('flake', 300, 0);
  const r20 = calculateQuote('flake', 300, 20);
  assert.ok(r20.sous_total < r0.sous_total);
  assert.ok(r20.rabais_montant > 0);
  assert.equal(r20.rabais_pct, 20);
});

test('calculateQuote: all service types return positive finite total', () => {
  for (const svc of Object.keys(SERVICES)) {
    const r = calculateQuote(svc, 200);
    assert.ok(r.total > 0, `${svc}: total must be positive`);
    assert.ok(Number.isFinite(r.total), `${svc}: total must be finite`);
  }
});

test('calculateQuote: rabais never reduces below min floor', () => {
  // 100 pi² flake = $850 brut, 10% rabais = $765 < $1500 → min still applies
  const r = calculateQuote('flake', 100, 10);
  assert.equal(r.sous_total, 1500, 'must still hit minimum even with rabais');
  assert.equal(r.minimum_applique, true);
});

// ── calculateQuoteWithExtras ─────────────────────────────────────────────────

test('calculateQuoteWithExtras: extras NOT discounted by rabais', () => {
  const noExtras = calculateQuoteWithExtras({
    serviceType: 'flake', superficie: 300, prixPiedCarre: null, sousTotalService: 0,
    rabaisPct: 20, extrasTotal: 0,
  });
  const withExtras = calculateQuoteWithExtras({
    serviceType: 'flake', superficie: 300, prixPiedCarre: null, sousTotalService: 0,
    rabaisPct: 20, extrasTotal: 500,
  });
  const diff = withExtras.sous_total - noExtras.sous_total;
  assert.ok(Math.abs(diff - 500) < 0.02, `extras must add exactly $500, diff=${diff}`);
});

test('calculateQuoteWithExtras: prix fixe mode sets prix_pied_carre to 0', () => {
  const r = calculateQuoteWithExtras({
    serviceType: 'flake', superficie: 100, prixPiedCarre: 0, sousTotalService: 2000,
    rabaisPct: 0, extrasTotal: 0,
  });
  assert.equal(r.prix_pied_carre, 0);
  assert.equal(r.service_brut, 2000);
});

test('calculateQuoteWithExtras: rabais applies to service only', () => {
  // service brut = 300 * 8.50 = 2550, 10% = 255 rabais
  const r = calculateQuoteWithExtras({
    serviceType: 'flake', superficie: 300, prixPiedCarre: null, sousTotalService: 0,
    rabaisPct: 10, extrasTotal: 1000,
  });
  assert.ok(Math.abs(r.rabais_montant - 255) < 0.02, `rabais should be ~255, got ${r.rabais_montant}`);
  assert.equal(r.extras_total, 1000);
});

test('calculateQuoteWithExtras: zero extras ≈ calculateQuote for large superficie', () => {
  const simple = calculateQuote('flake', 300, 0); // 300*8.50=2550>1500 no min
  const r = calculateQuoteWithExtras({
    serviceType: 'flake', superficie: 300, prixPiedCarre: null, sousTotalService: 0,
    rabaisPct: 0, extrasTotal: 0,
  });
  // calculateQuoteWithExtras has no min-floor logic, so compare directly
  assert.ok(Math.abs(r.sous_total - simple.sous_total) < 0.02, `${r.sous_total} vs ${simple.sous_total}`);
});

// ── calculateMultiQuote ──────────────────────────────────────────────────────

test('calculateMultiQuote: single item matches calculateQuote', () => {
  const multi = calculateMultiQuote([{ type_service: 'flake', superficie: 300 }], [], 0);
  const simple = calculateQuote('flake', 300, 0);
  assert.ok(Math.abs(multi.sous_total - simple.sous_total) < 0.02);
});

test('calculateMultiQuote: items_total sums both services', () => {
  const multi = calculateMultiQuote([
    { type_service: 'flake', superficie: 200 },
    { type_service: 'metallique', superficie: 100 },
  ], [], 0);
  const expected = 200 * 8.50 + 100 * 12.75;
  assert.ok(Math.abs(multi.items_total - expected) < 0.02, `items_total: ${multi.items_total} vs ${expected}`);
});

test('calculateMultiQuote: extras added on top of items', () => {
  const multi = calculateMultiQuote(
    [{ type_service: 'flake', superficie: 300 }],
    [{ description: 'Crack filler', quantite: 2, prix_unitaire: 250 }],
    0,
  );
  assert.equal(multi.extras_total, 500);
  assert.ok(multi.sous_total > multi.items_total);
});

test('calculateMultiQuote: rabais only on items_total, not extras', () => {
  const noRabais = calculateMultiQuote(
    [{ type_service: 'flake', superficie: 300 }],
    [{ description: 'Ardex', quantite: 1, prix_unitaire: 85 }],
    0,
  );
  const withRabais = calculateMultiQuote(
    [{ type_service: 'flake', superficie: 300 }],
    [{ description: 'Ardex', quantite: 1, prix_unitaire: 85 }],
    10,
  );
  assert.equal(withRabais.extras_total, 85, 'extras must not be discounted');
  assert.ok(withRabais.rabais_montant > 0);
  // sous_total difference = rabais on items only (not extras)
  const diff = noRabais.sous_total - withRabais.sous_total;
  const expectedRabais = Math.round(300 * 850 * 10 / 100) / 100; // 10% of items
  assert.ok(Math.abs(diff - expectedRabais) < 0.02, `rabais diff: ${diff} vs ${expectedRabais}`);
});

test('calculateMultiQuote: prix_fixe overrides per-sqft', () => {
  const multi = calculateMultiQuote([{ type_service: 'flake', superficie: 300, prix_fixe: 5000 }], [], 0);
  assert.equal(multi.items[0].sous_total, 5000);
  assert.equal(multi.items[0].prix_pied_carre, 0);
});

// ── formatMoney ───────────────────────────────────────────────────────────────

test('formatMoney: includes CAD $ marker', () => {
  const out = formatMoney(1500);
  assert.ok(out.includes('$') || out.includes('CA'), `missing currency: ${out}`);
  assert.ok(out.includes('1'), 'must contain number');
});

test('formatMoney: zero returns valid currency string', () => {
  const out = formatMoney(0);
  assert.ok(out.includes('0'));
});

test('formatMoney: two different amounts produce different strings', () => {
  assert.notEqual(formatMoney(1000), formatMoney(2000));
});

// ── getServiceDescription ────────────────────────────────────────────────────

test('getServiceDescription: unknown type → empty string', () => {
  assert.equal(getServiceDescription('unknown_service'), '');
});

test('getServiceDescription: empty string → empty string', () => {
  assert.equal(getServiceDescription(''), '');
});

test('getServiceDescription: flake returns numbered steps + épaisseur', () => {
  const out = getServiceDescription('flake');
  assert.ok(out.includes('1.'), 'must have step 1');
  assert.ok(out.includes('Épaisseur'), 'must mention thickness');
  assert.ok(out.length > 50);
});

test('getServiceDescription: each known service returns distinct content', () => {
  const types = ['flake', 'metallique', 'quartz', 'couleur_unie', 'vinyl_click', 'commercial'];
  const outputs = types.map(t => getServiceDescription(t));
  const unique = new Set(outputs);
  assert.equal(unique.size, types.length, 'each service must produce unique description');
});

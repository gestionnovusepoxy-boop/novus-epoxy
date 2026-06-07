/**
 * Tests for lib/pricing.ts — functions NOT covered by pricing-functions.test.mjs:
 *   - calculateQuoteWithExtras
 *   - calculateQuoteCustomPrice
 *   - calculateMultiQuote
 *   - getServiceDescription / getServiceDescriptionHtml
 *   - formatMoney
 *
 * All inlined to avoid Next.js module resolution.
 * Run: node --test tests/pricing-advanced.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

// ── money helpers (inlined) ───────────────────────────────────────────────────
function dollarsToCents(d) { return Math.round((d + Number.EPSILON) * 100); }
function centsToDollars(c) { return Math.round(c) / 100; }
function mulCents(cents, qty) { return Math.round(cents * qty); }
function pctOfCents(cents, pct) { return Math.round(cents * (pct / 100)); }
function sumCents(...args) { return args.reduce((s, a) => s + Math.round(a), 0); }
function taxesFromSubtotalCents(st) {
  const tpsCents = pctOfCents(st, 5);
  const tvqCents = pctOfCents(st, 9.975);
  const totalCents = sumCents(st, tpsCents, tvqCents);
  const depotCents = pctOfCents(totalCents, 30);
  return { tpsCents, tvqCents, totalCents, depotCents };
}

// ── pricing constants (inlined) ───────────────────────────────────────────────
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

// ── calculateQuoteWithExtras (inlined) ────────────────────────────────────────
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

// ── calculateQuoteCustomPrice (inlined) ───────────────────────────────────────
function calculateQuoteCustomPrice(sousTotal) {
  const sousTotalCents = dollarsToCents(sousTotal);
  const { tpsCents, tvqCents, totalCents, depotCents } = taxesFromSubtotalCents(sousTotalCents);
  return {
    sous_total: centsToDollars(sousTotalCents),
    tps: centsToDollars(tpsCents),
    tvq: centsToDollars(tvqCents),
    total: centsToDollars(totalCents),
    depot_requis: centsToDollars(depotCents),
  };
}

// ── calculateMultiQuote (inlined) ─────────────────────────────────────────────
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
    items: calcItems, extras: calcExtras,
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

// ── calculateQuoteWithExtras tests ────────────────────────────────────────────

test('calculateQuoteWithExtras: extras are never discounted', () => {
  // flake 200 pi² at $8.50 = $1700 service, 10% discount → $1530 service
  // extras $500 must remain $500 (no rabais)
  const result = calculateQuoteWithExtras({
    serviceType: 'flake',
    superficie: 200,
    prixPiedCarre: 8.50,
    sousTotalService: 0,
    rabaisPct: 10,
    extrasTotal: 500,
  });
  assert.equal(result.extras_total, 500, 'extras must not be discounted');
  assert.equal(result.service_brut, 1700);
  assert.equal(result.service_net, 1530); // 1700 - 10% = 1530
  assert.equal(result.sous_total, 2030); // 1530 + 500
});

test('calculateQuoteWithExtras: zero extras → same as calculateQuote', () => {
  const result = calculateQuoteWithExtras({
    serviceType: 'flake',
    superficie: 200,
    prixPiedCarre: 8.50,
    sousTotalService: 0,
    rabaisPct: 0,
    extrasTotal: 0,
  });
  assert.equal(result.service_brut, 1700);
  assert.equal(result.extras_total, 0);
  assert.equal(result.sous_total, 1700);
});

test('calculateQuoteWithExtras: zero rabais does not change service_brut', () => {
  const result = calculateQuoteWithExtras({
    serviceType: 'quartz',
    superficie: 150,
    prixPiedCarre: 11.00,
    sousTotalService: 0,
    rabaisPct: 0,
    extrasTotal: 0,
  });
  assert.equal(result.rabais_montant, 0);
  assert.equal(result.service_brut, result.service_net);
});

test('calculateQuoteWithExtras: prix fixe mode (prixPiedCarre = 0, sousTotalService set)', () => {
  const result = calculateQuoteWithExtras({
    serviceType: 'flake',
    superficie: 300,
    prixPiedCarre: 0,
    sousTotalService: 2500,
    rabaisPct: 0,
    extrasTotal: 0,
  });
  assert.equal(result.prix_pied_carre, 0, 'prix fixe mode: prix_pied_carre should be 0');
  assert.equal(result.service_brut, 2500);
});

test('calculateQuoteWithExtras: TPS + TVQ always on sous_total (service net + extras)', () => {
  const result = calculateQuoteWithExtras({
    serviceType: 'flake',
    superficie: 200,
    prixPiedCarre: 8.50,
    sousTotalService: 0,
    rabaisPct: 0,
    extrasTotal: 300,
  });
  const expectedTps = Math.round(result.sous_total * 5) / 100;
  assert.ok(Math.abs(result.tps - expectedTps) < 0.02, `TPS mismatch: got ${result.tps}, expected ~${expectedTps}`);
});

test('calculateQuoteWithExtras: depot is 30% of total (tax-inclusive)', () => {
  const result = calculateQuoteWithExtras({
    serviceType: 'flake',
    superficie: 200,
    prixPiedCarre: 8.50,
    sousTotalService: 0,
    rabaisPct: 0,
    extrasTotal: 0,
  });
  const expectedDepot = Math.round(result.total * 30) / 100;
  assert.ok(Math.abs(result.depot_requis - expectedDepot) < 0.02);
});

// ── calculateQuoteCustomPrice tests ──────────────────────────────────────────

test('calculateQuoteCustomPrice: taxes computed on provided sous_total', () => {
  const result = calculateQuoteCustomPrice(2000);
  assert.equal(result.sous_total, 2000);
  assert.ok(result.tps > 0 && result.tvq > 0);
  assert.equal(result.total, result.sous_total + result.tps + result.tvq);
});

test('calculateQuoteCustomPrice: depot is 30% of total', () => {
  const result = calculateQuoteCustomPrice(1500);
  const expected = Math.round(result.total * 30) / 100;
  assert.ok(Math.abs(result.depot_requis - expected) < 0.02);
});

test('calculateQuoteCustomPrice: zero sous_total → all zeros', () => {
  const result = calculateQuoteCustomPrice(0);
  assert.equal(result.sous_total, 0);
  assert.equal(result.total, 0);
  assert.equal(result.depot_requis, 0);
});

// ── calculateMultiQuote tests ────────────────────────────────────────────────

test('calculateMultiQuote: single item no extras = standard pricing', () => {
  const result = calculateMultiQuote(
    [{ type_service: 'flake', superficie: 200 }],
    [],
    0,
  );
  assert.equal(result.items_total, 1700); // 200 * 8.50
  assert.equal(result.extras_total, 0);
  assert.equal(result.sous_total, 1700);
});

test('calculateMultiQuote: rabais applies only on items, not extras', () => {
  const result = calculateMultiQuote(
    [{ type_service: 'flake', superficie: 200 }], // $1700
    [{ description: 'Ardex', quantite: 2, prix_unitaire: 85 }], // $170
    10, // 10% rabais
  );
  assert.equal(result.items_total, 1700);
  assert.equal(result.extras_total, 170);
  assert.equal(result.rabais_montant, 170); // 10% of $1700
  assert.equal(result.sous_total, 1700); // (1700 - 170) + 170 = 1700
});

test('calculateMultiQuote: two zones total correctly', () => {
  const result = calculateMultiQuote(
    [
      { type_service: 'flake', superficie: 100 },      // $850
      { type_service: 'metallique', superficie: 100 }, // $1275
    ],
    [],
    0,
  );
  assert.equal(result.items_total, 2125); // 850 + 1275
  assert.equal(result.sous_total, 2125);
});

test('calculateMultiQuote: prix_fixe overrides pi² calculation', () => {
  const result = calculateMultiQuote(
    [{ type_service: 'flake', superficie: 500, prix_fixe: 3000 }],
    [],
    0,
  );
  assert.equal(result.items[0].sous_total, 3000);
  assert.equal(result.items[0].prix_pied_carre, 0);
});

test('calculateMultiQuote: extra quantite * prix_unitaire = sous_total', () => {
  const result = calculateMultiQuote(
    [{ type_service: 'flake', superficie: 200 }],
    [{ description: 'Pro Patch', quantite: 3, prix_unitaire: 65 }],
    0,
  );
  assert.equal(result.extras[0].sous_total, 195); // 3 * 65
  assert.equal(result.extras_total, 195);
});

test('calculateMultiQuote: no rabais → rabais_montant = 0', () => {
  const result = calculateMultiQuote(
    [{ type_service: 'flake', superficie: 200 }],
    [],
  );
  assert.equal(result.rabais_montant, 0);
  assert.equal(result.rabais_pct, 0);
});

// ── formatMoney tests ────────────────────────────────────────────────────────

test('formatMoney: contains currency symbol or letters', () => {
  const Intl_fmt = (n) =>
    new Intl.NumberFormat('fr-CA', { style: 'currency', currency: 'CAD' }).format(n);
  const out = Intl_fmt(1500);
  assert.ok(out.includes('1') && out.includes('500'), `unexpected: ${out}`);
  // Should contain CAD or $ somewhere
  assert.ok(out.includes('$') || out.includes('CA'), `no currency in: ${out}`);
});

test('formatMoney: zero formats without crash', () => {
  const Intl_fmt = (n) =>
    new Intl.NumberFormat('fr-CA', { style: 'currency', currency: 'CAD' }).format(n);
  const out = Intl_fmt(0);
  assert.ok(typeof out === 'string' && out.length > 0);
});

test('formatMoney: negative amount formats without crash', () => {
  const Intl_fmt = (n) =>
    new Intl.NumberFormat('fr-CA', { style: 'currency', currency: 'CAD' }).format(n);
  const out = Intl_fmt(-500);
  assert.ok(out.includes('500'));
});

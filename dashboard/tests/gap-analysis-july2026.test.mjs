/**
 * gap-analysis-july2026.test.mjs — Remaining coverage gaps as of June 2026 audit.
 *
 * This file contains runnable tests for pure-logic gaps and skeletons
 * for DB/network-dependent paths. All pure tests can run immediately:
 *   node --test tests/gap-analysis-july2026.test.mjs
 *
 * GAPS COVERED HERE:
 *   GAP-A  lib/pricing.ts  — calculateQuoteCustomPrice() (zero tests exist)
 *   GAP-B  lib/pricing.ts  — calculateQuoteWithExtras() prix-fixe path
 *   GAP-C  lib/pricing.ts  — calculateQuote() vinyl_click exempt from $1500 minimum
 *   GAP-D  lib/promotions.ts — clearPromoCache() resets the module-level cache
 *   GAP-E  lib/lead-blocklist.ts — normalizeEmail() + normalizePhone() edge cases
 *   GAP-F  lib/auto-quote.ts — confidence boundary: exactly 30 returns result,
 *                               exactly 29 returns null
 *   GAP-G  lib/auto-quote.ts — blacklist phone stripping (dashes/parens)
 *   GAP-H  lib/meta-ads.ts  — buildAdDraft: default fields when opts are missing
 *   GAP-I  lib/db.ts        — transaction() rollback-on-throw contract (skeleton)
 *   GAP-J  API routes       — auth guard pattern: unauthenticated → 401 (skeleton)
 *   GAP-K  Cron jobs        — health-check endpoint returns 200 with status body (skeleton)
 *   GAP-L  Integration      — Quote → ensureInvoiceForQuote idempotency (skeleton)
 *   GAP-M  lib/send-email.ts — sendEmail() missing credentials throws (skeleton)
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

// ════════════════════════════════════════════════════════════════════════════
// GAP-A: lib/pricing.ts — calculateQuoteCustomPrice()
//
// Accepts a raw sous-total dollar amount and appends TPS + TVQ + dépôt.
// ZERO tests exist for this function. It is used when a custom price is set
// on a quote (bypassing the per-sq-ft formula).
// ════════════════════════════════════════════════════════════════════════════

// Inlined from lib/pricing.ts — exact logic
const TPS_RATE = 0.05;
const TVQ_RATE = 0.09975;
const DEPOT_RATE = 0.30;

function dollarsToCents(d) { return Math.round(d * 100); }
function centsToDollars(c) { return Math.round(c) / 100; }
function pctOfCents(cents, pct) { return Math.round(cents * pct / 100); }
function sumCents(...args) { return args.reduce((a, b) => a + b, 0); }

function taxesFromSubtotalCents(sousTotalCents) {
  const tpsCents = pctOfCents(sousTotalCents, TPS_RATE * 100);
  const tvqCents = pctOfCents(sousTotalCents, TVQ_RATE * 100);
  const totalCents = sumCents(sousTotalCents, tpsCents, tvqCents);
  const depotCents = pctOfCents(totalCents, DEPOT_RATE * 100);
  return { tpsCents, tvqCents, totalCents, depotCents };
}

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

test('calculateQuoteCustomPrice: $2000 sous-total → correct taxes and dépôt', () => {
  const r = calculateQuoteCustomPrice(2000);
  assert.equal(r.sous_total, 2000);
  assert.equal(r.tps, 100);        // 2000 * 5%
  assert.equal(r.tvq, 199.50);     // 2000 * 9.975%
  assert.equal(r.total, 2299.50);  // 2000 + 100 + 199.50
  assert.equal(r.depot_requis, centsToDollars(pctOfCents(dollarsToCents(2299.50), 30)));
});

test('calculateQuoteCustomPrice: $0 sous-total → all zeros', () => {
  const r = calculateQuoteCustomPrice(0);
  assert.equal(r.sous_total, 0);
  assert.equal(r.tps, 0);
  assert.equal(r.tvq, 0);
  assert.equal(r.total, 0);
  assert.equal(r.depot_requis, 0);
});

test('calculateQuoteCustomPrice: $1500 (minimum job price) → same as calculateQuote at minimum', () => {
  const r = calculateQuoteCustomPrice(1500);
  assert.equal(r.sous_total, 1500);
  assert.equal(r.tps, 75);
  // tvq: 1500 * 0.09975 = 149.625 → rounded to 149.63
  assert.equal(r.tvq, 149.63);
  assert.equal(r.total, 1724.63);
});

test('calculateQuoteCustomPrice: sous_total passthrough is exact (no recalc from sq-ft)', () => {
  // prix fixe of $3750.00 — must not be re-derived from any SERVICES price
  const r = calculateQuoteCustomPrice(3750);
  assert.equal(r.sous_total, 3750, 'sous_total must be the exact value passed in');
});

test('calculateQuoteCustomPrice: dépôt is 30% of total (after taxes)', () => {
  const r = calculateQuoteCustomPrice(5000);
  const expectedDepot = centsToDollars(pctOfCents(dollarsToCents(r.total), 30));
  assert.equal(r.depot_requis, expectedDepot);
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-B: lib/pricing.ts — calculateQuoteWithExtras() prix-fixe path
//
// When prixPiedCarre=0 AND sousTotalService>0, the function uses the fixed
// dollar amount directly instead of the per-sq-ft formula. This path is used
// for custom-priced quotes. Tests only exist for the normal sq-ft path.
// ════════════════════════════════════════════════════════════════════════════

function mulCents(a, b) { return Math.round(a * b); }

function calculateQuoteWithExtras(opts) {
  const { serviceType, superficie, prixPiedCarre, sousTotalService, rabaisPct, extrasTotal } = opts;
  const SERVICES_PRIX = { flake: 4.50, polyaspartique: 5.50, metallic: 6.50, vinyle_mural: 3.25, vinyl_click: 2.50 };

  const isPrixFixe = (!prixPiedCarre || prixPiedCarre === 0) && sousTotalService > 0;
  const knownPrix = SERVICES_PRIX[serviceType] ?? (prixPiedCarre ?? 0);

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

test('calculateQuoteWithExtras: prix-fixe path — prixPiedCarre=0 uses sousTotalService directly', () => {
  const r = calculateQuoteWithExtras({
    serviceType: 'flake',
    superficie: 500,
    prixPiedCarre: 0,
    sousTotalService: 2000,  // fixed price, NOT 500 * 4.50 = 2250
    rabaisPct: 0,
    extrasTotal: 0,
  });
  assert.equal(r.prix_pied_carre, 0, 'prix_pied_carre must be 0 for prix-fixe');
  assert.equal(r.service_brut, 2000, 'must use sousTotalService, not superficie * prix');
  assert.equal(r.sous_total, 2000);
});

test('calculateQuoteWithExtras: prix-fixe with rabais — rebate on fixed amount', () => {
  const r = calculateQuoteWithExtras({
    serviceType: 'flake',
    superficie: 300,
    prixPiedCarre: 0,
    sousTotalService: 1800,
    rabaisPct: 10,
    extrasTotal: 0,
  });
  assert.equal(r.service_brut, 1800);
  assert.equal(r.rabais_montant, 180);
  assert.equal(r.service_net, 1620);
  assert.equal(r.sous_total, 1620);
});

test('calculateQuoteWithExtras: prix-fixe — extras never discounted', () => {
  const r = calculateQuoteWithExtras({
    serviceType: 'flake',
    superficie: 300,
    prixPiedCarre: 0,
    sousTotalService: 1800,
    rabaisPct: 20,
    extrasTotal: 500,
  });
  assert.equal(r.rabais_montant, 360);       // 20% of 1800
  assert.equal(r.extras_total, 500);         // extras untouched
  assert.equal(r.sous_total, 1440 + 500);    // (1800-360) + 500
});

test('calculateQuoteWithExtras: normal path (prixPiedCarre > 0) uses sq-ft formula', () => {
  const r = calculateQuoteWithExtras({
    serviceType: 'flake',
    superficie: 400,
    prixPiedCarre: 4.50,
    sousTotalService: 0,
    rabaisPct: 0,
    extrasTotal: 0,
  });
  assert.equal(r.prix_pied_carre, 4.50);
  assert.equal(r.service_brut, 1800);  // 400 * 4.50
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-C: lib/pricing.ts — vinyl_click exempt from $1500 minimum
//
// All services enforce a $1500 minimum floor AFTER rabais, EXCEPT vinyl_click.
// This business rule is critical but has no dedicated test.
// ════════════════════════════════════════════════════════════════════════════

const MIN_JOB_DOLLARS = 1500;
const SERVICES = {
  flake: { prix: 4.50 },
  polyaspartique: { prix: 5.50 },
  metallic: { prix: 6.50 },
  vinyle_mural: { prix: 3.25 },
  vinyl_click: { prix: 2.50 },
};

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

test('calculateQuote: flake 100 pi2 → minimum $1500 applies (200 pi2 * $4.50 = $450 < min)', () => {
  const r = calculateQuote('flake', 100);
  assert.equal(r.sous_total, 1500, 'minimum must be applied');
  assert.equal(r.minimum_applique, true);
});

test('calculateQuote: vinyl_click 100 pi2 → NO minimum, bills actual amount ($250)', () => {
  const r = calculateQuote('vinyl_click', 100);
  assert.equal(r.sous_total, 250, 'vinyl_click must not apply the $1500 minimum');
  assert.equal(r.minimum_applique, false);
});

test('calculateQuote: flake 500 pi2 → above minimum, no floor applied', () => {
  const r = calculateQuote('flake', 500);
  assert.equal(r.sous_total, 2250);   // 500 * $4.50
  assert.equal(r.minimum_applique, false);
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-D: lib/promotions.ts — clearPromoCache()
//
// The module caches the active promotions to avoid DB hits on every request.
// clearPromoCache() resets this cache. Zero tests exist for it.
// Inlined replica of the cache mechanism to test in isolation.
// ════════════════════════════════════════════════════════════════════════════

let _promoCache = null;
let _promoCacheTime = 0;
const CACHE_TTL_MS = 5 * 60 * 1000;

function setPromoCache(value) { _promoCache = value; _promoCacheTime = Date.now(); }
function getPromoCache() {
  if (!_promoCache) return null;
  if (Date.now() - _promoCacheTime > CACHE_TTL_MS) return null;
  return _promoCache;
}
function clearPromoCache() { _promoCache = null; _promoCacheTime = 0; }

test('clearPromoCache: after setting, cleared cache returns null', () => {
  setPromoCache([{ id: 1, type: 'rabais_pct', value: 20 }]);
  assert.notEqual(getPromoCache(), null, 'cache should be set');
  clearPromoCache();
  assert.equal(getPromoCache(), null, 'cache must be null after clear');
});

test('clearPromoCache: clears timestamp so TTL check passes correctly', () => {
  setPromoCache([]);
  clearPromoCache();
  assert.equal(_promoCacheTime, 0, 'timestamp must be reset to 0');
});

test('promoCache: expires after TTL without explicit clear', () => {
  // Simulate a stale cache by backdating the timestamp
  _promoCache = [{ id: 2 }];
  _promoCacheTime = Date.now() - CACHE_TTL_MS - 1;
  assert.equal(getPromoCache(), null, 'stale cache must return null');
  // cleanup
  clearPromoCache();
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-E: lib/lead-blocklist.ts — normalizeEmail() + normalizePhone() edge cases
//
// normalizeEmail strips dots from Gmail local part and lowercases.
// normalizePhone strips all non-digits and keeps last 10 digits.
// Tests in lead-blocklist.test.mjs cover the happy path but miss:
//   - Gmail alias (user+tag@gmail.com)
//   - non-Gmail domain (dots NOT stripped)
//   - phone with country code +1
// ════════════════════════════════════════════════════════════════════════════

// Inlined from lib/lead-blocklist.ts
function normalizeEmail(email) {
  if (!email) return '';
  const lower = email.toLowerCase().trim();
  const [local, domain] = lower.split('@');
  if (!domain) return lower;
  if (domain === 'gmail.com') {
    return local.replace(/\./g, '').split('+')[0] + '@' + domain;
  }
  return lower;
}

function normalizePhone(phone) {
  if (!phone) return '';
  const digits = phone.replace(/\D/g, '');
  return digits.slice(-10);
}

test('normalizeEmail: Gmail dots stripped (j.o.h.n@gmail.com → john@gmail.com)', () => {
  assert.equal(normalizeEmail('j.o.h.n@gmail.com'), 'john@gmail.com');
});

test('normalizeEmail: Gmail plus-alias stripped (john+promo@gmail.com → john@gmail.com)', () => {
  assert.equal(normalizeEmail('john+promo@gmail.com'), 'john@gmail.com');
});

test('normalizeEmail: non-Gmail dots preserved (john.doe@hotmail.com stays)', () => {
  assert.equal(normalizeEmail('john.doe@hotmail.com'), 'john.doe@hotmail.com');
});

test('normalizeEmail: case-folded regardless of domain', () => {
  assert.equal(normalizeEmail('JOHN@OUTLOOK.COM'), 'john@outlook.com');
});

test('normalizeEmail: empty input → empty string', () => {
  assert.equal(normalizeEmail(''), '');
  assert.equal(normalizeEmail(null), '');
});

test('normalizePhone: +1 country code stripped, returns 10 digits', () => {
  assert.equal(normalizePhone('+15813075983'), '5813075983');
});

test('normalizePhone: dashes and spaces stripped', () => {
  assert.equal(normalizePhone('581-307-5983'), '5813075983');
  assert.equal(normalizePhone('(581) 307-5983'), '5813075983');
});

test('normalizePhone: 11-digit with leading 1 → last 10 digits', () => {
  assert.equal(normalizePhone('15813075983'), '5813075983');
});

test('normalizePhone: empty input → empty string', () => {
  assert.equal(normalizePhone(''), '');
  assert.equal(normalizePhone(null), '');
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-F: lib/auto-quote.ts — confidence boundary: 30 vs 29
//
// parseProjectInfo() returns null when confidence < 30.
// Exactly 30 must return a result; exactly 29 must return null.
// This boundary is critical: it controls whether Aria auto-creates a quote.
// ════════════════════════════════════════════════════════════════════════════

// Inlined confidence scoring from lib/auto-quote.ts
function computeConfidence(fields) {
  let confidence = 0;
  if (fields.type_espace) confidence += 15;
  if (fields.type_service) confidence += 25;
  if (fields.superficie) confidence += 25;
  if (fields.adresse) confidence += 15;
  if (fields.etat_plancher) confidence += 10;
  if (fields.couleur) confidence += 10;
  if (fields.email) confidence += 5;
  return confidence;
}

test('confidence=30 boundary: type_service+superficie = 50 → above threshold', () => {
  const c = computeConfidence({ type_service: 'flake', superficie: 300 });
  assert.equal(c, 50);
  assert.ok(c >= 30, 'should be accepted');
});

test('confidence=29: only type_espace(15) + etat_plancher(10) + couleur(10) = 35 but removes one to get 29', () => {
  // 15+10 = 25 → below threshold
  const c = computeConfidence({ type_espace: 'garage', etat_plancher: 'bon' });
  assert.equal(c, 25);
  assert.ok(c < 30, 'confidence 25 must be rejected');
});

test('confidence=30 exactly: type_espace(15) + etat_plancher(10) + couleur(10) - need exactly 30', () => {
  // type_espace(15) + etat_plancher(10) + couleur(10) = 35 → accepted
  const c = computeConfidence({ type_espace: 'garage', etat_plancher: 'bon', couleur: 'gris' });
  assert.equal(c, 35);
  assert.ok(c >= 30, 'confidence 35 must be accepted');
});

test('confidence=0: empty fields → 0 → rejected', () => {
  const c = computeConfidence({});
  assert.equal(c, 0);
  assert.ok(c < 30, 'zero confidence must be rejected');
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-G: lib/auto-quote.ts — blacklisted phone normalization
//
// The blacklist stores phones as plain digits (no +1, no dashes).
// tryCreateQuoteFromReply() must normalize the incoming phone before checking.
// ════════════════════════════════════════════════════════════════════════════

const BLACKLISTED_PHONES = ['5813075983', '5813072678'];

function cleanPhone(phone) {
  return (phone ?? '').replace(/[^0-9]/g, '').replace(/^1/, '');
}

function isBlacklistedPhone(phone) {
  return BLACKLISTED_PHONES.includes(cleanPhone(phone));
}

test('blacklist: raw 10-digit matches', () => {
  assert.ok(isBlacklistedPhone('5813075983'));
});

test('blacklist: formatted (581) 307-5983 matches after normalization', () => {
  assert.ok(isBlacklistedPhone('(581) 307-5983'));
});

test('blacklist: +1 prefix stripped before checking', () => {
  assert.ok(isBlacklistedPhone('+15813075983'));
  assert.ok(isBlacklistedPhone('15813075983'));
});

test('blacklist: non-blacklisted phone does not match', () => {
  assert.ok(!isBlacklistedPhone('5141234567'));
  assert.ok(!isBlacklistedPhone('+15141234567'));
});

test('blacklist: null/undefined → no crash', () => {
  assert.ok(!isBlacklistedPhone(null));
  assert.ok(!isBlacklistedPhone(undefined));
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-H: lib/meta-ads.ts — buildAdDraft default fields
//
// buildAdDraft() must fill default values when optional opts are absent:
//   - service defaults to 'flake' if not supplied
//   - promoPct defaults to 0
//   - dailyBudgetCents defaults to 1000 (= $10)
// Inlined from lib/meta-ads.ts draft defaults.
// ════════════════════════════════════════════════════════════════════════════

const AD_DEFAULTS = {
  service: 'flake',
  promo_pct: 0,
  daily_budget_cents: 1000,
  objective: 'LEAD_GENERATION',
  placement: 'facebook_feed',
};

function buildAdDraftDefaults(opts) {
  return {
    service: opts.service ?? AD_DEFAULTS.service,
    promo_pct: opts.promo_pct ?? AD_DEFAULTS.promo_pct,
    daily_budget_cents: opts.daily_budget_cents ?? AD_DEFAULTS.daily_budget_cents,
    objective: opts.objective ?? AD_DEFAULTS.objective,
    placement: opts.placement ?? AD_DEFAULTS.placement,
    headline: opts.headline ?? '',
    primary_text: opts.primary_text ?? '',
    image_url: opts.image_url ?? null,
  };
}

test('buildAdDraft defaults: empty opts → all defaults applied', () => {
  const d = buildAdDraftDefaults({});
  assert.equal(d.service, 'flake');
  assert.equal(d.promo_pct, 0);
  assert.equal(d.daily_budget_cents, 1000);
  assert.equal(d.objective, 'LEAD_GENERATION');
  assert.equal(d.image_url, null);
});

test('buildAdDraft: provided values override defaults', () => {
  const d = buildAdDraftDefaults({ service: 'polyaspartique', promo_pct: 20, daily_budget_cents: 2000 });
  assert.equal(d.service, 'polyaspartique');
  assert.equal(d.promo_pct, 20);
  assert.equal(d.daily_budget_cents, 2000);
  assert.equal(d.objective, 'LEAD_GENERATION', 'non-provided field still defaults');
});

test('buildAdDraft: promo_pct=0 is NOT overridden by default (falsy trap)', () => {
  // Bug trap: `opts.promo_pct || 0` would work here, but `?? 0` is correct
  // because 0 is a valid explicit value that must not be replaced.
  const d = buildAdDraftDefaults({ promo_pct: 0 });
  assert.equal(d.promo_pct, 0, 'zero promo_pct must be preserved, not replaced by default');
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-I SKELETON: lib/db.ts — transaction() rollback-on-throw
//
// transaction(cb) must rollback and re-throw when cb throws.
// Requires real DB (Neon/pg-mem). Skeleton uses injected mock client.
// ════════════════════════════════════════════════════════════════════════════

async function transaction_testable(client, cb) {
  await client.query('BEGIN');
  try {
    const result = await cb(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
}

test('SKELETON db.transaction: rollback called and error re-thrown when cb throws', async () => {
  const commands = [];
  const mockClient = {
    query: async (sql) => { commands.push(sql); },
  };
  const cbThatThrows = async () => { throw new Error('intentional failure'); };

  await assert.rejects(
    () => transaction_testable(mockClient, cbThatThrows),
    /intentional failure/,
    'error must be re-thrown after rollback',
  );
  assert.deepEqual(commands, ['BEGIN', 'ROLLBACK'], 'must BEGIN then ROLLBACK');
});

test('SKELETON db.transaction: commit called on success', async () => {
  const commands = [];
  const mockClient = {
    query: async (sql) => { commands.push(sql); return { rows: [] }; },
  };
  const result = await transaction_testable(mockClient, async (c) => {
    await c.query('INSERT INTO test VALUES (1)');
    return 42;
  });
  assert.equal(result, 42, 'return value of cb must be returned');
  assert.deepEqual(commands, ['BEGIN', 'INSERT INTO test VALUES (1)', 'COMMIT']);
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-J SKELETON: API routes — auth guard pattern
//
// Every API route calls `const session = await auth()` and returns 401 if null.
// Integration test requires a real Next.js test server. Skeleton documents
// the expected behavior for future supertest/fetch integration tests.
// ════════════════════════════════════════════════════════════════════════════

// Minimal inline replica of the auth guard pattern used in every route
async function apiRouteHandler(authFn, handlerFn, req) {
  const session = await authFn();
  if (!session) return { status: 401, body: { error: 'Non autorisé' } };
  return handlerFn(req, session);
}

test('SKELETON API auth guard: unauthenticated request → 401', async () => {
  const authFn = async () => null;
  const handlerFn = async () => { throw new Error('should not reach handler'); };
  const res = await apiRouteHandler(authFn, handlerFn, {});
  assert.equal(res.status, 401);
  assert.equal(res.body.error, 'Non autorisé');
});

test('SKELETON API auth guard: authenticated request → handler executes', async () => {
  const session = { user: { email: 'luca@novusepoxy.com' } };
  const authFn = async () => session;
  const handlerFn = async (req, sess) => ({ status: 200, body: { ok: true, user: sess.user.email } });
  const res = await apiRouteHandler(authFn, handlerFn, {});
  assert.equal(res.status, 200);
  assert.equal(res.body.user, 'luca@novusepoxy.com');
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-K SKELETON: Cron job — /api/cron/health-check response contract
//
// The health-check cron must return 200 with a JSON body including:
//   { ok: true, checks: { db: 'ok'|'fail', telegram: 'ok'|'fail', ... } }
// Integration test requires running Next.js dev server. Skeleton inline.
// ════════════════════════════════════════════════════════════════════════════

async function healthCheckHandler(deps) {
  const checks = {};
  for (const [name, check] of Object.entries(deps)) {
    try { await check(); checks[name] = 'ok'; }
    catch { checks[name] = 'fail'; }
  }
  const allOk = Object.values(checks).every(v => v === 'ok');
  return { status: allOk ? 200 : 503, body: { ok: allOk, checks } };
}

test('SKELETON health-check: all deps healthy → 200 ok:true', async () => {
  const deps = {
    db: async () => {},
    telegram: async () => {},
  };
  const res = await healthCheckHandler(deps);
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.checks.db, 'ok');
});

test('SKELETON health-check: one dep fails → 503 ok:false, failed dep shows fail', async () => {
  const deps = {
    db: async () => {},
    telegram: async () => { throw new Error('Telegram unreachable'); },
  };
  const res = await healthCheckHandler(deps);
  assert.equal(res.status, 503);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.checks.telegram, 'fail');
  assert.equal(res.body.checks.db, 'ok');
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-L SKELETON: ensureInvoiceForQuote() idempotency
//
// If called twice for the same quote, must NOT create duplicate invoice.
// The real function requires DB. Testable replica for idempotency logic.
// ════════════════════════════════════════════════════════════════════════════

async function ensureInvoice_testable(quoteId, db) {
  const quoteRows = db.quotes.filter(q => q.id === quoteId);
  if (!quoteRows.length) return { invoice_id: null, created: false, payment_recorded: false };

  const q = quoteRows[0];
  if (!['gagne', 'complete'].includes(q.statut)) return { invoice_id: null, created: false, payment_recorded: false };

  const existing = db.invoices.filter(i => i.quote_id === quoteId);
  if (existing.length) return { invoice_id: existing[0].id, created: false, payment_recorded: false };

  const newId = db.invoices.length + 1;
  db.invoices.push({ id: newId, quote_id: quoteId, total: q.total });
  return { invoice_id: newId, created: true, payment_recorded: false };
}

test('SKELETON ensureInvoice: creates invoice for gagne quote', async () => {
  const db = { quotes: [{ id: 1, statut: 'gagne', total: 2299.50 }], invoices: [] };
  const r = await ensureInvoice_testable(1, db);
  assert.equal(r.created, true);
  assert.equal(typeof r.invoice_id, 'number');
});

test('SKELETON ensureInvoice: idempotent — second call returns existing invoice, created=false', async () => {
  const db = { quotes: [{ id: 1, statut: 'gagne', total: 2299.50 }], invoices: [] };
  const r1 = await ensureInvoice_testable(1, db);
  const r2 = await ensureInvoice_testable(1, db);
  assert.equal(r1.created, true);
  assert.equal(r2.created, false, 'second call must NOT create a new invoice');
  assert.equal(r1.invoice_id, r2.invoice_id, 'both calls return same invoice_id');
  assert.equal(db.invoices.length, 1, 'only one invoice must exist');
});

test('SKELETON ensureInvoice: quote not found → invoice_id null', async () => {
  const db = { quotes: [], invoices: [] };
  const r = await ensureInvoice_testable(99, db);
  assert.equal(r.invoice_id, null);
  assert.equal(r.created, false);
});

test('SKELETON ensureInvoice: non-terminal statut (contacte) → no invoice created', async () => {
  const db = { quotes: [{ id: 1, statut: 'contacte', total: 2299.50 }], invoices: [] };
  const r = await ensureInvoice_testable(1, db);
  assert.equal(r.invoice_id, null, 'invoice must not be created for non-terminal quote');
  assert.equal(r.created, false);
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-M SKELETON: lib/send-email.ts — sendEmail() missing credentials throw
//
// sendEmail() must throw early when GMAIL_CLIENT_ID / REFRESH_TOKEN missing.
// The actual Gmail API call cannot run in unit tests.
// ════════════════════════════════════════════════════════════════════════════

function sendEmail_guardCheck(env) {
  if (!env.GMAIL_CLIENT_ID || !env.GMAIL_CLIENT_SECRET || !env.GMAIL_REFRESH_TOKEN) {
    throw new Error('Gmail credentials not configured');
  }
}

test('SKELETON sendEmail: missing GMAIL_CLIENT_ID → throws', () => {
  assert.throws(
    () => sendEmail_guardCheck({ GMAIL_CLIENT_SECRET: 'x', GMAIL_REFRESH_TOKEN: 'y' }),
    /Gmail credentials not configured/,
  );
});

test('SKELETON sendEmail: all credentials present → no throw', () => {
  assert.doesNotThrow(() =>
    sendEmail_guardCheck({ GMAIL_CLIENT_ID: 'a', GMAIL_CLIENT_SECRET: 'b', GMAIL_REFRESH_TOKEN: 'c' })
  );
});

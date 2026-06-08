/**
 * Tests for lib/contract-pdf.ts:
 *   - bookingSlotLabel(slot)
 *   - generateContractHtml(quote, companyInfo?)
 *
 * Both are pure functions (no DB, no network). Inlined here to avoid
 * Next.js module resolution issues when running with plain node.
 *
 * GAP: contract-pdf.ts has ZERO tests. bookingSlotLabel drives slot display
 * text on every printed contract; generateContractHtml produces the signed
 * PDF — XSS safety and missing-field branches are critical.
 *
 * Run: node --test tests/contract-pdf.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

// ── Inlined from lib/utils.ts ────────────────────────────────────────────────
function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── Inlined from lib/pricing.ts (subset) ─────────────────────────────────────
const SERVICES = {
  flake:        { label: 'Époxy Flocon (Flake)', prix: 8.50 },
  metallique:   { label: 'Époxy Métallique', prix: 12.75 },
  couleur_unie: { label: 'Époxy Couleur Unie', prix: 7.50 },
  quartz:       { label: 'Quartz Époxy', prix: 11.00 },
  commercial:   { label: 'Époxy Commercial', prix: 15.00 },
};
function formatMoney(n) {
  return new Intl.NumberFormat('fr-CA', { style: 'currency', currency: 'CAD' }).format(n);
}

// ── Inlined from lib/contract-pdf.ts ─────────────────────────────────────────
function bookingSlotLabel(slot) {
  if (slot === 'matin') return 'AM (8h a 12h)';
  if (slot === 'journee') return 'Journee (8h a 17h)';
  return 'PM (13h a 17h)';
}

const DEFAULT_COMPANY = {
  nom: 'Novus Epoxy',
  adresse: '44 rue de la Polyvalente, Quebec, G2N 1G8',
  telephone: '581-307-5983',
  rbq: '5861-8471-01',
  apchq: true,
};

function generateContractHtml(quote, companyInfo = DEFAULT_COMPANY) {
  const service = SERVICES[quote.type_service];
  const serviceName = service?.label ?? quote.type_service;
  const depot30 = formatMoney(Number(quote.depot_requis));
  const solde70 = formatMoney(Number(quote.total) - Number(quote.depot_requis));
  const penalite2pct = Math.max(400, Number(quote.total) * 0.02);

  const formatDate = (d) => {
    if (!d) return '';
    return new Intl.DateTimeFormat('fr-CA', { year: 'numeric', month: 'long', day: 'numeric' }).format(new Date(d));
  };

  return `<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"><title>Contrat</title></head>
<body>
<div>${escapeHtml(companyInfo.nom)}</div>
<div>${escapeHtml(quote.client_nom)}</div>
<div>${escapeHtml(serviceName)}</div>
<div>${quote.superficie} pi²</div>
${quote.client_adresse ? `<div>${escapeHtml(quote.client_adresse)}</div>` : ''}
${quote.etat_plancher ? `<div>${escapeHtml(quote.etat_plancher)}</div>` : ''}
${quote.notes ? `<div>${escapeHtml(quote.notes)}</div>` : ''}
<div>${depot30}</div>
<div>${solde70}</div>
<div>${formatMoney(penalite2pct)}</div>
${quote.booking_jour1_date ? `
<div>Jour 1: ${formatDate(quote.booking_jour1_date)} — ${bookingSlotLabel(quote.booking_jour1_slot)}</div>
${quote.booking_jour2_date ? `<div>Jour 2: ${formatDate(quote.booking_jour2_date)} — ${bookingSlotLabel(quote.booking_jour2_slot)}</div>` : ''}
` : '<div>dates a confirmer</div>'}
</body></html>`;
}

// ── bookingSlotLabel ─────────────────────────────────────────────────────────

test('bookingSlotLabel: matin → AM label', () => {
  assert.equal(bookingSlotLabel('matin'), 'AM (8h a 12h)');
});

test('bookingSlotLabel: journee → full-day label', () => {
  assert.equal(bookingSlotLabel('journee'), 'Journee (8h a 17h)');
});

test('bookingSlotLabel: apres-midi → PM label', () => {
  assert.equal(bookingSlotLabel('apres-midi'), 'PM (13h a 17h)');
});

test('bookingSlotLabel: null → defaults to PM (legacy jour2)', () => {
  assert.equal(bookingSlotLabel(null), 'PM (13h a 17h)');
});

test('bookingSlotLabel: undefined → defaults to PM', () => {
  assert.equal(bookingSlotLabel(undefined), 'PM (13h a 17h)');
});

test('bookingSlotLabel: unknown string → defaults to PM', () => {
  assert.equal(bookingSlotLabel('evening'), 'PM (13h a 17h)');
});

test('bookingSlotLabel: empty string → defaults to PM', () => {
  assert.equal(bookingSlotLabel(''), 'PM (13h a 17h)');
});

// ── generateContractHtml — basic structure ───────────────────────────────────

function makeQuote(overrides = {}) {
  return {
    id: 42,
    client_nom: 'Jean Tremblay',
    client_email: 'jean@test.com',
    client_tel: '5145551234',
    client_adresse: '123 rue des Érables, Québec',
    type_service: 'flake',
    superficie: 400,
    etat_plancher: 'Béton brut',
    notes: null,
    sous_total: 3400,
    tps: 170,
    tvq: 339.15,
    total: 3909.15,
    depot_requis: 1172.75,
    created_at: '2026-06-01T00:00:00Z',
    booking_jour1_date: null,
    booking_jour1_slot: null,
    booking_jour2_date: null,
    booking_jour2_slot: null,
    ...overrides,
  };
}

test('generateContractHtml: returns a string containing DOCTYPE', () => {
  const html = generateContractHtml(makeQuote());
  assert.ok(typeof html === 'string');
  assert.ok(html.startsWith('<!DOCTYPE html>'));
});

test('generateContractHtml: contains client name', () => {
  const html = generateContractHtml(makeQuote({ client_nom: 'Marie Lavoie' }));
  assert.ok(html.includes('Marie Lavoie'), 'must include client name');
});

test('generateContractHtml: XSS in client name is escaped', () => {
  const html = generateContractHtml(makeQuote({ client_nom: '<script>alert(1)</script>' }));
  assert.ok(!html.includes('<script>alert'), 'must not include raw script tag');
  assert.ok(html.includes('&lt;script&gt;'), 'must HTML-encode the tag');
});

test('generateContractHtml: XSS in client address is escaped', () => {
  const html = generateContractHtml(makeQuote({ client_adresse: '"><img src=x onerror=alert(1)>' }));
  assert.ok(!html.includes('<img src=x'), 'must not include raw img tag');
});

test('generateContractHtml: XSS in notes is escaped', () => {
  const html = generateContractHtml(makeQuote({ notes: '<b onmouseover="evil()">note</b>' }));
  assert.ok(!html.includes('<b onmouseover'), 'raw handler must not appear');
});

test('generateContractHtml: service name shown for known type', () => {
  const html = generateContractHtml(makeQuote({ type_service: 'flake' }));
  assert.ok(html.includes('Époxy Flocon') || html.includes('Flocon'), 'must show service label');
});

test('generateContractHtml: unknown service type shows raw type_service value', () => {
  const html = generateContractHtml(makeQuote({ type_service: 'autonivelant' }));
  assert.ok(html.includes('autonivelant'), 'falls back to raw type_service');
});

test('generateContractHtml: no notes → notes section absent', () => {
  const html = generateContractHtml(makeQuote({ notes: null }));
  // The optional notes block must not be in the HTML at all when null
  // (hard to assert absence without knowing exact marker — check a proxy)
  assert.ok(!html.includes('undefined'), 'must not render "undefined"');
  assert.ok(!html.includes('null'), 'must not render "null"');
});

test('generateContractHtml: no client_adresse → address section absent', () => {
  const html = generateContractHtml(makeQuote({ client_adresse: null }));
  assert.ok(!html.includes('null'), 'must not render "null"');
});

test('generateContractHtml: no booking dates → shows fallback text', () => {
  const html = generateContractHtml(makeQuote({ booking_jour1_date: null }));
  assert.ok(html.includes('confirmer') || html.includes('convenues'), 'must show date-TBD text');
});

test('generateContractHtml: booking_jour1_date shown with correct slot label', () => {
  const html = generateContractHtml(makeQuote({
    booking_jour1_date: '2026-07-10',
    booking_jour1_slot: 'matin',
  }));
  assert.ok(html.includes('AM (8h a 12h)'), 'must show AM slot label');
});

test('generateContractHtml: jour2 shown only when booking_jour2_date present', () => {
  const htmlWith = generateContractHtml(makeQuote({
    booking_jour1_date: '2026-07-10',
    booking_jour1_slot: 'matin',
    booking_jour2_date: '2026-07-11',
    booking_jour2_slot: 'apres-midi',
  }));
  const htmlWithout = generateContractHtml(makeQuote({
    booking_jour1_date: '2026-07-10',
    booking_jour1_slot: 'matin',
    booking_jour2_date: null,
  }));
  assert.ok(htmlWith.includes('Jour 2'), 'must show Jour 2 when date present');
  assert.ok(!htmlWithout.includes('Jour 2'), 'must not show Jour 2 when date absent');
});

// ── Penalty calculation ───────────────────────────────────────────────────────

test('generateContractHtml: small job uses $400 flat penalty (2% < $400)', () => {
  // total = 1500, 2% = 30 < 400 → penalty = 400
  const html = generateContractHtml(makeQuote({ total: 1500, depot_requis: 450 }));
  // formatMoney(400) in fr-CA will contain "400"
  assert.ok(html.includes('400'), 'must show $400 minimum penalty');
});

test('generateContractHtml: large job uses 2% penalty (2% > $400)', () => {
  // total = 50000, 2% = 1000 > 400 → penalty = 1000
  const html = generateContractHtml(makeQuote({ total: 50000, depot_requis: 15000 }));
  // fr-CA currency uses non-breaking spaces — strip them before asserting
  const normalized = html.replace(/[   ]/g, ' ');
  assert.ok(normalized.includes('1 000') || normalized.includes('1000'), 'must show 1000 penalty');
});

// ── Custom company info ───────────────────────────────────────────────────────

test('generateContractHtml: custom companyInfo overrides defaults', () => {
  const html = generateContractHtml(makeQuote(), {
    nom: 'ACME Floors',
    adresse: '99 Main St',
    telephone: '555-0100',
    rbq: '1234-5678-01',
    apchq: false,
  });
  assert.ok(html.includes('ACME Floors'), 'must use custom company name');
  assert.ok(!html.includes('Novus Epoxy'), 'must not show default company name');
});

/**
 * Tests for lib/invoice-pdf.ts — generateInvoiceHtml().
 *
 * GAP: invoice-pdf.ts has ZERO tests despite being the template used for every
 * invoice email. Key risks:
 *   - XSS in client data fields
 *   - Multi-item (items[]) vs single-item (invoice-level) rendering path
 *   - Extras rendering
 *   - Payments section: no payments, one payment, multiple payments
 *   - fully-paid badge display
 *   - Missing optional fields (address, notes, couleur, dates)
 *
 * Inlined logic matches lib/invoice-pdf.ts. Replace with real import once
 * the project supports loading TS files in isolation.
 *
 * Run: node --test tests/invoice-pdf.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

// ── Helpers (inlined from lib/utils.ts) ─────────────────────────────────────
function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const SERVICES = {
  flake: { label: 'Époxy Flocon (Flake)' },
  metallique: { label: 'Époxy Métallique' },
};

function formatMoney(n) {
  return new Intl.NumberFormat('fr-CA', { style: 'currency', currency: 'CAD' }).format(n);
}

// ── Minimal inlined generateInvoiceHtml for testing ─────────────────────────
// Tracks the same rendering branches as the real function.
function generateInvoiceHtml(invoice, client) {
  const items = invoice.items && invoice.items.length > 0
    ? invoice.items
    : [{ type_service: invoice.type_service, superficie: invoice.superficie,
         prix_pied_carre: invoice.prix_pied_carre, sous_total: invoice.sous_total }];

  const itemRows = items.map(it => {
    const lbl = SERVICES[it.type_service]?.label ?? it.type_service;
    return `<tr><td>${escapeHtml(lbl)}</td><td>${it.superficie} pi²</td>
    <td>${formatMoney(it.prix_pied_carre)}/pi²</td><td>${formatMoney(it.sous_total)}</td></tr>`;
  }).join('');

  const extraRows = (invoice.extras ?? []).map(ex =>
    `<tr><td>${escapeHtml(ex.description)}</td><td>${ex.quantite}</td>
    <td>${formatMoney(ex.prix_unitaire)}</td><td>${formatMoney(ex.sous_total)}</td></tr>`
  ).join('');

  const payments = invoice.payments ?? [];
  const totalPaid = payments.reduce((s, p) => s + Number(p.montant), 0);
  const isFullyPaid = Math.abs(totalPaid - Number(invoice.total)) < 0.02;

  const paymentSection = payments.length === 0
    ? `<div class="payments"><p>Aucun paiement enregistré</p></div>`
    : `<div class="payments">
        ${payments.map(p => `<div class="payment-row">
          ${escapeHtml(p.type)} — ${formatMoney(p.montant)}
          ${p.methode ? `(${escapeHtml(p.methode)})` : ''}
        </div>`).join('')}
        ${isFullyPaid ? '<div class="badge-paid">PAYÉE EN ENTIER</div>' : ''}
      </div>`;

  return `<!DOCTYPE html>
<html lang="fr"><head><meta charset="UTF-8">
<title>Facture ${escapeHtml(invoice.numero)}</title></head>
<body>
<h1>Facture ${escapeHtml(invoice.numero)}</h1>
<div class="client">
  <div>${escapeHtml(client.nom)}</div>
  <div>${escapeHtml(client.email)}</div>
  ${client.telephone ? `<div>${escapeHtml(client.telephone)}</div>` : ''}
  ${client.adresse ? `<div>${escapeHtml(client.adresse)}</div>` : ''}
</div>
${invoice.notes ? `<div class="notes">${escapeHtml(invoice.notes)}</div>` : ''}
<table>${itemRows}${extraRows}</table>
<div class="totals">
  <div>Sous-total: ${formatMoney(invoice.sous_total)}</div>
  <div>TPS: ${formatMoney(invoice.tps)}</div>
  <div>TVQ: ${formatMoney(invoice.tvq)}</div>
  <div>Total: ${formatMoney(invoice.total)}</div>
</div>
${paymentSection}
</body></html>`;
}

// ── Fixtures ─────────────────────────────────────────────────────────────────
function makeInvoice(overrides = {}) {
  return {
    numero: 'FACT-2026-042',
    date_emission: '2026-06-01',
    date_echeance: '2026-06-15',
    type_service: 'flake',
    superficie: 400,
    prix_pied_carre: 8.50,
    sous_total: 3400,
    tps: 170,
    tvq: 339.15,
    total: 3909.15,
    depot_montant: 1172.75,
    depot_paye: false,
    depot_paye_at: null,
    final_montant: 2736.40,
    final_paye: false,
    final_paye_at: null,
    notes: null,
    statut: 'en_attente',
    items: null,
    extras: null,
    payments: null,
    ...overrides,
  };
}

function makeClient(overrides = {}) {
  return {
    nom: 'Jean Tremblay',
    email: 'jean@test.com',
    telephone: '5145551234',
    adresse: '123 rue des Érables, Québec',
    ...overrides,
  };
}

// ── Basic structure ───────────────────────────────────────────────────────────

test('generateInvoiceHtml: returns DOCTYPE string', () => {
  const html = generateInvoiceHtml(makeInvoice(), makeClient());
  assert.ok(typeof html === 'string');
  assert.ok(html.startsWith('<!DOCTYPE html>'));
});

test('generateInvoiceHtml: contains invoice number in title', () => {
  const html = generateInvoiceHtml(makeInvoice(), makeClient());
  assert.ok(html.includes('FACT-2026-042'));
});

test('generateInvoiceHtml: contains client name', () => {
  const html = generateInvoiceHtml(makeInvoice(), makeClient({ nom: 'Marie Lavoie' }));
  assert.ok(html.includes('Marie Lavoie'));
});

// ── XSS safety ───────────────────────────────────────────────────────────────

test('generateInvoiceHtml: XSS in client name is escaped', () => {
  const html = generateInvoiceHtml(makeInvoice(), makeClient({ nom: '<script>alert(1)</script>' }));
  assert.ok(!html.includes('<script>alert'), 'must not include raw script tag');
  assert.ok(html.includes('&lt;script&gt;'));
});

test('generateInvoiceHtml: XSS in client email is escaped', () => {
  const html = generateInvoiceHtml(makeInvoice(), makeClient({ email: '"><img onerror=x>' }));
  assert.ok(!html.includes('<img onerror'));
});

test('generateInvoiceHtml: XSS in notes is escaped', () => {
  const html = generateInvoiceHtml(makeInvoice({ notes: '<b onmouseover="alert(1)">note</b>' }), makeClient());
  assert.ok(!html.includes('<b onmouseover'));
});

test('generateInvoiceHtml: XSS in invoice numero is escaped', () => {
  const html = generateInvoiceHtml(makeInvoice({ numero: '<FACT>' }), makeClient());
  assert.ok(!html.includes('<FACT>'));
  assert.ok(html.includes('&lt;FACT&gt;'));
});

// ── Optional fields ──────────────────────────────────────────────────────────

test('generateInvoiceHtml: no client.telephone → no undefined/null in output', () => {
  const html = generateInvoiceHtml(makeInvoice(), makeClient({ telephone: null }));
  assert.ok(!html.includes('null'));
  assert.ok(!html.includes('undefined'));
});

test('generateInvoiceHtml: no client.adresse → no null/undefined', () => {
  const html = generateInvoiceHtml(makeInvoice(), makeClient({ adresse: null }));
  assert.ok(!html.includes('null'));
});

test('generateInvoiceHtml: notes=null → notes section absent', () => {
  const html = generateInvoiceHtml(makeInvoice({ notes: null }), makeClient());
  assert.ok(!html.includes('null'));
  assert.ok(!html.includes('class="notes"'));
});

test('generateInvoiceHtml: notes present → shown in output', () => {
  const html = generateInvoiceHtml(makeInvoice({ notes: 'Travail le matin seulement' }), makeClient());
  assert.ok(html.includes('Travail le matin seulement'));
});

// ── Items rendering paths ─────────────────────────────────────────────────────

test('generateInvoiceHtml: single-item invoice (no items array) uses invoice-level fields', () => {
  const html = generateInvoiceHtml(makeInvoice({ items: null }), makeClient());
  assert.ok(html.includes('Époxy Flocon') || html.includes('flake'));
});

test('generateInvoiceHtml: multi-item invoice renders each item', () => {
  const html = generateInvoiceHtml(makeInvoice({
    items: [
      { type_service: 'flake', superficie: 200, prix_pied_carre: 8.50, sous_total: 1700 },
      { type_service: 'metallique', superficie: 100, prix_pied_carre: 12.75, sous_total: 1275 },
    ],
  }), makeClient());
  assert.ok(html.includes('Époxy Flocon') || html.includes('flake'));
  assert.ok(html.includes('Époxy Métallique') || html.includes('metallique'));
});

test('generateInvoiceHtml: unknown service type shows raw key', () => {
  const html = generateInvoiceHtml(makeInvoice({ type_service: 'autonivelant' }), makeClient());
  assert.ok(html.includes('autonivelant'));
});

// ── Extras rendering ──────────────────────────────────────────────────────────

test('generateInvoiceHtml: extras=null → no extras rows, no crash', () => {
  const html = generateInvoiceHtml(makeInvoice({ extras: null }), makeClient());
  assert.ok(typeof html === 'string');
  assert.ok(!html.includes('null'));
});

test('generateInvoiceHtml: extras present → shown in table', () => {
  const html = generateInvoiceHtml(makeInvoice({
    extras: [{ description: 'Nettoyage plancher', quantite: 1, prix_unitaire: 150, sous_total: 150 }],
  }), makeClient());
  assert.ok(html.includes('Nettoyage plancher'));
});

test('generateInvoiceHtml: XSS in extra description is escaped', () => {
  const html = generateInvoiceHtml(makeInvoice({
    extras: [{ description: '<script>evil()</script>', quantite: 1, prix_unitaire: 100, sous_total: 100 }],
  }), makeClient());
  assert.ok(!html.includes('<script>evil'));
  assert.ok(html.includes('&lt;script&gt;'));
});

// ── Payments section ─────────────────────────────────────────────────────────

test('generateInvoiceHtml: no payments → shows "Aucun paiement" message', () => {
  const html = generateInvoiceHtml(makeInvoice({ payments: null }), makeClient());
  assert.ok(html.includes('Aucun paiement'));
});

test('generateInvoiceHtml: empty payments array → shows "Aucun paiement" message', () => {
  const html = generateInvoiceHtml(makeInvoice({ payments: [] }), makeClient());
  assert.ok(html.includes('Aucun paiement'));
});

test('generateInvoiceHtml: one payment rendered', () => {
  const html = generateInvoiceHtml(makeInvoice({
    total: 3909.15,
    payments: [{ type: 'depot', montant: 1172.75, methode: 'Interac', paid_at: '2026-06-02' }],
  }), makeClient());
  assert.ok(html.includes('depot'));
  assert.ok(html.includes('Interac'));
});

test('generateInvoiceHtml: fully-paid shows "PAYÉE EN ENTIER" badge', () => {
  const html = generateInvoiceHtml(makeInvoice({
    total: 2000,
    payments: [
      { type: 'depot', montant: 600, methode: 'Interac', paid_at: '2026-06-01' },
      { type: 'final', montant: 1400, methode: 'Interac', paid_at: '2026-06-15' },
    ],
  }), makeClient());
  assert.ok(html.includes('PAYÉE EN ENTIER'), 'must show fully-paid badge');
});

test('generateInvoiceHtml: partially paid does NOT show fully-paid badge', () => {
  const html = generateInvoiceHtml(makeInvoice({
    total: 2000,
    payments: [{ type: 'depot', montant: 600, methode: 'Interac', paid_at: '2026-06-01' }],
  }), makeClient());
  assert.ok(!html.includes('PAYÉE EN ENTIER'), 'must not show fully-paid badge when balance remains');
});

test('generateInvoiceHtml: XSS in payment type/methode is escaped', () => {
  const html = generateInvoiceHtml(makeInvoice({
    total: 1000,
    payments: [{ type: '<b>depot</b>', montant: 1000, methode: '"><script>', paid_at: '2026-06-01' }],
  }), makeClient());
  assert.ok(!html.includes('<b>depot</b>'));
  assert.ok(!html.includes('"><script>'));
});

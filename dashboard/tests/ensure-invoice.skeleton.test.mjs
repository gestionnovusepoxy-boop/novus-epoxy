/**
 * Skeleton: Integration tests for ensureInvoiceForQuote (lib/ensure-invoice.ts).
 *
 * GAP: ensureInvoiceForQuote is completely untested. It contains critical
 * idempotency logic: if called twice for the same quote, it must not create a
 * second invoice or a duplicate payment record.
 *
 * All paths require DB access. These skeletons document the required scenarios
 * and are ready to activate once a pg-mem / test-container setup is in place.
 *
 * TODO: Replace mock stubs with a real test DB using pg-mem or neon branch.
 *
 * Run: node --test tests/ensure-invoice.skeleton.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

// ── Mock DB state ─────────────────────────────────────────────────────────────
// Each test constructs a minimal in-memory DB to exercise the logic.

/**
 * Minimal implementation of ensureInvoiceForQuote for unit-testing purposes.
 * Matches the real logic but uses an injected query function instead of the
 * real Neon DB. Replace with the real import once pg-mem is wired.
 */
async function ensureInvoiceForQuote_testable(quoteId, db) {
  const quoteRows = db.quotes.filter(q => q.id === quoteId);
  if (!quoteRows.length) return { invoice_id: null, created: false, payment_recorded: false };
  const q = quoteRows[0];

  let clientId = q.client_id ?? null;
  if (!clientId) {
    const existing = q.client_email
      ? db.clients.filter(c => c.email?.toLowerCase() === q.client_email?.toLowerCase())
      : [];
    if (existing.length) {
      clientId = existing[0].id;
    } else {
      const newId = db.clients.length + 1;
      db.clients.push({ id: newId, nom: q.client_nom, email: q.client_email });
      clientId = newId;
    }
  }

  let invoiceRows = db.invoices.filter(i => i.quote_id === quoteId);
  let created = false;
  if (!invoiceRows.length) {
    const newId = db.invoices.length + 1;
    db.invoices.push({ id: newId, quote_id: quoteId, client_id: clientId, statut: 'depot_recu', numero: `FACT-${newId}` });
    invoiceRows = [{ id: newId }];
    created = true;
  }

  const invoiceId = invoiceRows[0].id;
  let paymentRecorded = false;

  if (q.deposit_paid_at) {
    const existingDepot = db.payments.filter(p => p.invoice_id === invoiceId && p.type === 'depot');
    if (!existingDepot.length) {
      db.payments.push({ id: db.payments.length + 1, invoice_id: invoiceId, type: 'depot', montant: Number(q.depot_requis ?? 0) });
      paymentRecorded = true;
    }
  }

  if (q.balance_paid_at) {
    const existingFinal = db.payments.filter(p => p.invoice_id === invoiceId && p.type === 'final');
    if (!existingFinal.length) {
      const finalMontant = Number(q.total ?? 0) - Number(q.depot_requis ?? 0);
      db.payments.push({ id: db.payments.length + 1, invoice_id: invoiceId, type: 'final', montant: finalMontant });
      paymentRecorded = true;
    }
  }

  return { invoice_id: invoiceId, created, payment_recorded: paymentRecorded };
}

function makeDB(overrides = {}) {
  return {
    quotes: [],
    invoices: [],
    payments: [],
    clients: [],
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test('ensureInvoice: unknown quoteId → null result', async () => {
  const db = makeDB();
  const result = await ensureInvoiceForQuote_testable(999, db);
  assert.deepEqual(result, { invoice_id: null, created: false, payment_recorded: false });
});

test('ensureInvoice: new quote without deposit → creates invoice, no payment', async () => {
  const db = makeDB({
    quotes: [{ id: 1, client_nom: 'Jean Tremblay', client_email: 'jean@test.com', client_tel: '5145551234',
               client_adresse: '123 rue', type_service: 'flake', superficie: 300, prix_pied_carre: 4.75,
               rabais_pct: 0, rabais_montant: 0, sous_total: 1425, tps: 71.25, tvq: 142.09,
               total: 1638.34, depot_requis: 491.50, deposit_paid_at: null, balance_paid_at: null,
               client_id: null }],
  });
  const result = await ensureInvoiceForQuote_testable(1, db);
  assert.equal(result.created, true);
  assert.equal(result.payment_recorded, false);
  assert.equal(typeof result.invoice_id, 'number');
});

test('ensureInvoice: idempotent — calling twice for same quote creates only one invoice', async () => {
  const db = makeDB({
    quotes: [{ id: 1, client_nom: 'Marie', client_email: 'marie@test.com', client_tel: '5145551234',
               client_adresse: '1 rue', total: 2000, depot_requis: 600,
               deposit_paid_at: null, balance_paid_at: null, client_id: null }],
  });
  const r1 = await ensureInvoiceForQuote_testable(1, db);
  const r2 = await ensureInvoiceForQuote_testable(1, db);
  assert.equal(r1.created, true);
  assert.equal(r2.created, false, 'second call must not create a new invoice');
  assert.equal(db.invoices.length, 1, 'exactly one invoice in DB');
  assert.equal(r1.invoice_id, r2.invoice_id, 'both calls return the same invoice_id');
});

test('ensureInvoice: deposit paid → records deposit payment', async () => {
  const db = makeDB({
    quotes: [{ id: 1, client_nom: 'Alex', client_email: 'alex@test.com', client_tel: '5145551234',
               client_adresse: '1 rue', total: 2000, depot_requis: 600,
               deposit_paid_at: '2026-06-01T10:00:00Z', balance_paid_at: null, client_id: null }],
  });
  const result = await ensureInvoiceForQuote_testable(1, db);
  assert.equal(result.payment_recorded, true);
  const depotPayments = db.payments.filter(p => p.type === 'depot');
  assert.equal(depotPayments.length, 1);
  assert.equal(depotPayments[0].montant, 600);
});

test('ensureInvoice: deposit + balance paid → records both payment records', async () => {
  const db = makeDB({
    quotes: [{ id: 1, client_nom: 'Pierre', client_email: 'p@test.com', client_tel: '5145551234',
               client_adresse: '1 rue', total: 2000, depot_requis: 600,
               deposit_paid_at: '2026-06-01T10:00:00Z', balance_paid_at: '2026-06-15T10:00:00Z',
               client_id: null }],
  });
  await ensureInvoiceForQuote_testable(1, db);
  assert.equal(db.payments.filter(p => p.type === 'depot').length, 1);
  assert.equal(db.payments.filter(p => p.type === 'final').length, 1);
  const finalPayment = db.payments.find(p => p.type === 'final');
  assert.equal(finalPayment.montant, 1400, 'final = total - depot');
});

test('ensureInvoice: idempotent deposit — called twice does not double-count payment', async () => {
  const db = makeDB({
    quotes: [{ id: 1, client_nom: 'Luc', client_email: 'luc@test.com', client_tel: '5145551234',
               client_adresse: '1 rue', total: 2000, depot_requis: 600,
               deposit_paid_at: '2026-06-01T10:00:00Z', balance_paid_at: null, client_id: null }],
  });
  await ensureInvoiceForQuote_testable(1, db);
  await ensureInvoiceForQuote_testable(1, db);
  assert.equal(db.payments.filter(p => p.type === 'depot').length, 1, 'must not duplicate payment');
});

test('ensureInvoice: existing client found by email → reused, no new client row', async () => {
  const db = makeDB({
    quotes: [{ id: 1, client_nom: 'Anne', client_email: 'anne@test.com', client_tel: '5145551234',
               client_adresse: '1 rue', total: 1800, depot_requis: 540,
               deposit_paid_at: null, balance_paid_at: null, client_id: null }],
    clients: [{ id: 7, nom: 'Anne Dupont', email: 'anne@test.com' }],
  });
  await ensureInvoiceForQuote_testable(1, db);
  assert.equal(db.clients.length, 1, 'no new client row should be created');
  assert.equal(db.invoices[0].client_id, 7, 'invoice linked to existing client 7');
});

test('ensureInvoice: no existing client → new client created', async () => {
  const db = makeDB({
    quotes: [{ id: 1, client_nom: 'Nouveau Client', client_email: 'nouveau@test.com', client_tel: '5145551234',
               client_adresse: '1 rue', total: 1800, depot_requis: 540,
               deposit_paid_at: null, balance_paid_at: null, client_id: null }],
  });
  await ensureInvoiceForQuote_testable(1, db);
  assert.equal(db.clients.length, 1, 'one new client created');
  assert.equal(db.clients[0].nom, 'Nouveau Client');
});

test('ensureInvoice: quote already has client_id → skips client lookup', async () => {
  const db = makeDB({
    quotes: [{ id: 1, client_nom: 'Bernard', client_email: 'b@test.com', client_tel: '5145551234',
               client_adresse: '1 rue', total: 2500, depot_requis: 750,
               deposit_paid_at: null, balance_paid_at: null, client_id: 5 }],
    clients: [{ id: 5, nom: 'Bernard Gagné', email: 'b@test.com' }],
  });
  await ensureInvoiceForQuote_testable(1, db);
  assert.equal(db.clients.length, 1, 'no extra client rows');
  assert.equal(db.invoices[0].client_id, 5, 'uses quote.client_id directly');
});

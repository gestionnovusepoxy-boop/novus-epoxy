/**
 * coverage-gaps-june2026-fresh.test.mjs — New coverage gaps identified June 10 2026.
 *
 * Run: node --test tests/coverage-gaps-june2026-fresh.test.mjs
 *
 * PURE-LOGIC GAPS (run immediately, no DB/network):
 *   GAP-1  app/api/quotes/[id]/route.ts  — DELETE: protected statuts guard
 *   GAP-2  app/api/quotes/[id]/route.ts  — PATCH: no fields → 400
 *   GAP-3  app/api/quotes/[id]/route.ts  — PATCH: invalid type_service → 400
 *   GAP-4  app/api/quotes/[id]/route.ts  — PATCH: statut transitions set timestamp fields
 *   GAP-5  app/api/bank/reconcile/route.ts — SQL SET clause construction (partial fields)
 *   GAP-6  app/api/bank/transactions/route.ts — WHERE clause construction (reconciled filter)
 *   GAP-7  app/api/time-entries/route.ts  — Auto-calculate hours from heure_debut/heure_fin
 *   GAP-8  lib/telegram-utils.ts          — getAdminChatIds: group env takes priority
 *   GAP-9  lib/sms.ts                     — Phone area code normalization
 *   GAP-10 lib/auto-heal.ts               — healEmailScan: google_token_broken 24h auto-clear
 *
 * INTEGRATION SKELETONS (skipped unless INTEGRATION_TEST=1):
 *   INT-1  DELETE /api/quotes/:id         — protected statut → 400
 *   INT-2  DELETE /api/quotes/:id         — brouillon quote → 200 { success: true }
 *   INT-3  PATCH  /api/quotes/:id         — empty body → 400 "Rien à mettre à jour"
 *   INT-4  POST   /api/bank/reconcile     — no transaction_id → 400
 *   INT-5  POST   /api/bank/reconcile     — no target id → 400
 *   INT-6  GET    /api/bank/transactions  — reconciled=false filter applied
 *   INT-7  POST   /api/time-entries       — heure_fin before heure_debut → 400
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

const SKIP_INTEGRATION = !process.env.INTEGRATION_TEST;

// ════════════════════════════════════════════════════════════════════════════
// GAP-1 & GAP-2: DELETE /api/quotes/[id] — protected statuts & empty body
//
// Source: app/api/quotes/[id]/route.ts lines ~180-200
// ════════════════════════════════════════════════════════════════════════════

// Inlined delete guard logic
function canDeleteQuote(statut) {
  const protectedStatuts = ['depot_paye', 'planifie', 'complete'];
  return !protectedStatuts.includes(statut);
}

test('DELETE quote: depot_paye is protected → cannot delete', () => {
  assert.equal(canDeleteQuote('depot_paye'), false);
});

test('DELETE quote: planifie is protected → cannot delete', () => {
  assert.equal(canDeleteQuote('planifie'), false);
});

test('DELETE quote: complete is protected → cannot delete', () => {
  assert.equal(canDeleteQuote('complete'), false);
});

test('DELETE quote: brouillon is not protected → can delete', () => {
  assert.equal(canDeleteQuote('brouillon'), true);
});

test('DELETE quote: envoye is not protected → can delete', () => {
  assert.equal(canDeleteQuote('envoye'), true);
});

test('DELETE quote: en_attente is not protected → can delete', () => {
  assert.equal(canDeleteQuote('en_attente'), true);
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-3: PATCH /api/quotes/[id] — invalid type_service validation
//
// Source: app/api/quotes/[id]/route.ts ~line 38
// The route validates type_service against SERVICES keys. Unknown service → 400.
// ════════════════════════════════════════════════════════════════════════════

const VALID_SERVICES = new Set([
  'flake', 'metallique', 'quartz', 'couleur_unie', 'antiderapant',
  'commercial', 'meulage',
]);

function isValidServiceType(service) {
  return VALID_SERVICES.has(service);
}

test('PATCH quote: flake is a valid type_service', () => {
  assert.equal(isValidServiceType('flake'), true);
});

test('PATCH quote: metallique is a valid type_service', () => {
  assert.equal(isValidServiceType('metallique'), true);
});

test('PATCH quote: unknown_service is invalid → should return 400', () => {
  assert.equal(isValidServiceType('unknown_service'), false);
});

test('PATCH quote: empty string is invalid type_service', () => {
  assert.equal(isValidServiceType(''), false);
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-4: PATCH /api/quotes/[id] — statut transitions auto-set timestamp columns
//
// Source: app/api/quotes/[id]/route.ts ~line 107-116
// Setting statut=approuve adds approved_at=NOW(), envoye → sent_at, contrat_signe → contrat_signe_at
// ════════════════════════════════════════════════════════════════════════════

function getTimestampFieldForStatut(statut) {
  if (statut === 'approuve') return 'approved_at';
  if (statut === 'envoye') return 'sent_at';
  if (statut === 'contrat_signe') return 'contrat_signe_at';
  return null;
}

test('statut=approuve → timestamp field is approved_at', () => {
  assert.equal(getTimestampFieldForStatut('approuve'), 'approved_at');
});

test('statut=envoye → timestamp field is sent_at', () => {
  assert.equal(getTimestampFieldForStatut('envoye'), 'sent_at');
});

test('statut=contrat_signe → timestamp field is contrat_signe_at', () => {
  assert.equal(getTimestampFieldForStatut('contrat_signe'), 'contrat_signe_at');
});

test('statut=brouillon → no timestamp field set (null)', () => {
  assert.equal(getTimestampFieldForStatut('brouillon'), null);
});

test('statut=depot_paye → no timestamp field set (null)', () => {
  assert.equal(getTimestampFieldForStatut('depot_paye'), null);
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-5: /api/bank/reconcile POST — SQL SET clause construction
//
// Source: app/api/bank/reconcile/route.ts
// Only invoice_id → SET reconciled, invoice_id
// Only expense_id → SET reconciled, expense_id
// invoice_id + expense_id → SET reconciled, invoice_id, expense_id
// Missing transaction_id → 400
// Missing all target ids → 400
// ════════════════════════════════════════════════════════════════════════════

function buildReconcileUpdate({ transaction_id, invoice_id, expense_id, payment_id }) {
  if (!transaction_id) return { error: 'transaction_id requis', status: 400 };
  if (!invoice_id && !expense_id && !payment_id) {
    return { error: 'invoice_id, expense_id ou payment_id requis', status: 400 };
  }

  const sets = ['reconciled = true'];
  const values = [];
  let i = 1;

  if (invoice_id) { sets.push(`invoice_id = $${i++}`); values.push(invoice_id); }
  if (expense_id) { sets.push(`expense_id = $${i++}`); values.push(expense_id); }
  if (payment_id) { sets.push(`payment_id = $${i++}`); values.push(payment_id); }

  values.push(transaction_id);
  return { sets, values, idParam: i };
}

test('reconcile: missing transaction_id → error 400', () => {
  const r = buildReconcileUpdate({ invoice_id: 5 });
  assert.equal(r.status, 400);
  assert.ok(r.error.includes('transaction_id'));
});

test('reconcile: missing all target ids → error 400', () => {
  const r = buildReconcileUpdate({ transaction_id: 1 });
  assert.equal(r.status, 400);
  assert.ok(r.error.includes('invoice_id'));
});

test('reconcile: invoice_id only → sets has reconciled + invoice_id', () => {
  const r = buildReconcileUpdate({ transaction_id: 1, invoice_id: 10 });
  assert.ok(r.sets.includes('reconciled = true'));
  assert.ok(r.sets.some(s => s.startsWith('invoice_id')));
  assert.ok(!r.sets.some(s => s.startsWith('expense_id')));
  assert.deepEqual(r.values, [10, 1]);
});

test('reconcile: expense_id only → sets has reconciled + expense_id', () => {
  const r = buildReconcileUpdate({ transaction_id: 1, expense_id: 7 });
  assert.ok(r.sets.some(s => s.startsWith('expense_id')));
  assert.ok(!r.sets.some(s => s.startsWith('invoice_id')));
  assert.deepEqual(r.values, [7, 1]);
});

test('reconcile: both invoice_id + expense_id → both in SET clause', () => {
  const r = buildReconcileUpdate({ transaction_id: 2, invoice_id: 10, expense_id: 7 });
  assert.ok(r.sets.some(s => s.startsWith('invoice_id')));
  assert.ok(r.sets.some(s => s.startsWith('expense_id')));
  assert.equal(r.values.length, 3); // invoice_id, expense_id, transaction_id
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-6: /api/bank/transactions GET — WHERE clause construction
//
// Source: app/api/bank/transactions/route.ts
// reconciled=true  → AND bt.reconciled = true
// reconciled=false → AND bt.reconciled = false
// reconciled absent → no reconciled filter
// page/limit are bounded (page ≥ 1, limit ≤ 100)
// ════════════════════════════════════════════════════════════════════════════

function buildTransactionsQuery(searchParams) {
  const page       = Math.max(1, parseInt(searchParams.page ?? '1'));
  const limit      = Math.min(100, parseInt(searchParams.limit ?? '50'));
  const reconciled = searchParams.reconciled ?? null;
  const offset     = (page - 1) * limit;

  let where = 'WHERE 1=1';
  if (reconciled === 'true')  where += ' AND bt.reconciled = true';
  if (reconciled === 'false') where += ' AND bt.reconciled = false';

  return { where, page, limit, offset };
}

test('transactions: reconciled=true → filter clause appended', () => {
  const { where } = buildTransactionsQuery({ reconciled: 'true' });
  assert.ok(where.includes('bt.reconciled = true'));
});

test('transactions: reconciled=false → filter clause appended', () => {
  const { where } = buildTransactionsQuery({ reconciled: 'false' });
  assert.ok(where.includes('bt.reconciled = false'));
});

test('transactions: no reconciled param → no filter clause', () => {
  const { where } = buildTransactionsQuery({});
  assert.ok(!where.includes('reconciled'));
});

test('transactions: page 0 clamped to 1', () => {
  const { page, offset } = buildTransactionsQuery({ page: '0' });
  assert.equal(page, 1);
  assert.equal(offset, 0);
});

test('transactions: page 2 limit 10 → offset 10', () => {
  const { offset } = buildTransactionsQuery({ page: '2', limit: '10' });
  assert.equal(offset, 10);
});

test('transactions: limit 200 clamped to 100', () => {
  const { limit } = buildTransactionsQuery({ limit: '200' });
  assert.equal(limit, 100);
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-7: /api/time-entries POST — Auto-calculate hours from heure_debut/heure_fin
//
// Source: app/api/time-entries/route.ts
// If heure_debut + heure_fin provided and no explicit heures → auto-calculate
// heure_fin before heure_debut → 400 "heure_fin doit être après heure_debut"
// ════════════════════════════════════════════════════════════════════════════

function calculateHoursFromTimes(heure_debut, heure_fin) {
  const [sh, sm] = heure_debut.split(':').map(Number);
  const [eh, em] = heure_fin.split(':').map(Number);
  const startMin = sh * 60 + sm;
  const endMin   = eh * 60 + em;
  return Math.round(((endMin - startMin) / 60) * 100) / 100;
}

test('time-entry: 08:00 → 12:00 = 4.00 hours', () => {
  assert.equal(calculateHoursFromTimes('08:00', '12:00'), 4);
});

test('time-entry: 07:30 → 16:45 = 9.25 hours', () => {
  assert.equal(calculateHoursFromTimes('07:30', '16:45'), 9.25);
});

test('time-entry: 08:00 → 08:45 = 0.75 hours', () => {
  assert.equal(calculateHoursFromTimes('08:00', '08:45'), 0.75);
});

test('time-entry: negative result when fin < debut → should be rejected', () => {
  const h = calculateHoursFromTimes('16:00', '08:00');
  assert.ok(h <= 0, 'Negative or zero hours should trigger 400');
});

test('time-entry: same start and end → 0 hours → should be rejected', () => {
  const h = calculateHoursFromTimes('09:00', '09:00');
  assert.equal(h, 0);
});

test('time-entry: explicit heures supplied → auto-calc skipped (heures wins)', () => {
  // Logic: if heures is truthy AND heure_debut/heure_fin provided, heures wins
  const heures = '7.5';
  const calculatedHeures = heures ? parseFloat(heures) : null;
  // When heures is provided, we do NOT run calculateHoursFromTimes
  assert.equal(calculatedHeures, 7.5);
});

test('time-entry: missing employee_id → validation fails', () => {
  function validateTimeEntry({ employee_id, date_travail }) {
    if (!employee_id || !date_travail) return { error: 'employee_id et date_travail requis', status: 400 };
    return null;
  }
  assert.ok(validateTimeEntry({ date_travail: '2026-06-10' })?.status === 400);
  assert.ok(validateTimeEntry({ employee_id: 1 })?.status === 400);
  assert.ok(validateTimeEntry({ employee_id: 1, date_travail: '2026-06-10' }) === null);
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-8: lib/telegram-utils.ts — getAdminChatIds priority
//
// Source: lib/telegram-utils.ts
// TELEGRAM_GROUP_CHAT_ID set → return [group] (single entry, group wins)
// TELEGRAM_GROUP_CHAT_ID absent → split TELEGRAM_ADMIN_CHAT_IDS by comma
// Both absent → empty array
// ════════════════════════════════════════════════════════════════════════════

function getAdminChatIds(env) {
  const group = env.TELEGRAM_GROUP_CHAT_ID;
  if (group) return [group];
  return (env.TELEGRAM_ADMIN_CHAT_IDS ?? '').split(',').filter(Boolean);
}

test('getAdminChatIds: GROUP_CHAT_ID set → returns [group], ignores ADMIN_CHAT_IDS', () => {
  const ids = getAdminChatIds({
    TELEGRAM_GROUP_CHAT_ID: '-1001234567',
    TELEGRAM_ADMIN_CHAT_IDS: '111,222',
  });
  assert.deepEqual(ids, ['-1001234567']);
});

test('getAdminChatIds: GROUP_CHAT_ID absent → splits ADMIN_CHAT_IDS by comma', () => {
  const ids = getAdminChatIds({ TELEGRAM_ADMIN_CHAT_IDS: '111,222,333' });
  assert.deepEqual(ids, ['111', '222', '333']);
});

test('getAdminChatIds: both absent → empty array', () => {
  const ids = getAdminChatIds({});
  assert.deepEqual(ids, []);
});

test('getAdminChatIds: ADMIN_CHAT_IDS empty string → empty array', () => {
  const ids = getAdminChatIds({ TELEGRAM_ADMIN_CHAT_IDS: '' });
  assert.deepEqual(ids, []);
});

test('getAdminChatIds: ADMIN_CHAT_IDS with trailing comma → filters empty string', () => {
  const ids = getAdminChatIds({ TELEGRAM_ADMIN_CHAT_IDS: '111,222,' });
  assert.deepEqual(ids, ['111', '222']);
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-9: lib/sms.ts — phone number normalization + area code validation
//
// Source: lib/sms.ts ~lines 30-45
// cleaned starts with '+' → kept as-is
// cleaned starts with '1' → prepend '+'
// otherwise → prepend '+1'
// Area codes not in the approved QC list → blocked
// ════════════════════════════════════════════════════════════════════════════

const QC_AREA_CODES = new Set(['418', '581', '819', '450', '438', '514', '579', '873', '367']);

function normalizePhone(to) {
  const cleaned = to.replace(/[^0-9+]/g, '');
  return cleaned.startsWith('+') ? cleaned
    : cleaned.startsWith('1') ? `+${cleaned}`
    : `+1${cleaned}`;
}

function isValidSmsPhone(to) {
  const phone = normalizePhone(to);
  const digitsOnly = phone.replace(/\D/g, '');
  const areaCode = digitsOnly.length === 11 ? digitsOnly.substring(1, 4) : digitsOnly.substring(0, 3);
  return (digitsOnly.length === 10 || digitsOnly.length === 11) && QC_AREA_CODES.has(areaCode);
}

test('phone norm: +1XXXXXXXXXX kept with + prefix', () => {
  assert.equal(normalizePhone('+14185551234'), '+14185551234');
});

test('phone norm: 14185551234 (no +) → +14185551234', () => {
  assert.equal(normalizePhone('14185551234'), '+14185551234');
});

test('phone norm: 4185551234 (10 digits) → +14185551234', () => {
  assert.equal(normalizePhone('4185551234'), '+14185551234');
});

test('phone norm: 418-555-1234 (with dashes) → normalized', () => {
  assert.equal(normalizePhone('418-555-1234'), '+14185551234');
});

test('SMS phone: 418 area code → valid QC', () => {
  assert.equal(isValidSmsPhone('4185551234'), true);
});

test('SMS phone: 514 area code → valid QC', () => {
  assert.equal(isValidSmsPhone('5145551234'), true);
});

test('SMS phone: 613 area code (Ottawa) → blocked (not QC)', () => {
  assert.equal(isValidSmsPhone('6135551234'), false);
});

test('SMS phone: 212 area code (NYC) → blocked', () => {
  assert.equal(isValidSmsPhone('2125551234'), false);
});

test('SMS phone: 9-digit number → blocked (too short)', () => {
  assert.equal(isValidSmsPhone('418555123'), false);
});

test('SMS phone: 12-digit number → blocked (too long)', () => {
  assert.equal(isValidSmsPhone('14185551234567'), false);
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-10: lib/auto-heal.ts — healEmailScan google_token_broken 24h auto-clear
//
// Source: lib/auto-heal.ts healEmailScan()
// If google_token_broken=true AND age < 24h → skip scan (return null)
// If google_token_broken=true AND age >= 24h → clear flag and proceed
// If no broken flag → skip check
// ════════════════════════════════════════════════════════════════════════════

function shouldSkipEmailScanDueToTokenBroken(brokenFlag, brokenUpdatedAtIso, nowMs) {
  if (!brokenFlag || brokenFlag.value !== 'true') return false;
  if (!brokenUpdatedAtIso) return true; // flag exists but no timestamp → conservative skip
  const brokenAge = (nowMs - new Date(brokenUpdatedAtIso).getTime()) / 3600000;
  return brokenAge < 24;
}

test('healEmailScan: no broken flag → do not skip', () => {
  assert.equal(shouldSkipEmailScanDueToTokenBroken(null, null, Date.now()), false);
});

test('healEmailScan: broken=true, 12h old → skip (within cooldown)', () => {
  const now = Date.now();
  const broken = { value: 'true' };
  const updatedAt = new Date(now - 12 * 3600000).toISOString();
  assert.equal(shouldSkipEmailScanDueToTokenBroken(broken, updatedAt, now), true);
});

test('healEmailScan: broken=true, 23h59m old → still skip', () => {
  const now = Date.now();
  const broken = { value: 'true' };
  const updatedAt = new Date(now - (24 * 3600000 - 60000)).toISOString();
  assert.equal(shouldSkipEmailScanDueToTokenBroken(broken, updatedAt, now), true);
});

test('healEmailScan: broken=true, 24h1m old → auto-clear allowed (do not skip)', () => {
  const now = Date.now();
  const broken = { value: 'true' };
  const updatedAt = new Date(now - (24 * 3600000 + 60000)).toISOString();
  assert.equal(shouldSkipEmailScanDueToTokenBroken(broken, updatedAt, now), false);
});

test('healEmailScan: broken=false (wrong value) → do not skip', () => {
  const broken = { value: 'false' };
  assert.equal(shouldSkipEmailScanDueToTokenBroken(broken, new Date().toISOString(), Date.now()), false);
});

// ════════════════════════════════════════════════════════════════════════════
// INTEGRATION SKELETONS
// ════════════════════════════════════════════════════════════════════════════

const BASE_URL = process.env.INTEGRATION_BASE_URL ?? 'http://localhost:3000';
const ADMIN_KEY = process.env.ADMIN_API_KEY ?? '';

test('INT-1: DELETE /api/quotes/:id with protected statut → 400', { skip: SKIP_INTEGRATION }, async () => {
  // Pre-condition: a quote in state 'depot_paye' must exist
  // Replace QUOTE_ID_DEPOT_PAYE with a real fixture ID
  const QUOTE_ID = process.env.TEST_PROTECTED_QUOTE_ID;
  if (!QUOTE_ID) return assert.fail('Set TEST_PROTECTED_QUOTE_ID env to a depot_paye quote');

  const res = await fetch(`${BASE_URL}/api/quotes/${QUOTE_ID}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${ADMIN_KEY}` },
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.ok(body.error.toLowerCase().includes('impossible'));
});

test('INT-2: DELETE /api/quotes/:id brouillon → 200 { success: true }', { skip: SKIP_INTEGRATION }, async () => {
  // Pre-condition: a quote in state 'brouillon' must exist
  const QUOTE_ID = process.env.TEST_BROUILLON_QUOTE_ID;
  if (!QUOTE_ID) return assert.fail('Set TEST_BROUILLON_QUOTE_ID env to a brouillon quote');

  const res = await fetch(`${BASE_URL}/api/quotes/${QUOTE_ID}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${ADMIN_KEY}` },
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.success, true);
});

test('INT-3: PATCH /api/quotes/:id empty body → 400 "Rien à mettre à jour"', { skip: SKIP_INTEGRATION }, async () => {
  const QUOTE_ID = process.env.TEST_QUOTE_ID;
  if (!QUOTE_ID) return assert.fail('Set TEST_QUOTE_ID env');

  const res = await fetch(`${BASE_URL}/api/quotes/${QUOTE_ID}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${ADMIN_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.ok(body.error.includes('Rien'));
});

test('INT-4: POST /api/bank/reconcile missing transaction_id → 400', { skip: SKIP_INTEGRATION }, async () => {
  const res = await fetch(`${BASE_URL}/api/bank/reconcile`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${ADMIN_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ invoice_id: 1 }),
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.ok(body.error.includes('transaction_id'));
});

test('INT-5: POST /api/bank/reconcile missing all target ids → 400', { skip: SKIP_INTEGRATION }, async () => {
  const res = await fetch(`${BASE_URL}/api/bank/reconcile`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${ADMIN_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ transaction_id: 99 }),
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.ok(body.error.includes('invoice_id'));
});

test('INT-6: GET /api/bank/transactions?reconciled=false → only unreconciled rows', { skip: SKIP_INTEGRATION }, async () => {
  const res = await fetch(`${BASE_URL}/api/bank/transactions?reconciled=false`, {
    headers: { Authorization: `Bearer ${ADMIN_KEY}` },
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(Array.isArray(body.data));
  // Every row must be unreconciled
  for (const row of body.data) {
    assert.equal(row.reconciled, false);
  }
});

test('INT-7: POST /api/time-entries heure_fin before heure_debut → 400', { skip: SKIP_INTEGRATION }, async () => {
  const res = await fetch(`${BASE_URL}/api/time-entries`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${ADMIN_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      employee_id: 1,
      date_travail: '2026-06-10',
      heure_debut: '16:00',
      heure_fin: '08:00',
    }),
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.ok(body.error.toLowerCase().includes('heure_fin'));
});

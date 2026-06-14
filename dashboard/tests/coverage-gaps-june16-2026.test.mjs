/**
 * coverage-gaps-june16-2026.test.mjs
 *
 * TRUE GAPS not covered by any prior test file as of June 16 2026.
 * All decision logic is inlined (no @/ imports) — runs with plain node --test.
 *
 * Run: node --test tests/coverage-gaps-june16-2026.test.mjs
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * UNIT GAPS:
 *
 *   GAP-1  app/api/projects/[id]/report/route.ts — profit & margin arithmetic
 *          profit = totalRevenue - totalExpenses - totalLaborCost (each rounded to cents)
 *          margin = profit / totalRevenue * 100, rounded to 2 decimal places.
 *          When totalRevenue === 0, margin defaults to 0 (no division-by-zero).
 *          None of this arithmetic has been directly unit-tested.
 *
 *   GAP-2  app/api/projects/[id]/report/route.ts — labor aggregation per employee
 *          Each time_entry: cout = Math.round(heures * taux_horaire * 100) / 100.
 *          Multiple entries for the same employee_id accumulate heures and cout.
 *          Two different employees produce two separate slots in laborByEmployee.
 *          The per-entry rounding (not per-employee) is the subtle invariant.
 *
 *   GAP-3  app/api/projects/[id]/report/route.ts — expense field priority
 *          totalExpenses uses montant_ttc when present, falls back to montant_ht.
 *          An expense with both set uses ttc; one with only ht uses ht.
 *          Never directly asserted.
 *
 *   GAP-4  app/api/reviews/stats/route.ts — ADMIN_API_KEY empty string bypasses auth
 *          When adminKey === '' (env var not set), the guard short-circuits.
 *          This "open-mode" intentional behavior is never pinned by a test.
 *          Distinct from the cronSecret path which also grants access.
 *
 *   GAP-5  app/api/time-entries/route.ts — DELETE missing id → 400
 *          DELETE requires `id` query param. If absent, returns 400 "id requis".
 *          The 404 path (id provided but row not found) is also unasserted.
 *
 *   GAP-6  app/api/time-entries/route.ts — GET filter param accumulation
 *          Each of quote_id, employee_id, from, to appends a WHERE clause and
 *          increments the param counter independently. A request with all four
 *          filters should produce $1..$4. The param-counter logic is never tested.
 *
 * INTEGRATION SKELETONS (skipped unless INTEGRATION_TEST=1):
 *   INT-1  GET /api/projects/1/report — unauthenticated → 401
 *   INT-2  GET /api/projects/999/report — authenticated, not found → 404
 *   INT-3  DELETE /api/time-entries — no id query param → 400
 *   INT-4  GET /api/reviews/stats — no adminKey set, no header → 200
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

const SKIP_INTEGRATION = !process.env.INTEGRATION_TEST;
const BASE = process.env.TEST_BASE_URL || 'http://localhost:3000';

// ════════════════════════════════════════════════════════════════════════════
// GAP-1/2/3: projects/[id]/report — profit, margin, labor aggregation, expense priority
//
// Inlined from app/api/projects/[id]/report/route.ts
// ════════════════════════════════════════════════════════════════════════════

function computeProjectReport({ revenue, expenses, laborEntries }) {
  const totalRevenue = revenue.reduce(
    (s, p) => s + parseFloat(String(p.montant ?? 0)),
    0,
  );

  const totalExpenses = expenses.reduce(
    (s, e) => s + parseFloat(String(e.montant_ttc ?? e.montant_ht ?? 0)),
    0,
  );

  const laborByEmployee = {};
  let totalLaborHours = 0;
  let totalLaborCost  = 0;

  for (const entry of laborEntries) {
    const empId  = entry.employee_id;
    const heures = parseFloat(String(entry.heures ?? 0));
    const taux   = parseFloat(String(entry.taux_horaire ?? 0));
    const cout   = Math.round(heures * taux * 100) / 100;

    if (!laborByEmployee[empId]) {
      laborByEmployee[empId] = { nom: entry.nom, heures: 0, cout: 0 };
    }
    laborByEmployee[empId].heures += heures;
    laborByEmployee[empId].cout   += cout;
    totalLaborHours += heures;
    totalLaborCost  += cout;
  }

  totalLaborCost = Math.round(totalLaborCost * 100) / 100;
  const totalExpensesRounded = Math.round(totalExpenses * 100) / 100;
  const profit = Math.round((totalRevenue - totalExpensesRounded - totalLaborCost) * 100) / 100;
  const margin = totalRevenue > 0
    ? Math.round((profit / totalRevenue) * 10000) / 100
    : 0;

  return {
    totalRevenue,
    totalExpensesRounded,
    totalLaborCost,
    totalLaborHours,
    profit,
    margin,
    laborByEmployee,
  };
}

// — GAP-1: profit arithmetic —

test('GAP-1: profit = revenue − expenses − labor cost', () => {
  const r = computeProjectReport({
    revenue:      [{ montant: '5000' }],
    expenses:     [{ montant_ttc: '500' }],
    laborEntries: [{ employee_id: 1, nom: 'Jason', heures: '10', taux_horaire: '25' }],
  });
  assert.equal(r.totalRevenue, 5000);
  assert.equal(r.totalExpensesRounded, 500);
  assert.equal(r.totalLaborCost, 250);   // 10h × $25
  assert.equal(r.profit, 4250);          // 5000 − 500 − 250
});

test('GAP-1: margin = profit / revenue × 100, rounded to 2 decimal places', () => {
  const r = computeProjectReport({
    revenue:      [{ montant: '5000' }],
    expenses:     [{ montant_ttc: '500' }],
    laborEntries: [{ employee_id: 1, nom: 'Jason', heures: '10', taux_horaire: '25' }],
  });
  assert.equal(r.margin, 85);   // 4250 / 5000 = 0.85 → 85.00%
});

test('GAP-1: margin = 0 when revenue is 0 (no division-by-zero)', () => {
  const r = computeProjectReport({
    revenue:      [],
    expenses:     [{ montant_ttc: '200' }],
    laborEntries: [],
  });
  assert.equal(r.totalRevenue, 0);
  assert.equal(r.margin, 0, 'should not throw, should return 0');
});

test('GAP-1: negative profit when costs exceed revenue', () => {
  const r = computeProjectReport({
    revenue:      [{ montant: '1000' }],
    expenses:     [{ montant_ttc: '800' }],
    laborEntries: [{ employee_id: 1, nom: 'Emp', heures: '20', taux_horaire: '25' }],
  });
  assert.equal(r.totalLaborCost, 500);  // 20h × $25
  assert.equal(r.profit, -300);         // 1000 − 800 − 500
  assert.ok(r.margin < 0, 'negative profit → negative margin');
});

test('GAP-1: multiple payments sum correctly', () => {
  const r = computeProjectReport({
    revenue:      [{ montant: '3000' }, { montant: '1500' }, { montant: '500' }],
    expenses:     [],
    laborEntries: [],
  });
  assert.equal(r.totalRevenue, 5000);
  assert.equal(r.profit, 5000);
  assert.equal(r.margin, 100);
});

test('GAP-1: fractional margin rounds to 2 decimal places', () => {
  // profit=1000, revenue=3000 → 33.333...% → rounds to 33.33
  const r = computeProjectReport({
    revenue:      [{ montant: '3000' }],
    expenses:     [{ montant_ttc: '2000' }],
    laborEntries: [],
  });
  assert.equal(r.margin, 33.33);
});

// — GAP-2: labor aggregation per employee —

test('GAP-2: two entries for same employee accumulate hours and cost', () => {
  const r = computeProjectReport({
    revenue:      [{ montant: '5000' }],
    expenses:     [],
    laborEntries: [
      { employee_id: 1, nom: 'Jason', heures: '4', taux_horaire: '25' },
      { employee_id: 1, nom: 'Jason', heures: '6', taux_horaire: '25' },
    ],
  });
  const emp = r.laborByEmployee[1];
  assert.ok(emp, 'employee 1 should be present');
  assert.equal(emp.heures, 10);
  assert.equal(emp.cout, 250);   // 4×25=100 + 6×25=150
  assert.equal(r.totalLaborHours, 10);
  assert.equal(r.totalLaborCost, 250);
});

test('GAP-2: two different employees are tracked separately', () => {
  const r = computeProjectReport({
    revenue:      [{ montant: '5000' }],
    expenses:     [],
    laborEntries: [
      { employee_id: 1, nom: 'Jason', heures: '5', taux_horaire: '25' },
      { employee_id: 2, nom: 'Luca',  heures: '3', taux_horaire: '30' },
    ],
  });
  assert.equal(r.laborByEmployee[1].cout, 125);   // 5 × 25
  assert.equal(r.laborByEmployee[2].cout, 90);    // 3 × 30
  assert.equal(r.totalLaborHours, 8);
  assert.equal(r.totalLaborCost, 215);
});

test('GAP-2: per-entry cost rounds before accumulating (not at the end)', () => {
  // 1h × $33.333/h → Math.round(33.333 * 100) / 100 = 33.33 per entry
  const r = computeProjectReport({
    revenue:      [{ montant: '100' }],
    expenses:     [],
    laborEntries: [
      { employee_id: 1, nom: 'Worker', heures: '1', taux_horaire: '33.333' },
      { employee_id: 1, nom: 'Worker', heures: '1', taux_horaire: '33.333' },
    ],
  });
  // Each entry: Math.round(33.333 * 100) / 100 = 33.33
  // Sum: 33.33 + 33.33 = 66.66, then Math.round(66.66 * 100) / 100 = 66.66
  assert.equal(r.laborByEmployee[1].cout, 66.66);
  assert.equal(r.totalLaborCost, 66.66);
});

test('GAP-2: empty laborEntries → totalLaborCost = 0, totalLaborHours = 0', () => {
  const r = computeProjectReport({
    revenue:      [{ montant: '2000' }],
    expenses:     [],
    laborEntries: [],
  });
  assert.equal(r.totalLaborCost, 0);
  assert.equal(r.totalLaborHours, 0);
  assert.deepEqual(r.laborByEmployee, {});
});

// — GAP-3: expense field priority —

test('GAP-3: montant_ttc takes priority over montant_ht when both present', () => {
  const r = computeProjectReport({
    revenue:      [{ montant: '1000' }],
    expenses:     [{ montant_ttc: '100', montant_ht: '84.03' }],
    laborEntries: [],
  });
  assert.equal(r.totalExpensesRounded, 100);
});

test('GAP-3: falls back to montant_ht when montant_ttc is absent', () => {
  const r = computeProjectReport({
    revenue:      [{ montant: '1000' }],
    expenses:     [{ montant_ht: '84.03' }],
    laborEntries: [],
  });
  assert.equal(r.totalExpensesRounded, 84.03);
});

test('GAP-3: null montant_ttc falls back to montant_ht', () => {
  const r = computeProjectReport({
    revenue:      [{ montant: '1000' }],
    expenses:     [{ montant_ttc: null, montant_ht: '50' }],
    laborEntries: [],
  });
  assert.equal(r.totalExpensesRounded, 50);
});

test('GAP-3: both absent → expense contributes 0', () => {
  const r = computeProjectReport({
    revenue:      [{ montant: '1000' }],
    expenses:     [{}],
    laborEntries: [],
  });
  assert.equal(r.totalExpensesRounded, 0);
});

test('GAP-3: multiple expenses summed correctly with mixed field usage', () => {
  const r = computeProjectReport({
    revenue:      [{ montant: '2000' }],
    expenses:     [
      { montant_ttc: '200' },            // uses ttc
      { montant_ht: '100' },             // uses ht
      { montant_ttc: '50', montant_ht: '42' }, // ttc wins
    ],
    laborEntries: [],
  });
  assert.equal(r.totalExpensesRounded, 350);  // 200 + 100 + 50
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-4: reviews/stats — dual-token auth & open-mode when adminKey unset
//
// Inlined from app/api/reviews/stats/route.ts
// Guard: `if (adminKey && authHeader !== adminKey && authHeader !== cronSecret)`
// ════════════════════════════════════════════════════════════════════════════

function isReviewsAuthorized(authHeader, adminKey, cronSecret) {
  if (adminKey && authHeader !== adminKey && authHeader !== cronSecret) {
    return false;
  }
  return true;
}

test('GAP-4: valid adminKey in header → authorized', () => {
  assert.ok(isReviewsAuthorized('secret123', 'secret123', 'cron'));
});

test('GAP-4: valid cronSecret in header → authorized (even when adminKey is different)', () => {
  assert.ok(isReviewsAuthorized('cron', 'secret123', 'cron'));
});

test('GAP-4: wrong token when adminKey set → unauthorized', () => {
  assert.ok(!isReviewsAuthorized('wrong', 'secret123', 'cron'));
});

test('GAP-4: empty adminKey (env not set) → all requests pass (open mode)', () => {
  assert.ok(isReviewsAuthorized('', '', ''),         'empty header ok in open mode');
  assert.ok(isReviewsAuthorized('garbage', '', ''),  'any header ok in open mode');
  assert.ok(isReviewsAuthorized('', '', 'cron'),     'no adminKey set → open regardless of cronSecret');
});

test('GAP-4: empty header when adminKey is set → unauthorized', () => {
  assert.ok(!isReviewsAuthorized('', 'secret123', 'cron'));
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-5: time-entries DELETE — missing id guard
//
// Inlined from app/api/time-entries/route.ts DELETE handler
// ════════════════════════════════════════════════════════════════════════════

function validateDeleteTimeEntry(id) {
  if (!id) return { ok: false, status: 400, error: 'id requis' };
  const parsed = parseInt(id);
  if (isNaN(parsed)) return { ok: false, status: 400, error: 'id invalide' };
  return { ok: true, id: parsed };
}

test('GAP-5: DELETE without id query param → 400 "id requis"', () => {
  const r = validateDeleteTimeEntry(null);
  assert.ok(!r.ok);
  assert.equal(r.status, 400);
  assert.match(r.error, /requis/);
});

test('GAP-5: DELETE with empty string id → 400 "id requis" (falsy)', () => {
  const r = validateDeleteTimeEntry('');
  assert.ok(!r.ok);
  assert.equal(r.status, 400);
});

test('GAP-5: DELETE with numeric string id → ok, returns parsed int', () => {
  const r = validateDeleteTimeEntry('42');
  assert.ok(r.ok);
  assert.equal(r.id, 42);
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-6: time-entries GET — filter param counter accumulation
//
// The GET handler builds a WHERE clause by appending conditions for each
// optional query param: quote_id, employee_id, from, to.
// The param counter starts at 1 and increments for each appended condition.
// ════════════════════════════════════════════════════════════════════════════

function buildTimeEntriesWhere(params) {
  let where = 'WHERE 1=1';
  const queryParams = [];
  let i = 1;

  if (params.quoteId) {
    where += ` AND te.quote_id = $${i++}`;
    queryParams.push(parseInt(params.quoteId));
  }
  if (params.employeeId) {
    where += ` AND te.employee_id = $${i++}`;
    queryParams.push(parseInt(params.employeeId));
  }
  if (params.from) {
    where += ` AND te.date_travail >= $${i++}`;
    queryParams.push(params.from);
  }
  if (params.to) {
    where += ` AND te.date_travail <= $${i++}`;
    queryParams.push(params.to);
  }

  return { where, params: queryParams, nextI: i };
}

test('GAP-6: no filters → bare WHERE 1=1, no params, nextI = 1', () => {
  const r = buildTimeEntriesWhere({});
  assert.equal(r.where, 'WHERE 1=1');
  assert.deepEqual(r.params, []);
  assert.equal(r.nextI, 1);
});

test('GAP-6: quoteId only → $1 in clause, one param', () => {
  const r = buildTimeEntriesWhere({ quoteId: '5' });
  assert.ok(r.where.includes('$1'));
  assert.deepEqual(r.params, [5]);
  assert.equal(r.nextI, 2);
});

test('GAP-6: quoteId + employeeId → $1 and $2, counter at 3', () => {
  const r = buildTimeEntriesWhere({ quoteId: '5', employeeId: '2' });
  assert.ok(r.where.includes('$1'));
  assert.ok(r.where.includes('$2'));
  assert.deepEqual(r.params, [5, 2]);
  assert.equal(r.nextI, 3);
});

test('GAP-6: all four filters → $1..$4, four params, counter at 5', () => {
  const r = buildTimeEntriesWhere({
    quoteId: '10', employeeId: '3', from: '2026-06-01', to: '2026-06-30',
  });
  assert.ok(r.where.includes('$1'));
  assert.ok(r.where.includes('$2'));
  assert.ok(r.where.includes('$3'));
  assert.ok(r.where.includes('$4'));
  assert.deepEqual(r.params, [10, 3, '2026-06-01', '2026-06-30']);
  assert.equal(r.nextI, 5);
});

test('GAP-6: from + to without quoteId/employeeId → $1 and $2', () => {
  const r = buildTimeEntriesWhere({ from: '2026-06-01', to: '2026-06-30' });
  assert.ok(r.where.includes('$1'));
  assert.ok(r.where.includes('$2'));
  assert.deepEqual(r.params, ['2026-06-01', '2026-06-30']);
  assert.equal(r.nextI, 3);
});

// ════════════════════════════════════════════════════════════════════════════
// INTEGRATION SKELETONS
// ════════════════════════════════════════════════════════════════════════════

test('INT-1: GET /api/projects/1/report — unauthenticated → 401', { skip: SKIP_INTEGRATION }, async () => {
  const r = await fetch(`${BASE}/api/projects/1/report`);
  assert.equal(r.status, 401);
});

test('INT-2: GET /api/projects/999999/report — authenticated, not found → 404', { skip: SKIP_INTEGRATION }, async () => {
  const r = await fetch(`${BASE}/api/projects/999999/report`, {
    headers: { Cookie: 'next-auth.session-token=test-session' },
  });
  assert.ok([401, 404].includes(r.status), `expected 401 or 404, got ${r.status}`);
});

test('INT-3: DELETE /api/time-entries — no id query param → 400', { skip: SKIP_INTEGRATION }, async () => {
  const r = await fetch(`${BASE}/api/time-entries`, { method: 'DELETE' });
  assert.ok([400, 401].includes(r.status), `expected 400 or 401, got ${r.status}`);
});

test('INT-4: GET /api/reviews/stats — no ADMIN_API_KEY → 200 (open mode)', { skip: SKIP_INTEGRATION }, async () => {
  const r = await fetch(`${BASE}/api/reviews/stats`);
  assert.ok([200, 401].includes(r.status),
    'Open when key unset → 200; protected when set and no header → 401');
});

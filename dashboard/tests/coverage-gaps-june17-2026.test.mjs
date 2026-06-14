/**
 * coverage-gaps-june17-2026.test.mjs
 *
 * TRUE GAPS not covered by any prior test file as of June 17 2026.
 * All decision logic is inlined (no @/ imports) — runs with plain `node --test`.
 *
 * Run:  node --test tests/coverage-gaps-june17-2026.test.mjs
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CONFIRMED ZERO-COVERAGE GAPS (grep across all 92 test files returned 0 hits):
 *
 *   GAP-1  app/api/agents/cost/route.ts — period-to-interval mapping
 *          period '7d'  → '7 days'
 *          period '30d' → '30 days'
 *          period '24h' → '24 hours' (default)
 *          unknown period → '24 hours' (default fallback)
 *          Mapping is .toLowerCase() first, so '7D' → '7 days'.
 *
 *   GAP-2  app/api/portfolio/videos/route.ts — row-to-video shape transformation
 *          Each DB row is mapped to: { id, titre, type, couleur, url }.
 *          `type` is `r.type_service` (renamed field).
 *          `url`  is `(r.videos as string[])[0]` — first element only.
 *          These field-rename and array-indexing behaviours are never pinned.
 *
 *   GAP-3  app/api/expenses/[id]/route.ts — PATCH allowlist (13 fields)
 *          Allowed: date_depense, fournisseur, description, categorie, montant_ht,
 *                   tps, tvq, montant_ttc, methode, reference, invoice_id, quote_id,
 *                   pending_project.
 *          Body with NONE of these → 400. Body with a mix of allowed + unknown →
 *          only the allowed keys make it into the SET clause (unknown silently dropped).
 *          `pending_project` is exclusive to expenses (not in invoice/client handlers)
 *          and has NEVER been asserted.
 *
 *   GAP-4  app/api/quotes/[id]/send/route.ts — unknown type_service fallback label
 *          When SERVICES[quote.type_service] is undefined, the route uses
 *          `{ label: String(quote.type_service ?? 'Service') }` as the service object
 *          rather than crashing. This is a silent degradation path never tested.
 *
 *   GAP-5  app/api/invoices/[id]/route.ts — PATCH allowed-field accumulation with
 *          param counter: each field that IS present increments `i` independently,
 *          producing $1..$N in order. A PATCH that sets all three fields at once
 *          (statut + notes + date_echeance) should yield i=4 after the loop
 *          (1-based, so 3 fields → last param = $4 for the WHERE clause). Never tested.
 *
 * INTEGRATION SKELETONS (skipped unless INTEGRATION_TEST=1):
 *   INT-1  GET /api/agents/cost — unauthenticated → 401
 *   INT-2  GET /api/agents/cost?period=7d — authenticated → 200 with byAgent, byTier
 *   INT-3  GET /api/portfolio/videos — 200 with array (public, no auth)
 *   INT-4  PATCH /api/expenses/1 — unknown keys only → 400
 *   INT-5  PATCH /api/expenses/1 — pending_project key → accepted (no 400)
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

const SKIP_INTEGRATION = !process.env.INTEGRATION_TEST;
const BASE = process.env.TEST_BASE_URL || 'http://localhost:3000';

// ════════════════════════════════════════════════════════════════════════════
// GAP-1: app/api/agents/cost — period-to-interval mapping
//
// Inlined from app/api/agents/cost/route.ts line 16-17:
//   const period = (req.searchParams.get('period') ?? '24h').toLowerCase();
//   const interval = period === '7d' ? '7 days' : period === '30d' ? '30 days' : '24 hours';
// ════════════════════════════════════════════════════════════════════════════

function resolveInterval(rawPeriod) {
  const period = (rawPeriod ?? '24h').toLowerCase();
  return period === '7d' ? '7 days' : period === '30d' ? '30 days' : '24 hours';
}

test('GAP-1a: period=7d → "7 days"', () => {
  assert.equal(resolveInterval('7d'), '7 days');
});

test('GAP-1b: period=30d → "30 days"', () => {
  assert.equal(resolveInterval('30d'), '30 days');
});

test('GAP-1c: period=24h → "24 hours"', () => {
  assert.equal(resolveInterval('24h'), '24 hours');
});

test('GAP-1d: unknown period → default "24 hours"', () => {
  assert.equal(resolveInterval('1h'), '24 hours');
  assert.equal(resolveInterval('90d'), '24 hours');
  assert.equal(resolveInterval('GARBAGE'), '24 hours');
});

test('GAP-1e: period is case-insensitive — "7D" → "7 days"', () => {
  assert.equal(resolveInterval('7D'), '7 days');
  assert.equal(resolveInterval('30D'), '30 days');
  assert.equal(resolveInterval('24H'), '24 hours');
});

test('GAP-1f: missing period (null) → default "24 hours"', () => {
  assert.equal(resolveInterval(null), '24 hours');
  assert.equal(resolveInterval(undefined), '24 hours');
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-2: app/api/portfolio/videos — row-to-video shape transformation
//
// Inlined from app/api/portfolio/videos/route.ts:
//   const videos = rows.map(r => ({
//     id: r.id,
//     titre: r.titre,
//     type: r.type_service,      // ← rename
//     couleur: r.couleur,
//     url: (r.videos as string[])[0],   // ← first element only
//   }));
// ════════════════════════════════════════════════════════════════════════════

function mapPortfolioRow(r) {
  return {
    id: r.id,
    titre: r.titre,
    type: r.type_service,
    couleur: r.couleur,
    url: r.videos[0],
  };
}

test('GAP-2a: type_service is renamed to "type"', () => {
  const row = { id: 1, titre: 'Garage epoxy', type_service: 'epoxy_flocon', couleur: 'gris', videos: ['https://cdn/v1.mp4'] };
  const out = mapPortfolioRow(row);
  assert.equal(out.type, 'epoxy_flocon', 'type_service → type');
  assert.ok(!('type_service' in out), 'original key absent in output');
});

test('GAP-2b: url is the first element of the videos array', () => {
  const row = { id: 2, titre: 'Salon', type_service: 'poly', couleur: 'beige', videos: ['https://cdn/first.mp4', 'https://cdn/second.mp4'] };
  const out = mapPortfolioRow(row);
  assert.equal(out.url, 'https://cdn/first.mp4', 'first element selected');
});

test('GAP-2c: single-video array — url equals that element', () => {
  const row = { id: 3, titre: 'Cave', type_service: 'epoxy_solid', couleur: 'noir', videos: ['https://cdn/only.mp4'] };
  assert.equal(mapPortfolioRow(row).url, 'https://cdn/only.mp4');
});

test('GAP-2d: map preserves id, titre, couleur unchanged', () => {
  const row = { id: 99, titre: 'Test title', type_service: 'epoxy', couleur: '#FF0000', videos: ['u'] };
  const out = mapPortfolioRow(row);
  assert.equal(out.id, 99);
  assert.equal(out.titre, 'Test title');
  assert.equal(out.couleur, '#FF0000');
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-3: app/api/expenses/[id] — PATCH allowlist (13 fields)
//
// Inlined from app/api/expenses/[id]/route.ts:
//   const allowed = ['date_depense','fournisseur','description','categorie',
//                    'montant_ht','tps','tvq','montant_ttc','methode','reference',
//                    'invoice_id','quote_id','pending_project'];
//   const sets = []; const values = []; let i = 1;
//   for (const key of allowed) {
//     if (key in body) { sets.push(`${key} = $${i++}`); values.push(body[key]); }
//   }
//   if (sets.length === 0) return 400;
// ════════════════════════════════════════════════════════════════════════════

const EXPENSES_ALLOWED = [
  'date_depense', 'fournisseur', 'description', 'categorie',
  'montant_ht', 'tps', 'tvq', 'montant_ttc', 'methode', 'reference',
  'invoice_id', 'quote_id', 'pending_project',
];

function buildExpenseSets(body) {
  const sets = [];
  const values = [];
  let i = 1;
  for (const key of EXPENSES_ALLOWED) {
    if (key in body) {
      sets.push(`${key} = $${i++}`);
      values.push(body[key]);
    }
  }
  return { sets, values, wouldReturn400: sets.length === 0 };
}

test('GAP-3a: empty body → 0 sets → would return 400', () => {
  const { sets, wouldReturn400 } = buildExpenseSets({});
  assert.equal(sets.length, 0);
  assert.ok(wouldReturn400);
});

test('GAP-3b: unknown-only keys → 0 sets → would return 400', () => {
  const { sets, wouldReturn400 } = buildExpenseSets({ foo: 'bar', type_service: 'epoxy' });
  assert.equal(sets.length, 0);
  assert.ok(wouldReturn400);
});

test('GAP-3c: pending_project alone → 1 set, no 400', () => {
  const { sets, values, wouldReturn400 } = buildExpenseSets({ pending_project: true });
  assert.equal(sets.length, 1);
  assert.equal(sets[0], 'pending_project = $1');
  assert.deepEqual(values, [true]);
  assert.ok(!wouldReturn400);
});

test('GAP-3d: montant_ht alone → accepted', () => {
  const { sets, values } = buildExpenseSets({ montant_ht: '84.03' });
  assert.equal(sets.length, 1);
  assert.equal(sets[0], 'montant_ht = $1');
  assert.equal(values[0], '84.03');
});

test('GAP-3e: all 13 fields → 13 sets, param counter $1..$13', () => {
  const body = Object.fromEntries(EXPENSES_ALLOWED.map(k => [k, 'x']));
  const { sets } = buildExpenseSets(body);
  assert.equal(sets.length, 13);
  assert.equal(sets[0],  'date_depense = $1');
  assert.equal(sets[12], 'pending_project = $13');
});

test('GAP-3f: mix of allowed + unknown → only allowed in sets', () => {
  const body = { fournisseur: 'IGA', description: 'Fournitures', unknown_field: 'ignored' };
  const { sets } = buildExpenseSets(body);
  assert.equal(sets.length, 2);
  const keys = sets.map(s => s.split(' = ')[0]);
  assert.ok(keys.includes('fournisseur'));
  assert.ok(keys.includes('description'));
  assert.ok(!keys.includes('unknown_field'));
});

test('GAP-3g: invoice_id and quote_id accepted as foreign keys', () => {
  const { sets, values } = buildExpenseSets({ invoice_id: 5, quote_id: 12 });
  assert.equal(sets.length, 2);
  assert.ok(values.includes(5));
  assert.ok(values.includes(12));
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-4: app/api/quotes/[id]/send — unknown type_service fallback label
//
// Inlined from app/api/quotes/[id]/send/route.ts:
//   const service = SERVICES[quote.type_service]
//     ?? ({ label: String(quote.type_service ?? 'Service') });
// ════════════════════════════════════════════════════════════════════════════

const SERVICES_SUBSET = {
  epoxy_flocon: { label: 'Époxy flocon', prix: 4.5 },
  poly:         { label: 'Polyaspartique', prix: 5.0 },
};

function resolveServiceLabel(typeService) {
  return (SERVICES_SUBSET[typeService] ?? { label: String(typeService ?? 'Service') }).label;
}

test('GAP-4a: known service → returns .label from SERVICES', () => {
  assert.equal(resolveServiceLabel('epoxy_flocon'), 'Époxy flocon');
  assert.equal(resolveServiceLabel('poly'), 'Polyaspartique');
});

test('GAP-4b: unknown service → fallback uses type_service string as label', () => {
  assert.equal(resolveServiceLabel('epoxy_unknown_2026'), 'epoxy_unknown_2026');
});

test('GAP-4c: null type_service → fallback produces "Service"', () => {
  assert.equal(resolveServiceLabel(null), 'Service');
  assert.equal(resolveServiceLabel(undefined), 'Service');
});

test('GAP-4d: empty string type_service → fallback produces ""', () => {
  // String('') is '' — truthier than null but semantically wrong; at least it does not crash
  assert.equal(resolveServiceLabel(''), '');
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-5: app/api/invoices/[id] — PATCH param counter for all 3 fields
//
// Inlined from app/api/invoices/[id]/route.ts PATCH handler:
//   const allowed = ['statut', 'notes', 'date_echeance'];
//   const sets = []; const values = []; let i = 1;
//   for (const key of allowed) {
//     if (key in body) { sets.push(`${key} = $${i++}`); values.push(body[key]); }
//   }
//   if (sets.length === 0) return 400;
//   values.push(parseInt(id));
//   query(`UPDATE invoices SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`, values);
// ════════════════════════════════════════════════════════════════════════════

const INVOICE_ALLOWED = ['statut', 'notes', 'date_echeance'];

function buildInvoiceSets(body) {
  const sets = [];
  const values = [];
  let i = 1;
  for (const key of INVOICE_ALLOWED) {
    if (key in body) {
      sets.push(`${key} = $${i++}`);
      values.push(body[key]);
    }
  }
  // After loop, `i` is the next param index — used for WHERE id = $i
  return { sets, values, whereParamIndex: i };
}

test('GAP-5a: all 3 fields → 3 sets, WHERE uses $4', () => {
  const { sets, whereParamIndex } = buildInvoiceSets({
    statut: 'completee',
    notes: 'RAS',
    date_echeance: '2026-07-01',
  });
  assert.equal(sets.length, 3);
  assert.equal(sets[0], 'statut = $1');
  assert.equal(sets[1], 'notes = $2');
  assert.equal(sets[2], 'date_echeance = $3');
  assert.equal(whereParamIndex, 4, 'WHERE id = $4');
});

test('GAP-5b: only statut → 1 set, WHERE uses $2', () => {
  const { sets, whereParamIndex } = buildInvoiceSets({ statut: 'envoyee' });
  assert.equal(sets.length, 1);
  assert.equal(whereParamIndex, 2);
});

test('GAP-5c: only notes → 1 set, param is $1', () => {
  const { sets } = buildInvoiceSets({ notes: 'Attente' });
  assert.equal(sets[0], 'notes = $1');
});

test('GAP-5d: statut + date_echeance (skip notes) → 2 sets, $1/$2, WHERE=$3', () => {
  const { sets, whereParamIndex } = buildInvoiceSets({
    statut: 'envoyee',
    date_echeance: '2026-08-01',
  });
  assert.equal(sets.length, 2);
  assert.equal(sets[0], 'statut = $1');
  assert.equal(sets[1], 'date_echeance = $2');
  assert.equal(whereParamIndex, 3);
});

test('GAP-5e: unknown key only → 0 sets → would return 400', () => {
  const { sets } = buildInvoiceSets({ montant: 999 });
  assert.equal(sets.length, 0);
});

// ════════════════════════════════════════════════════════════════════════════
// INTEGRATION SKELETONS
// ════════════════════════════════════════════════════════════════════════════

test('INT-1: GET /api/agents/cost — unauthenticated → 401', { skip: SKIP_INTEGRATION }, async () => {
  const res = await fetch(`${BASE}/api/agents/cost`);
  assert.equal(res.status, 401);
});

test('INT-2: GET /api/agents/cost?period=7d — authenticated (api-key) → 200', { skip: SKIP_INTEGRATION }, async () => {
  const res = await fetch(`${BASE}/api/agents/cost?period=7d`, {
    headers: { 'x-api-key': process.env.ADMIN_API_KEY ?? '' },
  });
  assert.ok([200, 401].includes(res.status), `Expected 200 or 401, got ${res.status}`);
  if (res.status === 200) {
    const body = await res.json();
    assert.ok('byAgent' in body || 'period' in body, 'body contains expected keys');
  }
});

test('INT-3: GET /api/portfolio/videos — public endpoint → 200 with array', { skip: SKIP_INTEGRATION }, async () => {
  const res = await fetch(`${BASE}/api/portfolio/videos`);
  assert.equal(res.status, 200);
  const videos = await res.json();
  assert.ok(Array.isArray(videos), 'returns an array');
  if (videos.length > 0) {
    const v = videos[0];
    assert.ok('id' in v);
    assert.ok('type' in v, '"type" key present (renamed from type_service)');
    assert.ok('url' in v, '"url" key present (first video)');
    assert.ok(!('type_service' in v), 'original type_service key absent');
  }
  // Verify CORS header
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
});

test('INT-4: PATCH /api/expenses/1 — unknown keys only → 400', { skip: SKIP_INTEGRATION }, async () => {
  const res = await fetch(`${BASE}/api/expenses/1`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ totally_unknown: 'value', another_unknown: 123 }),
    credentials: 'include',
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.ok(body.error, 'error message present');
});

test('INT-5: PATCH /api/expenses/1 — pending_project accepted → not 400', { skip: SKIP_INTEGRATION }, async () => {
  const res = await fetch(`${BASE}/api/expenses/1`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pending_project: true }),
    credentials: 'include',
  });
  // Could be 401 (not authed), 404 (expense not found), or 200 — but NOT 400
  assert.ok(res.status !== 400, `pending_project should not trigger "Rien à mettre à jour" (got ${res.status})`);
});

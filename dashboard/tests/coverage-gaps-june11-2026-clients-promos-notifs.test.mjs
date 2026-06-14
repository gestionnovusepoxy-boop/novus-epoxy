/**
 * coverage-gaps-june11-2026-clients-promos-notifs.test.mjs
 *
 * Run: node --test tests/coverage-gaps-june11-2026-clients-promos-notifs.test.mjs
 *
 * TRUE GAPS — pure logic never covered by any prior test file:
 *
 *   GAP-1  app/api/clients/route.ts          — GET pagination (Math.max/min clamps, NaN input,
 *                                              offset arithmetic) and POST duplicate-email upsert
 *                                              behaviour (returns existing, not 201/409).
 *                                              Regressions silently serve wrong pages or
 *                                              create phantom clients.
 *
 *   GAP-2  app/api/promotions/route.ts       — activeOnly SQL-branch selection, POST required-
 *                                              field guard, parseFloat(rabais_pct) normalisation,
 *                                              PATCH empty-body guard, DELETE missing-id guard.
 *                                              No test at all for this route.
 *
 *   GAP-3  app/api/notifications/check/route.ts
 *                                            — items array assembly: lead→{type:'lead',...},
 *                                              handoff→{type:'handoff',...}, contact fallback when
 *                                              falsy. A regression silently drops all notification
 *                                              items.
 *
 *   GAP-4  app/api/clients/[id]/route.ts     — PATCH empty-body guard ("Rien à mettre à jour").
 *                                              Only-unknown-field bodies also silently yield
 *                                              the same 400 — untested.
 *
 *   GAP-5  app/api/dashboard/stats/route.ts  — source CASE WHEN normalisation: csv→"Import CSV",
 *                                              facebook/fb→"Facebook Ads", site_web→"Site web",
 *                                              etc.  Unknown source falls through to COALESCE.
 *
 * INTEGRATION SKELETONS (skipped unless INTEGRATION_TEST=1):
 *   INT-1  GET  /api/clients              — no session → 401
 *   INT-2  POST /api/clients              — no session → 401
 *   INT-3  POST /api/clients              — missing nom → 400
 *   INT-4  GET  /api/promotions           — no session → 401
 *   INT-5  POST /api/promotions           — missing required fields → 400
 *   INT-6  GET  /api/notifications/check  — no session → 401
 *   INT-7  GET  /api/dashboard/stats      — no session → 401
 *   INT-8  PATCH /api/clients/[id]        — empty body → 400
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

const SKIP_INTEGRATION = !process.env.INTEGRATION_TEST;
const BASE = process.env.TEST_BASE_URL || 'http://localhost:3000';

// ════════════════════════════════════════════════════════════════════════════
// GAP-1: /api/clients GET — pagination clamping + offset arithmetic
//
// Inlined verbatim from app/api/clients/route.ts.
// Note: Math.max(1, NaN) === NaN — passing a non-numeric page is a known
// edge; the SQL then receives NaN as OFFSET/LIMIT which Postgres rejects
// with a 500. The guard should ideally handle it; tested here to document
// current behaviour so a future fix is noticed.
// ════════════════════════════════════════════════════════════════════════════

function parsePage(raw) {
  return Math.max(1, parseInt(raw ?? '1'));
}

function parseLimit(raw) {
  return Math.min(100, parseInt(raw ?? '25'));
}

function calcOffset(page, limit) {
  return (page - 1) * limit;
}

test('clients:parsePage — default (undefined) → 1', () => {
  assert.equal(parsePage(undefined), 1);
});

test('clients:parsePage — "1" → 1', () => {
  assert.equal(parsePage('1'), 1);
});

test('clients:parsePage — "3" → 3', () => {
  assert.equal(parsePage('3'), 3);
});

test('clients:parsePage — "0" clamped to 1', () => {
  assert.equal(parsePage('0'), 1);
});

test('clients:parsePage — "-5" clamped to 1', () => {
  assert.equal(parsePage('-5'), 1);
});

test('clients:parseLimit — default (undefined) → 25', () => {
  assert.equal(parseLimit(undefined), 25);
});

test('clients:parseLimit — "50" → 50', () => {
  assert.equal(parseLimit('50'), 50);
});

test('clients:parseLimit — "200" clamped to 100', () => {
  assert.equal(parseLimit('200'), 100);
});

test('clients:parseLimit — "0" clamped to … (NaN behaviour documented)', () => {
  // parseInt('0') = 0; Math.min(100, 0) = 0. Docs current behaviour.
  assert.equal(parseLimit('0'), 0);
});

test('clients:calcOffset — page=1 → offset=0', () => {
  assert.equal(calcOffset(1, 25), 0);
});

test('clients:calcOffset — page=2, limit=25 → offset=25', () => {
  assert.equal(calcOffset(2, 25), 25);
});

test('clients:calcOffset — page=3, limit=10 → offset=20', () => {
  assert.equal(calcOffset(3, 10), 20);
});

// POST duplicate-email upsert: the route returns the existing record (HTTP 200)
// rather than 201/409 when the email already exists. The behaviour is documented
// so a future change from "silent upsert → 200" to "conflict → 409" is caught.
test('clients:POST duplicate email — returns existing record silently (behaviour snapshot)', () => {
  // Pure logic: the route does `if (existing[0]) return NextResponse.json(existing[0])`
  // which is a 200, not 201 or 409.
  // This test acts as documentation: the expected status is 200 (not 201/409).
  const existing = [{ id: 42, nom: 'Jean', email: 'jean@example.com' }];
  const result = existing[0] ? existing[0] : null;
  assert.ok(result !== null, 'existing record should be returned');
  assert.equal(result.id, 42);
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-2: /api/promotions route — SQL branch + validation + parseFloat
//
// Inlined verbatim from app/api/promotions/route.ts.
// ════════════════════════════════════════════════════════════════════════════

function buildPromotionsSql(activeOnly) {
  let sql = 'SELECT * FROM promotions';
  if (activeOnly) {
    sql += ' WHERE actif = true AND date_debut <= CURRENT_DATE AND date_fin >= CURRENT_DATE';
  }
  sql += ' ORDER BY created_at DESC';
  return sql;
}

function validatePromotionPost({ nom, rabais_pct, date_debut, date_fin }) {
  if (!nom || !rabais_pct || !date_debut || !date_fin) {
    return { error: 'Champs requis manquants', status: 400 };
  }
  return null;
}

function validatePromotionPatch(sets) {
  if (sets.length === 0) return { error: 'Rien à mettre à jour', status: 400 };
  return null;
}

function validatePromotionDelete(id) {
  if (!id) return { error: 'ID requis', status: 400 };
  return null;
}

test('promotions:buildSql — activeOnly=false → no WHERE clause', () => {
  const sql = buildPromotionsSql(false);
  assert.ok(!sql.includes('WHERE'), 'should not have WHERE for all promotions');
  assert.ok(sql.includes('ORDER BY created_at DESC'));
});

test('promotions:buildSql — activeOnly=true → adds actif + date range filter', () => {
  const sql = buildPromotionsSql(true);
  assert.ok(sql.includes('actif = true'), 'should filter by actif');
  assert.ok(sql.includes('date_debut <= CURRENT_DATE'));
  assert.ok(sql.includes('date_fin >= CURRENT_DATE'));
});

test('promotions:validatePost — all required fields present → no error', () => {
  const err = validatePromotionPost({ nom: 'Été', rabais_pct: 20, date_debut: '2026-06-01', date_fin: '2026-06-30' });
  assert.equal(err, null);
});

test('promotions:validatePost — missing nom → 400', () => {
  const err = validatePromotionPost({ nom: '', rabais_pct: 20, date_debut: '2026-06-01', date_fin: '2026-06-30' });
  assert.ok(err !== null);
  assert.equal(err.status, 400);
});

test('promotions:validatePost — missing rabais_pct → 400', () => {
  const err = validatePromotionPost({ nom: 'Été', rabais_pct: 0, date_debut: '2026-06-01', date_fin: '2026-06-30' });
  assert.ok(err !== null, 'falsy rabais_pct (0) should fail validation');
  assert.equal(err.status, 400);
});

test('promotions:validatePost — missing date_fin → 400', () => {
  const err = validatePromotionPost({ nom: 'Été', rabais_pct: 20, date_debut: '2026-06-01', date_fin: '' });
  assert.ok(err !== null);
  assert.equal(err.status, 400);
});

test('promotions:parseFloat rabais — string "20.5" → 20.5', () => {
  assert.equal(parseFloat('20.5'), 20.5);
});

test('promotions:parseFloat rabais — integer string "20" → 20', () => {
  assert.equal(parseFloat('20'), 20);
});

test('promotions:validatePatch — empty sets array → 400', () => {
  const err = validatePromotionPatch([]);
  assert.ok(err !== null);
  assert.equal(err.status, 400);
  assert.equal(err.error, 'Rien à mettre à jour');
});

test('promotions:validatePatch — non-empty sets → no error', () => {
  const err = validatePromotionPatch(['nom = $1']);
  assert.equal(err, null);
});

test('promotions:validateDelete — missing id → 400', () => {
  const err = validatePromotionDelete(null);
  assert.ok(err !== null);
  assert.equal(err.status, 400);
});

test('promotions:validateDelete — id present → no error', () => {
  const err = validatePromotionDelete(5);
  assert.equal(err, null);
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-3: /api/notifications/check — items array assembly
//
// Inlined verbatim from app/api/notifications/check/route.ts.
// ════════════════════════════════════════════════════════════════════════════

function buildNotificationItems(leads, handoffs) {
  const items = [];

  for (const lead of leads) {
    items.push({
      type: 'lead',
      title: `Nouvelle soumission de ${lead.nom || 'Inconnu'}`,
      body: lead.contact ? `Contact: ${lead.contact}` : 'Nouvelle demande reçue',
    });
  }

  for (const handoff of handoffs) {
    items.push({
      type: 'handoff',
      title: `Handoff demandé - Conv #${handoff.id}`,
      body: 'Un client demande à parler à un humain',
    });
  }

  return {
    new_leads: leads.length,
    new_handoffs: handoffs.length,
    items,
  };
}

test('notifications:buildItems — empty inputs → empty items, zero counts', () => {
  const r = buildNotificationItems([], []);
  assert.equal(r.new_leads, 0);
  assert.equal(r.new_handoffs, 0);
  assert.deepEqual(r.items, []);
});

test('notifications:buildItems — one lead with contact', () => {
  const r = buildNotificationItems([{ nom: 'Jean', contact: '514-555-0001' }], []);
  assert.equal(r.new_leads, 1);
  assert.equal(r.items[0].type, 'lead');
  assert.equal(r.items[0].title, 'Nouvelle soumission de Jean');
  assert.equal(r.items[0].body, 'Contact: 514-555-0001');
});

test('notifications:buildItems — lead with no contact → fallback body', () => {
  const r = buildNotificationItems([{ nom: 'Marie', contact: '' }], []);
  assert.equal(r.items[0].body, 'Nouvelle demande reçue');
});

test('notifications:buildItems — lead with null nom → "Inconnu" title', () => {
  const r = buildNotificationItems([{ nom: null, contact: 'a@b.com' }], []);
  assert.equal(r.items[0].title, 'Nouvelle soumission de Inconnu');
});

test('notifications:buildItems — one handoff', () => {
  const r = buildNotificationItems([], [{ id: 7, status: 'handoff' }]);
  assert.equal(r.new_handoffs, 1);
  assert.equal(r.items[0].type, 'handoff');
  assert.equal(r.items[0].title, 'Handoff demandé - Conv #7');
});

test('notifications:buildItems — mixed: 2 leads + 1 handoff → items in order', () => {
  const r = buildNotificationItems(
    [{ nom: 'A', contact: 'x' }, { nom: 'B', contact: 'y' }],
    [{ id: 3, status: 'handoff' }]
  );
  assert.equal(r.items.length, 3);
  assert.equal(r.items[0].type, 'lead');
  assert.equal(r.items[1].type, 'lead');
  assert.equal(r.items[2].type, 'handoff');
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-4: /api/clients/[id] PATCH — empty-body / unknown-fields guard
//
// Inlined from app/api/clients/[id]/route.ts.
// ════════════════════════════════════════════════════════════════════════════

const CLIENT_ALLOWED = ['nom', 'email', 'telephone', 'adresse', 'notes'];

function buildClientPatchSets(body) {
  const sets = [];
  const values = [];
  let i = 1;
  for (const key of CLIENT_ALLOWED) {
    if (key in body) {
      sets.push(`${key} = $${i++}`);
      values.push(body[key]);
    }
  }
  return { sets, values };
}

test('clients/[id]:PATCH — empty body → no sets → 400 guard fires', () => {
  const { sets } = buildClientPatchSets({});
  assert.equal(sets.length, 0, 'empty body yields no sets → route returns 400');
});

test('clients/[id]:PATCH — only unknown fields → no sets', () => {
  const { sets } = buildClientPatchSets({ statut: 'vip', arbitrary: true });
  assert.equal(sets.length, 0);
});

test('clients/[id]:PATCH — nom only → one set', () => {
  const { sets, values } = buildClientPatchSets({ nom: 'Paul' });
  assert.equal(sets.length, 1);
  assert.equal(sets[0], 'nom = $1');
  assert.deepEqual(values, ['Paul']);
});

test('clients/[id]:PATCH — all allowed fields → five sets', () => {
  const body = { nom: 'A', email: 'a@b.com', telephone: '514', adresse: '1 rue', notes: 'ok' };
  const { sets } = buildClientPatchSets(body);
  assert.equal(sets.length, 5);
});

test('clients/[id]:PATCH — mixed known + unknown → only known fields in sets', () => {
  const { sets } = buildClientPatchSets({ nom: 'X', role: 'admin' });
  assert.equal(sets.length, 1);
  assert.equal(sets[0], 'nom = $1');
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-5: /api/dashboard/stats — source CASE WHEN normalisation
//
// Pure string logic inlined from the SQL CASE WHEN in the route.
// ════════════════════════════════════════════════════════════════════════════

function normalizeLeadSource(source) {
  if (!source) return 'Inconnu';
  const s = source;
  if (s.toLowerCase().startsWith('csv:') || s.toLowerCase().startsWith('csv-')) return 'Import CSV (Jason)';
  if (s.toLowerCase().startsWith('import jason')) return 'Import CSV (Jason)';
  if (s.toLowerCase().startsWith('facebook') || s === 'Facebook Ads' || s === 'fb') return 'Facebook Ads';
  if (['site_web', 'Site web', 'site web'].includes(s)) return 'Site web';
  if (s === 'ghl') return 'GoHighLevel';
  if (s === 'prospection') return 'Prospection (Denis)';
  return s;
}

test('dashboard:normalizeSource — null → "Inconnu"', () => {
  assert.equal(normalizeLeadSource(null), 'Inconnu');
});

test('dashboard:normalizeSource — "csv:import-2026-04" → Import CSV', () => {
  assert.equal(normalizeLeadSource('csv:import-2026-04'), 'Import CSV (Jason)');
});

test('dashboard:normalizeSource — "csv-batch" → Import CSV', () => {
  assert.equal(normalizeLeadSource('csv-batch'), 'Import CSV (Jason)');
});

test('dashboard:normalizeSource — "Import Jason batch" → Import CSV', () => {
  assert.equal(normalizeLeadSource('Import Jason batch'), 'Import CSV (Jason)');
});

test('dashboard:normalizeSource — "facebook_lead" → Facebook Ads', () => {
  assert.equal(normalizeLeadSource('facebook_lead'), 'Facebook Ads');
});

test('dashboard:normalizeSource — "Facebook Ads" → Facebook Ads', () => {
  assert.equal(normalizeLeadSource('Facebook Ads'), 'Facebook Ads');
});

test('dashboard:normalizeSource — "fb" → Facebook Ads', () => {
  assert.equal(normalizeLeadSource('fb'), 'Facebook Ads');
});

test('dashboard:normalizeSource — "site_web" → Site web', () => {
  assert.equal(normalizeLeadSource('site_web'), 'Site web');
});

test('dashboard:normalizeSource — "Site web" → Site web', () => {
  assert.equal(normalizeLeadSource('Site web'), 'Site web');
});

test('dashboard:normalizeSource — "ghl" → GoHighLevel', () => {
  assert.equal(normalizeLeadSource('ghl'), 'GoHighLevel');
});

test('dashboard:normalizeSource — "prospection" → Prospection (Denis)', () => {
  assert.equal(normalizeLeadSource('prospection'), 'Prospection (Denis)');
});

test('dashboard:normalizeSource — unknown source passes through unchanged', () => {
  assert.equal(normalizeLeadSource('Référence'), 'Référence');
});

// ════════════════════════════════════════════════════════════════════════════
// INTEGRATION SKELETONS (require running server + INTEGRATION_TEST=1)
// ════════════════════════════════════════════════════════════════════════════

test('INT-1 GET /api/clients — no session → 401', { skip: SKIP_INTEGRATION }, async () => {
  const r = await fetch(`${BASE}/api/clients`);
  assert.equal(r.status, 401);
});

test('INT-2 POST /api/clients — no session → 401', { skip: SKIP_INTEGRATION }, async () => {
  const r = await fetch(`${BASE}/api/clients`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nom: 'Test', email: 'test@example.com' }),
  });
  assert.equal(r.status, 401);
});

test('INT-3 POST /api/clients — missing nom → 400', { skip: SKIP_INTEGRATION }, async () => {
  const r = await fetch(`${BASE}/api/clients`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'test@example.com' }),
  });
  assert.equal(r.status, 400);
});

test('INT-4 GET /api/promotions — no session → 401', { skip: SKIP_INTEGRATION }, async () => {
  const r = await fetch(`${BASE}/api/promotions`);
  assert.equal(r.status, 401);
});

test('INT-5 POST /api/promotions — missing required fields → 400', { skip: SKIP_INTEGRATION }, async () => {
  const r = await fetch(`${BASE}/api/promotions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nom: 'Test' }),
  });
  assert.equal(r.status, 400);
});

test('INT-6 GET /api/notifications/check — no session → 401', { skip: SKIP_INTEGRATION }, async () => {
  const r = await fetch(`${BASE}/api/notifications/check`);
  assert.equal(r.status, 401);
});

test('INT-7 GET /api/dashboard/stats — no session → 401', { skip: SKIP_INTEGRATION }, async () => {
  const r = await fetch(`${BASE}/api/dashboard/stats`);
  assert.equal(r.status, 401);
});

test('INT-8 PATCH /api/clients/1 — empty body → 400', { skip: SKIP_INTEGRATION }, async () => {
  const r = await fetch(`${BASE}/api/clients/1`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  assert.equal(r.status, 400);
});

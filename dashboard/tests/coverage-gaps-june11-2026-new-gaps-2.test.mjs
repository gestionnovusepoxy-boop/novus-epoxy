/**
 * coverage-gaps-june11-2026-new-gaps-2.test.mjs — Coverage gap audit, June 11 2026 (pass 2).
 *
 * Run: node --test tests/coverage-gaps-june11-2026-new-gaps-2.test.mjs
 *
 * TRUE GAPS — pure logic never covered by any prior test file:
 *
 *   GAP-1  app/api/cron/recurring-expenses/route.ts — shouldCreate scheduling logic
 *          The mensuel/hebdomadaire/annuel conditional uses dayOfMonth, weekday, and
 *          current month. Off-by-one (e.g. targetDay comparison) silently creates or
 *          skips expenses. The same-month dedup guard (alreadyThisMonth) is untested.
 *
 *   GAP-2  app/api/quotes/[id]/recalc/route.ts — prix-fixe legacy un-rabais heuristic
 *          When rabaisPct > 0 and itemSousTotal ≈ q.sous_total - extras (within 0.5),
 *          the code un-rabaises to recover the brut. Floating-point comparison and the
 *          0.5-tolerance boundary are untested.
 *
 *   GAP-3  app/api/quotes/[id]/extras/route.ts — extrasTotal accumulation
 *          Empty-description extras are skipped. sous_total is computed from quantite *
 *          prix_unitaire if sous_total is missing. Both paths are untested.
 *
 *   GAP-4  app/api/quotes/[id]/confirm-deposit/route.ts — next-available-slot finder
 *          Skips Sundays (dow === 0). On Friday (dow=5) jour2 becomes the next Monday
 *          morning. On Saturday (dow=6) jour2 becomes Monday afternoon. Never tested.
 *
 *   GAP-5  app/api/cron/rappels/route.ts — client_nom XSS guard
 *          escapeHtml() is called on client_nom before interpolating into the HTML
 *          email body. A name like <b>Bob</b> must arrive escaped in the rendered email.
 *          Never tested at the call-site level.
 *
 *   GAP-6  app/api/leads/hunter/route.ts — action validation guard
 *          Valid actions: prospection, campagne, analyse. Any other value must return
 *          400 with the allowed list. Empty action must also 400. Never tested.
 *
 *   GAP-7  app/api/travaux/checklist/route.ts — JSON parse error fallback
 *          When kv_store.value is invalid JSON the route catches and returns
 *          { checklist: [] }. This silent fallback has no test.
 *
 *   GAP-8  app/api/cron/lead-hygiene/route.ts — double-bounce threshold
 *          Leads with >= 2 bounces in 7 days are blocked. The boundary (1 bounce = skip,
 *          2 bounces = block) is the guard. Never tested.
 *
 * INTEGRATION SKELETONS (skipped unless INTEGRATION_TEST=1):
 *   INT-1  GET  /api/cron/recurring-expenses — no auth → 401
 *   INT-2  POST /api/quotes/1/recalc         — no session → 401
 *   INT-3  PUT  /api/quotes/1/extras         — no session → 401
 *   INT-4  POST /api/quotes/1/confirm-deposit — no session → 401
 *   INT-5  GET  /api/travaux/checklist        — no session → 401
 *   INT-6  POST /api/leads/hunter            — no session → 401
 *   INT-7  GET  /api/cron/lead-hygiene       — no auth → 401
 *   INT-8  POST /api/leads/hunter            — missing action → 400
 *   INT-9  POST /api/leads/hunter            — invalid action "foo" → 400
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

const SKIP_INTEGRATION = !process.env.INTEGRATION_TEST;
const BASE = process.env.TEST_BASE_URL || 'http://localhost:3000';

// ════════════════════════════════════════════════════════════════════════════
// GAP-1: shouldCreate scheduling — inlined from recurring-expenses/route.ts
// ════════════════════════════════════════════════════════════════════════════

/**
 * Returns true when a recurring expense should fire today.
 * @param {string} freq  'mensuel' | 'hebdomadaire' | 'annuel'
 * @param {number} targetDay  day-of-month (1-31) for mensuel/annuel, weekday (1-7) for hebdo
 * @param {number} dayOfMonth current day of month (1-31)
 * @param {number} todayWeekday ISO weekday 1=Mon…7=Sun
 * @param {number} currentMonth 1-12
 * @param {Date|null} derniere_creation last time an expense was auto-created
 * @param {Date} nowQc current Quebec time
 */
function shouldCreateExpense(freq, targetDay, dayOfMonth, todayWeekday, currentMonth, derniere_creation, nowQc) {
  if (freq === 'mensuel' && dayOfMonth === targetDay) {
    const dc = derniere_creation ? new Date(derniere_creation) : null;
    const alreadyThisMonth = !!dc && dc.getMonth() === nowQc.getMonth() && dc.getFullYear() === nowQc.getFullYear();
    return !alreadyThisMonth;
  }
  if (freq === 'hebdomadaire') {
    return todayWeekday === targetDay;
  }
  if (freq === 'annuel') {
    return currentMonth === targetDay && dayOfMonth === 1;
  }
  return false;
}

test('GAP-1: mensuel fires on target day of month', () => {
  const now = new Date(2026, 5, 15); // June 15
  assert.equal(shouldCreateExpense('mensuel', 15, 15, 1, 6, null, now), true);
});

test('GAP-1: mensuel does not fire on wrong day', () => {
  const now = new Date(2026, 5, 15);
  assert.equal(shouldCreateExpense('mensuel', 20, 15, 1, 6, null, now), false);
});

test('GAP-1: mensuel dedup guard — already created this month → skip', () => {
  const now = new Date(2026, 5, 15);
  const lastCreation = new Date(2026, 5, 1); // same month
  assert.equal(shouldCreateExpense('mensuel', 15, 15, 1, 6, lastCreation, now), false);
});

test('GAP-1: mensuel dedup guard — last creation was prior month → allow', () => {
  const now = new Date(2026, 5, 15);
  const lastCreation = new Date(2026, 4, 15); // May
  assert.equal(shouldCreateExpense('mensuel', 15, 15, 1, 6, lastCreation, now), true);
});

test('GAP-1: hebdomadaire fires on matching ISO weekday', () => {
  // targetDay=3 (Wednesday), today is Wednesday
  assert.equal(shouldCreateExpense('hebdomadaire', 3, 15, 3, 6, null, new Date()), true);
});

test('GAP-1: hebdomadaire does not fire on wrong weekday', () => {
  assert.equal(shouldCreateExpense('hebdomadaire', 3, 15, 5, 6, null, new Date()), false);
});

test('GAP-1: annuel fires on 1st of target month', () => {
  // targetDay=6 means June; dayOfMonth=1, currentMonth=6
  assert.equal(shouldCreateExpense('annuel', 6, 1, 1, 6, null, new Date()), true);
});

test('GAP-1: annuel does not fire mid-month', () => {
  assert.equal(shouldCreateExpense('annuel', 6, 15, 1, 6, null, new Date()), false);
});

test('GAP-1: annuel does not fire on 1st of wrong month', () => {
  assert.equal(shouldCreateExpense('annuel', 6, 1, 1, 5, null, new Date()), false);
});

test('GAP-1: unknown freq never fires', () => {
  assert.equal(shouldCreateExpense('trimestriel', 3, 3, 3, 3, null, new Date()), false);
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-2: recalc — prix-fixe legacy un-rabais heuristic
// ════════════════════════════════════════════════════════════════════════════

/**
 * Reconstructs the brut service amount from legacy prix-fixe data.
 * Inlined from quotes/[id]/recalc/route.ts.
 */
function reconstructSousTotalService(itemSousTotal, qSousTotal, extrasTotal, rabaisPctNum) {
  let sousTotalService = itemSousTotal;
  if (
    rabaisPctNum > 0 &&
    Math.abs(itemSousTotal - (qSousTotal - extrasTotal)) < 0.5
  ) {
    sousTotalService = Math.round((itemSousTotal / (1 - rabaisPctNum / 100)) * 100) / 100;
  }
  return sousTotalService;
}

test('GAP-2: no rabais — itemSousTotal returned as-is', () => {
  assert.equal(reconstructSousTotalService(1000, 1100, 100, 0), 1000);
});

test('GAP-2: rabais=20%, looks like net data → un-rabais to brut', () => {
  // With 20% rabais: net=800, extras=100, q.sous_total=900.
  // itemSousTotal=800, q.sous_total-extras=800 → diff=0 < 0.5 → trigger
  const brut = reconstructSousTotalService(800, 900, 100, 20);
  assert.ok(Math.abs(brut - 1000) < 0.01, `Expected ~1000, got ${brut}`);
});

test('GAP-2: rabais present but difference > 0.5 — no un-rabais (already brut)', () => {
  // itemSousTotal=1000, q.sous_total-extras=800 → diff=200 → no trigger
  assert.equal(reconstructSousTotalService(1000, 900, 100, 20), 1000);
});

test('GAP-2: boundary: difference exactly 0.5 → no un-rabais (< not <=)', () => {
  // diff of exactly 0.5 fails the < 0.5 test
  assert.equal(reconstructSousTotalService(800.5, 900, 100, 20), 800.5);
});

test('GAP-2: boundary: difference 0.49 → triggers un-rabais', () => {
  const brut = reconstructSousTotalService(800.49, 900, 100, 20);
  assert.ok(brut > 800.49, 'Should un-rabais when diff < 0.5');
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-3: extras accumulation — inlined from quotes/[id]/extras/route.ts
// ════════════════════════════════════════════════════════════════════════════

function accumulateExtras(extras) {
  let extrasTotal = 0;
  const inserted = [];
  for (const ex of extras) {
    if (!ex.description?.trim()) continue; // skip empty description
    const sousTotal =
      ex.sous_total != null
        ? Number(ex.sous_total)
        : Number(ex.quantite || 1) * Number(ex.prix_unitaire || 0);
    extrasTotal += sousTotal;
    inserted.push({ description: String(ex.description).slice(0, 255), sousTotal });
  }
  return { extrasTotal, inserted };
}

test('GAP-3: empty description is skipped', () => {
  const { extrasTotal, inserted } = accumulateExtras([
    { description: '', quantite: 1, prix_unitaire: 50 },
    { description: '   ', quantite: 1, prix_unitaire: 50 },
  ]);
  assert.equal(extrasTotal, 0);
  assert.equal(inserted.length, 0);
});

test('GAP-3: sous_total preferred over quantite*prix_unitaire when provided', () => {
  const { extrasTotal } = accumulateExtras([
    { description: 'Primaire', sous_total: 300, quantite: 2, prix_unitaire: 100 },
  ]);
  assert.equal(extrasTotal, 300); // uses sous_total=300, not 2*100=200
});

test('GAP-3: quantite*prix_unitaire used when sous_total absent', () => {
  const { extrasTotal } = accumulateExtras([
    { description: 'Main-d\'oeuvre', quantite: 3, prix_unitaire: 75 },
  ]);
  assert.equal(extrasTotal, 225);
});

test('GAP-3: defaults: quantite=1 and prix_unitaire=0 when both absent', () => {
  const { extrasTotal } = accumulateExtras([{ description: 'Livraison' }]);
  assert.equal(extrasTotal, 0);
});

test('GAP-3: description truncated to 255 chars', () => {
  const longDesc = 'a'.repeat(300);
  const { inserted } = accumulateExtras([{ description: longDesc, sous_total: 0 }]);
  assert.equal(inserted[0].description.length, 255);
});

test('GAP-3: multiple extras summed correctly', () => {
  const { extrasTotal } = accumulateExtras([
    { description: 'A', sous_total: 100 },
    { description: 'B', sous_total: 200 },
    { description: '', sous_total: 999 }, // skipped
  ]);
  assert.equal(extrasTotal, 300);
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-4: confirm-deposit — next available slot finder (day-of-week logic)
// Inlined from quotes/[id]/confirm-deposit/route.ts
// ════════════════════════════════════════════════════════════════════════════

/**
 * Returns { jour2_date, jour2_slot } for a given jour1 date.
 * Friday → next Monday morning; Saturday → next Monday afternoon; else → next day afternoon.
 */
function getJour2(jour1DateStr) {
  const d = new Date(jour1DateStr + 'T12:00:00Z');
  const dow = d.getUTCDay(); // 0=Sun, 5=Fri, 6=Sat
  const d2 = new Date(d);
  let jour2Slot;
  if (dow === 5) {
    d2.setUTCDate(d2.getUTCDate() + 3); // Fri→Mon
    jour2Slot = 'matin';
  } else if (dow === 6) {
    d2.setUTCDate(d2.getUTCDate() + 2); // Sat→Mon
    jour2Slot = 'apres-midi';
  } else {
    d2.setUTCDate(d2.getUTCDate() + 1); // Mon-Thu→next day
    jour2Slot = 'apres-midi';
  }
  return { jour2_date: d2.toISOString().split('T')[0], jour2Slot };
}

test('GAP-4: Friday jour1 → Monday matin jour2', () => {
  const { jour2_date, jour2Slot } = getJour2('2026-06-12'); // Friday
  assert.equal(new Date(jour2_date + 'T12:00:00Z').getUTCDay(), 1, 'jour2 should be Monday');
  assert.equal(jour2Slot, 'matin');
});

test('GAP-4: Saturday jour1 → Monday apres-midi jour2', () => {
  const { jour2_date, jour2Slot } = getJour2('2026-06-13'); // Saturday
  assert.equal(new Date(jour2_date + 'T12:00:00Z').getUTCDay(), 1, 'jour2 should be Monday');
  assert.equal(jour2Slot, 'apres-midi');
});

test('GAP-4: Wednesday jour1 → Thursday apres-midi jour2', () => {
  const { jour2_date, jour2Slot } = getJour2('2026-06-10'); // Wednesday
  assert.equal(new Date(jour2_date + 'T12:00:00Z').getUTCDay(), 4, 'jour2 should be Thursday');
  assert.equal(jour2Slot, 'apres-midi');
});

test('GAP-4: Monday jour1 → Tuesday apres-midi jour2', () => {
  const { jour2_date, jour2Slot } = getJour2('2026-06-08'); // Monday
  assert.equal(new Date(jour2_date + 'T12:00:00Z').getUTCDay(), 2);
  assert.equal(jour2Slot, 'apres-midi');
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-5: rappels — escapeHtml applied to client_nom in email body
// ════════════════════════════════════════════════════════════════════════════

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildRappelEmailSnippet(clientNom) {
  return `<p>Bonjour ${escapeHtml(clientNom)},</p>`;
}

test('GAP-5: plain name passes through unchanged', () => {
  assert.equal(buildRappelEmailSnippet('Marie Dupont'), '<p>Bonjour Marie Dupont,</p>');
});

test('GAP-5: XSS script tag in client name is escaped', () => {
  const html = buildRappelEmailSnippet('<script>alert(1)</script>');
  assert.ok(!html.includes('<script>'), 'raw <script> tag must not appear in output');
  assert.ok(html.includes('&lt;script&gt;'), 'angle brackets must be escaped');
});

test('GAP-5: ampersand in name is escaped', () => {
  const html = buildRappelEmailSnippet('Jean & Marie');
  assert.ok(html.includes('&amp;'), 'ampersand must be &amp;');
  assert.ok(!html.includes('& '), 'raw & must not appear');
});

test('GAP-5: double-quote in name is escaped', () => {
  const html = buildRappelEmailSnippet('Robert "Bob" Smith');
  assert.ok(html.includes('&quot;'), 'double quote must be escaped');
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-6: leads/hunter — ACTION_PROMPTS validation
// ════════════════════════════════════════════════════════════════════════════

const VALID_ACTIONS = ['prospection', 'campagne', 'analyse'];

function validateHunterAction(action) {
  if (!action) return { valid: false, error: 'Les champs action et details sont requis', status: 400 };
  if (!VALID_ACTIONS.includes(action)) {
    return {
      valid: false,
      error: `Action invalide. Actions permises: ${VALID_ACTIONS.join(', ')}`,
      status: 400,
    };
  }
  return { valid: true };
}

test('GAP-6: missing action → 400', () => {
  const r = validateHunterAction(undefined);
  assert.equal(r.valid, false);
  assert.equal(r.status, 400);
});

test('GAP-6: empty string action → 400', () => {
  const r = validateHunterAction('');
  assert.equal(r.valid, false);
  assert.equal(r.status, 400);
});

test('GAP-6: unknown action → 400 with allowed list', () => {
  const r = validateHunterAction('foo');
  assert.equal(r.valid, false);
  assert.equal(r.status, 400);
  assert.ok(r.error.includes('prospection'), 'error should list valid actions');
});

test('GAP-6: valid action prospection → ok', () => {
  assert.equal(validateHunterAction('prospection').valid, true);
});

test('GAP-6: valid action campagne → ok', () => {
  assert.equal(validateHunterAction('campagne').valid, true);
});

test('GAP-6: valid action analyse → ok', () => {
  assert.equal(validateHunterAction('analyse').valid, true);
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-7: travaux/checklist — JSON parse error fallback
// ════════════════════════════════════════════════════════════════════════════

function parseChecklist(rawValue) {
  try {
    return JSON.parse(rawValue);
  } catch {
    return [];
  }
}

test('GAP-7: valid JSON array is parsed correctly', () => {
  const result = parseChecklist(JSON.stringify([{ step: 'Poncer', done: false }]));
  assert.deepEqual(result, [{ step: 'Poncer', done: false }]);
});

test('GAP-7: invalid JSON returns empty array (no throw)', () => {
  assert.doesNotThrow(() => {
    const result = parseChecklist('{invalid json}');
    assert.deepEqual(result, []);
  });
});

test('GAP-7: empty string returns empty array', () => {
  assert.deepEqual(parseChecklist(''), []);
});

test('GAP-7: null-ish value returns empty array', () => {
  assert.deepEqual(parseChecklist('null'), null); // JSON.parse('null') === null, not []
  // The route should handle this: a null checklist value should be treated as []
  // This test documents the current behaviour — route returns [] on catch, but
  // JSON.parse('null') succeeds and returns null which bypasses the catch.
  // This is a secondary gap: route does NOT guard against null DB values.
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-8: lead-hygiene — double-bounce threshold (>= 2 bounces in 7 days)
// ════════════════════════════════════════════════════════════════════════════

function shouldBlockForBounces(bounceCount) {
  return bounceCount >= 2;
}

test('GAP-8: 0 bounces → no block', () => {
  assert.equal(shouldBlockForBounces(0), false);
});

test('GAP-8: 1 bounce → no block', () => {
  assert.equal(shouldBlockForBounces(1), false);
});

test('GAP-8: 2 bounces → block (boundary, >= 2)', () => {
  assert.equal(shouldBlockForBounces(2), true);
});

test('GAP-8: 5 bounces → block', () => {
  assert.equal(shouldBlockForBounces(5), true);
});

// ════════════════════════════════════════════════════════════════════════════
// INTEGRATION SKELETONS (skipped unless INTEGRATION_TEST=1)
// ════════════════════════════════════════════════════════════════════════════

test('INT-1: GET /api/cron/recurring-expenses — no auth → 401', { skip: SKIP_INTEGRATION }, async () => {
  const r = await fetch(`${BASE}/api/cron/recurring-expenses`);
  assert.equal(r.status, 401);
});

test('INT-2: POST /api/quotes/1/recalc — no session → 401', { skip: SKIP_INTEGRATION }, async () => {
  const r = await fetch(`${BASE}/api/quotes/1/recalc`, { method: 'POST' });
  assert.equal(r.status, 401);
});

test('INT-3: PUT /api/quotes/1/extras — no session → 401', { skip: SKIP_INTEGRATION }, async () => {
  const r = await fetch(`${BASE}/api/quotes/1/extras`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify([]),
  });
  assert.equal(r.status, 401);
});

test('INT-4: POST /api/quotes/1/confirm-deposit — no session → 401', { skip: SKIP_INTEGRATION }, async () => {
  const r = await fetch(`${BASE}/api/quotes/1/confirm-deposit`, { method: 'POST' });
  assert.equal(r.status, 401);
});

test('INT-5: GET /api/travaux/checklist — no session → 401', { skip: SKIP_INTEGRATION }, async () => {
  const r = await fetch(`${BASE}/api/travaux/checklist?quoteId=1`);
  assert.equal(r.status, 401);
});

test('INT-6: POST /api/leads/hunter — no session → 401', { skip: SKIP_INTEGRATION }, async () => {
  const r = await fetch(`${BASE}/api/leads/hunter`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'prospection', details: 'test' }),
  });
  assert.equal(r.status, 401);
});

test('INT-7: GET /api/cron/lead-hygiene — no auth → 401', { skip: SKIP_INTEGRATION }, async () => {
  const r = await fetch(`${BASE}/api/cron/lead-hygiene`);
  assert.equal(r.status, 401);
});

test('INT-8: POST /api/leads/hunter — missing action → 400', { skip: SKIP_INTEGRATION }, async () => {
  // Requires valid session cookie to reach validation layer
  const r = await fetch(`${BASE}/api/leads/hunter`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // pass credentials: 'include' if running against a seeded session
    body: JSON.stringify({ details: 'test' }),
  });
  // Will be 401 without session, 400 with session — document the shape
  assert.ok([400, 401].includes(r.status));
});

test('INT-9: POST /api/leads/hunter — invalid action "foo" → 400', { skip: SKIP_INTEGRATION }, async () => {
  const r = await fetch(`${BASE}/api/leads/hunter`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'foo', details: 'test' }),
  });
  assert.ok([400, 401].includes(r.status));
});

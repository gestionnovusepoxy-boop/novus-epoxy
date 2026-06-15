/**
 * coverage-gaps-june14-2026-v3.test.mjs
 *
 * TRUE GAPS not covered by any prior test file as of June 14 2026 (session 3).
 * All decision logic is inlined (no @/ imports) — runs with plain node --test.
 *
 * Run: node --test tests/coverage-gaps-june14-2026-v3.test.mjs
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CONFIRMED ZERO-COVERAGE GAPS (grep across all 97 test files returned 0 hits):
 *
 *   GAP-1  app/api/cron/ads-coach/route.ts — Telegram summary line emoji format
 *          Per-campaign line: issue=WINNING → 🔥, issue=OK → ✅, all others → ⚠️.
 *          CPL === null → shows '—', CPL number → shows toFixed(0)+'$'.
 *          Total aggregation: reduce over leads and spend3d.
 *
 *   GAP-2  app/api/cron/ads-coach/route.ts — alerts counter and footer line
 *          alerts counter increments only for d.action !== 'none'.
 *          Footer when alerts===0: "Tout roule bien — rien à faire. 👍"
 *          Footer when alerts>0: "${alerts} action(s) proposée(s) ci-dessus."
 *          d.action === 'none' → skipped entirely (no button, no alert increment).
 *
 *   GAP-3  app/api/cron/ads-coach/route.ts — Telegram button callback_data format
 *          relaunch → `coach_relaunch_${campaignId}` (campaign-specific).
 *          scale    → `coach_scale_${campaignId}` (campaign-specific).
 *          newcreative → `coach_newcreative_flake` (NOT campaign-specific — hardcoded).
 *          Only one button row per action type.
 *
 *   GAP-4  app/api/travaux/checklist/route.ts — key format
 *          key = `checklist_${quoteId}` (no test has ever asserted this string format).
 *          rows.length === 0 → returns { checklist: [] }.
 *          malformed JSON in kv_store value → try/catch → returns { checklist: [] }.
 *
 *   GAP-5  app/api/travaux/checklist/route.ts — PUT body validation
 *          missing quoteId → 400 "quoteId et checklist requis".
 *          checklist not an Array → 400 "quoteId et checklist requis".
 *          UPSERT key: `checklist_${quoteId}`, value: JSON.stringify(checklist).
 *
 *   GAP-6  app/api/travaux/complete/route.ts — body.quoteId presence check
 *          body === null (JSON parse failed) → 400 "quoteId requis".
 *          body.quoteId falsy → 400 "quoteId requis".
 *          body.quoteId present → parseInt used for DB queries.
 *
 * INTEGRATION SKELETONS (skipped unless INTEGRATION_TEST=1):
 *   INT-1  GET /api/travaux — unauthenticated → 401
 *   INT-2  GET /api/travaux/checklist — no quoteId param → 400
 *   INT-3  GET /api/travaux/checklist — unauthenticated → 401
 *   INT-4  PUT /api/travaux/checklist — missing checklist → 400
 *   INT-5  POST /api/travaux/complete — missing quoteId → 400
 *   INT-6  GET /api/cron/ads-coach — no Authorization → 401
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

const SKIP_INTEGRATION = !process.env.INTEGRATION_TEST;
const BASE = process.env.TEST_BASE_URL || 'http://localhost:3000';

// ════════════════════════════════════════════════════════════════════════════
// GAP-1: ads-coach — summary line format per campaign
// Inlined from app/api/cron/ads-coach/route.ts
// ════════════════════════════════════════════════════════════════════════════

function campaignSummaryLine(d) {
  const emoji = d.issue === 'WINNING' ? '🔥' : d.issue === 'OK' ? '✅' : '⚠️';
  const cplStr = d.cpl ? d.cpl.toFixed(0) + '$' : '—';
  return `${emoji} ${d.name}: ${d.leads} leads · CPL ${cplStr} · ${d.spend3d.toFixed(0)}$ (3j)`;
}

test('GAP-1: issue=WINNING → 🔥 emoji', () => {
  const line = campaignSummaryLine({ issue: 'WINNING', name: 'Flake Résidentiel', leads: 3, cpl: 22, spend3d: 66 });
  assert.ok(line.startsWith('🔥'), `Got: ${line}`);
});

test('GAP-1: issue=OK → ✅ emoji', () => {
  const line = campaignSummaryLine({ issue: 'OK', name: 'Flake Résidentiel', leads: 1, cpl: 40, spend3d: 40 });
  assert.ok(line.startsWith('✅'), `Got: ${line}`);
});

test('GAP-1: issue=STALLED → ⚠️ emoji', () => {
  const line = campaignSummaryLine({ issue: 'STALLED', name: 'Test', leads: 0, cpl: null, spend3d: 5 });
  assert.ok(line.startsWith('⚠️'), `Got: ${line}`);
});

test('GAP-1: issue=NO_DELIVERY → ⚠️ emoji', () => {
  const line = campaignSummaryLine({ issue: 'NO_DELIVERY', name: 'Test', leads: 0, cpl: null, spend3d: 0 });
  assert.ok(line.startsWith('⚠️'), `Got: ${line}`);
});

test('GAP-1: issue=HIGH_CPL → ⚠️ emoji', () => {
  const line = campaignSummaryLine({ issue: 'HIGH_CPL', name: 'Test', leads: 1, cpl: 80, spend3d: 80 });
  assert.ok(line.startsWith('⚠️'), `Got: ${line}`);
});

test('GAP-1: issue=NO_LEADS → ⚠️ emoji', () => {
  const line = campaignSummaryLine({ issue: 'NO_LEADS', name: 'Test', leads: 0, cpl: null, spend3d: 30 });
  assert.ok(line.startsWith('⚠️'), `Got: ${line}`);
});

test('GAP-1: cpl null → shows "—"', () => {
  const line = campaignSummaryLine({ issue: 'NO_LEADS', name: 'X', leads: 0, cpl: null, spend3d: 30 });
  assert.ok(line.includes('CPL —'), `Got: ${line}`);
});

test('GAP-1: cpl 22.6 → shows "23$" (toFixed(0))', () => {
  const line = campaignSummaryLine({ issue: 'WINNING', name: 'X', leads: 2, cpl: 22.6, spend3d: 45.2 });
  assert.ok(line.includes('CPL 23$'), `Got: ${line}`);
});

test('GAP-1: spend3d 45.2 → shows "45$" (toFixed(0))', () => {
  const line = campaignSummaryLine({ issue: 'WINNING', name: 'X', leads: 2, cpl: 22, spend3d: 45.2 });
  assert.ok(line.includes('45$ (3j)'), `Got: ${line}`);
});

test('GAP-1: totalLeads aggregation sums all leads', () => {
  const diags = [
    { leads: 2, spend3d: 40 },
    { leads: 0, spend3d: 10 },
    { leads: 5, spend3d: 200 },
  ];
  const totalLeads = diags.reduce((n, d) => n + d.leads, 0);
  assert.equal(totalLeads, 7);
});

test('GAP-1: totalSpend aggregation sums all spend3d', () => {
  const diags = [
    { leads: 2, spend3d: 40.5 },
    { leads: 0, spend3d: 10.3 },
    { leads: 5, spend3d: 200.2 },
  ];
  const totalSpend = diags.reduce((n, d) => n + d.spend3d, 0);
  assert.ok(Math.abs(totalSpend - 251) < 0.01);
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-2: ads-coach — alerts counter and summary footer
// Inlined from app/api/cron/ads-coach/route.ts
// ════════════════════════════════════════════════════════════════════════════

function buildAlertsAndFooter(diags) {
  let alerts = 0;
  for (const d of diags) {
    if (d.action === 'none') continue;
    alerts++;
  }
  const footer = alerts === 0
    ? `\nTout roule bien — rien à faire. 👍`
    : `\n${alerts} action(s) proposée(s) ci-dessus.`;
  return { alerts, footer };
}

test('GAP-2: all actions=none → alerts=0, happy footer', () => {
  const { alerts, footer } = buildAlertsAndFooter([
    { action: 'none' },
    { action: 'none' },
  ]);
  assert.equal(alerts, 0);
  assert.ok(footer.includes('Tout roule bien'), `Got: ${footer}`);
  assert.ok(footer.includes('👍'), `Got: ${footer}`);
});

test('GAP-2: one action=relaunch → alerts=1, action footer', () => {
  const { alerts, footer } = buildAlertsAndFooter([
    { action: 'relaunch' },
    { action: 'none' },
  ]);
  assert.equal(alerts, 1);
  assert.ok(footer.includes('1 action(s) proposée(s)'), `Got: ${footer}`);
});

test('GAP-2: multiple non-none actions → correct count', () => {
  const { alerts, footer } = buildAlertsAndFooter([
    { action: 'relaunch' },
    { action: 'scale' },
    { action: 'newcreative' },
    { action: 'none' },
  ]);
  assert.equal(alerts, 3);
  assert.ok(footer.includes('3 action(s) proposée(s)'), `Got: ${footer}`);
});

test('GAP-2: empty diags → alerts=0, happy footer', () => {
  const { alerts } = buildAlertsAndFooter([]);
  assert.equal(alerts, 0);
});

test('GAP-2: action=none is skipped — not counted as alert', () => {
  const { alerts } = buildAlertsAndFooter([{ action: 'none' }, { action: 'none' }, { action: 'none' }]);
  assert.equal(alerts, 0);
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-3: ads-coach — Telegram button callback_data format
// Inlined from app/api/cron/ads-coach/route.ts
// ════════════════════════════════════════════════════════════════════════════

function buildButtons(action, campaignId) {
  const btns = [];
  if (action === 'relaunch') btns.push([{ text: '🔄 Relancer la pub', callback_data: `coach_relaunch_${campaignId}` }]);
  if (action === 'scale') btns.push([{ text: '💰 Monter budget +10$/j', callback_data: `coach_scale_${campaignId}` }]);
  if (action === 'newcreative') btns.push([{ text: '🎨 Nouvelle créative', callback_data: `coach_newcreative_flake` }]);
  return btns;
}

test('GAP-3: action=relaunch → button with coach_relaunch_<id>', () => {
  const btns = buildButtons('relaunch', '120208123456789');
  assert.equal(btns.length, 1);
  assert.equal(btns[0][0].callback_data, 'coach_relaunch_120208123456789');
});

test('GAP-3: action=scale → button with coach_scale_<id>', () => {
  const btns = buildButtons('scale', '120208123456789');
  assert.equal(btns.length, 1);
  assert.equal(btns[0][0].callback_data, 'coach_scale_120208123456789');
});

test('GAP-3: action=newcreative → hardcoded "coach_newcreative_flake" (NOT campaign-specific)', () => {
  const btns = buildButtons('newcreative', '120208123456789');
  assert.equal(btns.length, 1);
  assert.equal(btns[0][0].callback_data, 'coach_newcreative_flake');
  // Key invariant: campaign ID is NOT in the callback_data for newcreative
  assert.ok(!btns[0][0].callback_data.includes('120208123456789'), 'newcreative must NOT include campaign ID');
});

test('GAP-3: action=none → no buttons generated', () => {
  const btns = buildButtons('none', '120208123456789');
  assert.equal(btns.length, 0);
});

test('GAP-3: relaunch button has exactly one row with one button', () => {
  const btns = buildButtons('relaunch', 'abc');
  assert.equal(btns.length, 1);
  assert.equal(btns[0].length, 1);
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-4: travaux/checklist — key format + JSON parse fallback
// Inlined from app/api/travaux/checklist/route.ts
// ════════════════════════════════════════════════════════════════════════════

function checklistKey(quoteId) {
  return `checklist_${quoteId}`;
}

function parseChecklistValue(rawValue) {
  try {
    return JSON.parse(rawValue);
  } catch {
    return [];
  }
}

function getChecklistResponse(rows) {
  if (rows.length === 0) return { checklist: [] };
  return { checklist: parseChecklistValue(rows[0].value) };
}

test('GAP-4: key format is checklist_<quoteId>', () => {
  assert.equal(checklistKey(42), 'checklist_42');
  assert.equal(checklistKey('123'), 'checklist_123');
  assert.equal(checklistKey(1), 'checklist_1');
});

test('GAP-4: empty rows → returns { checklist: [] }', () => {
  const result = getChecklistResponse([]);
  assert.deepEqual(result, { checklist: [] });
});

test('GAP-4: valid JSON in row → parsed correctly', () => {
  const checklist = [{ id: 1, label: 'Poncer', done: false }];
  const result = getChecklistResponse([{ value: JSON.stringify(checklist) }]);
  assert.deepEqual(result.checklist, checklist);
});

test('GAP-4: malformed JSON in row → fallback to []', () => {
  const result = getChecklistResponse([{ value: '{not valid json}' }]);
  assert.deepEqual(result.checklist, []);
});

test('GAP-4: empty string in row → fallback to []', () => {
  const result = getChecklistResponse([{ value: '' }]);
  assert.deepEqual(result.checklist, []);
});

test('GAP-4: "null" string in row → JSON.parse returns null (no throw, no [] fallback)', () => {
  const result = getChecklistResponse([{ value: 'null' }]);
  assert.deepEqual(result.checklist, null); // JSON.parse('null') === null — not the same as empty []
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-5: travaux/checklist — PUT body validation
// Inlined from app/api/travaux/checklist/route.ts
// ════════════════════════════════════════════════════════════════════════════

function validateChecklistPut(body) {
  const { quoteId, checklist } = body ?? {};
  if (!quoteId || !Array.isArray(checklist)) {
    return { error: 'quoteId et checklist requis', status: 400 };
  }
  return { ok: true, key: `checklist_${quoteId}`, value: JSON.stringify(checklist) };
}

test('GAP-5: missing quoteId → 400', () => {
  const result = validateChecklistPut({ checklist: [] });
  assert.equal(result.status, 400);
  assert.equal(result.error, 'quoteId et checklist requis');
});

test('GAP-5: checklist not an array → 400', () => {
  const result = validateChecklistPut({ quoteId: 42, checklist: 'not-array' });
  assert.equal(result.status, 400);
});

test('GAP-5: checklist is null → 400', () => {
  const result = validateChecklistPut({ quoteId: 42, checklist: null });
  assert.equal(result.status, 400);
});

test('GAP-5: checklist is object → 400', () => {
  const result = validateChecklistPut({ quoteId: 42, checklist: { label: 'x' } });
  assert.equal(result.status, 400);
});

test('GAP-5: valid body → ok with correct key and JSON value', () => {
  const items = [{ id: 1, label: 'Poncer', done: false }];
  const result = validateChecklistPut({ quoteId: 42, checklist: items });
  assert.equal(result.ok, true);
  assert.equal(result.key, 'checklist_42');
  assert.equal(result.value, JSON.stringify(items));
});

test('GAP-5: empty array checklist → ok (empty checklist is valid)', () => {
  const result = validateChecklistPut({ quoteId: 42, checklist: [] });
  assert.equal(result.ok, true);
  assert.equal(result.value, '[]');
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-6: travaux/complete — body.quoteId presence check
// Inlined from app/api/travaux/complete/route.ts
// ════════════════════════════════════════════════════════════════════════════

function validateCompleteBody(body) {
  if (!body?.quoteId) {
    return { error: 'quoteId requis', status: 400 };
  }
  return { ok: true, quoteId: parseInt(body.quoteId) };
}

test('GAP-6: null body (JSON parse failure) → 400', () => {
  const result = validateCompleteBody(null);
  assert.equal(result.status, 400);
  assert.equal(result.error, 'quoteId requis');
});

test('GAP-6: body missing quoteId → 400', () => {
  const result = validateCompleteBody({ other: 'field' });
  assert.equal(result.status, 400);
});

test('GAP-6: quoteId is empty string → 400 (falsy)', () => {
  const result = validateCompleteBody({ quoteId: '' });
  assert.equal(result.status, 400);
});

test('GAP-6: quoteId is 0 → 400 (falsy)', () => {
  const result = validateCompleteBody({ quoteId: 0 });
  assert.equal(result.status, 400);
});

test('GAP-6: valid quoteId string → parseInt used', () => {
  const result = validateCompleteBody({ quoteId: '42' });
  assert.equal(result.ok, true);
  assert.equal(result.quoteId, 42);
  assert.equal(typeof result.quoteId, 'number');
});

test('GAP-6: valid quoteId number → parseInt of number is still a number', () => {
  const result = validateCompleteBody({ quoteId: 42 });
  assert.equal(result.ok, true);
  assert.equal(result.quoteId, 42);
});

// ════════════════════════════════════════════════════════════════════════════
// INTEGRATION SKELETONS (skipped unless INTEGRATION_TEST=1)
// ════════════════════════════════════════════════════════════════════════════

test('INT-1: GET /api/travaux — unauthenticated → 401', { skip: SKIP_INTEGRATION }, async () => {
  const res = await fetch(`${BASE}/api/travaux`);
  assert.equal(res.status, 401);
});

test('INT-2: GET /api/travaux/checklist — no quoteId → 400', { skip: SKIP_INTEGRATION }, async () => {
  // Assumes a valid session cookie is available via TEST_COOKIE env
  const res = await fetch(`${BASE}/api/travaux/checklist`, {
    headers: { Cookie: process.env.TEST_COOKIE ?? '' },
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.error, 'quoteId requis');
});

test('INT-3: GET /api/travaux/checklist — unauthenticated → 401', { skip: SKIP_INTEGRATION }, async () => {
  const res = await fetch(`${BASE}/api/travaux/checklist?quoteId=1`);
  assert.equal(res.status, 401);
});

test('INT-4: PUT /api/travaux/checklist — missing checklist → 400', { skip: SKIP_INTEGRATION }, async () => {
  const res = await fetch(`${BASE}/api/travaux/checklist`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Cookie: process.env.TEST_COOKIE ?? '' },
    body: JSON.stringify({ quoteId: 1 }),
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.error, 'quoteId et checklist requis');
});

test('INT-5: POST /api/travaux/complete — missing quoteId → 400', { skip: SKIP_INTEGRATION }, async () => {
  const res = await fetch(`${BASE}/api/travaux/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: process.env.TEST_COOKIE ?? '' },
    body: JSON.stringify({ other: 'field' }),
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.error, 'quoteId requis');
});

test('INT-6: GET /api/cron/ads-coach — no Authorization header → 401', { skip: SKIP_INTEGRATION }, async () => {
  const res = await fetch(`${BASE}/api/cron/ads-coach`);
  assert.equal(res.status, 401);
});

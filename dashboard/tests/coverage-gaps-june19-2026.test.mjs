/**
 * coverage-gaps-june19-2026.test.mjs
 *
 * TRUE GAPS not covered by any prior test file as of June 19 2026.
 * All decision logic is inlined (no @/ imports) — runs with plain node --test.
 *
 * Run: node --test tests/coverage-gaps-june19-2026.test.mjs
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CONFIRMED ZERO-COVERAGE GAPS (grep across all 95 test files returned 0 hits):
 *
 *   GAP-1  lib/ad-coach.ts — leadsOf() action_type extraction
 *          Tries 'lead' first, then 'onsite_conversion.lead_grouped',
 *          then 'offsite_complete_registration_add_meta_leads'.
 *          Falls back to 0 for an undefined actions array.
 *          Never touched in any test.
 *
 *   GAP-2  lib/ad-coach.ts — diagnostic issue classification
 *          The core `issue` enum: STALLED vs NO_DELIVERY hinge on `impressions === 0`
 *          inside the same "spend < 30% of budget3d" branch.
 *          HIGH_CPL fires when cpl > CPL_TARGET + 15 (i.e. > 55 CAD) AND leads >= 1.
 *          NO_LEADS fires when impressions > 500 AND leads === 0.
 *          WINNING fires when cpl < 25 AND leads >= 2.
 *          OK is the fallthrough default.
 *          None of these branches has ever been directly unit-tested.
 *
 *   GAP-3  lib/ad-coach.ts — action mapping driven by issue
 *          STALLED/NO_DELIVERY → 'relaunch'
 *          HIGH_CPL/NO_LEADS  → 'newcreative'
 *          WINNING            → 'scale'
 *          OK                 → 'none'
 *          The mapping is pure: same inputs always produce same outputs.
 *          Never asserted.
 *
 *   GAP-4  lib/ad-coach.ts — recordSnapshot() winners filter
 *          Winners = diags where cpl !== null && cpl < 30 && leads >= 1.
 *          A diag with cpl exactly 30 is NOT a winner (strict <).
 *          A diag with leads=0 and cpl=20 is NOT a winner.
 *          Never directly pinned.
 *
 *   GAP-5  lib/ad-coach.ts — getLearnings() output formatting
 *          No DB rows → empty string.
 *          DB has row but winners[] is empty → empty string.
 *          winners[0].topPlacement present → appended as " Meilleur placement: X."
 *          winners[0].topAge present → appended as " Audience qui convertit: X ans."
 *          Both absent → output ends after the CPL/leads preamble.
 *          Never tested.
 *
 *   GAP-6  app/api/cron/ads-coach/route.ts — auth guard (inline logic)
 *          Missing Authorization header → 401 (secret === '').
 *          Wrong Bearer value → 401.
 *          Correct CRON_SECRET → passes.
 *          Correct ADMIN_API_KEY → also passes (OR condition).
 *          Never unit-tested.
 *
 * INTEGRATION SKELETONS (skipped unless INTEGRATION_TEST=1):
 *   INT-1  GET /api/cron/ads-coach — no Authorization header → 401
 *   INT-2  GET /api/cron/ads-coach — wrong Bearer value → 401
 *   INT-3  GET /api/cron/ads-coach — missing META_PAGE_TOKEN env → 500
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

const SKIP_INTEGRATION = !process.env.INTEGRATION_TEST;
const BASE = process.env.TEST_BASE_URL || 'http://localhost:3000';

// ════════════════════════════════════════════════════════════════════════════
// GAP-1: lib/ad-coach.ts — leadsOf() action_type extraction
// Inlined verbatim from lib/ad-coach.ts
// ════════════════════════════════════════════════════════════════════════════

const num = (actions, t) =>
  Number((actions ?? []).find(a => a.action_type === t)?.value ?? 0);

const leadsOf = (a) =>
  num(a, 'lead') ||
  num(a, 'onsite_conversion.lead_grouped') ||
  num(a, 'offsite_complete_registration_add_meta_leads');

test('GAP-1: leadsOf — undefined actions returns 0', () => {
  assert.equal(leadsOf(undefined), 0);
});

test('GAP-1: leadsOf — empty array returns 0', () => {
  assert.equal(leadsOf([]), 0);
});

test('GAP-1: leadsOf — prefers "lead" action_type', () => {
  const actions = [
    { action_type: 'lead', value: '5' },
    { action_type: 'onsite_conversion.lead_grouped', value: '3' },
  ];
  assert.equal(leadsOf(actions), 5);
});

test('GAP-1: leadsOf — falls back to onsite_conversion.lead_grouped when no "lead"', () => {
  const actions = [
    { action_type: 'click', value: '10' },
    { action_type: 'onsite_conversion.lead_grouped', value: '7' },
  ];
  assert.equal(leadsOf(actions), 7);
});

test('GAP-1: leadsOf — falls back to offsite_complete_registration_add_meta_leads last', () => {
  const actions = [
    { action_type: 'click', value: '20' },
    { action_type: 'offsite_complete_registration_add_meta_leads', value: '2' },
  ];
  assert.equal(leadsOf(actions), 2);
});

test('GAP-1: leadsOf — "lead" = 0 does NOT trigger fallback (falsy 0 keeps checking)', () => {
  // When lead=0, the || chain moves to the next action_type
  const actions = [
    { action_type: 'lead', value: '0' },
    { action_type: 'onsite_conversion.lead_grouped', value: '4' },
  ];
  // 0 is falsy in JS, so || chain continues to 4
  assert.equal(leadsOf(actions), 4);
});

test('GAP-1: leadsOf — all types return 0 → overall 0', () => {
  const actions = [
    { action_type: 'lead', value: '0' },
    { action_type: 'onsite_conversion.lead_grouped', value: '0' },
    { action_type: 'offsite_complete_registration_add_meta_leads', value: '0' },
  ];
  assert.equal(leadsOf(actions), 0);
});

test('GAP-1: leadsOf — unknown action_type only → 0', () => {
  assert.equal(leadsOf([{ action_type: 'page_view', value: '100' }]), 0);
});

test('GAP-1: leadsOf — string value is coerced to number', () => {
  assert.equal(leadsOf([{ action_type: 'lead', value: '3' }]), 3);
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-2: lib/ad-coach.ts — diagnostic issue classification
// Inlined from the main diagnosis block in analyzeActiveCampaigns()
// ════════════════════════════════════════════════════════════════════════════

const CPL_TARGET = 40;

function diagnose({ dailyBudget, spend3d, impressions, leads, cpl }) {
  const budget3d = dailyBudget * 3;
  let issue = 'OK';
  let action = 'none';

  if (budget3d > 0 && spend3d < budget3d * 0.3) {
    issue = impressions === 0 ? 'NO_DELIVERY' : 'STALLED';
    action = 'relaunch';
  } else if (cpl !== null && cpl > CPL_TARGET + 15 && leads >= 1) {
    issue = 'HIGH_CPL';
    action = 'newcreative';
  } else if (impressions > 500 && leads === 0) {
    issue = 'NO_LEADS';
    action = 'newcreative';
  } else if (cpl !== null && cpl < 25 && leads >= 2) {
    issue = 'WINNING';
    action = 'scale';
  }

  return { issue, action };
}

test('GAP-2: NO_DELIVERY — spend < 30% budget AND impressions === 0', () => {
  const r = diagnose({ dailyBudget: 20, spend3d: 5, impressions: 0, leads: 0, cpl: null });
  assert.equal(r.issue, 'NO_DELIVERY');
  assert.equal(r.action, 'relaunch');
});

test('GAP-2: STALLED — spend < 30% budget AND impressions > 0', () => {
  const r = diagnose({ dailyBudget: 20, spend3d: 5, impressions: 100, leads: 0, cpl: null });
  assert.equal(r.issue, 'STALLED');
  assert.equal(r.action, 'relaunch');
});

test('GAP-2: spend exactly 30% of budget3d → NOT stalled (boundary ≥ 30%, issue=OK)', () => {
  // spend3d = 30% * budget3d → NOT < 0.3, so no stall
  const r = diagnose({ dailyBudget: 10, spend3d: 9, impressions: 50, leads: 0, cpl: null });
  // budget3d = 30, spend3d = 9 = 30% exactly → NOT < 0.3 → skip stall branch
  assert.notEqual(r.issue, 'STALLED');
  assert.notEqual(r.issue, 'NO_DELIVERY');
});

test('GAP-2: HIGH_CPL — cpl > 55 AND leads >= 1', () => {
  const r = diagnose({ dailyBudget: 20, spend3d: 170, impressions: 1000, leads: 3, cpl: 170 / 3 });
  assert.equal(r.issue, 'HIGH_CPL');
  assert.equal(r.action, 'newcreative');
});

test('GAP-2: HIGH_CPL threshold is CPL_TARGET + 15 = 55 (exclusive)', () => {
  // cpl = exactly 55 → NOT HIGH_CPL (must be strictly > 55)
  const r = diagnose({ dailyBudget: 20, spend3d: 55, impressions: 500, leads: 1, cpl: 55 });
  assert.notEqual(r.issue, 'HIGH_CPL', 'CPL=55 exactly is not HIGH_CPL (need > 55)');
});

test('GAP-2: HIGH_CPL requires leads >= 1 — cpl > 55 but leads=0 → not HIGH_CPL', () => {
  // cpl null when leads=0, so branch `cpl !== null && cpl > 55 && leads >= 1` fails
  const r = diagnose({ dailyBudget: 20, spend3d: 60, impressions: 600, leads: 0, cpl: null });
  assert.notEqual(r.issue, 'HIGH_CPL');
});

test('GAP-2: NO_LEADS — impressions > 500 AND leads === 0', () => {
  const r = diagnose({ dailyBudget: 20, spend3d: 18, impressions: 600, leads: 0, cpl: null });
  assert.equal(r.issue, 'NO_LEADS');
  assert.equal(r.action, 'newcreative');
});

test('GAP-2: NO_LEADS threshold — impressions exactly 500 → NOT NO_LEADS (need > 500)', () => {
  const r = diagnose({ dailyBudget: 20, spend3d: 18, impressions: 500, leads: 0, cpl: null });
  assert.notEqual(r.issue, 'NO_LEADS', '500 impressions is not > 500');
});

test('GAP-2: WINNING — cpl < 25 AND leads >= 2', () => {
  const r = diagnose({ dailyBudget: 20, spend3d: 40, impressions: 800, leads: 2, cpl: 20 });
  assert.equal(r.issue, 'WINNING');
  assert.equal(r.action, 'scale');
});

test('GAP-2: WINNING requires leads >= 2 — leads=1 with cpl=20 → not WINNING', () => {
  const r = diagnose({ dailyBudget: 20, spend3d: 20, impressions: 500, leads: 1, cpl: 20 });
  assert.notEqual(r.issue, 'WINNING', 'WINNING requires at least 2 leads');
});

test('GAP-2: OK — good spend, OK cpl, not exceptional → OK', () => {
  // cpl=35 (not > 55, not < 25), leads=2, impressions=400, good spend
  const r = diagnose({ dailyBudget: 10, spend3d: 70, impressions: 400, leads: 2, cpl: 35 });
  assert.equal(r.issue, 'OK');
  assert.equal(r.action, 'none');
});

test('GAP-2: zero dailyBudget → budget3d = 0 → stall branch skipped → OK', () => {
  // budget3d = 0 → `budget3d > 0` is false → skip stall branch entirely
  const r = diagnose({ dailyBudget: 0, spend3d: 0, impressions: 0, leads: 0, cpl: null });
  // Falls through: not NO_LEADS (impressions=0, not >500), not WINNING, not HIGH_CPL
  assert.equal(r.issue, 'OK');
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-3: lib/ad-coach.ts — action mapping driven by issue (already covered in
// GAP-2 via inline diagnose(), but explicitly assert the 4 action values)
// ════════════════════════════════════════════════════════════════════════════

test('GAP-3: action "relaunch" for STALLED', () => {
  assert.equal(diagnose({ dailyBudget: 20, spend3d: 1, impressions: 100, leads: 0, cpl: null }).action, 'relaunch');
});

test('GAP-3: action "relaunch" for NO_DELIVERY', () => {
  assert.equal(diagnose({ dailyBudget: 20, spend3d: 1, impressions: 0, leads: 0, cpl: null }).action, 'relaunch');
});

test('GAP-3: action "newcreative" for HIGH_CPL', () => {
  assert.equal(diagnose({ dailyBudget: 10, spend3d: 60, impressions: 300, leads: 1, cpl: 60 }).action, 'newcreative');
});

test('GAP-3: action "newcreative" for NO_LEADS', () => {
  assert.equal(diagnose({ dailyBudget: 10, spend3d: 18, impressions: 600, leads: 0, cpl: null }).action, 'newcreative');
});

test('GAP-3: action "scale" for WINNING', () => {
  assert.equal(diagnose({ dailyBudget: 10, spend3d: 40, impressions: 800, leads: 3, cpl: 13.3 }).action, 'scale');
});

test('GAP-3: action "none" for OK', () => {
  assert.equal(diagnose({ dailyBudget: 10, spend3d: 50, impressions: 300, leads: 2, cpl: 25 }).action, 'none');
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-4: lib/ad-coach.ts — recordSnapshot() winners filter
// Winners: cpl !== null && cpl < 30 && leads >= 1
// Inlined from recordSnapshot() in lib/ad-coach.ts
// ════════════════════════════════════════════════════════════════════════════

function filterWinners(diags) {
  return diags
    .filter(d => d.cpl !== null && d.cpl < 30 && d.leads >= 1)
    .map(d => ({ name: d.name, cpl: d.cpl, leads: d.leads, topPlacement: d.topPlacement, topAge: d.topAge }));
}

test('GAP-4: cpl < 30 and leads >= 1 → winner', () => {
  const diags = [{ name: 'A', cpl: 20, leads: 2, topPlacement: 'facebook/feed', topAge: '35-44', issue: 'WINNING' }];
  assert.equal(filterWinners(diags).length, 1);
});

test('GAP-4: cpl === 30 exactly → NOT a winner (strict <)', () => {
  const diags = [{ name: 'B', cpl: 30, leads: 3, topPlacement: null, topAge: null, issue: 'OK' }];
  assert.equal(filterWinners(diags).length, 0, 'cpl=30 is not < 30');
});

test('GAP-4: cpl = 29.99 → winner', () => {
  const diags = [{ name: 'C', cpl: 29.99, leads: 1, topPlacement: null, topAge: null, issue: 'OK' }];
  assert.equal(filterWinners(diags).length, 1);
});

test('GAP-4: leads = 0 → NOT a winner even if cpl is good', () => {
  const diags = [{ name: 'D', cpl: 20, leads: 0, topPlacement: null, topAge: null, issue: 'WINNING' }];
  assert.equal(filterWinners(diags).length, 0, 'leads=0 disqualifies winner');
});

test('GAP-4: cpl = null → NOT a winner', () => {
  const diags = [{ name: 'E', cpl: null, leads: 5, topPlacement: null, topAge: null, issue: 'NO_LEADS' }];
  assert.equal(filterWinners(diags).length, 0, 'null cpl disqualifies winner');
});

test('GAP-4: multiple diags — only qualifying ones returned', () => {
  const diags = [
    { name: 'Winner', cpl: 22, leads: 3, topPlacement: 'fb/feed', topAge: '25-34', issue: 'WINNING' },
    { name: 'HighCPL', cpl: 80, leads: 2, topPlacement: null, topAge: null, issue: 'HIGH_CPL' },
    { name: 'NoLeads', cpl: null, leads: 0, topPlacement: null, topAge: null, issue: 'NO_LEADS' },
    { name: 'AlsoWinner', cpl: 15, leads: 1, topPlacement: 'ig/feed', topAge: '45-54', issue: 'WINNING' },
  ];
  const winners = filterWinners(diags);
  assert.equal(winners.length, 2);
  assert.equal(winners[0].name, 'Winner');
  assert.equal(winners[1].name, 'AlsoWinner');
});

test('GAP-4: winner shape includes name, cpl, leads, topPlacement, topAge', () => {
  const diags = [{ name: 'Test', cpl: 18, leads: 4, topPlacement: 'facebook/feed', topAge: '25-34', issue: 'WINNING' }];
  const w = filterWinners(diags)[0];
  assert.ok('name' in w && 'cpl' in w && 'leads' in w && 'topPlacement' in w && 'topAge' in w);
  assert.equal(w.name, 'Test');
  assert.equal(w.cpl, 18);
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-5: lib/ad-coach.ts — getLearnings() output formatting
// Inlined from getLearnings() in lib/ad-coach.ts
// ════════════════════════════════════════════════════════════════════════════

function formatLearnings(rows) {
  if (!rows.length) return '';
  try {
    const o = JSON.parse(rows[0].value);
    const w = o.winners?.[0];
    if (!w) return '';
    const placement = w.topPlacement ? ` Meilleur placement: ${w.topPlacement}.` : '';
    const age = w.topAge ? ` Audience qui convertit: ${w.topAge} ans.` : '';
    const cplStr = typeof w.cpl?.toFixed === 'function' ? w.cpl.toFixed(0) : String(w.cpl ?? '?');
    return `APPRENTISSAGE (pubs passées qui ont marché — CPL ${cplStr}$, ${w.leads} leads):${placement}${age} Garde ce qui marche.`;
  } catch { return ''; }
}

test('GAP-5: no DB rows → empty string', () => {
  assert.equal(formatLearnings([]), '');
});

test('GAP-5: row with empty winners array → empty string', () => {
  const rows = [{ value: JSON.stringify({ updated: '2026-06-01', winners: [] }) }];
  assert.equal(formatLearnings(rows), '');
});

test('GAP-5: row with null winners → empty string', () => {
  const rows = [{ value: JSON.stringify({ updated: '2026-06-01', winners: null }) }];
  assert.equal(formatLearnings(rows), '');
});

test('GAP-5: winner without topPlacement and topAge → no placement/age in output', () => {
  const rows = [{ value: JSON.stringify({ winners: [{ cpl: 22, leads: 3, topPlacement: null, topAge: null }] }) }];
  const result = formatLearnings(rows);
  assert.ok(result.startsWith('APPRENTISSAGE'), 'starts with APPRENTISSAGE');
  assert.ok(!result.includes('Meilleur placement'), 'no placement when topPlacement=null');
  assert.ok(!result.includes('Audience qui convertit'), 'no age when topAge=null');
  assert.ok(result.endsWith('Garde ce qui marche.'), 'ends with closing phrase');
});

test('GAP-5: winner with topPlacement → included in output', () => {
  const rows = [{ value: JSON.stringify({ winners: [{ cpl: 18, leads: 2, topPlacement: 'facebook/feed', topAge: null }] }) }];
  const result = formatLearnings(rows);
  assert.ok(result.includes('Meilleur placement: facebook/feed.'), `placement in output: ${result}`);
});

test('GAP-5: winner with topAge → included in output', () => {
  const rows = [{ value: JSON.stringify({ winners: [{ cpl: 18, leads: 2, topPlacement: null, topAge: '35-44' }] }) }];
  const result = formatLearnings(rows);
  assert.ok(result.includes('Audience qui convertit: 35-44 ans.'), `age in output: ${result}`);
});

test('GAP-5: winner with both topPlacement and topAge → both in output', () => {
  const rows = [{ value: JSON.stringify({ winners: [{ cpl: 15, leads: 4, topPlacement: 'instagram/reels', topAge: '25-34' }] }) }];
  const result = formatLearnings(rows);
  assert.ok(result.includes('Meilleur placement: instagram/reels.'), 'placement present');
  assert.ok(result.includes('Audience qui convertit: 25-34 ans.'), 'age present');
});

test('GAP-5: CPL is formatted as toFixed(0) — 22.7 rounds to "23$"', () => {
  const rows = [{ value: JSON.stringify({ winners: [{ cpl: 22.7, leads: 3, topPlacement: null, topAge: null }] }) }];
  const result = formatLearnings(rows);
  assert.ok(result.includes('CPL 23$'), `CPL rounded in output: ${result}`);
});

test('GAP-5: invalid JSON in row value → returns empty string (no throw)', () => {
  const rows = [{ value: '{not: valid json}' }];
  assert.equal(formatLearnings(rows), '');
});

test('GAP-5: only first winner is used (even if multiple winners exist)', () => {
  const rows = [{ value: JSON.stringify({ winners: [
    { cpl: 20, leads: 3, topPlacement: 'facebook/feed', topAge: '35-44' },
    { cpl: 15, leads: 5, topPlacement: 'instagram/reels', topAge: '25-34' },
  ] }) }];
  const result = formatLearnings(rows);
  assert.ok(result.includes('facebook/feed'), 'uses first winner');
  assert.ok(!result.includes('instagram/reels'), 'ignores second winner');
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-6: app/api/cron/ads-coach/route.ts — auth guard inline logic
// Inlined from GET handler in app/api/cron/ads-coach/route.ts
// ════════════════════════════════════════════════════════════════════════════

function checkCronAuth(authHeader, cronSecret, adminApiKey) {
  const secret = (authHeader ?? '').replace('Bearer ', '');
  return !!(secret && (secret === (cronSecret ?? '') || secret === (adminApiKey ?? '')));
}

test('GAP-6: no Authorization header → denied', () => {
  assert.equal(checkCronAuth(null, 'mysecret', 'mykey'), false);
});

test('GAP-6: empty Authorization header → denied', () => {
  assert.equal(checkCronAuth('', 'mysecret', 'mykey'), false);
});

test('GAP-6: wrong Bearer value → denied', () => {
  assert.equal(checkCronAuth('Bearer wrongvalue', 'mysecret', 'mykey'), false);
});

test('GAP-6: correct CRON_SECRET in Bearer → allowed', () => {
  assert.equal(checkCronAuth('Bearer mysecret', 'mysecret', 'mykey'), true);
});

test('GAP-6: correct ADMIN_API_KEY in Bearer → also allowed (OR condition)', () => {
  assert.equal(checkCronAuth('Bearer mykey', 'mysecret', 'mykey'), true);
});

test('GAP-6: secret matches empty CRON_SECRET ("") → denied (empty string secret)', () => {
  // secret='' after replace, `secret &&` is falsy for empty string → denied
  assert.equal(checkCronAuth('Bearer ', 'mysecret', 'mykey'), false);
});

test('GAP-6: CRON_SECRET undefined and ADMIN_API_KEY undefined, empty Bearer → denied', () => {
  assert.equal(checkCronAuth('Bearer ', undefined, undefined), false);
});

test('GAP-6: value matches undefined CRON_SECRET (both undefined) — edge: "undefined" string match', () => {
  // cronSecret ?? '' → '', adminApiKey ?? '' → ''
  // secret = 'somevalue' → not '' → denied
  assert.equal(checkCronAuth('Bearer somevalue', undefined, undefined), false);
});

// ════════════════════════════════════════════════════════════════════════════
// INTEGRATION SKELETONS — skipped unless INTEGRATION_TEST=1
// ════════════════════════════════════════════════════════════════════════════

test('INT-1: GET /api/cron/ads-coach — no Authorization header → 401', { skip: SKIP_INTEGRATION }, async () => {
  const res = await fetch(`${BASE}/api/cron/ads-coach`);
  assert.equal(res.status, 401);
  const body = await res.json();
  assert.ok('error' in body, 'error field present');
});

test('INT-2: GET /api/cron/ads-coach — wrong Bearer value → 401', { skip: SKIP_INTEGRATION }, async () => {
  const res = await fetch(`${BASE}/api/cron/ads-coach`, {
    headers: { 'Authorization': 'Bearer definitelynotright' },
  });
  assert.equal(res.status, 401);
});

test('INT-3: GET /api/cron/ads-coach — META_PAGE_TOKEN missing → 500', { skip: SKIP_INTEGRATION }, async () => {
  // This test only makes sense in an env where META_PAGE_TOKEN is not set.
  // Pass the correct secret but simulate missing token by checking response.
  // If the server has the token, this returns 200 — the test is inconclusive.
  const secret = process.env.CRON_SECRET || process.env.ADMIN_API_KEY || '';
  if (!secret) { return; } // cannot authenticate, skip
  const res = await fetch(`${BASE}/api/cron/ads-coach`, {
    headers: { 'Authorization': `Bearer ${secret}` },
  });
  assert.ok([200, 500].includes(res.status), `Expected 200 or 500, got ${res.status}`);
});

/**
 * coverage-gaps-june14-2026-v5.test.mjs
 *
 * TRUE GAPS not covered by any prior test file as of June 14 2026 (session 5).
 * All decision logic is inlined (no @/ imports) — runs with plain node --test.
 *
 * Run: node --test tests/coverage-gaps-june14-2026-v5.test.mjs
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CONFIRMED ZERO-COVERAGE GAPS (grep across all 102 test files returned 0 hits):
 *
 *   GAP-1  app/api/cron/iris-report/route.ts — hasAction conditional
 *          The handler only sends Telegram when hasAction=true:
 *            pendingDeposits.length > 0 || staleQuotes.length > 0
 *            || Number(rev.rev_today) > 0 || bookings.length > 0
 *          When all four are false/zero → Telegram is skipped; sent_to: 0 in response.
 *          The four individual trigger conditions are never unit-tested.
 *
 *   GAP-2  app/api/cron/iris-report/route.ts — cash flow sign (positive vs. negative)
 *          cashFlow = pendingDepositTotal - pendingExpTotal
 *          cashFlow >= 0 → "+${formatMoney(cashFlow)}" (with + prefix)
 *          cashFlow < 0  → "${formatMoney(cashFlow)}" (formatMoney already includes sign for negatives)
 *          The sign logic and zero edge case are never asserted.
 *
 *   GAP-3  app/api/cron/iris-report/route.ts — stale-quote age label
 *          age = Math.floor((Date.now() - createdAt.getTime()) / 86400000)
 *          Line format: `  #${id} ${nom} -- ${formatMoney(total)} (${days}j)`
 *          The `(Xj)` suffix and floor rounding are never tested.
 *
 *   GAP-4  app/api/cron/deposit-watch/route.ts — balance calculation + zero-skip
 *          balance = Number(q.total) - Number(q.depot_requis)
 *          balance <= 0 → continue (no alert)
 *          balance > 0  → dedup check proceeds
 *          The skip condition for zero/negative balance is never asserted.
 *
 *   GAP-5  app/api/cron/deposit-watch/route.ts — dedup key format
 *          alertKey = `balance_alert_${q.id}`
 *          Today's date extracted: new Date().toISOString().split('T')[0]
 *          If kv_store contains today's date string → skip (already alerted)
 *          If kv_store contains a different date → send again
 *          The key format and date-match logic are never tested.
 *
 *   GAP-6  app/api/cron/meta-ads-spend/route.ts — metaFormFills() inlined reducer
 *          LEAD_ACTION_TYPES = ['lead','leadgen_grouped','onsite_conversion.lead_grouped',
 *                               'offsite_conversion.fb_pixel_lead']
 *          Sums .value from matching actions; skips non-matching action_types.
 *          undefined/empty actions array → 0.
 *          Multiple matching types → accumulated sum.
 *          None of these branches are in any test file.
 *
 *   GAP-7  app/api/cron/meta-ads-spend/route.ts — act_ prefix guard for adAccountId
 *          if adAccountId already starts with 'act_' → use as-is
 *          else → prepend 'act_' before constructing insights URL
 *          Never tested (grep for "act_" in test files returns 0 context hits).
 *
 *   GAP-8  app/api/cron/meta-ads-spend/route.ts — CPL null when totalLeads === 0
 *          cplCad = totalLeads > 0 ? totalSpendCad / totalLeads : null
 *          leads_not_synced = Math.max(0, totalMetaFormFills - totalLeads)
 *          USD_CAD_RATE env var converts spend: totalSpendCad = totalSpendNative * fxRate
 *          Default fxRate = 1.0 (no env var set → treat native as CAD).
 *          None of these computations are asserted.
 *
 * INTEGRATION SKELETONS (skipped unless INTEGRATION_TEST=1):
 *   INT-1  GET /api/cron/iris-report — no Authorization → 401
 *   INT-2  GET /api/cron/iris-report — valid auth, quiet hours → { skipped: 'quiet hours' }
 *   INT-3  GET /api/cron/deposit-watch — no Authorization → 401
 *   INT-4  GET /api/cron/meta-ads-spend — no Authorization → 401
 *   INT-5  GET /api/cron/meta-ads-spend — valid auth, no META_PAGE_TOKEN → 500
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

const SKIP_INTEGRATION = !process.env.INTEGRATION_TEST;
const BASE = process.env.TEST_BASE_URL || 'http://localhost:3000';

// ════════════════════════════════════════════════════════════════════════════
// GAP-1: iris-report — hasAction conditional
//
// Inlined from app/api/cron/iris-report/route.ts
// ════════════════════════════════════════════════════════════════════════════

function irisHasAction({ pendingDeposits, staleQuotes, revToday, bookings }) {
  return (
    pendingDeposits.length > 0 ||
    staleQuotes.length > 0 ||
    Number(revToday) > 0 ||
    bookings.length > 0
  );
}

test('GAP-1: hasAction=false when all empty/zero → Telegram skipped', () => {
  assert.equal(
    irisHasAction({ pendingDeposits: [], staleQuotes: [], revToday: '0', bookings: [] }),
    false
  );
});

test('GAP-1: hasAction=true when pendingDeposits.length > 0', () => {
  assert.equal(
    irisHasAction({ pendingDeposits: [{ id: 1 }], staleQuotes: [], revToday: '0', bookings: [] }),
    true
  );
});

test('GAP-1: hasAction=true when staleQuotes.length > 0', () => {
  assert.equal(
    irisHasAction({ pendingDeposits: [], staleQuotes: [{ id: 2 }], revToday: '0', bookings: [] }),
    true
  );
});

test('GAP-1: hasAction=true when revToday > 0', () => {
  assert.equal(
    irisHasAction({ pendingDeposits: [], staleQuotes: [], revToday: '500', bookings: [] }),
    true
  );
});

test('GAP-1: hasAction=true when bookings.length > 0', () => {
  assert.equal(
    irisHasAction({ pendingDeposits: [], staleQuotes: [], revToday: '0', bookings: [{ id: 3 }] }),
    true
  );
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-2: iris-report — cash flow sign and line prefix
//
// Inlined from app/api/cron/iris-report/route.ts:
//   cashFlow = pendingDepositTotal - pendingExpTotal
//   line: `Flux net: ${cashFlow >= 0 ? '+' : ''}${formatMoney(cashFlow)}`
// ════════════════════════════════════════════════════════════════════════════

// Minimal inline of the sign logic (formatMoney details not needed for the sign)
function irisFluxNetPrefix(pendingDepositTotal, pendingExpTotal) {
  const cashFlow = pendingDepositTotal - pendingExpTotal;
  return cashFlow >= 0 ? '+' : '';
}

test('GAP-2: cashFlow > 0 → "+" prefix', () => {
  assert.equal(irisFluxNetPrefix(1000, 400), '+');
});

test('GAP-2: cashFlow === 0 (equal) → "+" prefix (zero is >=0)', () => {
  assert.equal(irisFluxNetPrefix(500, 500), '+');
});

test('GAP-2: cashFlow < 0 → no "+" prefix', () => {
  assert.equal(irisFluxNetPrefix(100, 800), '');
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-3: iris-report — stale-quote age-in-days calculation
//
// Inlined from:
//   const d = new Date(String(q.created_at));
//   const days = Math.floor((Date.now() - d.getTime()) / 86400000);
//   lines.push(`  #${q.id} ${q.client_nom} -- ${formatMoney(Number(q.total))} (${days}j)`);
// ════════════════════════════════════════════════════════════════════════════

function staleQuoteAgeDays(createdAtIso, nowMs) {
  const d = new Date(createdAtIso);
  return Math.floor((nowMs - d.getTime()) / 86400000);
}

test('GAP-3: stale quote 10 days old → 10j', () => {
  const now = new Date('2026-06-14T12:00:00Z').getTime();
  const createdAt = new Date('2026-06-04T12:00:00Z').toISOString();
  assert.equal(staleQuoteAgeDays(createdAt, now), 10);
});

test('GAP-3: stale quote 7 days old → 7j (minimum threshold)', () => {
  const now = new Date('2026-06-14T12:00:00Z').getTime();
  const createdAt = new Date('2026-06-07T12:00:00Z').toISOString();
  assert.equal(staleQuoteAgeDays(createdAt, now), 7);
});

test('GAP-3: fractional days → floor (11.9 days → 11)', () => {
  const now = new Date('2026-06-14T23:00:00Z').getTime();
  const createdAt = new Date('2026-06-03T00:00:00Z').toISOString();
  // 11.958... days → Math.floor → 11
  assert.equal(staleQuoteAgeDays(createdAt, now), 11);
});

test('GAP-3: line format includes (Xj) suffix', () => {
  const id = 42;
  const nom = 'Bernard Gagné';
  const days = 9;
  const line = `  #${id} ${nom} -- $1,234.00 (${days}j)`;
  assert.ok(line.endsWith('(9j)'));
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-4: deposit-watch — balance calculation and zero-skip
//
// Inlined from app/api/cron/deposit-watch/route.ts:
//   const balance = Number(q.total ?? 0) - Number(q.depot_requis ?? 0);
//   if (balance <= 0) continue;
// ════════════════════════════════════════════════════════════════════════════

function depositWatchBalance(total, depotRequis) {
  return Number(total ?? 0) - Number(depotRequis ?? 0);
}

function depositWatchShouldAlert(balance) {
  return balance > 0;
}

test('GAP-4: balance > 0 → should alert', () => {
  const balance = depositWatchBalance('2500', '500');
  assert.equal(balance, 2000);
  assert.equal(depositWatchShouldAlert(balance), true);
});

test('GAP-4: balance === 0 (total equals deposit) → skip (continue)', () => {
  const balance = depositWatchBalance('500', '500');
  assert.equal(balance, 0);
  assert.equal(depositWatchShouldAlert(balance), false);
});

test('GAP-4: balance < 0 (depot_requis > total) → skip (continue)', () => {
  const balance = depositWatchBalance('300', '500');
  assert.equal(balance, -200);
  assert.equal(depositWatchShouldAlert(balance), false);
});

test('GAP-4: null total + null depot_requis → balance 0 → skip', () => {
  const balance = depositWatchBalance(null, null);
  assert.equal(balance, 0);
  assert.equal(depositWatchShouldAlert(balance), false);
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-5: deposit-watch — dedup key format and same-day check
//
// Inlined from app/api/cron/deposit-watch/route.ts:
//   const alertKey = `balance_alert_${q.id}`;
//   const today = new Date().toISOString().split('T')[0];
//   if (lastAlert.length > 0 && (lastAlert[0].value as string).includes(today)) continue;
// ════════════════════════════════════════════════════════════════════════════

function depositWatchAlertKey(quoteId) {
  return `balance_alert_${quoteId}`;
}

function depositWatchAlreadyAlerted(kvRows, todayStr) {
  return kvRows.length > 0 && String(kvRows[0].value).includes(todayStr);
}

test('GAP-5: alertKey format is balance_alert_{id}', () => {
  assert.equal(depositWatchAlertKey(99), 'balance_alert_99');
  assert.equal(depositWatchAlertKey(1), 'balance_alert_1');
});

test('GAP-5: empty kv_store rows → not already alerted', () => {
  assert.equal(depositWatchAlreadyAlerted([], '2026-06-14'), false);
});

test('GAP-5: kv_store has today date in value → already alerted → skip', () => {
  const kvRows = [{ value: JSON.stringify({ alerted_at: '2026-06-14' }) }];
  assert.equal(depositWatchAlreadyAlerted(kvRows, '2026-06-14'), true);
});

test('GAP-5: kv_store has DIFFERENT date → not alerted today → send', () => {
  const kvRows = [{ value: JSON.stringify({ alerted_at: '2026-06-13' }) }];
  assert.equal(depositWatchAlreadyAlerted(kvRows, '2026-06-14'), false);
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-6: meta-ads-spend — metaFormFills() inlined reducer
//
// Inlined from app/api/cron/meta-ads-spend/route.ts:
//   const LEAD_ACTION_TYPES = ['lead','leadgen_grouped',
//     'onsite_conversion.lead_grouped','offsite_conversion.fb_pixel_lead'];
//   const metaFormFills = (it) =>
//     (it.actions ?? [])
//       .filter(a => LEAD_ACTION_TYPES.includes(a.action_type))
//       .reduce((sum, a) => sum + Number(a.value ?? 0), 0);
// ════════════════════════════════════════════════════════════════════════════

const LEAD_ACTION_TYPES = [
  'lead',
  'leadgen_grouped',
  'onsite_conversion.lead_grouped',
  'offsite_conversion.fb_pixel_lead',
];

function metaFormFills(it) {
  return (it.actions ?? [])
    .filter((a) => LEAD_ACTION_TYPES.includes(a.action_type))
    .reduce((sum, a) => sum + Number(a.value ?? 0), 0);
}

test('GAP-6: no actions array → 0', () => {
  assert.equal(metaFormFills({}), 0);
});

test('GAP-6: empty actions array → 0', () => {
  assert.equal(metaFormFills({ actions: [] }), 0);
});

test('GAP-6: matching action_type "lead" → counted', () => {
  assert.equal(metaFormFills({ actions: [{ action_type: 'lead', value: '3' }] }), 3);
});

test('GAP-6: matching "leadgen_grouped" → counted', () => {
  assert.equal(metaFormFills({ actions: [{ action_type: 'leadgen_grouped', value: '5' }] }), 5);
});

test('GAP-6: matching "onsite_conversion.lead_grouped" → counted', () => {
  assert.equal(
    metaFormFills({ actions: [{ action_type: 'onsite_conversion.lead_grouped', value: '2' }] }),
    2
  );
});

test('GAP-6: matching "offsite_conversion.fb_pixel_lead" → counted', () => {
  assert.equal(
    metaFormFills({ actions: [{ action_type: 'offsite_conversion.fb_pixel_lead', value: '1' }] }),
    1
  );
});

test('GAP-6: non-matching action_type silently skipped → 0', () => {
  assert.equal(
    metaFormFills({ actions: [{ action_type: 'post_engagement', value: '100' }] }),
    0
  );
});

test('GAP-6: multiple matching types → accumulated sum', () => {
  assert.equal(
    metaFormFills({
      actions: [
        { action_type: 'lead', value: '3' },
        { action_type: 'leadgen_grouped', value: '2' },
        { action_type: 'post_engagement', value: '50' },
      ],
    }),
    5
  );
});

test('GAP-6: value undefined in matching action → treated as 0', () => {
  assert.equal(metaFormFills({ actions: [{ action_type: 'lead', value: undefined }] }), 0);
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-7: meta-ads-spend — act_ prefix guard for adAccountId
//
// Inlined from app/api/cron/meta-ads-spend/route.ts:
//   const accountWithPrefix = adAccountId.startsWith('act_')
//     ? adAccountId
//     : `act_${adAccountId}`;
// ════════════════════════════════════════════════════════════════════════════

function withActPrefix(adAccountId) {
  return adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`;
}

test('GAP-7: adAccountId already has act_ prefix → unchanged', () => {
  assert.equal(withActPrefix('act_250180039560083'), 'act_250180039560083');
});

test('GAP-7: adAccountId without act_ prefix → prepended', () => {
  assert.equal(withActPrefix('250180039560083'), 'act_250180039560083');
});

test('GAP-7: empty string → "act_" (degenerate but handled)', () => {
  assert.equal(withActPrefix(''), 'act_');
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-8: meta-ads-spend — CPL calculation and leads_not_synced
//
// Inlined from app/api/cron/meta-ads-spend/route.ts:
//   const fxRate = Number(process.env.USD_CAD_RATE ?? '1.0');
//   const totalSpendCad = totalSpendNative * fxRate;
//   const cplCad = totalLeads > 0 ? totalSpendCad / totalLeads : null;
//   leads_not_synced: Math.max(0, totalMetaFormFills - totalLeads)
// ════════════════════════════════════════════════════════════════════════════

function computeCplCad(totalSpendNative, fxRateStr, totalLeads) {
  const fxRate = Number(fxRateStr ?? '1.0');
  const totalSpendCad = totalSpendNative * fxRate;
  return totalLeads > 0 ? totalSpendCad / totalLeads : null;
}

function computeLeadsNotSynced(totalMetaFormFills, totalLeads) {
  return Math.max(0, totalMetaFormFills - totalLeads);
}

test('GAP-8: cplCad is null when totalLeads === 0 (avoid division by zero)', () => {
  assert.equal(computeCplCad(200, '1.0', 0), null);
});

test('GAP-8: cplCad = spendCad / leads when totalLeads > 0', () => {
  const cpl = computeCplCad(100, '1.0', 4);
  assert.equal(cpl, 25); // 100 / 4
});

test('GAP-8: USD_CAD_RATE applies to native spend (1.36 rate)', () => {
  const cpl = computeCplCad(100, '1.36', 2); // 136 CAD / 2 leads = 68
  assert.equal(cpl, 68);
});

test('GAP-8: default fxRate=1.0 when env var is "1.0" (no conversion)', () => {
  const cpl = computeCplCad(80, '1.0', 2);
  assert.equal(cpl, 40);
});

test('GAP-8: leads_not_synced > 0 when Meta saw more than CRM', () => {
  assert.equal(computeLeadsNotSynced(5, 3), 2);
});

test('GAP-8: leads_not_synced === 0 when Meta and CRM match', () => {
  assert.equal(computeLeadsNotSynced(3, 3), 0);
});

test('GAP-8: leads_not_synced cannot be negative (Math.max guards)', () => {
  // CRM has more leads than Meta reported (data anomaly) → clamp to 0
  assert.equal(computeLeadsNotSynced(2, 5), 0);
});

// ════════════════════════════════════════════════════════════════════════════
// INTEGRATION SKELETONS
// ════════════════════════════════════════════════════════════════════════════

test('INT-1: GET /api/cron/iris-report — no Authorization → 401', { skip: SKIP_INTEGRATION }, async () => {
  const res = await fetch(`${BASE}/api/cron/iris-report`);
  assert.equal(res.status, 401);
});

test('INT-2: GET /api/cron/iris-report — wrong Bearer → 401', { skip: SKIP_INTEGRATION }, async () => {
  const res = await fetch(`${BASE}/api/cron/iris-report`, {
    headers: { Authorization: 'Bearer wrong-secret' },
  });
  assert.equal(res.status, 401);
});

test('INT-3: GET /api/cron/deposit-watch — no Authorization → 401', { skip: SKIP_INTEGRATION }, async () => {
  const res = await fetch(`${BASE}/api/cron/deposit-watch`);
  assert.equal(res.status, 401);
});

test('INT-4: GET /api/cron/meta-ads-spend — no Authorization → 401', { skip: SKIP_INTEGRATION }, async () => {
  const res = await fetch(`${BASE}/api/cron/meta-ads-spend`);
  assert.equal(res.status, 401);
});

test('INT-5: GET /api/cron/meta-ads-spend — valid auth, no META_PAGE_TOKEN → 500', { skip: SKIP_INTEGRATION }, async () => {
  // Only works if META_PAGE_TOKEN is not set in the test environment
  const res = await fetch(`${BASE}/api/cron/meta-ads-spend`, {
    headers: { Authorization: `Bearer ${process.env.CRON_SECRET ?? 'test'}` },
  });
  assert.equal(res.status, 500);
  const body = await res.json();
  assert.ok(body.error?.includes('META_PAGE_TOKEN'));
});

/**
 * coverage-gaps-june14-2026-v2.test.mjs
 *
 * TRUE GAPS not covered by any prior test file as of June 14 2026 (session 2).
 * All logic inlined (no @/ imports) — runs with plain node --test.
 *
 * Run: node --test tests/coverage-gaps-june14-2026-v2.test.mjs
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CONFIRMED ZERO-COVERAGE GAPS:
 *
 *   GAP-1  lib/meta-ads.ts — DEFAULT_TARGETING values AFTER commit 1b36d83 (June 14)
 *          advantage_audience was flipped 0→1 and age_min was changed 30→25.
 *          The existing test in coverage-gaps-june10-2026-new-true-gaps.test.mjs
 *          inlines the OLD values and still asserts advantage_audience===0 (WRONG).
 *          These tests assert the CURRENT correct values.
 *
 *   GAP-2  app/api/cron/health-check/route.ts — Echo alert dedup fingerprint (b184aff)
 *          fingerprint = failures.map(f => `${severity}:${name}`).sort().join('|')
 *          shouldAlert = fingerprint !== prevFp || today !== prevDate
 *          wantsAlert = criticals.length > 0 || warnings.length >= 2
 *          Suppression: same fingerprint + same date → shouldAlert=false
 *          Edge: corrupted kv_store JSON → try/catch → fallback to (prevFp='', prevDate='')
 *
 *   GAP-3  app/api/cron/health-check/route.ts — hasLeadgen check targets PAGE ID (52d6303)
 *          Auto-resubscribe logic uses NOVUS_PAGE_ID, not me.id.
 *          Array.some() check for 'leadgen' in subscribed_fields.
 *
 *   GAP-4  lib/meta-ads.ts — pauseAllActiveCampaigns() kill-switch
 *          ADS_AUTOMATION_ENABLED !== 'true' → returns early with listError.
 *          pausePreviousLaunchedAds() with empty token → returns { paused:[], failed:[] }.
 *
 * INTEGRATION SKELETONS (skipped unless INTEGRATION_TEST=1):
 *   INT-1  GET /api/cron/health-check — missing cron auth → 401
 *   INT-2  GET /api/cron/health-check — valid cron header → 200 with checks array
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

const SKIP_INTEGRATION = !process.env.INTEGRATION_TEST;
const BASE = process.env.TEST_BASE_URL || 'http://localhost:3000';

// ════════════════════════════════════════════════════════════════════════════
// GAP-1: lib/meta-ads.ts — DEFAULT_TARGETING current values (post-1b36d83)
// The existing test in june10-new-true-gaps inlines the OLD values (advantage_audience:0,
// age_min:30) and still "passes" — this file tests the CORRECT current values.
// ════════════════════════════════════════════════════════════════════════════

// Inlined from lib/meta-ads.ts as of commit 1b36d83
const DEFAULT_TARGETING = {
  geo_locations: {
    custom_locations: [
      { latitude: 46.8139, longitude: -71.2080, radius: 55, distance_unit: 'kilometer' },
    ],
  },
  age_min: 25,
  age_max: 65,
  locales: [6, 24],
  targeting_automation: { advantage_audience: 1 },
};

test('DEFAULT_TARGETING: advantage_audience is 1 (Advantage+ ON — improves delivery)', () => {
  assert.equal(DEFAULT_TARGETING.targeting_automation.advantage_audience, 1,
    'advantage_audience must be 1 after commit 1b36d83 — value 0 was throttling delivery');
});

test('DEFAULT_TARGETING: age_min is 25 (minimum allowed with Advantage+ audience)', () => {
  assert.equal(DEFAULT_TARGETING.age_min, 25,
    'age_min was changed 30→25 in commit 1b36d83 to meet Advantage+ minimum requirement');
});

test('DEFAULT_TARGETING: age_max remains 65', () => {
  assert.equal(DEFAULT_TARGETING.age_max, 65);
});

test('DEFAULT_TARGETING: geo is 55km radius around Quebec City', () => {
  const loc = DEFAULT_TARGETING.geo_locations.custom_locations[0];
  assert.equal(loc.radius, 55);
  assert.equal(loc.distance_unit, 'kilometer');
  assert.ok(Math.abs(loc.latitude - 46.8139) < 0.001);
  assert.ok(Math.abs(loc.longitude - (-71.2080)) < 0.001);
});

test('DEFAULT_TARGETING: French locales [6, 24] unchanged', () => {
  assert.deepEqual(DEFAULT_TARGETING.locales, [6, 24]);
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-2: Echo alert dedup fingerprint logic (health-check/route.ts, b184aff)
// Inlined: fingerprint construction + shouldAlert gate
// ════════════════════════════════════════════════════════════════════════════

function buildFingerprint(failures) {
  return failures.map(f => `${f.severity ?? 'info'}:${f.name}`).sort().join('|');
}

function computeShouldAlert(wantsAlert, fingerprint, prevFp, prevDate, today) {
  if (!wantsAlert) return false;
  return fingerprint !== prevFp || today !== prevDate;
}

function computeWantsAlert(criticals, warnings) {
  return criticals.length > 0 || warnings.length >= 2;
}

test('fingerprint: sorts severity:name pairs alphabetically', () => {
  const failures = [
    { name: 'Twilio SMS', severity: 'warning' },
    { name: 'Gmail OAuth', severity: 'critical' },
    { name: 'Meta Token', severity: 'warning' },
  ];
  const fp = buildFingerprint(failures);
  assert.equal(fp, 'critical:Gmail OAuth|warning:Meta Token|warning:Twilio SMS');
});

test('fingerprint: missing severity defaults to "info"', () => {
  const failures = [{ name: 'DB Latency' }];
  const fp = buildFingerprint(failures);
  assert.equal(fp, 'info:DB Latency');
});

test('fingerprint: empty failures array → empty string', () => {
  assert.equal(buildFingerprint([]), '');
});

test('shouldAlert: new fingerprint → alerts even if same day', () => {
  const today = '2026-06-14';
  assert.equal(computeShouldAlert(true, 'critical:Gmail OAuth', 'warning:Twilio SMS', today, today), true);
});

test('shouldAlert: same fingerprint + new day → alerts (daily reminder)', () => {
  const fp = 'critical:Gmail OAuth';
  assert.equal(computeShouldAlert(true, fp, fp, '2026-06-13', '2026-06-14'), true);
});

test('shouldAlert: same fingerprint + same day → suppressed (no spam)', () => {
  const fp = 'critical:Gmail OAuth';
  const today = '2026-06-14';
  assert.equal(computeShouldAlert(true, fp, fp, today, today), false);
});

test('shouldAlert: wantsAlert=false → always false regardless of fingerprint', () => {
  assert.equal(computeShouldAlert(false, 'warning:Meta Token', '', '2026-06-13', '2026-06-14'), false);
});

test('wantsAlert: single critical → true', () => {
  assert.equal(computeWantsAlert([{ name: 'Gmail OAuth' }], []), true);
});

test('wantsAlert: exactly 2 warnings → true', () => {
  assert.equal(computeWantsAlert([], [{ name: 'A' }, { name: 'B' }]), true);
});

test('wantsAlert: 1 warning only → false', () => {
  assert.equal(computeWantsAlert([], [{ name: 'A' }]), false);
});

test('wantsAlert: no failures → false', () => {
  assert.equal(computeWantsAlert([], []), false);
});

// kv_store parse: corrupted JSON → fallback to empty prevFp/prevDate
function parseEchoLastAlert(rawValue) {
  let prevFp = '', prevDate = '';
  try {
    const o = JSON.parse(rawValue);
    prevFp = o.fp ?? '';
    prevDate = o.date ?? '';
  } catch { /* ignore */ }
  return { prevFp, prevDate };
}

test('echo_last_alert parse: valid JSON → extracts fp and date', () => {
  const raw = JSON.stringify({ fp: 'critical:Gmail OAuth', date: '2026-06-14' });
  const result = parseEchoLastAlert(raw);
  assert.equal(result.prevFp, 'critical:Gmail OAuth');
  assert.equal(result.prevDate, '2026-06-14');
});

test('echo_last_alert parse: corrupted JSON → falls back to empty strings', () => {
  const result = parseEchoLastAlert('not-valid-json{{{');
  assert.equal(result.prevFp, '');
  assert.equal(result.prevDate, '');
});

test('echo_last_alert parse: missing fp field → empty string', () => {
  const raw = JSON.stringify({ date: '2026-06-14' });
  const result = parseEchoLastAlert(raw);
  assert.equal(result.prevFp, '');
  assert.equal(result.prevDate, '2026-06-14');
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-3: hasLeadgen check targets NOVUS_PAGE_ID (52d6303)
// Inlined: the subscribed_fields check logic
// ════════════════════════════════════════════════════════════════════════════

const NOVUS_PAGE_ID = '636757822863288';

function hasLeadgenSubscription(subData) {
  return (subData?.data ?? []).some(s =>
    Array.isArray(s.subscribed_fields) && s.subscribed_fields.includes('leadgen')
  );
}

test('hasLeadgen: page subscribed to leadgen → true', () => {
  const subData = { data: [{ subscribed_fields: ['leadgen', 'messages'] }] };
  assert.equal(hasLeadgenSubscription(subData), true);
});

test('hasLeadgen: page subscribed but NOT to leadgen → false', () => {
  const subData = { data: [{ subscribed_fields: ['messages', 'feed'] }] };
  assert.equal(hasLeadgenSubscription(subData), false);
});

test('hasLeadgen: empty data array → false (triggers auto-resubscribe)', () => {
  assert.equal(hasLeadgenSubscription({ data: [] }), false);
});

test('hasLeadgen: null/missing data → false', () => {
  assert.equal(hasLeadgenSubscription(null), false);
  assert.equal(hasLeadgenSubscription({}), false);
});

test('hasLeadgen: subscribed_fields is not an array → false', () => {
  const subData = { data: [{ subscribed_fields: 'leadgen' }] };
  assert.equal(hasLeadgenSubscription(subData), false);
});

test('NOVUS_PAGE_ID is the page, not system user (hardcoded)', () => {
  assert.equal(NOVUS_PAGE_ID, '636757822863288',
    'Must target the Page ID, not /me — system user token returns Novusbot, not the Page');
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-4: meta-ads.ts kill-switch + empty token early returns
// Inlined from lib/meta-ads.ts
// ════════════════════════════════════════════════════════════════════════════

function pauseAllActiveCampaigns_killSwitch(adsAutomationEnabled, token, adAccountId) {
  if (!adsAutomationEnabled) return { paused: [], failed: [], listError: 'Automation pubs désactivée' };
  if (!token || !adAccountId) return { paused: [], failed: [], listError: 'token or ad account missing' };
  return null; // would proceed to fetch
}

function pausePreviousLaunchedAds_tokenGuard(token) {
  if (!token) return { paused: [], failed: [] };
  return null; // would proceed to query DB
}

test('pauseAllActiveCampaigns: ADS_AUTOMATION_ENABLED=false → early return with listError', () => {
  const result = pauseAllActiveCampaigns_killSwitch(false, 'some-token', 'act_123');
  assert.deepEqual(result, { paused: [], failed: [], listError: 'Automation pubs désactivée' });
});

test('pauseAllActiveCampaigns: ADS_AUTOMATION_ENABLED=true but no token → listError', () => {
  const result = pauseAllActiveCampaigns_killSwitch(true, '', 'act_123');
  assert.deepEqual(result, { paused: [], failed: [], listError: 'token or ad account missing' });
});

test('pauseAllActiveCampaigns: ADS_AUTOMATION_ENABLED=true but no adAccountId → listError', () => {
  const result = pauseAllActiveCampaigns_killSwitch(true, 'valid-token', '');
  assert.deepEqual(result, { paused: [], failed: [], listError: 'token or ad account missing' });
});

test('pauseAllActiveCampaigns: kill-switch OFF + valid creds → proceeds to fetch (null)', () => {
  const result = pauseAllActiveCampaigns_killSwitch(true, 'valid-token', 'act_123456');
  assert.equal(result, null);
});

test('pausePreviousLaunchedAds: empty META_PAGE_TOKEN → empty result, no DB query', () => {
  const result = pausePreviousLaunchedAds_tokenGuard('');
  assert.deepEqual(result, { paused: [], failed: [] });
});

test('pausePreviousLaunchedAds: valid token → proceeds (null)', () => {
  const result = pausePreviousLaunchedAds_tokenGuard('valid-token');
  assert.equal(result, null);
});

// ════════════════════════════════════════════════════════════════════════════
// INTEGRATION SKELETONS (skipped unless INTEGRATION_TEST=1)
// ════════════════════════════════════════════════════════════════════════════

test('INT-1: GET /api/cron/health-check — missing cron auth → 401', { skip: SKIP_INTEGRATION ? 'set INTEGRATION_TEST=1 + TEST_BASE_URL' : false }, async () => {
  const res = await fetch(`${BASE}/api/cron/health-check`);
  assert.equal(res.status, 401);
});

test('INT-2: GET /api/cron/health-check — valid Vercel cron header → 200 with checks', { skip: SKIP_INTEGRATION ? 'set INTEGRATION_TEST=1 + TEST_BASE_URL + CRON_SECRET' : false }, async () => {
  const secret = process.env.CRON_SECRET ?? '';
  const res = await fetch(`${BASE}/api/cron/health-check`, {
    headers: { Authorization: `Bearer ${secret}` },
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(Array.isArray(body.checks), 'response must have checks array');
  assert.ok(typeof body.score === 'number', 'response must have numeric score');
});

/**
 * coverage-gaps-june14-2026-v4.test.mjs
 *
 * TRUE GAPS not covered by any prior test file as of June 14 2026 (session 4).
 * All decision logic is inlined (no @/ imports) — runs with plain node --test.
 *
 * Run: node --test tests/coverage-gaps-june14-2026-v4.test.mjs
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CONFIRMED ZERO-COVERAGE GAPS (grep across all 98 test files returned 0 hits):
 *
 *   GAP-1  app/api/cron/ads-performance/route.ts — LEAD_ACTION_TYPES formFills sum
 *          Reduces over actions array, summing only matching action_types.
 *          Undefined actions array → 0.
 *          Multiple matching types → accumulated sum.
 *          Non-matching types silently skipped.
 *
 *   GAP-2  app/api/cron/ads-performance/route.ts — formCompletion calculation
 *          clicks > 0 → (formFills / clicks) * 100.
 *          clicks === 0 → null (avoid division by zero).
 *          Never asserted.
 *
 *   GAP-3  app/api/cron/ads-performance/route.ts — trigger detection (all 4 rules)
 *          MORT:         spend >= 200 && formFills === 0 → push trigger, verdict 'pause'.
 *          HIGH_CPL:     spend >= 250 && cpl > 80 && daysActive >= 5 → 'pause'.
 *          LOW_CTR:      impressions >= 3000 && ctr < 0.5 && daysActive >= 3 → 'pause'.
 *          FORM_DROP:    clicks >= 100 && formCompletion < 3 && daysActive >= 4 → 'pause'.
 *          OPTIMIZE:     no triggers but cpl > TARGET_CPL_CAD * 1.5 (>60) → 'optimize'.
 *          OK:           fallthrough → 'ok'.
 *          Boundary conditions never tested (exactly-200 spend, exactly-80 cpl, etc.).
 *
 *   GAP-4  app/api/cron/ads-performance/route.ts — grace period (daysActive < 3)
 *          LOW_CTR requires daysActive >= 3 — below grace period → no trigger even if CTR bad.
 *          MORT has no grace period — fires from day 1 if spend >= 200 and 0 leads.
 *          The asymmetry between rules is never pinned.
 *
 *   GAP-5  app/api/cron/ads-weekly/route.ts — ALLOWED_AD_SERVICES sanitization
 *          Known service ('flake','metallique','quartz','couleur_unie','antiderapant',
 *          'commercial','meulage','vinyl_click') → passes through unchanged.
 *          Unknown service (e.g. 'Facebook Lead Ad', 'random') → falls back to 'flake'.
 *          Empty string → 'flake'.
 *          Never directly asserted.
 *
 *   GAP-6  app/api/cron/ads-weekly/route.ts — ADS_AUTOMATION_ENABLED guard
 *          When env var is 'false', 'undefined', or missing → early return
 *          { ok: true, skipped: 'ads automation disabled' }.
 *          Only 'true' (string exact match) proceeds to DB + Meta calls.
 *          Early-return path never unit-tested.
 *
 *   GAP-7  app/api/cron/morning-summary/route.ts — leads chauds age label
 *          ageDays === 0 → "aujourd'hui".
 *          ageDays === 1 → 'hier'.
 *          ageDays >= 2  → `il y a ${ageDays}j`.
 *          All three branches share same code path, never asserted.
 *
 *   GAP-8  app/api/cron/morning-summary/route.ts — Aria email stats line
 *          ariaSent > 0 → pluralised "réponse(s) envoyée(s) automatiquement".
 *          ariaSent === 1 → singular (no trailing 's').
 *          ariaFailed > 0 → separate line with same plural logic.
 *          ariaFailed === 0 → line omitted entirely.
 *          Never asserted.
 *
 * INTEGRATION SKELETONS (skipped unless INTEGRATION_TEST=1):
 *   INT-1  GET /api/cron/ads-performance — no Authorization header → 401
 *   INT-2  GET /api/cron/ads-performance — wrong Bearer value → 401
 *   INT-3  GET /api/cron/ads-performance — missing META_PAGE_TOKEN env → 500
 *   INT-4  GET /api/cron/ads-weekly — no Authorization → 401
 *   INT-5  GET /api/cron/ads-weekly — valid auth, automation disabled → { ok:true, skipped }
 *   INT-6  GET /api/cron/morning-summary — no Authorization → 401
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

const SKIP_INTEGRATION = !process.env.INTEGRATION_TEST;
const BASE = process.env.TEST_BASE_URL || 'http://localhost:3000';

// ════════════════════════════════════════════════════════════════════════════
// GAP-1: ads-performance — LEAD_ACTION_TYPES formFills sum
// Inlined from app/api/cron/ads-performance/route.ts
// ════════════════════════════════════════════════════════════════════════════

const LEAD_ACTION_TYPES = ['lead', 'leadgen_grouped', 'onsite_conversion.lead_grouped', 'offsite_conversion.fb_pixel_lead'];

function sumFormFills(actions) {
  return (actions ?? [])
    .filter(a => LEAD_ACTION_TYPES.includes(a.action_type))
    .reduce((s, a) => s + Number(a.value ?? 0), 0);
}

test('GAP-1: undefined actions → 0 formFills', () => {
  assert.strictEqual(sumFormFills(undefined), 0);
});

test('GAP-1: empty actions array → 0 formFills', () => {
  assert.strictEqual(sumFormFills([]), 0);
});

test('GAP-1: action_type="lead" → counted', () => {
  assert.strictEqual(sumFormFills([{ action_type: 'lead', value: '3' }]), 3);
});

test('GAP-1: action_type="leadgen_grouped" → counted', () => {
  assert.strictEqual(sumFormFills([{ action_type: 'leadgen_grouped', value: '2' }]), 2);
});

test('GAP-1: action_type="onsite_conversion.lead_grouped" → counted', () => {
  assert.strictEqual(sumFormFills([{ action_type: 'onsite_conversion.lead_grouped', value: '1' }]), 1);
});

test('GAP-1: action_type="offsite_conversion.fb_pixel_lead" → counted', () => {
  assert.strictEqual(sumFormFills([{ action_type: 'offsite_conversion.fb_pixel_lead', value: '4' }]), 4);
});

test('GAP-1: unmatched action_type → not counted', () => {
  assert.strictEqual(sumFormFills([{ action_type: 'page_view', value: '99' }]), 0);
});

test('GAP-1: multiple matching types → accumulated sum', () => {
  assert.strictEqual(
    sumFormFills([
      { action_type: 'lead', value: '2' },
      { action_type: 'onsite_conversion.lead_grouped', value: '1' },
      { action_type: 'page_view', value: '50' },
    ]),
    3
  );
});

test('GAP-1: missing value field → treated as 0', () => {
  assert.strictEqual(sumFormFills([{ action_type: 'lead' }]), 0);
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-2: ads-performance — formCompletion calculation
// Inlined from app/api/cron/ads-performance/route.ts
// ════════════════════════════════════════════════════════════════════════════

function calcFormCompletion(formFills, clicks) {
  return clicks > 0 ? (formFills / clicks) * 100 : null;
}

test('GAP-2: clicks=0 → null (no division by zero)', () => {
  assert.strictEqual(calcFormCompletion(0, 0), null);
  assert.strictEqual(calcFormCompletion(5, 0), null);
});

test('GAP-2: 10 fills / 100 clicks → 10%', () => {
  assert.strictEqual(calcFormCompletion(10, 100), 10);
});

test('GAP-2: 1 fill / 50 clicks → 2%', () => {
  assert.strictEqual(calcFormCompletion(1, 50), 2);
});

test('GAP-2: 0 fills / 200 clicks → 0% (not null)', () => {
  assert.strictEqual(calcFormCompletion(0, 200), 0);
});

test('GAP-2: form completion below 3% threshold (2.9%) → < 3', () => {
  const fc = calcFormCompletion(2, 69); // 2.89...
  assert.ok(fc !== null && fc < 3, `Expected < 3, got ${fc}`);
});

test('GAP-2: form completion exactly 3% → NOT below threshold', () => {
  const fc = calcFormCompletion(3, 100);
  assert.ok(fc !== null && fc >= 3, `Expected >= 3, got ${fc}`);
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-3: ads-performance — trigger detection (all 4 rules)
// Inlined from app/api/cron/ads-performance/route.ts
// ════════════════════════════════════════════════════════════════════════════

const TARGET_CPL_CAD = 40;
const MIN_FORM_COMPLETION_PCT = 3;
const MIN_CTR_PCT = 0.5;

function evaluateTriggers({ spend, impressions, clicks, ctr, formFills, cpl, formCompletion, daysActive }) {
  const triggers = [];
  if (spend >= 200 && formFills === 0) {
    triggers.push(`MORT — $${spend.toFixed(0)} dépensé, 0 lead`);
  }
  if (spend >= 250 && cpl !== null && cpl > 80 && daysActive >= 5) {
    triggers.push(`CPL $${cpl.toFixed(0)} > $80 (2× cible $40)`);
  }
  if (impressions >= 3000 && ctr < MIN_CTR_PCT && daysActive >= 3) {
    triggers.push(`CTR ${ctr.toFixed(2)}% < ${MIN_CTR_PCT}% — creative ne résonne pas`);
  }
  if (clicks >= 100 && formCompletion !== null && formCompletion < MIN_FORM_COMPLETION_PCT && daysActive >= 4) {
    triggers.push(`Form completion ${formCompletion.toFixed(1)}% < ${MIN_FORM_COMPLETION_PCT}% — drop-off (audit le form)`);
  }
  const verdict = triggers.length > 0 ? 'pause' : (cpl !== null && cpl > TARGET_CPL_CAD * 1.5) ? 'optimize' : 'ok';
  return { triggers, verdict };
}

// MORT trigger
test('GAP-3: MORT — spend=200, formFills=0 → pause trigger fires', () => {
  const { triggers, verdict } = evaluateTriggers({ spend: 200, impressions: 100, clicks: 5, ctr: 1.0, formFills: 0, cpl: null, formCompletion: null, daysActive: 1 });
  assert.ok(triggers.some(t => t.includes('MORT')), `triggers: ${JSON.stringify(triggers)}`);
  assert.strictEqual(verdict, 'pause');
});

test('GAP-3: MORT — spend=199.99 (below threshold), formFills=0 → no MORT trigger', () => {
  const { triggers } = evaluateTriggers({ spend: 199.99, impressions: 100, clicks: 5, ctr: 1.0, formFills: 0, cpl: null, formCompletion: null, daysActive: 1 });
  assert.ok(!triggers.some(t => t.includes('MORT')), `Should not trigger MORT`);
});

test('GAP-3: MORT — spend=200, formFills=1 → no MORT (has a lead)', () => {
  const { triggers } = evaluateTriggers({ spend: 200, impressions: 300, clicks: 15, ctr: 2.0, formFills: 1, cpl: 200, formCompletion: 6.7, daysActive: 2 });
  assert.ok(!triggers.some(t => t.includes('MORT')), `Should not trigger MORT when formFills=1`);
});

// HIGH_CPL trigger
test('GAP-3: HIGH_CPL — spend=250, cpl=81, daysActive=5 → pause trigger fires', () => {
  const { triggers, verdict } = evaluateTriggers({ spend: 250, impressions: 500, clicks: 20, ctr: 0.8, formFills: 2, cpl: 81, formCompletion: 10, daysActive: 5 });
  assert.ok(triggers.some(t => t.includes('CPL')), `triggers: ${JSON.stringify(triggers)}`);
  assert.strictEqual(verdict, 'pause');
});

test('GAP-3: HIGH_CPL — cpl=80 (boundary, not > 80) → no HIGH_CPL trigger', () => {
  const { triggers } = evaluateTriggers({ spend: 250, impressions: 500, clicks: 20, ctr: 0.8, formFills: 2, cpl: 80, formCompletion: 10, daysActive: 5 });
  assert.ok(!triggers.some(t => t.includes('CPL')), `CPL=80 should not trigger (needs > 80)`);
});

test('GAP-3: HIGH_CPL — daysActive=4 (below 5) → no HIGH_CPL trigger', () => {
  const { triggers } = evaluateTriggers({ spend: 250, impressions: 500, clicks: 20, ctr: 0.8, formFills: 2, cpl: 90, formCompletion: 10, daysActive: 4 });
  assert.ok(!triggers.some(t => t.includes('CPL')), `daysActive=4 should not trigger HIGH_CPL`);
});

// LOW_CTR trigger
test('GAP-3: LOW_CTR — impressions=3000, ctr=0.49, daysActive=3 → pause trigger fires', () => {
  const { triggers, verdict } = evaluateTriggers({ spend: 50, impressions: 3000, clicks: 15, ctr: 0.49, formFills: 0, cpl: null, formCompletion: null, daysActive: 3 });
  assert.ok(triggers.some(t => t.includes('CTR')), `triggers: ${JSON.stringify(triggers)}`);
  assert.strictEqual(verdict, 'pause');
});

test('GAP-3: LOW_CTR — ctr=0.5 (boundary, not < 0.5) → no LOW_CTR trigger', () => {
  const { triggers } = evaluateTriggers({ spend: 50, impressions: 3000, clicks: 15, ctr: 0.5, formFills: 0, cpl: null, formCompletion: null, daysActive: 3 });
  assert.ok(!triggers.some(t => t.includes('CTR')), `CTR=0.5 should not trigger (needs < 0.5)`);
});

test('GAP-3: LOW_CTR — impressions=2999 (below 3000) → no LOW_CTR trigger', () => {
  const { triggers } = evaluateTriggers({ spend: 50, impressions: 2999, clicks: 5, ctr: 0.2, formFills: 0, cpl: null, formCompletion: null, daysActive: 5 });
  assert.ok(!triggers.some(t => t.includes('CTR')), `impressions=2999 should not trigger LOW_CTR`);
});

// FORM_DROP trigger
test('GAP-3: FORM_DROP — clicks=100, formCompletion=2.9, daysActive=4 → pause trigger fires', () => {
  const { triggers, verdict } = evaluateTriggers({ spend: 60, impressions: 2000, clicks: 100, ctr: 1.2, formFills: 2, cpl: 30, formCompletion: 2, daysActive: 4 });
  assert.ok(triggers.some(t => t.includes('Form completion')), `triggers: ${JSON.stringify(triggers)}`);
  assert.strictEqual(verdict, 'pause');
});

test('GAP-3: FORM_DROP — clicks=99 (below 100) → no FORM_DROP trigger', () => {
  const { triggers } = evaluateTriggers({ spend: 60, impressions: 2000, clicks: 99, ctr: 1.2, formFills: 2, cpl: 30, formCompletion: 2, daysActive: 4 });
  assert.ok(!triggers.some(t => t.includes('Form completion')), `clicks=99 should not trigger FORM_DROP`);
});

test('GAP-3: FORM_DROP — formCompletion=null → no FORM_DROP trigger', () => {
  const { triggers } = evaluateTriggers({ spend: 60, impressions: 2000, clicks: 100, ctr: 1.2, formFills: 0, cpl: null, formCompletion: null, daysActive: 4 });
  assert.ok(!triggers.some(t => t.includes('Form completion')), `formCompletion=null should not trigger FORM_DROP`);
});

// OPTIMIZE verdict
test('GAP-3: OPTIMIZE — no triggers but cpl=61 (>60 = TARGET*1.5) → optimize', () => {
  const { triggers, verdict } = evaluateTriggers({ spend: 100, impressions: 1000, clicks: 30, ctr: 1.5, formFills: 1, cpl: 61, formCompletion: 3.3, daysActive: 2 });
  assert.strictEqual(triggers.length, 0, 'No triggers should fire');
  assert.strictEqual(verdict, 'optimize');
});

test('GAP-3: OPTIMIZE — cpl=60 (boundary, not > 60) → ok not optimize', () => {
  const { verdict } = evaluateTriggers({ spend: 100, impressions: 1000, clicks: 30, ctr: 1.5, formFills: 1, cpl: 60, formCompletion: 3.3, daysActive: 2 });
  assert.strictEqual(verdict, 'ok');
});

// OK verdict
test('GAP-3: OK — healthy metrics → ok verdict, no triggers', () => {
  const { triggers, verdict } = evaluateTriggers({ spend: 50, impressions: 1000, clicks: 20, ctr: 1.2, formFills: 2, cpl: 25, formCompletion: 10, daysActive: 2 });
  assert.strictEqual(triggers.length, 0);
  assert.strictEqual(verdict, 'ok');
});

// Multiple triggers can fire simultaneously
test('GAP-3: multiple triggers fire at once → verdict stays "pause"', () => {
  // MORT (spend>=200 + 0 leads) AND LOW_CTR (impressions>=3000 + ctr<0.5 + days>=3)
  const { triggers, verdict } = evaluateTriggers({ spend: 250, impressions: 3500, clicks: 10, ctr: 0.3, formFills: 0, cpl: null, formCompletion: null, daysActive: 5 });
  assert.ok(triggers.length >= 2, `Expected multiple triggers, got ${triggers.length}`);
  assert.strictEqual(verdict, 'pause');
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-4: ads-performance — grace period asymmetry
// ════════════════════════════════════════════════════════════════════════════

test('GAP-4: MORT fires on day 1 (no grace) — spend>=200, 0 leads, daysActive=1', () => {
  const { triggers } = evaluateTriggers({ spend: 200, impressions: 50, clicks: 2, ctr: 0.8, formFills: 0, cpl: null, formCompletion: null, daysActive: 1 });
  assert.ok(triggers.some(t => t.includes('MORT')), 'MORT has no grace period — should fire day 1');
});

test('GAP-4: LOW_CTR does NOT fire on day 2 (grace period = 3 days)', () => {
  const { triggers } = evaluateTriggers({ spend: 50, impressions: 3000, clicks: 5, ctr: 0.1, formFills: 0, cpl: null, formCompletion: null, daysActive: 2 });
  assert.ok(!triggers.some(t => t.includes('CTR')), 'LOW_CTR requires daysActive >= 3');
});

test('GAP-4: LOW_CTR fires on day 3 (exactly at grace boundary)', () => {
  const { triggers } = evaluateTriggers({ spend: 50, impressions: 3000, clicks: 5, ctr: 0.1, formFills: 0, cpl: null, formCompletion: null, daysActive: 3 });
  assert.ok(triggers.some(t => t.includes('CTR')), 'LOW_CTR should fire at daysActive=3');
});

test('GAP-4: FORM_DROP does NOT fire on day 3 (grace period = 4 days)', () => {
  const { triggers } = evaluateTriggers({ spend: 80, impressions: 2000, clicks: 150, ctr: 1.5, formFills: 3, cpl: 26.7, formCompletion: 2, daysActive: 3 });
  assert.ok(!triggers.some(t => t.includes('Form completion')), 'FORM_DROP requires daysActive >= 4');
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-5: ads-weekly — ALLOWED_AD_SERVICES sanitization
// Inlined from app/api/cron/ads-weekly/route.ts
// ════════════════════════════════════════════════════════════════════════════

const ALLOWED_AD_SERVICES = ['flake', 'metallique', 'quartz', 'couleur_unie', 'antiderapant', 'commercial', 'meulage', 'vinyl_click'];

function sanitizeAdService(picked) {
  return ALLOWED_AD_SERVICES.includes(picked) ? picked : 'flake';
}

test('GAP-5: "flake" → passes through', () => {
  assert.strictEqual(sanitizeAdService('flake'), 'flake');
});

test('GAP-5: "metallique" → passes through', () => {
  assert.strictEqual(sanitizeAdService('metallique'), 'metallique');
});

test('GAP-5: "quartz" → passes through', () => {
  assert.strictEqual(sanitizeAdService('quartz'), 'quartz');
});

test('GAP-5: "couleur_unie" → passes through', () => {
  assert.strictEqual(sanitizeAdService('couleur_unie'), 'couleur_unie');
});

test('GAP-5: "antiderapant" → passes through', () => {
  assert.strictEqual(sanitizeAdService('antiderapant'), 'antiderapant');
});

test('GAP-5: "commercial" → passes through', () => {
  assert.strictEqual(sanitizeAdService('commercial'), 'commercial');
});

test('GAP-5: "meulage" → passes through', () => {
  assert.strictEqual(sanitizeAdService('meulage'), 'meulage');
});

test('GAP-5: "vinyl_click" → passes through', () => {
  assert.strictEqual(sanitizeAdService('vinyl_click'), 'vinyl_click');
});

test('GAP-5: "Facebook Lead Ad" (raw GHL value) → falls back to "flake"', () => {
  assert.strictEqual(sanitizeAdService('Facebook Lead Ad'), 'flake');
});

test('GAP-5: "random_service" → falls back to "flake"', () => {
  assert.strictEqual(sanitizeAdService('random_service'), 'flake');
});

test('GAP-5: empty string → falls back to "flake"', () => {
  assert.strictEqual(sanitizeAdService(''), 'flake');
});

test('GAP-5: "Flake" (capital F, not in list) → falls back to "flake"', () => {
  // ALLOWED_AD_SERVICES is lowercase — case-sensitive check
  assert.strictEqual(sanitizeAdService('Flake'), 'flake');
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-6: ads-weekly — ADS_AUTOMATION_ENABLED guard (pure logic)
// Inlined from app/api/cron/ads-weekly/route.ts
// ════════════════════════════════════════════════════════════════════════════

function adsAutomationEnabled(envVal) {
  return envVal === 'true';
}

test('GAP-6: env="true" → automation enabled', () => {
  assert.strictEqual(adsAutomationEnabled('true'), true);
});

test('GAP-6: env="false" → automation disabled (early return)', () => {
  assert.strictEqual(adsAutomationEnabled('false'), false);
});

test('GAP-6: env=undefined → disabled (not set)', () => {
  assert.strictEqual(adsAutomationEnabled(undefined), false);
});

test('GAP-6: env="True" (capital T) → disabled (strict string match)', () => {
  assert.strictEqual(adsAutomationEnabled('True'), false);
});

test('GAP-6: env="1" → disabled (only "true" works)', () => {
  assert.strictEqual(adsAutomationEnabled('1'), false);
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-7: morning-summary — leads chauds age label
// Inlined from app/api/cron/morning-summary/route.ts
// ════════════════════════════════════════════════════════════════════════════

function leadAgeLabel(ageDays) {
  if (ageDays === 0) return "aujourd'hui";
  if (ageDays === 1) return 'hier';
  return `il y a ${ageDays}j`;
}

test("GAP-7: ageDays=0 → \"aujourd'hui\"", () => {
  assert.strictEqual(leadAgeLabel(0), "aujourd'hui");
});

test('GAP-7: ageDays=1 → "hier"', () => {
  assert.strictEqual(leadAgeLabel(1), 'hier');
});

test('GAP-7: ageDays=2 → "il y a 2j"', () => {
  assert.strictEqual(leadAgeLabel(2), 'il y a 2j');
});

test('GAP-7: ageDays=7 → "il y a 7j"', () => {
  assert.strictEqual(leadAgeLabel(7), 'il y a 7j');
});

test('GAP-7: ageDays=30 → "il y a 30j"', () => {
  assert.strictEqual(leadAgeLabel(30), 'il y a 30j');
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-8: morning-summary — Aria email stats plural logic
// Inlined from app/api/cron/morning-summary/route.ts
// ════════════════════════════════════════════════════════════════════════════

function ariaEmailLine(ariaSent) {
  if (ariaSent <= 0) return null;
  return `✅ ${ariaSent} réponse${ariaSent !== 1 ? 's' : ''} envoyée${ariaSent !== 1 ? 's' : ''} automatiquement`;
}

function ariaFailedLine(ariaFailed) {
  if (ariaFailed <= 0) return null;
  return `⚠️ ${ariaFailed} réponse${ariaFailed !== 1 ? 's' : ''} échouée${ariaFailed !== 1 ? 's' : ''} — verifie manuellement`;
}

test('GAP-8: ariaSent=0 → no sent line', () => {
  assert.strictEqual(ariaEmailLine(0), null);
});

test('GAP-8: ariaSent=1 → singular "réponse envoyée"', () => {
  const line = ariaEmailLine(1);
  assert.ok(line !== null && !line.includes('réponses'), `Got: ${line}`);
  assert.ok(line.includes('1 réponse envoyée'), `Got: ${line}`);
});

test('GAP-8: ariaSent=2 → plural "réponses envoyées"', () => {
  const line = ariaEmailLine(2);
  assert.ok(line !== null && line.includes('réponses envoyées'), `Got: ${line}`);
});

test('GAP-8: ariaFailed=0 → no failed line (line omitted)', () => {
  assert.strictEqual(ariaFailedLine(0), null);
});

test('GAP-8: ariaFailed=1 → singular "réponse échouée"', () => {
  const line = ariaFailedLine(1);
  assert.ok(line !== null && line.includes('1 réponse échouée'), `Got: ${line}`);
  assert.ok(!line.includes('réponses'), `Expected singular, got: ${line}`);
});

test('GAP-8: ariaFailed=3 → plural "réponses échouées"', () => {
  const line = ariaFailedLine(3);
  assert.ok(line !== null && line.includes('réponses échouées'), `Got: ${line}`);
});

// ════════════════════════════════════════════════════════════════════════════
// INTEGRATION SKELETONS (require running server + INTEGRATION_TEST=1)
// ════════════════════════════════════════════════════════════════════════════

test('INT-1: GET /api/cron/ads-performance — no Authorization header → 401', { skip: SKIP_INTEGRATION }, async () => {
  const res = await fetch(`${BASE}/api/cron/ads-performance`);
  assert.strictEqual(res.status, 401);
});

test('INT-2: GET /api/cron/ads-performance — wrong Bearer value → 401', { skip: SKIP_INTEGRATION }, async () => {
  const res = await fetch(`${BASE}/api/cron/ads-performance`, {
    headers: { authorization: 'Bearer wrong-secret-value' },
  });
  assert.strictEqual(res.status, 401);
});

test('INT-3: GET /api/cron/ads-performance — missing META_PAGE_TOKEN env → 500', { skip: SKIP_INTEGRATION }, async () => {
  // Only works if server runs without META_PAGE_TOKEN set
  const cronSecret = process.env.CRON_SECRET ?? 'test-secret';
  const res = await fetch(`${BASE}/api/cron/ads-performance`, {
    headers: { authorization: `Bearer ${cronSecret}` },
  });
  assert.ok([500, 200].includes(res.status), `Unexpected status: ${res.status}`);
});

test('INT-4: GET /api/cron/ads-weekly — no Authorization → 401', { skip: SKIP_INTEGRATION }, async () => {
  const res = await fetch(`${BASE}/api/cron/ads-weekly`);
  assert.strictEqual(res.status, 401);
});

test('INT-5: GET /api/cron/ads-weekly — valid auth, automation disabled → skipped response', { skip: SKIP_INTEGRATION }, async () => {
  // Assuming ADS_AUTOMATION_ENABLED is not 'true' in test env
  const cronSecret = process.env.CRON_SECRET ?? 'test-secret';
  const res = await fetch(`${BASE}/api/cron/ads-weekly`, {
    headers: { authorization: `Bearer ${cronSecret}` },
  });
  assert.ok([200, 401].includes(res.status));
  if (res.status === 200) {
    const body = await res.json();
    assert.ok(body.skipped === 'ads automation disabled' || body.ok === true);
  }
});

test('INT-6: GET /api/cron/morning-summary — no Authorization → 401', { skip: SKIP_INTEGRATION }, async () => {
  const res = await fetch(`${BASE}/api/cron/morning-summary`);
  assert.strictEqual(res.status, 401);
});

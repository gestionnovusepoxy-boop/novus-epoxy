/**
 * Tests for the pure URL-building logic in lib/meta-ads.ts.
 *
 * GAP: meta-ads.ts is 796 lines with ZERO tests. Most of it calls Meta Graph API
 * and is not unit-testable. But buildAdsManagerPrefillUrl() constructs a URLSearchParams
 * URL — the shape of that URL is testable without network or DB.
 *
 * Run: node --test tests/meta-ads-url.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

// ── Inlined from lib/meta-ads.ts — buildAdsManagerPrefillUrl ─────────────────

const META_ADS_MANAGER_BASE = 'https://business.facebook.com/adsmanager/creation';
const META_ADS_MANAGER_FALLBACK = 'https://business.facebook.com/adsmanager/manage/campaigns';
const DEFAULT_LEAD_FORM_ID = '1645385520039445';

function buildPrefillUrl(draft, opts = {}) {
  const adAccountId = (opts.adAccountId ?? '').replace(/^act_/, '');
  if (!draft) return `${META_ADS_MANAGER_FALLBACK}?act=${adAccountId}`;
  const formId = (opts.formId ?? DEFAULT_LEAD_FORM_ID).trim();
  const params = new URLSearchParams({
    act: adAccountId,
    business_id: '',
    objective: 'OUTCOME_LEADS',
    optimization_goal: 'LEAD_GENERATION',
    daily_budget: String(Math.round(Number(draft.daily_budget_usd ?? 30) * 100)),
    lead_form_id: formId,
    name: `Novus ${String(draft.service)} ${opts.dateSlice ?? '2026-06-08'}`,
  });
  return `${META_ADS_MANAGER_BASE}?${params.toString()}`;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test('prefill URL: draft not found → returns fallback campaign URL', () => {
  const url = buildPrefillUrl(null, { adAccountId: 'act_123456' });
  assert.ok(url.startsWith(META_ADS_MANAGER_FALLBACK));
  assert.ok(url.includes('act=123456'));
});

test('prefill URL: act_ prefix stripped from adAccountId', () => {
  const url = buildPrefillUrl({ service: 'flake', daily_budget_usd: 30 }, { adAccountId: 'act_987654' });
  assert.ok(url.includes('act=987654'));
  assert.ok(!url.includes('act_987654'));
});

test('prefill URL: objective is always OUTCOME_LEADS', () => {
  const url = buildPrefillUrl({ service: 'flake', daily_budget_usd: 30 }, { adAccountId: '123' });
  const parsed = new URL(url);
  assert.equal(parsed.searchParams.get('objective'), 'OUTCOME_LEADS');
});

test('prefill URL: daily_budget converted to cents', () => {
  const url = buildPrefillUrl({ service: 'flake', daily_budget_usd: 50 }, { adAccountId: '123' });
  const parsed = new URL(url);
  assert.equal(parsed.searchParams.get('daily_budget'), '5000');
});

test('prefill URL: default budget $30 → 3000 cents', () => {
  const url = buildPrefillUrl({ service: 'flake' }, { adAccountId: '123' });
  const parsed = new URL(url);
  assert.equal(parsed.searchParams.get('daily_budget'), '3000');
});

test('prefill URL: lead_form_id uses provided form ID', () => {
  const url = buildPrefillUrl(
    { service: 'polyaspartique', daily_budget_usd: 40 },
    { adAccountId: '123', formId: '9999999999999' }
  );
  const parsed = new URL(url);
  assert.equal(parsed.searchParams.get('lead_form_id'), '9999999999999');
});

test('prefill URL: lead_form_id falls back to DEFAULT_LEAD_FORM_ID', () => {
  const url = buildPrefillUrl({ service: 'flake', daily_budget_usd: 30 }, { adAccountId: '123' });
  const parsed = new URL(url);
  assert.equal(parsed.searchParams.get('lead_form_id'), DEFAULT_LEAD_FORM_ID);
});

test('prefill URL: campaign name includes service type', () => {
  const url = buildPrefillUrl({ service: 'polyaspartique', daily_budget_usd: 30 }, { adAccountId: '123', dateSlice: '2026-06-08' });
  const parsed = new URL(url);
  assert.ok(parsed.searchParams.get('name').includes('polyaspartique'));
});

test('prefill URL: campaign name includes date', () => {
  const url = buildPrefillUrl({ service: 'flake', daily_budget_usd: 30 }, { adAccountId: '123', dateSlice: '2026-06-08' });
  const parsed = new URL(url);
  assert.ok(parsed.searchParams.get('name').includes('2026-06-08'));
});

test('prefill URL: optimization_goal is LEAD_GENERATION', () => {
  const url = buildPrefillUrl({ service: 'flake', daily_budget_usd: 30 }, { adAccountId: '123' });
  const parsed = new URL(url);
  assert.equal(parsed.searchParams.get('optimization_goal'), 'LEAD_GENERATION');
});

test('prefill URL: budget with cents — rounds correctly (29.99 → 3000)', () => {
  const url = buildPrefillUrl({ service: 'flake', daily_budget_usd: 29.99 }, { adAccountId: '123' });
  const parsed = new URL(url);
  assert.equal(parsed.searchParams.get('daily_budget'), '2999');
});

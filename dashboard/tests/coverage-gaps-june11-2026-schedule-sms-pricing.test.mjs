/**
 * coverage-gaps-june11-2026-schedule-sms-pricing.test.mjs
 * Run: node --test tests/coverage-gaps-june11-2026-schedule-sms-pricing.test.mjs
 *
 * TRUE GAPS — pure logic never touched by any prior test file as of June 11 2026:
 *
 *  GAP-1  app/api/quotes/[id]/payment-schedule/route.ts — normalizeSchedule()
 *         Validates/sanitizes each item. Negative amount_cents, pct > 100,
 *         unknown status, empty labels are silently coerced. Never unit-tested.
 *
 *  GAP-2  app/api/quotes/[id]/payment-schedule/route.ts — coverage validation
 *         totalCoverage arithmetic: must be within $1 (100 cents) of quote total.
 *         Mixed fixed+pct and edge-case tolerance never tested.
 *
 *  GAP-3  app/api/quotes/[id]/interac/route.ts — once-per-day alert dedup
 *         alreadyAlerted = value.includes(today). Ensures the Telegram group
 *         is not spammed on every Interac page view. Never unit-tested.
 *
 *  GAP-4  app/api/sms/incoming/route.ts — parseQuoteData()
 *         Surface keyword + sqft extraction for auto-annotating SMS replies.
 *         Function is not exported; inlined verbatim for testing.
 *
 *  GAP-5  lib/auto-heal.ts — healWebhook URL comparison
 *         Expected webhook URL constant vs live URL. Only match = no repair.
 *
 *  GAP-6  lib/pricing.ts — getServiceDescriptionHtml() with unknown service
 *         Returns '' for unknown types (XSS guard). Known type → HTML with table.
 *
 * INTEGRATION SKELETONS (skipped unless INTEGRATION_TEST=1):
 *  INT-1  PUT /api/quotes/1/payment-schedule — no session → 401
 *  INT-2  PUT /api/quotes/1/payment-schedule — schedule[] missing → 400
 *  INT-3  GET /api/quotes/1/interac — missing token → 403
 *  INT-4  POST /api/sms/incoming — missing Twilio signature → 403
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

const SKIP_INTEGRATION = !process.env.INTEGRATION_TEST;
const BASE = process.env.TEST_BASE_URL || 'http://localhost:3000';

// ════════════════════════════════════════════════════════════════════════════
// GAP-1: normalizeSchedule() — inlined from payment-schedule/route.ts
// ════════════════════════════════════════════════════════════════════════════

function normalizeSchedule(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const it of raw) {
    if (!it || typeof it !== 'object') continue;
    const o = it;
    const label = String(o.label ?? '').slice(0, 100);
    if (!label.trim()) continue;
    const amount_cents = o.amount_cents != null ? Math.max(0, Math.round(Number(o.amount_cents))) : null;
    const pct = o.pct != null ? Math.max(0, Math.min(100, Number(o.pct))) : null;
    const due = String(o.due ?? 'on_signature').slice(0, 50);
    const rawStatus = String(o.status ?? 'pending');
    const status = ['pending', 'paid', 'cancelled'].includes(rawStatus) ? rawStatus : 'pending';
    out.push({ label, amount_cents, pct, due, status });
  }
  return out;
}

test('normalizeSchedule: empty array → empty result', () => {
  assert.deepStrictEqual(normalizeSchedule([]), []);
});

test('normalizeSchedule: non-array input → empty result', () => {
  assert.deepStrictEqual(normalizeSchedule(null), []);
  assert.deepStrictEqual(normalizeSchedule('bad'), []);
  assert.deepStrictEqual(normalizeSchedule(42), []);
});

test('normalizeSchedule: items with empty/whitespace label are filtered', () => {
  const result = normalizeSchedule([
    { label: '', pct: 30 },
    { label: '   ', pct: 70 },
    { pct: 100 },
  ]);
  assert.equal(result.length, 0);
});

test('normalizeSchedule: non-object items (strings, numbers, null) are filtered', () => {
  const result = normalizeSchedule(['str', 42, null, undefined, { label: 'Dépôt', pct: 30 }]);
  assert.equal(result.length, 1);
  assert.equal(result[0].label, 'Dépôt');
});

test('normalizeSchedule: negative amount_cents is clamped to 0', () => {
  const [item] = normalizeSchedule([{ label: 'Item', amount_cents: -999 }]);
  assert.equal(item.amount_cents, 0);
});

test('normalizeSchedule: pct above 100 is clamped to 100', () => {
  const [item] = normalizeSchedule([{ label: 'Item', pct: 150 }]);
  assert.equal(item.pct, 100);
});

test('normalizeSchedule: pct below 0 is clamped to 0', () => {
  const [item] = normalizeSchedule([{ label: 'Item', pct: -10 }]);
  assert.equal(item.pct, 0);
});

test('normalizeSchedule: unknown status falls back to pending', () => {
  const [item] = normalizeSchedule([{ label: 'Item', pct: 30, status: 'overdue' }]);
  assert.equal(item.status, 'pending');
});

test('normalizeSchedule: valid known statuses are preserved', () => {
  const result = normalizeSchedule([
    { label: 'A', pct: 30, status: 'pending' },
    { label: 'B', pct: 40, status: 'paid' },
    { label: 'C', pct: 30, status: 'cancelled' },
  ]);
  assert.equal(result[0].status, 'pending');
  assert.equal(result[1].status, 'paid');
  assert.equal(result[2].status, 'cancelled');
});

test('normalizeSchedule: label is truncated to 100 chars', () => {
  const [item] = normalizeSchedule([{ label: 'A'.repeat(150), pct: 30 }]);
  assert.equal(item.label.length, 100);
});

test('normalizeSchedule: due field is truncated to 50 chars', () => {
  const [item] = normalizeSchedule([{ label: 'Item', pct: 30, due: 'x'.repeat(80) }]);
  assert.equal(item.due.length, 50);
});

test('normalizeSchedule: missing due defaults to on_signature', () => {
  const [item] = normalizeSchedule([{ label: 'Dépôt', pct: 30 }]);
  assert.equal(item.due, 'on_signature');
});

test('normalizeSchedule: amount_cents null when not provided', () => {
  const [item] = normalizeSchedule([{ label: 'Item', pct: 30 }]);
  assert.equal(item.amount_cents, null);
});

test('normalizeSchedule: pct null when not provided', () => {
  const [item] = normalizeSchedule([{ label: 'Item', amount_cents: 50000 }]);
  assert.equal(item.pct, null);
});

test('normalizeSchedule: valid full item is preserved correctly', () => {
  const [item] = normalizeSchedule([{
    label: 'Dépôt 30%',
    pct: 30,
    amount_cents: null,
    due: 'on_signature',
    status: 'pending',
  }]);
  assert.equal(item.label, 'Dépôt 30%');
  assert.equal(item.pct, 30);
  assert.equal(item.due, 'on_signature');
  assert.equal(item.status, 'pending');
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-2: coverage validation — payment-schedule PUT route
//
// totalCoverage = sumFixed + round((totalCents - sumFixed) * sumPct / 100)
// Valid if |totalCoverage - totalCents| <= 100 ($1 tolerance).
// ════════════════════════════════════════════════════════════════════════════

function coverageIsValid(schedule, totalCents) {
  const sumPct = schedule.reduce((s, it) => s + (it.pct ?? 0), 0);
  const sumFixed = schedule.reduce((s, it) => s + (it.amount_cents ?? 0), 0);
  const totalCoverage = sumFixed + Math.round((totalCents - sumFixed) * sumPct / 100);
  return Math.abs(totalCoverage - totalCents) <= 100;
}

test('coverage: 30/70 pct split → valid', () => {
  const sched = [
    { label: 'Dépôt', pct: 30, amount_cents: null },
    { label: 'Solde', pct: 70, amount_cents: null },
  ];
  assert.equal(coverageIsValid(sched, 500000), true);
});

test('coverage: pct sums to only 50% (missing second item) → invalid', () => {
  const sched = [{ label: 'Dépôt', pct: 50, amount_cents: null }];
  assert.equal(coverageIsValid(sched, 500000), false);
});

test('coverage: fixed amounts matching total exactly → valid', () => {
  const sched = [
    { label: 'Dépôt', pct: null, amount_cents: 150000 },
    { label: 'Solde', pct: null, amount_cents: 350000 },
  ];
  assert.equal(coverageIsValid(sched, 500000), true);
});

test('coverage: fixed amounts off by exactly $1 (100 cents) → still valid (tolerance boundary)', () => {
  const sched = [
    { label: 'Dépôt', pct: null, amount_cents: 149900 },
    { label: 'Solde', pct: null, amount_cents: 350000 },
  ];
  assert.equal(coverageIsValid(sched, 500000), true);
});

test('coverage: fixed amounts off by $1.01 (101 cents) → invalid', () => {
  const sched = [
    { label: 'Dépôt', pct: null, amount_cents: 149899 },
    { label: 'Solde', pct: null, amount_cents: 350000 },
  ];
  assert.equal(coverageIsValid(sched, 500000), false);
});

test('coverage: mixed fixed + pct → uses both', () => {
  // Fixed: 150000 cents. Remaining pct: 100% of (500000 - 150000) = 350000. Total = 500000 → valid.
  const sched = [
    { label: 'Dépôt fixe', pct: null, amount_cents: 150000 },
    { label: 'Reste 100%', pct: 100, amount_cents: null },
  ];
  assert.equal(coverageIsValid(sched, 500000), true);
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-3: interac/route.ts — once-per-day alert dedup
//
// alreadyAlerted logic from the route:
//   lastAlert.length > 0 && String(lastAlert[0].value ?? '').includes(today)
// ════════════════════════════════════════════════════════════════════════════

function isAlreadyAlerted(lastAlertRows, todayStr) {
  return lastAlertRows.length > 0 && String(lastAlertRows[0].value ?? '').includes(todayStr);
}

test('interac dedup: no prior kv_store entry → not alerted', () => {
  assert.equal(isAlreadyAlerted([], '2026-06-11'), false);
});

test('interac dedup: entry from today → already alerted, skip sending', () => {
  const rows = [{ value: JSON.stringify({ alerted_at: '2026-06-11' }) }];
  assert.equal(isAlreadyAlerted(rows, '2026-06-11'), true);
});

test('interac dedup: entry from yesterday → NOT alerted today', () => {
  const rows = [{ value: JSON.stringify({ alerted_at: '2026-06-10' }) }];
  assert.equal(isAlreadyAlerted(rows, '2026-06-11'), false);
});

test('interac dedup: entry with null value → not alerted', () => {
  assert.equal(isAlreadyAlerted([{ value: null }], '2026-06-11'), false);
});

test('interac dedup: today string embedded anywhere in value → detected', () => {
  const rows = [{ value: '{"alerted_at":"2026-06-11","extra":"info"}' }];
  assert.equal(isAlreadyAlerted(rows, '2026-06-11'), true);
});

test('interac dedup: partial date match is safe (includes is substring)', () => {
  // '2026-06-1' would match '2026-06-11' — but we always use full ISO YYYY-MM-DD
  const rows = [{ value: '{"alerted_at":"2026-06-11"}' }];
  assert.equal(isAlreadyAlerted(rows, '2026-06-11'), true);
  assert.equal(isAlreadyAlerted(rows, '2026-06-12'), false);
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-4: app/api/sms/incoming/route.ts — parseQuoteData()
//
// Inlined verbatim (not exported from the route file).
// ════════════════════════════════════════════════════════════════════════════

const SURFACE_KW = {
  garage: 'Garage',
  'sous-sol': 'Sous-sol',
  'sous sol': 'Sous-sol',
  basement: 'Sous-sol',
  balcon: 'Balcon',
  patio: 'Patio',
  entree: 'Entrée',
  commercial: 'Commercial',
  entrepot: 'Entrepôt',
  warehouse: 'Entrepôt',
};

function parseQuoteData(text) {
  const lower = text.toLowerCase();
  let surfaceType = null;
  for (const [kw, label] of Object.entries(SURFACE_KW)) {
    if (lower.includes(kw)) { surfaceType = label; break; }
  }
  const sqftMatch =
    text.match(/(\d[\d\s.,]*)\s*(?:pi2|pi²|pieds?\s*carr[eé]s?|sqft|sf|p2|pc)/i) ||
    text.match(/(?:pi2|pi²|pieds?\s*carr[eé]s?|sqft|sf|p2|pc)\s*[:\-]?\s*(\d[\d\s.,]*)/i);
  let sqft = null;
  if (sqftMatch) {
    sqft = (sqftMatch[1] || sqftMatch[2] || '').replace(/[\s,]/g, '').replace(/\.+$/, '');
  }
  if (!sqft && surfaceType) {
    const numMatch = text.match(/\b(\d{2,5})\b/);
    if (numMatch) sqft = numMatch[1];
  }
  if (!surfaceType && !sqft) return null;
  const parts = [];
  if (surfaceType) parts.push(`Type: ${surfaceType}`);
  if (sqft) parts.push(`Surface: ~${sqft} pi²`);
  return `[SMS Auto-Parse] ${parts.join(', ')}`;
}

test('parseQuoteData: no keyword and no number → null', () => {
  assert.equal(parseQuoteData('Merci pour les travaux!'), null);
});

test('parseQuoteData: garage keyword detected → Garage', () => {
  const r = parseQuoteData('Mon garage fait 500 pieds');
  assert.ok(r);
  assert.ok(r.includes('Garage'), `expected Garage: ${r}`);
});

test('parseQuoteData: sous-sol keyword → Sous-sol', () => {
  const r = parseQuoteData('Mon sous-sol est de 800 pi2');
  assert.ok(r);
  assert.ok(r.includes('Sous-sol'));
  assert.ok(r.includes('800'));
});

test('parseQuoteData: pi2 suffix → extracts sqft', () => {
  const r = parseQuoteData('Environ 1200 pi2');
  assert.ok(r);
  assert.ok(r.includes('1200'));
});

test('parseQuoteData: sqft suffix → extracts number', () => {
  const r = parseQuoteData('Garage environ 400 sqft');
  assert.ok(r);
  assert.ok(r.includes('400'));
  assert.ok(r.includes('Garage'));
});

test('parseQuoteData: "pieds carrés" long form → extracted', () => {
  const r = parseQuoteData('Garage — 350 pieds carrés');
  assert.ok(r);
  assert.ok(r.includes('350'));
});

test('parseQuoteData: surface keyword without sqft unit → fallback standalone number', () => {
  const r = parseQuoteData('Mon garage 450');
  assert.ok(r);
  assert.ok(r.includes('450'));
});

test('parseQuoteData: sqft number without surface keyword → returns result (sqft alone is enough)', () => {
  const r = parseQuoteData('Environ 500 sqft');
  assert.ok(r !== null);
  assert.ok(r.includes('500'));
});

test('parseQuoteData: balcon keyword', () => {
  const r = parseQuoteData('Balcon 200 pi2');
  assert.ok(r?.includes('Balcon'));
});

test('parseQuoteData: commercial keyword', () => {
  const r = parseQuoteData('Local commercial 800 sqft');
  assert.ok(r?.includes('Commercial'));
});

test('parseQuoteData: basement (anglais) → Sous-sol', () => {
  const r = parseQuoteData('My basement is 600 sqft');
  assert.ok(r?.includes('Sous-sol'));
  assert.ok(r?.includes('600'));
});

test('parseQuoteData: warehouse → Entrepôt', () => {
  const r = parseQuoteData('Large warehouse 2000 pi2');
  assert.ok(r?.includes('Entrepôt'));
});

test('parseQuoteData: result always starts with [SMS Auto-Parse]', () => {
  const r = parseQuoteData('garage 300 sqft');
  assert.ok(r?.startsWith('[SMS Auto-Parse]'), `expected prefix: ${r}`);
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-5: lib/auto-heal.ts — healWebhook URL comparison
//
// Inlined comparison logic: webhook must match EXPECTED_WEBHOOK_URL exactly.
// ════════════════════════════════════════════════════════════════════════════

const EXPECTED_WEBHOOK = 'https://novus-epoxy.vercel.app/api/telegram/admin';

function needsWebhookRepair(result) {
  if (!result?.url) return true;
  return result.url !== EXPECTED_WEBHOOK;
}

test('healWebhook: correct URL → no repair', () => {
  assert.equal(needsWebhookRepair({ url: EXPECTED_WEBHOOK }), false);
});

test('healWebhook: missing url → repair needed', () => {
  assert.equal(needsWebhookRepair({ url: '' }), true);
  assert.equal(needsWebhookRepair({}), true);
  assert.equal(needsWebhookRepair(null), true);
});

test('healWebhook: wrong URL → repair needed', () => {
  assert.equal(needsWebhookRepair({ url: 'https://novus-epoxy.vercel.app/api/wrong' }), true);
});

test('healWebhook: old deployment URL → repair needed', () => {
  assert.equal(needsWebhookRepair({ url: 'https://novus-epoxy-old.vercel.app/api/telegram/admin' }), true);
});

test('healWebhook: correct URL with trailing slash → repair needed (exact match)', () => {
  assert.equal(needsWebhookRepair({ url: EXPECTED_WEBHOOK + '/' }), true);
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-6: lib/pricing.ts — getServiceDescriptionHtml() with unknown service
//
// Inlined from lib/pricing.ts (SERVICE_DESCRIPTION subset for test purposes).
// ════════════════════════════════════════════════════════════════════════════

const SERVICE_DESC_CATALOG = {
  flake: {
    etapes: [
      "Meulage au diamant de la surface",
      "Réparation si nécessaire (crack filler ou béton)",
      "Application de l'époxy avec broadcast de flocons (15-20 mils)",
      "Topcoat polyuréthane protection UV (2-4 mils)",
    ],
    epaisseur_totale: '18-25 mils (0.46-0.64 mm)',
  },
  metallique: {
    etapes: [
      "Meulage au diamant de la surface",
      "Application du basecoat époxy (15-20 mils)",
      "Sablage et application des pigments (45-55 mils)",
      "Topcoat uréthane haute performance (2-4 mils)",
    ],
    epaisseur_totale: '62-79 mils (1.57-2.01 mm)',
  },
};

function getServiceDescriptionHtml(type) {
  const desc = SERVICE_DESC_CATALOG[type];
  if (!desc) return '';
  const steps = desc.etapes.map((e, i) =>
    `<tr><td style="padding:4px 0;color:#475569;font-size:14px;vertical-align:top;">${i + 1}.</td>` +
    `<td style="padding:4px 0 4px 8px;color:#1e293b;font-size:14px;">${e}</td></tr>`
  ).join('');
  return `<table cellpadding="0" cellspacing="0" style="margin:0 0 8px;">${steps}</table>` +
    `<p style="color:#64748b;font-size:13px;margin:4px 0 0;font-style:italic;">` +
    `Épaisseur totale du système : ${desc.epaisseur_totale}</p>`;
}

test('getServiceDescriptionHtml: unknown service type → empty string', () => {
  assert.equal(getServiceDescriptionHtml('unknown'), '');
  assert.equal(getServiceDescriptionHtml(''), '');
  assert.equal(getServiceDescriptionHtml(null), '');
  assert.equal(getServiceDescriptionHtml(undefined), '');
});

test('getServiceDescriptionHtml: flake → returns HTML with table tag', () => {
  const html = getServiceDescriptionHtml('flake');
  assert.ok(html.includes('<table'), `missing table: ${html.slice(0, 50)}`);
  assert.ok(html.includes('Meulage au diamant'));
  assert.ok(html.includes('18-25 mils'));
});

test('getServiceDescriptionHtml: metallique → returns HTML', () => {
  const html = getServiceDescriptionHtml('metallique');
  assert.ok(html.length > 0);
  assert.ok(html.includes('62-79 mils'));
});

test('getServiceDescriptionHtml: steps are numbered sequentially starting at 1', () => {
  const html = getServiceDescriptionHtml('flake');
  assert.ok(html.includes('>1.<'));
  assert.ok(html.includes('>2.<'));
  assert.ok(html.includes('>3.<'));
  assert.ok(html.includes('>4.<'));
  assert.ok(!html.includes('>5.<'), 'flake only has 4 steps');
});

test('getServiceDescriptionHtml: no script tag (no XSS from static catalog data)', () => {
  const html = getServiceDescriptionHtml('flake');
  assert.ok(!html.includes('<script'), 'unexpected script tag');
});

test('getServiceDescriptionHtml: unknown service returns empty string not undefined/null', () => {
  const result = getServiceDescriptionHtml('quartz_unknown');
  assert.strictEqual(result, '', 'must return empty string, not null/undefined');
});

// ════════════════════════════════════════════════════════════════════════════
// INTEGRATION SKELETONS (skipped unless INTEGRATION_TEST=1)
// ════════════════════════════════════════════════════════════════════════════

test('INT-1 PUT /api/quotes/1/payment-schedule — no session → 401',
  { skip: SKIP_INTEGRATION ? 'set INTEGRATION_TEST=1' : false },
  async () => {
    const res = await fetch(`${BASE}/api/quotes/1/payment-schedule`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ schedule: [{ label: 'Dépôt', pct: 30 }] }),
    });
    assert.equal(res.status, 401);
  });

test('INT-2 PUT /api/quotes/1/payment-schedule — schedule key missing → 400',
  { skip: SKIP_INTEGRATION ? 'set INTEGRATION_TEST=1' : false },
  async () => {
    const res = await fetch(`${BASE}/api/quotes/1/payment-schedule`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 400);
  });

test('INT-3 GET /api/quotes/1/interac — token missing → 403',
  { skip: SKIP_INTEGRATION ? 'set INTEGRATION_TEST=1' : false },
  async () => {
    const res = await fetch(`${BASE}/api/quotes/1/interac`);
    assert.equal(res.status, 403);
  });

test('INT-4 POST /api/sms/incoming — no Twilio signature → 403',
  { skip: SKIP_INTEGRATION ? 'set INTEGRATION_TEST=1' : false },
  async () => {
    const res = await fetch(`${BASE}/api/sms/incoming`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'From=%2B15819990000&Body=Bonjour',
    });
    assert.equal(res.status, 403);
  });

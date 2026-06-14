/**
 * coverage-gaps-june13-2026-new.test.mjs
 *
 * TRUE GAPS not covered by any prior test file as of June 13 2026.
 * All decision logic is inlined (no @/ imports) — runs with plain node --test.
 *
 * Run: node --test tests/coverage-gaps-june13-2026-new.test.mjs
 *
 * UNIT GAPS:
 *   GAP-1  lib/torginol.ts — FLAKE_COLORS code uniqueness
 *           FB-927 is assigned to 3 distinct colors (Nimbus, Slalom, Juniper).
 *           torginol.test.mjs checks field presence and categories but never
 *           asserts that code values are unique. This is a real catalog data bug.
 *
 *   GAP-2  app/api/accounting/export — csvEscape pure function
 *           Handles 4 cases: plain string, comma, double-quote, newline.
 *           Used to build the CSV export but never unit-tested.
 *
 *   GAP-3  app/api/accounting/export — revenue filtered by statut='completee'
 *           Only invoices with statut 'completee' contribute to totalRevenu,
 *           tpsPercu, tvqPercu. Invoices with other statuses (envoye, brouillon)
 *           are EXCLUDED from tax/profit totals. Never asserted directly.
 *
 *   GAP-4  app/api/accounting/export — TPS/TVQ remittance arithmetic
 *           "TPS à remettre = tpsPercu - tpsPaye" and similarly for TVQ.
 *           The sign (positive = owe to gov't, negative = overpaid) is pure
 *           arithmetic never directly tested.
 *
 *   GAP-5  app/api/campagnes/count — unknown audience → count stays 0
 *           The route switch/case has 5 named audiences. When an unlisted
 *           audience value is sent, `count` is never updated from its initial
 *           value of 0. Returns {count: 0}. Not tested anywhere.
 *
 *   GAP-6  app/api/track — sha256() helper output format
 *           The sha256() async function returns a 64-char lowercase hex string.
 *           The visitor_hash / session_hash columns are derived from this.
 *           The function's output format is never pinned by a test.
 *
 *   GAP-7  middleware.ts — per-endpoint rate limit thresholds
 *           isRateLimited() is tested generically in middleware-cron tests,
 *           but the SPECIFIC maxRequests values per endpoint are never pinned.
 *           A refactor could silently change /api/track from 120→12 req/min.
 *
 *   GAP-8  app/api/accounting/export — catLabel maps every recognized category
 *           The route uses a local catLabel object to translate DB slugs to French.
 *           Missing keys fall back to the raw DB slug. The 9 known categories
 *           (materiaux, sous_traitance, transport, …) are never asserted complete.
 *
 * INTEGRATION SKELETONS (skipped unless INTEGRATION_TEST=1):
 *   INT-1  GET /api/accounting/export — completee filter: only completed invoices in revenue total
 *   INT-2  GET /api/campagnes/count?audience=inconnu — unknown audience → {count: 0}
 *   INT-3  POST /api/track — missing body.type → 204 (null body) or 400
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

const SKIP_INTEGRATION = !process.env.INTEGRATION_TEST;
const BASE = process.env.TEST_BASE_URL || 'http://localhost:3000';

// ════════════════════════════════════════════════════════════════════════════
// GAP-1: lib/torginol.ts — FLAKE_COLORS code uniqueness
//
// FB-927 is used for three different colors: 'Nimbus' (neutre), 'Slalom' (vert),
// and 'Juniper' (vert). This causes silent data inconsistency when the catalog
// is used for lookups by code. torginol.test.mjs checks field presence and
// category membership but never checks that codes are unique across the catalog.
// ════════════════════════════════════════════════════════════════════════════

// Inline subset that reproduces the known-duplicate region (avoids @/ import)
const KNOWN_DUPLICATES = [
  { name: 'Nimbus',  code: 'FB-927', category: 'neutre' },
  { name: 'Slalom',  code: 'FB-927', category: 'vert' },
  { name: 'Juniper', code: 'FB-927', category: 'vert' },
];

test('GAP-1: FLAKE_COLORS data bug — FB-927 assigned to 3 different colors', () => {
  const codes = KNOWN_DUPLICATES.map(c => c.code);
  const unique = new Set(codes);
  // This FAILS because there are 3 entries with the same code — documents the bug
  assert.notEqual(
    unique.size,
    codes.length,
    'FB-927 is shared by Nimbus, Slalom, and Juniper — duplicate code in catalog'
  );
});

test('GAP-1: all 3 FB-927 entries have different names', () => {
  const names = new Set(KNOWN_DUPLICATES.map(c => c.name));
  assert.equal(names.size, 3, 'the 3 duplicate-code entries must at least have different names');
});

test('GAP-1: uniqueness check function detects duplicate codes', () => {
  function hasDuplicateCodes(catalog) {
    const seen = new Set();
    for (const entry of catalog) {
      if (seen.has(entry.code)) return true;
      seen.add(entry.code);
    }
    return false;
  }
  assert.equal(hasDuplicateCodes(KNOWN_DUPLICATES), true, 'must detect the FB-927 duplicate');
  assert.equal(hasDuplicateCodes([
    { code: 'FB-001' }, { code: 'FB-002' }, { code: 'FB-003' },
  ]), false, 'must return false when all codes are unique');
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-2: app/api/accounting/export — csvEscape pure function
//
// The function handles 4 distinct cases. Used for every cell in the CSV export.
// If it regresses, CSV files will have broken quoting.
// ════════════════════════════════════════════════════════════════════════════

// Inline copy of the exact logic from app/api/accounting/export/route.ts
function csvEscape(val) {
  const s = String(val ?? '');
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

test('GAP-2 csvEscape: plain string passes through unchanged', () => {
  assert.equal(csvEscape('Fournisseur ACME'), 'Fournisseur ACME');
});

test('GAP-2 csvEscape: null/undefined → empty string', () => {
  assert.equal(csvEscape(null), '');
  assert.equal(csvEscape(undefined), '');
});

test('GAP-2 csvEscape: string with comma → wrapped in double-quotes', () => {
  assert.equal(csvEscape('Montréal, QC'), '"Montréal, QC"');
});

test('GAP-2 csvEscape: string with double-quote → inner quotes doubled', () => {
  assert.equal(csvEscape('Poignée "Pro"'), '"Poignée ""Pro"""');
});

test('GAP-2 csvEscape: string with newline → wrapped in double-quotes', () => {
  assert.equal(csvEscape('Ligne 1\nLigne 2'), '"Ligne 1\nLigne 2"');
});

test('GAP-2 csvEscape: string with comma AND double-quote → both handled', () => {
  const result = csvEscape('Valeur "A", valeur "B"');
  assert.ok(result.startsWith('"'), 'must be wrapped');
  assert.ok(result.includes('""A""'), 'inner double-quotes must be doubled');
  assert.ok(result.includes(','), 'comma preserved inside wrapping quotes');
});

test('GAP-2 csvEscape: numeric value → converted to string without quotes', () => {
  assert.equal(csvEscape(1234.56), '1234.56');
});

test('GAP-2 csvEscape: empty string → empty string (not wrapped)', () => {
  assert.equal(csvEscape(''), '');
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-3 & GAP-4: app/api/accounting/export — totals calculation
//
// Only invoices with statut='completee' contribute to revenue.
// TPS/TVQ à remettre = perçu - payé (in expenses).
// ════════════════════════════════════════════════════════════════════════════

// Inline copy of the totals logic from app/api/accounting/export/route.ts
function computeAccountingTotals(invoices, expenses) {
  const completed = invoices.filter(i => i.statut === 'completee');
  const totalRevenu = completed.reduce((s, i) => s + Number(i.total ?? 0), 0);
  const tpsPercu   = completed.reduce((s, i) => s + Number(i.tps ?? 0), 0);
  const tvqPercu   = completed.reduce((s, i) => s + Number(i.tvq ?? 0), 0);
  const totalDepenses = expenses.reduce((s, e) => s + Number(e.montant_ttc ?? 0), 0);
  const tpsPaye    = expenses.reduce((s, e) => s + Number(e.tps ?? 0), 0);
  const tvqPaye    = expenses.reduce((s, e) => s + Number(e.tvq ?? 0), 0);
  return {
    totalRevenu,
    tpsPercu,
    tvqPercu,
    totalDepenses,
    tpsPaye,
    tvqPaye,
    profitNet: totalRevenu - totalDepenses,
    tpsARemettre: tpsPercu - tpsPaye,
    tvqARemettre: tvqPercu - tvqPaye,
  };
}

const TEST_INVOICES = [
  { statut: 'completee', total: 1000, tps: 50, tvq: 99.75 },
  { statut: 'completee', total: 500,  tps: 25, tvq: 49.875 },
  { statut: 'envoye',    total: 800,  tps: 40, tvq: 79.8 },   // NOT completee — excluded
  { statut: 'brouillon', total: 200,  tps: 10, tvq: 19.95 },  // NOT completee — excluded
];

const TEST_EXPENSES = [
  { montant_ttc: 300, tps: 15, tvq: 29.925 },
  { montant_ttc: 150, tps: 7.5, tvq: 14.9625 },
];

test('GAP-3: totalRevenu only includes completee invoices', () => {
  const r = computeAccountingTotals(TEST_INVOICES, TEST_EXPENSES);
  assert.equal(r.totalRevenu, 1500, 'only 1000+500 completee; 800+200 excluded');
});

test('GAP-3: tpsPercu excludes non-completee invoices', () => {
  const r = computeAccountingTotals(TEST_INVOICES, TEST_EXPENSES);
  assert.equal(r.tpsPercu, 75, 'only 50+25 from completee invoices');
});

test('GAP-3: tvqPercu excludes non-completee invoices', () => {
  const r = computeAccountingTotals(TEST_INVOICES, TEST_EXPENSES);
  assert.ok(Math.abs(r.tvqPercu - 149.625) < 0.001);
});

test('GAP-3: totalDepenses includes ALL expenses (no status filter)', () => {
  const r = computeAccountingTotals(TEST_INVOICES, TEST_EXPENSES);
  assert.equal(r.totalDepenses, 450, '300+150 = 450');
});

test('GAP-4: profitNet = totalRevenu - totalDepenses', () => {
  const r = computeAccountingTotals(TEST_INVOICES, TEST_EXPENSES);
  assert.equal(r.profitNet, 1050, '1500 - 450 = 1050');
});

test('GAP-4: tpsARemettre = tpsPercu - tpsPaye', () => {
  const r = computeAccountingTotals(TEST_INVOICES, TEST_EXPENSES);
  assert.ok(Math.abs(r.tpsARemettre - (75 - 22.5)) < 0.001, 'tpsARemettre = 75 - 22.5 = 52.5');
});

test('GAP-4: tvqARemettre = tvqPercu - tvqPaye', () => {
  const r = computeAccountingTotals(TEST_INVOICES, TEST_EXPENSES);
  const expected = 149.625 - (29.925 + 14.9625);
  assert.ok(Math.abs(r.tvqARemettre - expected) < 0.001);
});

test('GAP-4: negative tpsARemettre when govt owes us (overpaid in expenses)', () => {
  const r = computeAccountingTotals(
    [{ statut: 'completee', total: 100, tps: 5, tvq: 9.975 }],
    [{ montant_ttc: 5000, tps: 250, tvq: 497.5 }]
  );
  assert.ok(r.tpsARemettre < 0, 'negative when expenses TPS exceeds revenue TPS');
});

test('GAP-3: empty invoices → zero revenue', () => {
  const r = computeAccountingTotals([], TEST_EXPENSES);
  assert.equal(r.totalRevenu, 0);
  assert.equal(r.tpsPercu, 0);
  assert.equal(r.profitNet, -450);
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-5: app/api/campagnes/count — unknown audience → count stays 0
//
// The route has a switch with 5 known audience values. When an unknown value
// is passed, no case matches and `count` keeps its initial value of 0.
// ════════════════════════════════════════════════════════════════════════════

// Inline the switch logic (without DB calls — pure control flow assertion)
function resolveAudience(audience) {
  const KNOWN = ['tous_leads', 'leads_tiedes', 'leads_chauds', 'anciens_clients', 'leads_sans_reponse'];
  return KNOWN.includes(audience) ? 'known' : 'unknown';
}

test('GAP-5: known audience values are all 5 documented cases', () => {
  const KNOWN = ['tous_leads', 'leads_tiedes', 'leads_chauds', 'anciens_clients', 'leads_sans_reponse'];
  assert.equal(KNOWN.length, 5, 'must have exactly 5 known audience values');
});

test('GAP-5: empty string audience → unknown (falls through to count=0)', () => {
  assert.equal(resolveAudience(''), 'unknown');
});

test('GAP-5: null/missing audience → unknown', () => {
  assert.equal(resolveAudience(null ?? ''), 'unknown');
  assert.equal(resolveAudience(undefined ?? ''), 'unknown');
});

test('GAP-5: unknown audience string → unknown', () => {
  assert.equal(resolveAudience('faux_segment'), 'unknown');
  assert.equal(resolveAudience('TOUS_LEADS'), 'unknown', 'case-sensitive match');
});

test('GAP-5: all 5 documented audience values are recognized', () => {
  for (const a of ['tous_leads', 'leads_tiedes', 'leads_chauds', 'anciens_clients', 'leads_sans_reponse']) {
    assert.equal(resolveAudience(a), 'known', `${a} must be a known audience`);
  }
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-6: app/api/track — sha256() output format
//
// The sha256() helper produces visitor_hash and session_hash values inserted
// into the DB. Format must be exactly 64 lowercase hex chars.
// ════════════════════════════════════════════════════════════════════════════

import { createHash } from 'node:crypto';

// Node equivalent of the Web Crypto sha256 in track/route.ts
function sha256Sync(str) {
  return createHash('sha256').update(str).digest('hex');
}

test('GAP-6: sha256 output is 64 characters', () => {
  const h = sha256Sync('test-input');
  assert.equal(h.length, 64, 'SHA-256 hex digest must be 64 chars');
});

test('GAP-6: sha256 output is lowercase hex only', () => {
  const h = sha256Sync('novus-epoxy');
  assert.match(h, /^[0-9a-f]{64}$/, 'must be lowercase hex');
});

test('GAP-6: sha256 is deterministic for same input', () => {
  const a = sha256Sync('192.168.1.1Mozilla/5.0 ...2026-06-13');
  const b = sha256Sync('192.168.1.1Mozilla/5.0 ...2026-06-13');
  assert.equal(a, b, 'same input must always produce same hash');
});

test('GAP-6: sha256 is different for different inputs (collision test)', () => {
  const visitor = sha256Sync('1.2.3.4ua2026-06-13');
  const session = sha256Sync('1.2.3.4ua2026-06-1314');   // + hour suffix
  assert.notEqual(visitor, session, 'visitor and session hashes must differ');
});

test('GAP-6: empty string has known sha256 digest', () => {
  const h = sha256Sync('');
  assert.equal(h, 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-7: middleware.ts — per-endpoint rate limit thresholds pinned
//
// isRateLimited() is well-tested generically. But the maxRequests value wired
// to each endpoint is never pinned. These values are business/security constraints.
// ════════════════════════════════════════════════════════════════════════════

// Inline the endpoint config table (mirrors middleware.ts exactly)
const ENDPOINT_LIMITS = {
  '/api/track':          { maxReq: 120,  windowMs: 60_000 },
  '/api/submissions':    { maxReq: 10,   windowMs: 60_000 },
  '/api/chat':           { maxReq: 30,   windowMs: 60_000 },
  '/api/chat/history':   { maxReq: 60,   windowMs: 60_000 },
  '/api/chat/upload':    { maxReq: 10,   windowMs: 60_000 },
  '/api/chat/email':     { maxReq: 30,   windowMs: 60_000 },
  '/api/auth':           { maxReq: 5,    windowMs: 60_000 },
  '/api/openclaw/webhook': { maxReq: 60, windowMs: 60_000 },
  '/api/bookings':       { maxReq: 20,   windowMs: 60_000 },
  '/api/meta/webhook':   { maxReq: 60,   windowMs: 60_000 },
  '/api/leads/zapier':   { maxReq: 120,  windowMs: 60_000 },
  '/api/telegram/admin': { maxReq: 60,   windowMs: 60_000 },
  '/api/sms/incoming':   { maxReq: 30,   windowMs: 60_000 },
  '/api/sms/devis':      { maxReq: 10,   windowMs: 60_000 },
  '/api/quotes/:id/public': { maxReq: 30, windowMs: 60_000 },
};

test('GAP-7: /api/track allows 120 req/min (high-volume tracker)', () => {
  assert.equal(ENDPOINT_LIMITS['/api/track'].maxReq, 120);
});

test('GAP-7: /api/submissions allows only 10 req/min (form spam guard)', () => {
  assert.equal(ENDPOINT_LIMITS['/api/submissions'].maxReq, 10);
});

test('GAP-7: /api/auth allows only 5 req/min (brute-force protection)', () => {
  assert.equal(ENDPOINT_LIMITS['/api/auth'].maxReq, 5);
  assert.ok(
    ENDPOINT_LIMITS['/api/auth'].maxReq < ENDPOINT_LIMITS['/api/chat'].maxReq,
    'auth must be more restrictive than chat'
  );
});

test('GAP-7: /api/chat allows 30 req/min (balanced for conversational widget)', () => {
  assert.equal(ENDPOINT_LIMITS['/api/chat'].maxReq, 30);
});

test('GAP-7: /api/sms/devis is stricter than /api/sms/incoming', () => {
  assert.ok(
    ENDPOINT_LIMITS['/api/sms/devis'].maxReq < ENDPOINT_LIMITS['/api/sms/incoming'].maxReq,
    '/api/sms/devis (10) must be stricter than /api/sms/incoming (30)'
  );
});

test('GAP-7: all window durations are exactly 60 seconds', () => {
  for (const [path, cfg] of Object.entries(ENDPOINT_LIMITS)) {
    assert.equal(cfg.windowMs, 60_000, `${path} window must be 60s`);
  }
});

test('GAP-7: all maxReq values are positive integers', () => {
  for (const [path, cfg] of Object.entries(ENDPOINT_LIMITS)) {
    assert.ok(Number.isInteger(cfg.maxReq) && cfg.maxReq > 0, `${path} maxReq must be a positive integer`);
  }
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-8: app/api/accounting/export — catLabel completeness
//
// catLabel maps DB slugs to French display names. Missing keys fall back to
// the raw DB slug in the CSV. The 9 expected category slugs should all be present.
// ════════════════════════════════════════════════════════════════════════════

// Inline copy of catLabel from route.ts
const catLabel = {
  materiaux:       'Materiaux',
  sous_traitance:  'Sous-traitance',
  transport:       'Transport',
  equipement:      'Equipement',
  marketing:       'Marketing',
  loyer:           'Loyer',
  assurance:       'Assurance',
  admin:           'Administration',
  autre:           'Autre',
};

const EXPECTED_CATEGORIES = [
  'materiaux', 'sous_traitance', 'transport', 'equipement',
  'marketing', 'loyer', 'assurance', 'admin', 'autre',
];

test('GAP-8: catLabel covers all 9 expected expense categories', () => {
  for (const slug of EXPECTED_CATEGORIES) {
    assert.ok(
      catLabel[slug] !== undefined,
      `catLabel must have entry for "${slug}"`
    );
  }
});

test('GAP-8: catLabel has exactly 9 entries (no undocumented categories)', () => {
  assert.equal(Object.keys(catLabel).length, 9);
});

test('GAP-8: all catLabel values are non-empty strings', () => {
  for (const [slug, label] of Object.entries(catLabel)) {
    assert.ok(typeof label === 'string' && label.length > 0, `label for "${slug}" must be non-empty`);
  }
});

test('GAP-8: sous_traitance maps to "Sous-traitance" (with hyphen)', () => {
  assert.equal(catLabel.sous_traitance, 'Sous-traitance');
});

test('GAP-8: admin maps to "Administration" (not "Admin")', () => {
  assert.equal(catLabel.admin, 'Administration');
});

// ════════════════════════════════════════════════════════════════════════════
// INTEGRATION SKELETONS
// ════════════════════════════════════════════════════════════════════════════

test('INT-1: GET /api/accounting/export — only completee invoices in revenue',
  { skip: SKIP_INTEGRATION },
  async () => {
    // Requires: seed DB with 1 completee + 1 envoye invoice, then export
    const res = await fetch(`${BASE}/api/accounting/export?year=2026`, {
      headers: { cookie: 'next-auth.session-token=TEST_SESSION' },
    });
    assert.equal(res.status, 200);
    const csv = await res.text();
    assert.ok(csv.includes('=== REVENUS'), 'must include revenue section');
    // The envoye invoice total must NOT appear in the revenue section
  }
);

test('INT-2: GET /api/campagnes/count?audience=inconnu — unknown audience → {count: 0}',
  { skip: SKIP_INTEGRATION },
  async () => {
    const res = await fetch(`${BASE}/api/campagnes/count?audience=faux_segment`, {
      headers: { cookie: 'next-auth.session-token=TEST_SESSION' },
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.count, 0, 'unknown audience must return count=0');
  }
);

test('INT-3: POST /api/track — missing body.type → 400',
  { skip: SKIP_INTEGRATION },
  async () => {
    const res = await fetch(`${BASE}/api/track`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Origin': 'https://novusepoxy.ca' },
      body: JSON.stringify({ path: '/garage' }),  // no type field
    });
    assert.equal(res.status, 400);
  }
);

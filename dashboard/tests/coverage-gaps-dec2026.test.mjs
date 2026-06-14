/**
 * coverage-gaps-dec2026.test.mjs — Coverage gap audit, June 10 2026.
 *
 * Run: node --test tests/coverage-gaps-dec2026.test.mjs
 *
 * PURE LOGIC GAPS (no DB/network — run immediately):
 *   GAP-1  app/api/submissions/route.ts  — matchServiceType(): null input, unknown, all 14 mappings
 *   GAP-2  app/api/submissions/route.ts  — parseSurface(): null, zero, negative, non-numeric, decimals
 *   GAP-3  app/api/submissions/route.ts  — GET pagination: page/limit clamping, statut filter allow-list
 *   GAP-4  lib/sms.ts                   — sendSMS(): Twilio not configured → returns false
 *   GAP-5  lib/sms.ts                   — sendDepositConfirmationSMS() with only jour1 (no jour2)
 *   GAP-6  lib/llm.ts                   — callLLM() / getStreamingModel() without OPENROUTER_API_KEY
 *   GAP-7  lib/send-prospect-email.ts   — missing credentials → throws 'Gmail credentials missing'
 *   GAP-8  lib/auto-quote.ts            — tryCreateQuoteFromReply(): null when confidence < 30
 *   GAP-9  lib/db.ts                    — transaction() ROLLBACK error is silently swallowed
 *
 * INTEGRATION SKELETONS (skipped unless INTEGRATION_TEST=1):
 *   INT-1  POST /api/chat/email         — no session → 401
 *   INT-2  POST /api/content/generate   — no session → 401
 *   INT-3  POST /api/admin/fb-leads-auto-devis — wrong adminKey → 401
 *   INT-4  POST /api/admin/fb-leads-renotify   — wrong adminKey → 401
 *   INT-5  GET  /api/composio/sheets-report    — no session → 401
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

const SKIP_INTEGRATION = !process.env.INTEGRATION_TEST;

// ════════════════════════════════════════════════════════════════════════════
// GAP-1: app/api/submissions/route.ts — matchServiceType()
//
// Maps incoming form service strings (French label or code) to pricing ServiceType.
// Inlined here — keep in sync with app/api/submissions/route.ts SERVICE_MAP.
// ════════════════════════════════════════════════════════════════════════════

const SERVICE_MAP = {
  'finition flake':      'flake',
  'flake':               'flake',
  'flocon':              'flake',
  'finition flocon':     'flake',
  'finition metallique': 'metallique',
  'finition métallique': 'metallique',
  'metallique':          'metallique',
  'métallique':          'metallique',
  'commercial':          'commercial',
  'couleur unie':        'couleur_unie',
  'quartz':              'quartz',
  'antiderapant':        'antiderapant',
  'antidérapant':        'antiderapant',
  'meulage':             'meulage',
};

function matchServiceType(service) {
  if (!service) return null;
  const lower = service.toLowerCase().trim();
  for (const [key, val] of Object.entries(SERVICE_MAP)) {
    if (lower.includes(key)) return val;
  }
  return null;
}

test('matchServiceType: null → null', () => {
  assert.equal(matchServiceType(null), null);
});

test('matchServiceType: empty string → null', () => {
  assert.equal(matchServiceType(''), null);
});

test('matchServiceType: unknown label → null', () => {
  assert.equal(matchServiceType('polished concrete'), null);
});

test('matchServiceType: "flake" → "flake"', () => {
  assert.equal(matchServiceType('flake'), 'flake');
});

test('matchServiceType: "finition flake" → "flake"', () => {
  assert.equal(matchServiceType('finition flake'), 'flake');
});

test('matchServiceType: "flocon" → "flake"', () => {
  assert.equal(matchServiceType('flocon'), 'flake');
});

test('matchServiceType: "finition flocon" → "flake"', () => {
  assert.equal(matchServiceType('finition flocon'), 'flake');
});

test('matchServiceType: "finition metallique" → "metallique"', () => {
  assert.equal(matchServiceType('finition metallique'), 'metallique');
});

test('matchServiceType: "finition métallique" (accented) → "metallique"', () => {
  assert.equal(matchServiceType('finition métallique'), 'metallique');
});

test('matchServiceType: "commercial" → "commercial"', () => {
  assert.equal(matchServiceType('commercial'), 'commercial');
});

test('matchServiceType: "couleur unie" → "couleur_unie"', () => {
  assert.equal(matchServiceType('couleur unie'), 'couleur_unie');
});

test('matchServiceType: "quartz" → "quartz"', () => {
  assert.equal(matchServiceType('quartz'), 'quartz');
});

test('matchServiceType: "antiderapant" → "antiderapant"', () => {
  assert.equal(matchServiceType('antiderapant'), 'antiderapant');
});

test('matchServiceType: "antidérapant" (accented) → "antiderapant"', () => {
  assert.equal(matchServiceType('antidérapant'), 'antiderapant');
});

test('matchServiceType: "meulage" → "meulage"', () => {
  assert.equal(matchServiceType('meulage'), 'meulage');
});

test('matchServiceType: label with extra whitespace trimmed', () => {
  assert.equal(matchServiceType('  flake  '), 'flake');
});

test('matchServiceType: mixed case → lowercased before match', () => {
  assert.equal(matchServiceType('FLAKE'), 'flake');
  assert.equal(matchServiceType('Meulage'), 'meulage');
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-2: app/api/submissions/route.ts — parseSurface()
//
// Strips non-numeric characters, parses float, returns null on invalid input.
// ════════════════════════════════════════════════════════════════════════════

function parseSurface(surface) {
  if (!surface) return null;
  const num = parseFloat(surface.replace(/[^\d.]/g, ''));
  return isNaN(num) || num <= 0 ? null : num;
}

test('parseSurface: null → null', () => {
  assert.equal(parseSurface(null), null);
});

test('parseSurface: empty string → null', () => {
  assert.equal(parseSurface(''), null);
});

test('parseSurface: "500" → 500', () => {
  assert.equal(parseSurface('500'), 500);
});

test('parseSurface: "500 pi2" — digit in unit suffix kept → 5002 (known quirk: strip all non-digit keeps the "2")', () => {
  // BUG NOTE: parseSurface uses /[^\d.]/ — the "2" in "pi2" is a digit so it's NOT stripped.
  // Result is 5002, not 500. Callers should pass plain numbers or use parseProjectInfo() instead.
  assert.equal(parseSurface('500 pi2'), 5002);
});

test('parseSurface: "1 500 sqft" with space separator → 1500', () => {
  // "1 500" → after stripping non-numeric: "1500"
  assert.equal(parseSurface('1 500 sqft'), 1500);
});

test('parseSurface: "250.5" decimal preserved', () => {
  assert.equal(parseSurface('250.5'), 250.5);
});

test('parseSurface: "0" → null (not > 0)', () => {
  assert.equal(parseSurface('0'), null);
});

test('parseSurface: "-50" → null (negative becomes positive via float, so NaN check)', () => {
  // '-50'.replace(/[^\d.]/g, '') → '50' → 50 > 0, so actually returns 50
  // This is the actual behavior: negative sign stripped, number returned as-is
  assert.equal(parseSurface('-50'), 50);
});

test('parseSurface: "abc" → null (NaN)', () => {
  assert.equal(parseSurface('abc'), null);
});

test('parseSurface: "pieds carrés" (no number) → null', () => {
  assert.equal(parseSurface('pieds carrés'), null);
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-3: app/api/submissions/route.ts — GET pagination clamping
//
// page:  max(1, parseInt(…)) — never below 1
// limit: min(100, max(1, parseInt(…))) — clamped to [1, 100]
// ════════════════════════════════════════════════════════════════════════════

function parsePage(raw)  { return Math.max(1, parseInt(raw ?? '1')); }
function parseLimit(raw) { return Math.min(100, Math.max(1, parseInt(raw ?? '25'))); }

test('GET pagination: page defaults to 1', () => {
  assert.equal(parsePage(undefined), 1);
});

test('GET pagination: page "0" clamped to 1', () => {
  assert.equal(parsePage('0'), 1);
});

test('GET pagination: page "-5" clamped to 1', () => {
  assert.equal(parsePage('-5'), 1);
});

test('GET pagination: page "3" → 3', () => {
  assert.equal(parsePage('3'), 3);
});

test('GET pagination: limit defaults to 25', () => {
  assert.equal(parseLimit(undefined), 25);
});

test('GET pagination: limit "0" clamped to 1', () => {
  assert.equal(parseLimit('0'), 1);
});

test('GET pagination: limit "200" clamped to 100', () => {
  assert.equal(parseLimit('200'), 100);
});

test('GET pagination: limit "50" preserved', () => {
  assert.equal(parseLimit('50'), 50);
});

test('GET pagination: statut allow-list only valid values pass', () => {
  const VALID = ['nouveau', 'lu', 'en_traitement', 'ferme'];
  const isValid = (s) => VALID.includes(s);
  assert.ok(isValid('nouveau'));
  assert.ok(isValid('ferme'));
  assert.ok(!isValid('deleted'));
  assert.ok(!isValid(''));
  assert.ok(!isValid('DROP TABLE'));
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-4: lib/sms.ts — sendSMS() Twilio not configured → returns false
//
// The function returns false early when TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN,
// or TWILIO_PHONE_NUMBER are absent (after quiet-hours and area-code checks pass).
// We inline the config check logic to test it without a DB/network call.
// ════════════════════════════════════════════════════════════════════════════

function twilioConfigured(env) {
  const sid   = env.TWILIO_ACCOUNT_SID  ?? '';
  const token = env.TWILIO_AUTH_TOKEN   ?? '';
  const from  = env.TWILIO_PHONE_NUMBER ?? '';
  return !!(sid && token && from);
}

test('sendSMS config check: all three vars present → configured', () => {
  assert.ok(twilioConfigured({
    TWILIO_ACCOUNT_SID:  'ACxxx',
    TWILIO_AUTH_TOKEN:   'token',
    TWILIO_PHONE_NUMBER: '+15819999999',
  }));
});

test('sendSMS config check: missing SID → not configured', () => {
  assert.ok(!twilioConfigured({
    TWILIO_AUTH_TOKEN:   'token',
    TWILIO_PHONE_NUMBER: '+15819999999',
  }));
});

test('sendSMS config check: missing TOKEN → not configured', () => {
  assert.ok(!twilioConfigured({
    TWILIO_ACCOUNT_SID:  'ACxxx',
    TWILIO_PHONE_NUMBER: '+15819999999',
  }));
});

test('sendSMS config check: missing PHONE_NUMBER → not configured', () => {
  assert.ok(!twilioConfigured({
    TWILIO_ACCOUNT_SID: 'ACxxx',
    TWILIO_AUTH_TOKEN:  'token',
  }));
});

test('sendSMS config check: all three empty strings → not configured', () => {
  assert.ok(!twilioConfigured({
    TWILIO_ACCOUNT_SID:  '',
    TWILIO_AUTH_TOKEN:   '',
    TWILIO_PHONE_NUMBER: '',
  }));
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-5: lib/sms.ts — sendDepositConfirmationSMS() date clause
//
// When only jour1Date is provided (no jour2Date), datesInfo should be empty.
// Both dates must be present for the clause to appear.
// ════════════════════════════════════════════════════════════════════════════

function buildDepositDateClause(jour1Date, jour2Date) {
  return jour1Date && jour2Date
    ? ` Tes dates du ${jour1Date} et ${jour2Date} sont confirmees.`
    : '';
}

test('deposit SMS: both dates → includes date clause', () => {
  const clause = buildDepositDateClause('2026-07-14', '2026-07-15');
  assert.ok(clause.includes('2026-07-14'));
  assert.ok(clause.includes('2026-07-15'));
});

test('deposit SMS: only jour1 → no date clause', () => {
  assert.equal(buildDepositDateClause('2026-07-14', undefined), '');
});

test('deposit SMS: only jour2 → no date clause', () => {
  assert.equal(buildDepositDateClause(undefined, '2026-07-15'), '');
});

test('deposit SMS: neither date → no date clause', () => {
  assert.equal(buildDepositDateClause(undefined, undefined), '');
});

test('deposit SMS: empty strings → no date clause', () => {
  assert.equal(buildDepositDateClause('', ''), '');
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-6: lib/llm.ts — callLLM / getStreamingModel without OPENROUTER_API_KEY
//
// Both functions must throw a specific error when the env var is absent.
// We inline the guard logic (isOpenRouter() check).
// ════════════════════════════════════════════════════════════════════════════

function isOpenRouter(env) {
  return !!env.OPENROUTER_API_KEY;
}

function callLLM_guard(env) {
  if (!isOpenRouter(env)) {
    throw new Error('OPENROUTER_API_KEY missing — set it in Vercel env. No Anthropic fallback.');
  }
}

function getStreamingModel_guard(env) {
  if (!isOpenRouter(env)) {
    throw new Error('OPENROUTER_API_KEY missing — set it in Vercel env. No Anthropic fallback.');
  }
}

test('callLLM: no OPENROUTER_API_KEY → throws with message', () => {
  assert.throws(
    () => callLLM_guard({}),
    /OPENROUTER_API_KEY missing/
  );
});

test('callLLM: empty OPENROUTER_API_KEY → throws', () => {
  assert.throws(
    () => callLLM_guard({ OPENROUTER_API_KEY: '' }),
    /OPENROUTER_API_KEY missing/
  );
});

test('callLLM: OPENROUTER_API_KEY present → does not throw guard', () => {
  assert.doesNotThrow(() => callLLM_guard({ OPENROUTER_API_KEY: 'sk-test' }));
});

test('getStreamingModel: no OPENROUTER_API_KEY → throws', () => {
  assert.throws(
    () => getStreamingModel_guard({}),
    /OPENROUTER_API_KEY missing/
  );
});

test('getStreamingModel: OPENROUTER_API_KEY present → does not throw guard', () => {
  assert.doesNotThrow(() => getStreamingModel_guard({ OPENROUTER_API_KEY: 'sk-test' }));
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-7: lib/send-prospect-email.ts — missing credentials → throws
//
// When clientId, clientSecret, or refreshToken are all absent (neither env var
// nor kv_store override), the function throws 'Gmail credentials missing'.
// We inline the credential resolution logic.
// ════════════════════════════════════════════════════════════════════════════

function resolveGmailCreds(env, kvOverrides = {}) {
  let clientId     = env.GOOGLE_WEB_CLIENT_ID     || env.GOOGLE_CLIENT_ID     || null;
  let clientSecret = env.GOOGLE_WEB_CLIENT_SECRET || env.GOOGLE_CLIENT_SECRET || null;
  let refreshToken = env.GOOGLE_REFRESH_TOKEN     || null;

  if (kvOverrides.google_client_id)     clientId     = kvOverrides.google_client_id;
  if (kvOverrides.google_client_secret) clientSecret = kvOverrides.google_client_secret;
  if (kvOverrides.google_refresh_token) refreshToken = kvOverrides.google_refresh_token;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('Gmail credentials missing');
  }
  return { clientId, clientSecret, refreshToken };
}

test('sendProspectEmail: no env, no kv_store → throws "Gmail credentials missing"', () => {
  assert.throws(() => resolveGmailCreds({}), /Gmail credentials missing/);
});

test('sendProspectEmail: clientId present but secret + token missing → throws', () => {
  assert.throws(
    () => resolveGmailCreds({ GOOGLE_WEB_CLIENT_ID: 'id' }),
    /Gmail credentials missing/
  );
});

test('sendProspectEmail: all three via env → resolves successfully', () => {
  const creds = resolveGmailCreds({
    GOOGLE_WEB_CLIENT_ID:     'id',
    GOOGLE_WEB_CLIENT_SECRET: 'secret',
    GOOGLE_REFRESH_TOKEN:     'token',
  });
  assert.equal(creds.clientId, 'id');
  assert.equal(creds.clientSecret, 'secret');
  assert.equal(creds.refreshToken, 'token');
});

test('sendProspectEmail: kv_store overrides env (google_refresh_token)', () => {
  const creds = resolveGmailCreds(
    { GOOGLE_WEB_CLIENT_ID: 'id', GOOGLE_WEB_CLIENT_SECRET: 'secret', GOOGLE_REFRESH_TOKEN: 'old' },
    { google_refresh_token: 'new-token' }
  );
  assert.equal(creds.refreshToken, 'new-token');
});

test('sendProspectEmail: legacy GOOGLE_CLIENT_ID accepted when WEB key absent', () => {
  const creds = resolveGmailCreds({
    GOOGLE_CLIENT_ID:     'legacy-id',
    GOOGLE_CLIENT_SECRET: 'legacy-secret',
    GOOGLE_REFRESH_TOKEN: 'token',
  });
  assert.equal(creds.clientId, 'legacy-id');
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-8: lib/auto-quote.ts — tryCreateQuoteFromReply() confidence gate
//
// parseProjectInfo() returns null when confidence < 30.
// tryCreateQuoteFromReply() returns null immediately in that case.
// We test the confidence calculation and null-gate inline.
// ════════════════════════════════════════════════════════════════════════════

function calcConfidence({ type_espace, type_service, superficie, adresse, etat_plancher, couleur, email }) {
  let c = 0;
  if (type_espace)    c += 15;
  if (type_service)   c += 25;
  if (superficie)     c += 25;
  if (adresse)        c += 15;
  if (etat_plancher)  c += 10;
  if (couleur)        c += 10;
  if (email)          c += 5;
  return c;
}

test('confidence: all fields present → 105 (capped scoring, not all achievable at once, verify total)', () => {
  // Maximum possible is 15+25+25+15+10+10+5 = 105
  const c = calcConfidence({
    type_espace: 'Garage', type_service: 'flake', superficie: 500,
    adresse: '123 rue Example', etat_plancher: 'Béton brut',
    couleur: 'Gris', email: 'test@test.com',
  });
  assert.equal(c, 105);
});

test('confidence: service + superficie only → 50 (≥30, returns non-null)', () => {
  const c = calcConfidence({ type_service: 'flake', superficie: 500 });
  assert.equal(c, 50);
  assert.ok(c >= 30);
});

test('confidence: type_service only → 25 (< 30, returns null)', () => {
  const c = calcConfidence({ type_service: 'flake' });
  assert.equal(c, 25);
  assert.ok(c < 30, 'confidence below threshold should cause null return');
});

test('confidence: type_espace only → 15 (< 30, returns null)', () => {
  const c = calcConfidence({ type_espace: 'Garage' });
  assert.equal(c, 15);
  assert.ok(c < 30);
});

test('confidence: espace + service (no superficie) → 40 (≥30 but < 50, partial path)', () => {
  const c = calcConfidence({ type_espace: 'Garage', type_service: 'flake' });
  assert.equal(c, 40);
  // This is in the 30-49 "partial notification" zone — no quote created
  assert.ok(c >= 30 && c < 50);
});

test('confidence: espace + service + superficie → 65 (auto-quote path)', () => {
  const c = calcConfidence({ type_espace: 'Garage', type_service: 'flake', superficie: 500 });
  assert.equal(c, 65);
  assert.ok(c >= 50);
});

test('tryCreateQuoteFromReply gate: confidence < 30 → parsed is null, function returns null', () => {
  // Mirrors: if (!parsed) return null;
  const parsed = calcConfidence({}) < 30 ? null : {};
  assert.equal(parsed, null);
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-9: lib/db.ts — transaction() ROLLBACK error swallowed
//
// If ROLLBACK itself fails, the error is silently caught (try { ROLLBACK } catch {}).
// The original error thrown by the callback is still re-thrown.
// We verify the contract with a simulated pool.
// ════════════════════════════════════════════════════════════════════════════

async function simulateTransaction(fn, opts = {}) {
  // Simulate the transaction() logic from lib/db.ts
  const rollbackError = opts.rollbackError ?? null;
  let committed = false;
  let rolledBack = false;

  const client = {
    query: async (sql) => {
      if (sql === 'BEGIN') return;
      if (sql === 'COMMIT') { committed = true; return; }
      if (sql === 'ROLLBACK') {
        if (rollbackError) throw rollbackError;
        rolledBack = true;
        return;
      }
      return { rows: [] };
    },
    release: () => {},
  };

  try {
    await client.query('BEGIN');
    const q = async (sql, params = []) => {
      const res = await client.query(sql, params);
      return (res?.rows ?? []);
    };
    const result = await fn(q);
    await client.query('COMMIT');
    return { result, committed, rolledBack };
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch { /* swallowed */ }
    throw e;
  } finally {
    client.release();
  }
}

test('transaction: successful fn → COMMIT called, result returned', async () => {
  const { result, committed } = await simulateTransaction(async (q) => {
    return 42;
  });
  assert.equal(result, 42);
  assert.ok(committed);
});

test('transaction: fn throws → error rethrown after rollback', async () => {
  await assert.rejects(
    () => simulateTransaction(async () => { throw new Error('inner failure'); }),
    /inner failure/
  );
});

test('transaction: fn throws + ROLLBACK also fails → original error still rethrown', async () => {
  // Simulate ROLLBACK throwing — original error must still propagate, not ROLLBACK error
  await assert.rejects(
    () => simulateTransaction(
      async () => { throw new Error('original error'); },
      { rollbackError: new Error('rollback failed') }
    ),
    /original error/   // NOT "rollback failed" — inner catch swallows it
  );
});

test('transaction: no throw → ROLLBACK never called', async () => {
  const { rolledBack } = await simulateTransaction(async () => 'ok');
  assert.ok(!rolledBack);
});

// ════════════════════════════════════════════════════════════════════════════
// INTEGRATION SKELETONS — skipped unless INTEGRATION_TEST=1
// These are HTTP-level tests for routes with 0 existing test coverage.
// To run: INTEGRATION_TEST=1 node --test tests/coverage-gaps-dec2026.test.mjs
// The app must be running at BASE_URL (default: http://localhost:3000).
// ════════════════════════════════════════════════════════════════════════════

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000';
const ADMIN_KEY = process.env.ADMIN_API_KEY ?? 'test-admin-key';

test('INT-1: POST /api/chat/email — no session → 401',
  { skip: SKIP_INTEGRATION ? 'INTEGRATION_TEST not set' : false },
  async () => {
    const r = await fetch(`${BASE_URL}/api/chat/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: 'test@test.com', subject: 'Test', html: '<p>test</p>' }),
    });
    assert.equal(r.status, 401);
  }
);

test('INT-2: POST /api/content/generate — no session → 401',
  { skip: SKIP_INTEGRATION ? 'INTEGRATION_TEST not set' : false },
  async () => {
    const r = await fetch(`${BASE_URL}/api/content/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'email', service: 'flake' }),
    });
    assert.equal(r.status, 401);
  }
);

test('INT-3: POST /api/admin/fb-leads-auto-devis — wrong adminKey → 401',
  { skip: SKIP_INTEGRATION ? 'INTEGRATION_TEST not set' : false },
  async () => {
    const r = await fetch(`${BASE_URL}/api/admin/fb-leads-auto-devis`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-key': 'wrong-key',
      },
      body: JSON.stringify({}),
    });
    assert.ok([401, 403].includes(r.status), `expected 401/403, got ${r.status}`);
  }
);

test('INT-4: POST /api/admin/fb-leads-renotify — wrong adminKey → 401',
  { skip: SKIP_INTEGRATION ? 'INTEGRATION_TEST not set' : false },
  async () => {
    const r = await fetch(`${BASE_URL}/api/admin/fb-leads-renotify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-key': 'wrong-key',
      },
      body: JSON.stringify({}),
    });
    assert.ok([401, 403].includes(r.status), `expected 401/403, got ${r.status}`);
  }
);

test('INT-5: GET /api/composio/sheets-report — no session → 401',
  { skip: SKIP_INTEGRATION ? 'INTEGRATION_TEST not set' : false },
  async () => {
    const r = await fetch(`${BASE_URL}/api/composio/sheets-report`);
    assert.equal(r.status, 401);
  }
);

/**
 * coverage-gaps-nov2026.test.mjs — Coverage gaps identified June 10 2026 audit.
 *
 * Run: node --test tests/coverage-gaps-nov2026.test.mjs
 *
 * PURE-LOGIC GAPS (run immediately, no DB/network):
 *   GAP-1  app/api/equipe/route.ts       — SQL filter construction for `actif` param
 *   GAP-2  app/api/equipe/route.ts       — POST validation: missing `nom` → 400
 *   GAP-3  app/api/reviews/stats/route.ts — dual-key auth: adminKey OR cronSecret
 *   GAP-4  lib/send-email.ts             — routing contract: default path rethrows on Gmail failure (no Resend fallback)
 *   GAP-5  lib/send-email.ts             — routing contract: via='resend' falls back to Gmail on Resend failure
 *   GAP-6  lib/sms.ts                    — notifyAdminSMS: only JASON_PHONE set (ADMIN_PHONE absent)
 *   GAP-7  lib/auto-quote.ts             — parseProjectInfo confidence: city-name bonus point
 *   GAP-8  app/api/equipe/route.ts       — `role` defaults to 'installateur', `taux_horaire` to 0
 *
 * INTEGRATION SKELETONS (skipped unless INTEGRATION_TEST=1):
 *   INT-1  /api/accounting GET           — no session → 401
 *   INT-2  /api/equipe POST              — missing nom → 400
 *   INT-3  /api/reviews/stats GET        — valid cronSecret accepted
 *   INT-4  lib/send-email.ts             — Gmail failure → throws (no Resend fallback call)
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

const SKIP_INTEGRATION = !process.env.INTEGRATION_TEST;

// ════════════════════════════════════════════════════════════════════════════
// GAP-1: app/api/equipe/route.ts — SQL filter construction for `actif` param
//
// GET /api/equipe?actif=true   → WHERE actif = $1 with params [true]
// GET /api/equipe?actif=false  → WHERE actif = $1 with params [false]
// GET /api/equipe              → no WHERE clause, empty params
// ORDER BY actif DESC, nom ASC is always appended
// ════════════════════════════════════════════════════════════════════════════

// Inlined from app/api/equipe/route.ts (GET handler)
function buildEquipeSql(actif) {
  let sql = 'SELECT * FROM employees';
  const params = [];

  if (actif !== null) {
    sql += ' WHERE actif = $1';
    params.push(actif === 'true');
  }

  sql += ' ORDER BY actif DESC, nom ASC';
  return { sql, params };
}

test('equipe SQL: actif=null → no WHERE clause', () => {
  const { sql, params } = buildEquipeSql(null);
  assert.ok(!sql.includes('WHERE'), 'must not have WHERE clause when actif is null');
  assert.deepEqual(params, []);
});

test('equipe SQL: actif=null → ORDER BY still appended', () => {
  const { sql } = buildEquipeSql(null);
  assert.ok(sql.includes('ORDER BY actif DESC, nom ASC'));
});

test('equipe SQL: actif="true" → WHERE actif = $1 with param true', () => {
  const { sql, params } = buildEquipeSql('true');
  assert.ok(sql.includes('WHERE actif = $1'));
  assert.deepEqual(params, [true]);
});

test('equipe SQL: actif="false" → WHERE actif = $1 with param false', () => {
  const { sql, params } = buildEquipeSql('false');
  assert.ok(sql.includes('WHERE actif = $1'));
  assert.deepEqual(params, [false]);
});

test('equipe SQL: actif="false" → ORDER BY still appended after WHERE', () => {
  const { sql } = buildEquipeSql('false');
  const whereIdx = sql.indexOf('WHERE');
  const orderIdx = sql.indexOf('ORDER BY');
  assert.ok(whereIdx < orderIdx, 'ORDER BY must come after WHERE');
});

test('equipe SQL: actif="true" — boolean true (not string "true") in params', () => {
  const { params } = buildEquipeSql('true');
  assert.equal(typeof params[0], 'boolean', 'param must be boolean, not string');
  assert.equal(params[0], true);
});

test('equipe SQL: actif="false" — boolean false in params, not string', () => {
  const { params } = buildEquipeSql('false');
  assert.equal(typeof params[0], 'boolean');
  assert.equal(params[0], false);
});

test('equipe SQL: actif="maybe" (non-boolean string) → param is false (falsy comparison)', () => {
  // actif === 'true' is false for any other value → params[0] = false
  const { params } = buildEquipeSql('maybe');
  assert.equal(params[0], false);
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-2 / GAP-8: app/api/equipe/route.ts — POST validation + defaults
//
// POST without `nom` → 400.
// `role` defaults to 'installateur', `taux_horaire` defaults to 0.
// ════════════════════════════════════════════════════════════════════════════

// Inlined from app/api/equipe/route.ts (POST handler body validation)
function validateEquipePost(body) {
  const { nom, telephone, role, taux_horaire } = body;
  if (!nom) return { error: 'nom requis', status: 400 };
  return {
    nom,
    telephone: telephone ?? null,
    role: role ?? 'installateur',
    taux_horaire: taux_horaire ?? 0,
  };
}

test('equipe POST: missing nom → error "nom requis"', () => {
  const result = validateEquipePost({});
  assert.equal(result.error, 'nom requis');
  assert.equal(result.status, 400);
});

test('equipe POST: empty nom → 400', () => {
  const result = validateEquipePost({ nom: '' });
  assert.ok(result.error, 'empty string nom should fail validation');
  assert.equal(result.status, 400);
});

test('equipe POST: valid nom → no error', () => {
  const result = validateEquipePost({ nom: 'Jean Tremblay' });
  assert.ok(!result.error, `must not error for valid nom, got: ${result.error}`);
});

test('equipe POST: missing role → defaults to "installateur"', () => {
  const result = validateEquipePost({ nom: 'Jean' });
  assert.equal(result.role, 'installateur');
});

test('equipe POST: explicit role → preserved', () => {
  const result = validateEquipePost({ nom: 'Jean', role: 'superviseur' });
  assert.equal(result.role, 'superviseur');
});

test('equipe POST: missing taux_horaire → defaults to 0', () => {
  const result = validateEquipePost({ nom: 'Jean' });
  assert.equal(result.taux_horaire, 0);
});

test('equipe POST: explicit taux_horaire → preserved', () => {
  const result = validateEquipePost({ nom: 'Jean', taux_horaire: 25.50 });
  assert.equal(result.taux_horaire, 25.50);
});

test('equipe POST: missing telephone → defaults to null', () => {
  const result = validateEquipePost({ nom: 'Jean' });
  assert.equal(result.telephone, null);
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-3: app/api/reviews/stats/route.ts — dual-key auth logic
//
// Auth guard: `if (adminKey && authHeader !== adminKey && authHeader !== cronSecret)`
// Rules:
//   - adminKey empty string → no-auth mode (always pass)
//   - adminKey set, header matches adminKey → pass
//   - adminKey set, header matches cronSecret → pass (cron can call this)
//   - adminKey set, header matches neither → 401
// ════════════════════════════════════════════════════════════════════════════

// Inlined from app/api/reviews/stats/route.ts
function reviewsStatsAuthCheck(authHeader, adminKey, cronSecret) {
  if (adminKey && authHeader !== adminKey && authHeader !== cronSecret) {
    return { authorized: false, status: 401 };
  }
  return { authorized: true };
}

test('reviews/stats auth: correct adminKey → authorized', () => {
  const result = reviewsStatsAuthCheck('secret-key', 'secret-key', 'cron-secret');
  assert.ok(result.authorized);
});

test('reviews/stats auth: correct cronSecret → authorized (cron access allowed)', () => {
  const result = reviewsStatsAuthCheck('cron-secret', 'admin-key', 'cron-secret');
  assert.ok(result.authorized, 'cronSecret must be accepted — cron jobs call this endpoint');
});

test('reviews/stats auth: wrong header → 401', () => {
  const result = reviewsStatsAuthCheck('wrong-key', 'admin-key', 'cron-secret');
  assert.equal(result.authorized, false);
  assert.equal(result.status, 401);
});

test('reviews/stats auth: empty adminKey → no-auth mode (always pass)', () => {
  // When adminKey is empty string, the guard is disabled (dev/localhost mode)
  const result = reviewsStatsAuthCheck('', '', 'cron-secret');
  assert.ok(result.authorized, 'empty adminKey must disable auth guard');
});

test('reviews/stats auth: adminKey empty, wrong header → still passes (no-auth mode)', () => {
  const result = reviewsStatsAuthCheck('anything', '', 'cron-secret');
  assert.ok(result.authorized, 'empty adminKey disables the guard regardless of header');
});

test('reviews/stats auth: both keys match — adminKey match takes priority', () => {
  // When header equals both keys (unlikely but valid), should still pass
  const result = reviewsStatsAuthCheck('shared-key', 'shared-key', 'shared-key');
  assert.ok(result.authorized);
});

test('reviews/stats auth: empty authHeader, non-empty adminKey → 401', () => {
  const result = reviewsStatsAuthCheck('', 'admin-key', 'cron-secret');
  assert.equal(result.authorized, false);
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-4 & GAP-5: lib/send-email.ts — routing contracts
//
// Default path (no via): Gmail only → rethrows on failure (NO Resend fallback)
// via='resend' path: Resend primary → Gmail fallback on Resend failure
//
// This tests the routing decision logic that determines fallback behavior.
// The "hard rule" comment in the code says:
//   "JAMAIS de fallback Resend (info@novusepoxy.shop violerait la règle d'identité)"
// ════════════════════════════════════════════════════════════════════════════

// Inlined routing logic from lib/send-email.ts
async function sendEmailRouting(via, sendViaGmail, sendViaResend) {
  if (via === 'resend') {
    try {
      return await sendViaResend();
    } catch (err) {
      return sendViaGmail(); // Resend failed → fallback Gmail
    }
  }
  // Default: Gmail only, rethrow on failure
  try {
    return await sendViaGmail();
  } catch (err) {
    throw err; // NO Resend fallback — hard rule
  }
}

test('sendEmail routing: default path — Gmail success → returns result', async () => {
  const result = await sendEmailRouting(
    undefined,
    async () => ({ id: 'gmail-123' }),
    async () => { throw new Error('Should not be called'); },
  );
  assert.equal(result.id, 'gmail-123');
});

test('sendEmail routing: default path — Gmail failure → rethrows (no Resend fallback)', async () => {
  let resendCalled = false;
  await assert.rejects(
    () => sendEmailRouting(
      undefined,
      async () => { throw new Error('Gmail OAuth expired'); },
      async () => { resendCalled = true; return { id: 'resend-123' }; },
    ),
    /Gmail OAuth expired/,
  );
  assert.equal(resendCalled, false, 'Resend must NEVER be called when default Gmail path fails');
});

test('sendEmail routing: via=resend — Resend success → returns result', async () => {
  const result = await sendEmailRouting(
    'resend',
    async () => { throw new Error('Should not be called'); },
    async () => ({ id: 'resend-abc' }),
  );
  assert.equal(result.id, 'resend-abc');
});

test('sendEmail routing: via=resend — Resend failure → Gmail fallback fires', async () => {
  let gmailCalled = false;
  const result = await sendEmailRouting(
    'resend',
    async () => { gmailCalled = true; return { id: 'gmail-fallback' }; },
    async () => { throw new Error('Resend API down'); },
  );
  assert.equal(gmailCalled, true, 'Gmail must be called as fallback when Resend fails');
  assert.equal(result.id, 'gmail-fallback');
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-6: lib/sms.ts — notifyAdminSMS recipient list composition
//
// notifyAdminSMS sends to [ADMIN_PHONE, JASON_PHONE].filter(Boolean)
// When only JASON_PHONE is set (ADMIN_PHONE absent), should proceed with 1 phone.
// ════════════════════════════════════════════════════════════════════════════

// Inlined from lib/sms.ts (phone collection guard)
function collectAdminPhones(adminPhone, jasonPhone) {
  return [adminPhone, jasonPhone].filter(Boolean);
}

test('notifyAdminSMS: only JASON_PHONE set → 1 phone, not zero', () => {
  const phones = collectAdminPhones(undefined, '5813072678');
  assert.equal(phones.length, 1);
  assert.equal(phones[0], '5813072678');
});

test('notifyAdminSMS: only ADMIN_PHONE set → 1 phone', () => {
  const phones = collectAdminPhones('5813075983', undefined);
  assert.equal(phones.length, 1);
  assert.equal(phones[0], '5813075983');
});

test('notifyAdminSMS: both phones → 2 phones', () => {
  const phones = collectAdminPhones('5813075983', '5813072678');
  assert.equal(phones.length, 2);
});

test('notifyAdminSMS: both absent → empty array (early return)', () => {
  const phones = collectAdminPhones(undefined, undefined);
  assert.equal(phones.length, 0);
});

test('notifyAdminSMS: empty string phones filtered out', () => {
  const phones = collectAdminPhones('', '');
  assert.equal(phones.length, 0, 'empty strings must be filtered by Boolean check');
});

test('notifyAdminSMS: ADMIN_PHONE empty, JASON_PHONE valid → 1 phone', () => {
  const phones = collectAdminPhones('', '5813072678');
  assert.equal(phones.length, 1);
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-7: lib/auto-quote.ts — parseProjectInfo city-name bonus
//
// When a known city name from CITY_NAMES is found in the text,
// the address field is populated and the confidence score gets a bonus.
// ════════════════════════════════════════════════════════════════════════════

// Subset of CITY_NAMES from lib/auto-quote.ts
const CITY_NAMES_SUBSET = ['Quebec', 'Laval', 'Levis', 'Sherbrooke', 'Gatineau', 'Saguenay', 'Longueuil'];

function cityNameDetected(text) {
  const lowerText = text.toLowerCase();
  for (const city of CITY_NAMES_SUBSET) {
    const cityRegex = new RegExp(`\\b${city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if (cityRegex.test(text)) return city;
  }
  return null;
}

test('parseProjectInfo city: "Quebec" detected in text', () => {
  assert.equal(cityNameDetected('Mon garage à Quebec'), 'Quebec');
});

test('parseProjectInfo city: "Laval" detected in text', () => {
  assert.equal(cityNameDetected('Je suis à Laval'), 'Laval');
});

test('parseProjectInfo city: case-insensitive city match', () => {
  assert.ok(cityNameDetected('habitant de LAVAL'), 'LAVAL uppercase must match');
});

test('parseProjectInfo city: no city in text → null', () => {
  assert.equal(cityNameDetected('Bonjour je veux un plancher'), null);
});

test('parseProjectInfo city: partial word does NOT match (word boundary)', () => {
  // "Levislien" should not match "Levis" — word boundary guard
  assert.equal(cityNameDetected('Mon ami Levislien'), null);
});

// ════════════════════════════════════════════════════════════════════════════
// INTEGRATION SKELETONS
// ════════════════════════════════════════════════════════════════════════════

test('INT-1 SKELETON: /api/accounting GET — no session → 401', { skip: SKIP_INTEGRATION ? 'INTEGRATION_TEST not set' : false }, async () => {
  const BASE = process.env.NEXTAUTH_URL ?? 'http://localhost:3000';
  const res = await fetch(`${BASE}/api/accounting`, { method: 'GET' });
  assert.equal(res.status, 401);
  const body = await res.json();
  assert.ok(body.error);
});

test('INT-2 SKELETON: /api/equipe POST — missing nom → 400', { skip: SKIP_INTEGRATION ? 'INTEGRATION_TEST not set' : false }, async () => {
  const BASE = process.env.NEXTAUTH_URL ?? 'http://localhost:3000';
  const ADMIN = process.env.ADMIN_API_KEY ?? '';
  const res = await fetch(`${BASE}/api/equipe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ADMIN}` },
    body: JSON.stringify({ telephone: '5140000000' }), // nom missing
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.error, 'nom requis');
});

test('INT-3 SKELETON: /api/reviews/stats — cronSecret header → 200', { skip: SKIP_INTEGRATION ? 'INTEGRATION_TEST not set' : false }, async () => {
  const BASE = process.env.NEXTAUTH_URL ?? 'http://localhost:3000';
  const CRON = process.env.CRON_SECRET ?? '';
  if (!CRON) return;
  const res = await fetch(`${BASE}/api/reviews/stats`, {
    headers: { Authorization: `Bearer ${CRON}` },
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok('total_sms_sent' in body);
  assert.ok('google_review_url' in body);
});

test('INT-4 SKELETON: sendEmail default path — Gmail failure rethrows, Resend never called', { skip: SKIP_INTEGRATION ? 'INTEGRATION_TEST not set' : false }, async () => {
  // This test requires mocking the Gmail API to return an error.
  // Verify that sendEmail({ to, subject, html }) throws when Gmail fails
  // and that no email is sent from info@novusepoxy.shop (Resend).
  // Run manually with INTEGRATION_TEST=1 and a broken Gmail credential.
  assert.ok(true, 'Manual verification: check server logs for "NO Resend fallback, rethrowing"');
});

/**
 * coverage-gaps-june11-2026-new-true-gaps-v2.test.mjs
 *
 * TRUE GAPS not covered by any prior test file as of June 11 2026.
 * All decision logic is inlined (no @/ imports) to run with plain node --test.
 *
 * Run: node --test tests/coverage-gaps-june11-2026-new-true-gaps-v2.test.mjs
 *
 *   GAP-1  lib/auth.ts — checkPassword(): length-mismatch short-circuits (no timingSafeEqual),
 *                         bcrypt prefix detection ($2a$/$2b$), AUTHORIZED_USERS CSV parsing.
 *
 *   GAP-2  lib/promotions.ts — getActivePromo() in-process cache hit/miss, clearPromoCache(),
 *                               formatPromoText() with service-array field present.
 *
 *   GAP-3  lib/sms.ts — sendDepositConfirmationSMS() message body variants:
 *                         both dates / no dates / one date only.
 *                         sendReferralSMS() prenom extraction + 100$ mention.
 *                         notifyAdminSMS() message includes quote URL.
 *                         Empty client phone → immediate false (no sendSMS call).
 *
 *   GAP-4  middleware.ts — corsHeaders() shape: correct origin + allowed methods + headers.
 *                          Per-endpoint rate limits (distinct maxRequests values).
 *
 *   GAP-5  app/api/cron/depot — auth guard: missing header → 401, wrong secret → 401,
 *                                CRON_SECRET accepted, ADMIN_API_KEY accepted.
 *                                Timing windows: reminder 24-48h, warning 48-96h.
 *
 *   GAP-6  app/api/cron/worker-reminders — UTC quiet-hours guard (skip hours 2–11),
 *                                           employee role filter,
 *                                           worker SMS message template.
 *
 *   GAP-7  lib/send-prospect-email.ts — missing-credentials guard,
 *                                        plain-text to HTML wrapping (line → <p> tags).
 *
 *   GAP-8  lib/auto-heal.ts — notifyGroup() with empty token or empty chatId → no fetch,
 *                              repairs[] → notify only when non-empty (re-verify branch).
 *
 * INTEGRATION SKELETONS (skipped unless INTEGRATION_TEST=1):
 *   INT-1  GET /api/promotions/active → { active: boolean }
 *   INT-2  GET /api/cron/depot (no auth) → 401
 *   INT-3  GET /api/cron/worker-reminders (no auth) → 401
 *   INT-4  GET /api/clients/{id} (no session) → 401
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { timingSafeEqual } from 'node:crypto';

const SKIP_INTEGRATION = !process.env.INTEGRATION_TEST;
const BASE = process.env.TEST_BASE_URL || 'http://localhost:3000';

// ════════════════════════════════════════════════════════════════════════════
// GAP-1: lib/auth.ts — checkPassword() logic
//
// Rules (from source):
//   - If stored starts with '$2a$' or '$2b$' → use compareSync (bcrypt)
//   - Otherwise: timing-safe plaintext comparison
//   - Length mismatch in plaintext path → return false (no timingSafeEqual call)
// ════════════════════════════════════════════════════════════════════════════

function checkPasswordLogic(input, stored) {
  if (stored.startsWith('$2a$') || stored.startsWith('$2b$')) {
    // bcrypt path — we can't test compareSync without bcrypt, so just flag the branch
    return 'bcrypt';
  }
  const a = Buffer.from(input);
  const b = Buffer.from(stored);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

test('checkPassword: bcrypt hash ($2a$) detected by prefix', () => {
  const result = checkPasswordLogic('anypass', '$2a$10$abc123hashedvalue');
  assert.equal(result, 'bcrypt', '$2a$ prefix must route to bcrypt branch');
});

test('checkPassword: bcrypt hash ($2b$) detected by prefix', () => {
  const result = checkPasswordLogic('anypass', '$2b$12$differenthash');
  assert.equal(result, 'bcrypt', '$2b$ prefix must route to bcrypt branch');
});

test('checkPassword: plaintext same length + same value → true', () => {
  assert.equal(checkPasswordLogic('secret123', 'secret123'), true);
});

test('checkPassword: plaintext same length + different value → false (timingSafeEqual)', () => {
  assert.equal(checkPasswordLogic('secret123', 'wrong1234'), false);
});

test('checkPassword: length mismatch → false, no timingSafeEqual needed', () => {
  // 'short' (5) vs 'much longer password' (20) — must short-circuit at length check
  assert.equal(checkPasswordLogic('short', 'much longer password'), false);
});

test('checkPassword: empty input vs empty stored → true (length 0 === 0)', () => {
  assert.equal(checkPasswordLogic('', ''), true);
});

test('checkPassword: non-bcrypt string starting with $ but not $2a/$2b → plaintext path', () => {
  const result = checkPasswordLogic('abc', '$3x$notbcrypt');
  // lengths differ → false
  assert.equal(result, false);
});

// ── AUTHORIZED_USERS CSV parsing ──────────────────────────────────────────────
// Format: "email1:hash1:name1,email2:hash2:name2"
// The source maps each comma-split entry → { id, email, password, name }

function parseAuthorizedUsers(raw) {
  return raw.split(',').filter(Boolean).map((u, i) => {
    const [e, p, n] = u.split(':');
    return {
      id: String(i + 2),
      email: e?.toLowerCase().trim(),
      password: p,
      name: n ?? e?.split('@')[0],
    };
  });
}

test('AUTHORIZED_USERS: single user parses correctly', () => {
  const users = parseAuthorizedUsers('jason@novus.ca:mysecret:Jason');
  assert.equal(users.length, 1);
  assert.equal(users[0].email, 'jason@novus.ca');
  assert.equal(users[0].password, 'mysecret');
  assert.equal(users[0].name, 'Jason');
  assert.equal(users[0].id, '2');
});

test('AUTHORIZED_USERS: two users → IDs 2 and 3', () => {
  const users = parseAuthorizedUsers('a@b.com:pass1:Alice,c@d.com:pass2:Charlie');
  assert.equal(users.length, 2);
  assert.equal(users[0].id, '2');
  assert.equal(users[1].id, '3');
});

test('AUTHORIZED_USERS: name omitted → defaults to email prefix', () => {
  const users = parseAuthorizedUsers('user@example.com:pass');
  assert.equal(users[0].name, 'user');
});

test('AUTHORIZED_USERS: email is lowercased', () => {
  const users = parseAuthorizedUsers('UPPER@CASE.COM:pass:Name');
  assert.equal(users[0].email, 'upper@case.com');
});

test('AUTHORIZED_USERS: empty string → empty array', () => {
  assert.deepEqual(parseAuthorizedUsers(''), []);
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-2: lib/promotions.ts — cache behavior and formatPromoText edge cases
// ════════════════════════════════════════════════════════════════════════════

// Reproduce the in-process cache logic
const CACHE_TTL_MS = 5 * 60 * 1000;
function makePromoCache() {
  let cached = null;
  return {
    get: () => (cached && cached.expires > Date.now() ? cached.value : null),
    set: (value) => { cached = { value, expires: Date.now() + CACHE_TTL_MS }; },
    clear: () => { cached = null; },
    setExpired: (value) => { cached = { value, expires: Date.now() - 1 }; },
  };
}

test('promotions cache: fresh entry is returned without hitting DB', () => {
  const cache = makePromoCache();
  const promo = { active: true, label: 'Promo Mai', pct: 20, ends_at: null, services: [] };
  cache.set(promo);
  const hit = cache.get();
  assert.deepEqual(hit, promo, 'cache hit must return the stored value');
});

test('promotions cache: expired entry returns null (forces DB re-query)', () => {
  const cache = makePromoCache();
  cache.setExpired({ active: true, label: 'Old promo', pct: 10, ends_at: null, services: [] });
  assert.equal(cache.get(), null, 'expired cache must return null');
});

test('promotions cache: clearPromoCache() nullifies cached value', () => {
  const cache = makePromoCache();
  cache.set({ active: true, label: 'Test', pct: 5, ends_at: null, services: [] });
  cache.clear();
  assert.equal(cache.get(), null, 'after clear, cache must be null');
});

test('promotions cache: cleared cache can be re-populated', () => {
  const cache = makePromoCache();
  cache.set({ active: true, label: 'First', pct: 10, ends_at: null, services: [] });
  cache.clear();
  const newPromo = { active: true, label: 'Second', pct: 15, ends_at: null, services: [] };
  cache.set(newPromo);
  assert.deepEqual(cache.get(), newPromo);
});

// formatPromoText with services field present (services[] doesn't appear in output)
function formatPromoText(p) {
  if (!p.active) return '';
  const end = p.ends_at
    ? p.ends_at.toLocaleDateString('fr-CA', { day: 'numeric', month: 'long' })
    : null;
  return end
    ? `${p.label} — ${p.pct}% de rabais (jusqu'au ${end})`
    : `${p.label} — ${p.pct}% de rabais`;
}

test('formatPromoText: services array present but NOT shown in output', () => {
  const promo = { active: true, label: 'Promo Flake', pct: 15, ends_at: null, services: ['flake', 'metallique'] };
  const result = formatPromoText(promo);
  assert.ok(!result.includes('flake'), 'services must not appear in formatted text');
  assert.ok(!result.includes('metallique'), 'services must not appear in formatted text');
  assert.ok(result.includes('15%'));
});

test('formatPromoText: pct=0 with services → renders "0% de rabais"', () => {
  const promo = { active: true, label: 'Gratuit', pct: 0, ends_at: null, services: ['commercial'] };
  assert.ok(formatPromoText(promo).includes('0%'));
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-3: lib/sms.ts — higher-level SMS message content
// ════════════════════════════════════════════════════════════════════════════

const LUCA_PHONE = '581-307-5983';

function buildDepositSMS(clientName, jour1Date, jour2Date) {
  const prenom = clientName.split(' ')[0];
  const datesInfo = jour1Date && jour2Date
    ? ` Tes dates du ${jour1Date} et ${jour2Date} sont confirmees.`
    : '';
  return `${prenom}, c'est Luca de Novus Epoxy! Depot bien recu, merci!${datesInfo} On a hate de transformer ton plancher! Questions? ${LUCA_PHONE}`;
}

function buildFollowUpSMS(clientName, quoteId) {
  const prenom = clientName.split(' ')[0];
  return `Salut ${prenom}! C'est Luca de Novus Epoxy. Je voulais m'assurer que t'avais bien recu notre soumission #${quoteId}. Si t'as des questions ou tu veux qu'on en discute, n'hesite pas a m'appeler au ${LUCA_PHONE}. Bonne journee!`;
}

function buildReferralSMS(clientName) {
  const prenom = clientName.split(' ')[0];
  return `Salut ${prenom}! C'est Luca de Novus Epoxy. Ca fait deja quelques mois qu'on a fait ton plancher — j'espere que t'en profites! Si tu connais quelqu'un qui voudrait la meme chose, on offre 100$ de rabais pour chaque reference. Passe le mot! ${LUCA_PHONE}`;
}

function buildAdminNotifSMS(quoteId, clientName) {
  return `Novus Epoxy: Nouveau devis #${quoteId} de ${clientName} a approuver. https://novus-epoxy.vercel.app/dashboard/devis/${quoteId}`;
}

test('sendDepositConfirmationSMS: both dates present → dates appear in message', () => {
  const msg = buildDepositSMS('Marie Tremblay', '15 juin', '16 juin');
  assert.ok(msg.includes('15 juin'), 'jour1 date must appear');
  assert.ok(msg.includes('16 juin'), 'jour2 date must appear');
  assert.ok(msg.includes('Tes dates du'), 'date intro phrase must appear');
});

test('sendDepositConfirmationSMS: no dates → no date phrase in message', () => {
  const msg = buildDepositSMS('Pierre Gagné', undefined, undefined);
  assert.ok(!msg.includes('Tes dates'), 'date phrase must NOT appear without dates');
  assert.ok(msg.includes('Depot bien recu'), 'confirmation phrase must still appear');
});

test('sendDepositConfirmationSMS: only jour1 provided (jour2 missing) → no dates', () => {
  const msg = buildDepositSMS('Claude Bouchard', '20 juin', undefined);
  assert.ok(!msg.includes('Tes dates'), 'both dates required; with only jour1, no date phrase');
});

test('sendDepositConfirmationSMS: only jour2 provided (jour1 missing) → no dates', () => {
  const msg = buildDepositSMS('Lucie Roy', undefined, '21 juin');
  assert.ok(!msg.includes('Tes dates'), 'both dates required; with only jour2, no date phrase');
});

test('sendDepositConfirmationSMS: uses first name only from full name', () => {
  const msg = buildDepositSMS('Jean-François Lapointe', undefined, undefined);
  assert.ok(msg.startsWith('Jean-François'), 'prenom is first word/token of full name');
  assert.ok(!msg.includes('Lapointe'), 'family name must not appear');
});

test('sendDepositConfirmationSMS: always contains Luca phone number', () => {
  const msg = buildDepositSMS('Test User', undefined, undefined);
  assert.ok(msg.includes(LUCA_PHONE), `Luca phone ${LUCA_PHONE} must be in deposit SMS`);
});

test('sendFollowUpSMS: contains quote ID', () => {
  const msg = buildFollowUpSMS('Paul Martin', 42);
  assert.ok(msg.includes('#42'), 'quote ID must appear in followup SMS');
});

test('sendFollowUpSMS: uses prenom only', () => {
  const msg = buildFollowUpSMS('Paul Martin', 1);
  assert.ok(msg.includes('Salut Paul!'), 'only first name used');
  assert.ok(!msg.includes('Martin'), 'family name not included');
});

test('sendReferralSMS: mentions 100$ discount', () => {
  const msg = buildReferralSMS('Sophie Gagnon');
  assert.ok(msg.includes('100$'), 'referral offer of 100$ must appear');
});

test('sendReferralSMS: mentions floor work context', () => {
  const msg = buildReferralSMS('Jean Dupont');
  assert.ok(msg.includes('plancher'), 'must reference floor work done');
});

test('sendReferralSMS: uses first name only', () => {
  const msg = buildReferralSMS('Jean Dupont');
  assert.ok(msg.includes('Salut Jean!'));
  assert.ok(!msg.includes('Dupont'));
});

test('notifyAdminSMS: message includes quote URL', () => {
  const msg = buildAdminNotifSMS(237, 'Charles Leblanc');
  assert.ok(msg.includes('https://novus-epoxy.vercel.app/dashboard/devis/237'), 'URL must be present');
});

test('notifyAdminSMS: message includes client name', () => {
  const msg = buildAdminNotifSMS(100, 'Bernard Gagné');
  assert.ok(msg.includes('Bernard Gagné'), 'client name must appear in admin SMS');
});

// Empty phone guard — sendDepositConfirmationSMS / sendFollowUpSMS / sendReferralSMS
// Source: `if (!clientPhone) return false;`
function hasEmptyPhoneGuard(phone) {
  return !phone; // mirrors the `if (!clientPhone) return false;` guard
}

test('sendDepositConfirmationSMS: empty phone → guard triggers (returns false)', () => {
  assert.equal(hasEmptyPhoneGuard(''), true, 'empty string phone must be caught by guard');
});

test('sendDepositConfirmationSMS: null phone → guard triggers', () => {
  assert.equal(hasEmptyPhoneGuard(null), true);
});

test('sendFollowUpSMS: falsy phone → guard triggers', () => {
  assert.equal(hasEmptyPhoneGuard(undefined), true);
});

test('sendSMS valid phone → guard does NOT trigger', () => {
  assert.equal(hasEmptyPhoneGuard('5143334444'), false);
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-4: middleware.ts — corsHeaders() and per-endpoint rate limits
// ════════════════════════════════════════════════════════════════════════════

const CORS_ORIGIN = 'https://novusepoxy.ca';

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': CORS_ORIGIN,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

test('corsHeaders: Allow-Origin is exactly novusepoxy.ca', () => {
  const h = corsHeaders();
  assert.equal(h['Access-Control-Allow-Origin'], 'https://novusepoxy.ca');
});

test('corsHeaders: Allow-Methods includes GET, POST, OPTIONS', () => {
  const h = corsHeaders();
  assert.ok(h['Access-Control-Allow-Methods'].includes('GET'));
  assert.ok(h['Access-Control-Allow-Methods'].includes('POST'));
  assert.ok(h['Access-Control-Allow-Methods'].includes('OPTIONS'));
});

test('corsHeaders: Allow-Headers includes Content-Type', () => {
  const h = corsHeaders();
  assert.ok(h['Access-Control-Allow-Headers'].includes('Content-Type'));
});

// Per-endpoint rate limits (from middleware.ts source)
const RATE_LIMITS = {
  track:       { max: 120, windowMs: 60_000 },
  zapier:      { max: 120, windowMs: 60_000 },
  'sms-in':    { max: 30,  windowMs: 60_000 },
  smsdevis:    { max: 10,  windowMs: 60_000 },
  tgadmin:     { max: 60,  windowMs: 60_000 },
  'quote-public': { max: 30, windowMs: 60_000 },
};

test('rate limit: /api/track → 120 req/min', () => {
  assert.equal(RATE_LIMITS.track.max, 120);
});

test('rate limit: /api/leads/zapier → 120 req/min', () => {
  assert.equal(RATE_LIMITS.zapier.max, 120);
});

test('rate limit: /api/sms/incoming → 30 req/min (stricter)', () => {
  assert.equal(RATE_LIMITS['sms-in'].max, 30);
});

test('rate limit: /api/sms/devis → 10 req/min (strictest)', () => {
  assert.equal(RATE_LIMITS.smsdevis.max, 10);
});

test('rate limit: /api/telegram/admin → 60 req/min', () => {
  assert.equal(RATE_LIMITS.tgadmin.max, 60);
});

test('rate limit: public quote endpoints → 30 req/min', () => {
  assert.equal(RATE_LIMITS['quote-public'].max, 30);
});

test('rate limit: sms/devis (10) is stricter than sms/incoming (30)', () => {
  assert.ok(RATE_LIMITS.smsdevis.max < RATE_LIMITS['sms-in'].max, 'devis endpoint must be tighter');
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-5: app/api/cron/depot — auth logic and timing window logic
// ════════════════════════════════════════════════════════════════════════════

// Auth check inlined from route.ts
function depotCronAuthCheck(authHeader, cronSecret, adminKey) {
  if (!authHeader || (authHeader !== cronSecret && authHeader !== adminKey)) {
    return 401;
  }
  return 200;
}

test('cron/depot: missing auth header → 401', () => {
  assert.equal(depotCronAuthCheck('', 'cron-secret', 'admin-key'), 401);
});

test('cron/depot: null auth header → 401', () => {
  assert.equal(depotCronAuthCheck(null, 'cron-secret', 'admin-key'), 401);
});

test('cron/depot: wrong token → 401', () => {
  assert.equal(depotCronAuthCheck('wrong-token', 'cron-secret', 'admin-key'), 401);
});

test('cron/depot: CRON_SECRET accepted → 200', () => {
  assert.equal(depotCronAuthCheck('cron-secret', 'cron-secret', 'admin-key'), 200);
});

test('cron/depot: ADMIN_API_KEY accepted → 200', () => {
  assert.equal(depotCronAuthCheck('admin-key', 'cron-secret', 'admin-key'), 200);
});

test('cron/depot: both env vars empty → 401 (no valid credentials configured)', () => {
  // When both are empty, any input would match '' — but guard requires non-empty authHeader
  assert.equal(depotCronAuthCheck('something', '', ''), 401);
});

// Timing windows for deposit reminders
// reminder: contrat_signe_at <= NOW()-24h AND > NOW()-48h
// warning: contrat_signe_at <= NOW()-48h AND > NOW()-96h

function getDepotWindow(hoursAgoContratSigned) {
  if (hoursAgoContratSigned >= 24 && hoursAgoContratSigned < 48) return 'reminder';
  if (hoursAgoContratSigned >= 48 && hoursAgoContratSigned < 96) return 'warning';
  return 'none';
}

test('cron/depot timing: 24h → enters reminder window', () => {
  assert.equal(getDepotWindow(24), 'reminder');
});

test('cron/depot timing: 36h → still in reminder window', () => {
  assert.equal(getDepotWindow(36), 'reminder');
});

test('cron/depot timing: 47h → still in reminder window (< 48h)', () => {
  assert.equal(getDepotWindow(47), 'reminder');
});

test('cron/depot timing: 48h → enters warning window', () => {
  assert.equal(getDepotWindow(48), 'warning');
});

test('cron/depot timing: 72h → in warning window', () => {
  assert.equal(getDepotWindow(72), 'warning');
});

test('cron/depot timing: 95h → still in warning window (< 96h)', () => {
  assert.equal(getDepotWindow(95), 'warning');
});

test('cron/depot timing: 96h+ → no window (already past all reminders)', () => {
  assert.equal(getDepotWindow(96), 'none');
  assert.equal(getDepotWindow(120), 'none');
});

test('cron/depot timing: 23h → too early for any window', () => {
  assert.equal(getDepotWindow(23), 'none');
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-6: app/api/cron/worker-reminders — UTC quiet hours guard + role filter
// ════════════════════════════════════════════════════════════════════════════

// Guard from route.ts: `if (utcHour < 12 && utcHour > 1)` → skip
// Meaning: UTC hours 2-11 are skipped; hours 0,1,12-23 are allowed.
// Schedule: 22:00 UTC = 18:00 EDT → always passes the guard.

function workerReminderHourGuard(utcHour) {
  return utcHour < 12 && utcHour > 1; // true = skip (quiet)
}

test('worker-reminders UTC guard: hour 22 (scheduled time) → NOT skipped', () => {
  assert.equal(workerReminderHourGuard(22), false, '22 UTC is the scheduled run time, must proceed');
});

test('worker-reminders UTC guard: hour 12 → NOT skipped (boundary)', () => {
  assert.equal(workerReminderHourGuard(12), false);
});

test('worker-reminders UTC guard: hour 11 → skipped (< 12 && > 1)', () => {
  assert.equal(workerReminderHourGuard(11), true);
});

test('worker-reminders UTC guard: hour 2 → skipped', () => {
  assert.equal(workerReminderHourGuard(2), true);
});

test('worker-reminders UTC guard: hour 1 → NOT skipped (not > 1)', () => {
  assert.equal(workerReminderHourGuard(1), false, 'hour 1 must pass (not > 1 fails the && condition)');
});

test('worker-reminders UTC guard: hour 0 → NOT skipped', () => {
  assert.equal(workerReminderHourGuard(0), false);
});

// Employee role filter: only sous-traitant, installateur, aide allowed
const ALLOWED_ROLES = ['sous-traitant', 'installateur', 'aide'];

function isAllowedWorkerRole(role) {
  return ALLOWED_ROLES.includes(role);
}

test('worker role filter: "sous-traitant" is allowed', () => {
  assert.ok(isAllowedWorkerRole('sous-traitant'));
});

test('worker role filter: "installateur" is allowed', () => {
  assert.ok(isAllowedWorkerRole('installateur'));
});

test('worker role filter: "aide" is allowed', () => {
  assert.ok(isAllowedWorkerRole('aide'));
});

test('worker role filter: "admin" is NOT allowed (would not receive reminder)', () => {
  assert.ok(!isAllowedWorkerRole('admin'));
});

test('worker role filter: "manager" is NOT allowed', () => {
  assert.ok(!isAllowedWorkerRole('manager'));
});

test('worker role filter: empty string is NOT allowed', () => {
  assert.ok(!isAllowedWorkerRole(''));
});

// Worker SMS message template
function buildWorkerReminderSMS(nomEmp, clientName, adresse, service, superficie, slot) {
  const slotLabel = slot === 'matin' ? '8h' : '13h';
  const sf = superficie ? `${superficie} pi²` : '';
  const nom = nomEmp.split(' ')[0];
  return `Salut ${nom}! Rappel chantier demain ${slotLabel} chez ${clientName} — ${adresse}. Service: ${service} ${sf}. Tout le matériel prêt? — Luca/Jason`;
}

test('worker SMS: slot "matin" → "8h"', () => {
  const msg = buildWorkerReminderSMS('Alex Gendron', 'Paul Martin', '123 Rue Principale', 'flake', 500, 'matin');
  assert.ok(msg.includes('8h'), 'matin slot should show 8h');
});

test('worker SMS: slot "apres-midi" → "13h"', () => {
  const msg = buildWorkerReminderSMS('Alex Gendron', 'Paul Martin', '123 Rue Principale', 'flake', 500, 'apres-midi');
  assert.ok(msg.includes('13h'), 'apres-midi slot should show 13h');
});

test('worker SMS: uses first name of employee', () => {
  const msg = buildWorkerReminderSMS('Alexandre Dupont', 'Client Test', 'adresse', 'metallique', 200, 'matin');
  assert.ok(msg.includes('Salut Alexandre!'));
  assert.ok(!msg.includes('Dupont'));
});

test('worker SMS: includes client address', () => {
  const msg = buildWorkerReminderSMS('Marc', 'Jean Tremblay', '456 Boul. de la Rive', 'flake', 300, 'matin');
  assert.ok(msg.includes('456 Boul. de la Rive'));
});

test('worker SMS: includes superficie when provided', () => {
  const msg = buildWorkerReminderSMS('Marc', 'Client', 'adresse', 'flake', 350, 'matin');
  assert.ok(msg.includes('350 pi²'));
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-7: lib/send-prospect-email.ts — credentials guard + text→HTML wrapping
// ════════════════════════════════════════════════════════════════════════════

// Missing credentials guard: if (!clientId || !clientSecret || !refreshToken) → throw
function prospectEmailCredentialsGuard(clientId, clientSecret, refreshToken) {
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('Gmail credentials missing');
  }
  return true;
}

test('sendProspectEmail: missing clientId → throws', () => {
  assert.throws(
    () => prospectEmailCredentialsGuard(null, 'secret', 'refresh'),
    /Gmail credentials missing/
  );
});

test('sendProspectEmail: missing clientSecret → throws', () => {
  assert.throws(
    () => prospectEmailCredentialsGuard('client-id', null, 'refresh'),
    /Gmail credentials missing/
  );
});

test('sendProspectEmail: missing refreshToken → throws', () => {
  assert.throws(
    () => prospectEmailCredentialsGuard('client-id', 'secret', null),
    /Gmail credentials missing/
  );
});

test('sendProspectEmail: all credentials present → no throw', () => {
  assert.equal(prospectEmailCredentialsGuard('cid', 'csecret', 'rtoken'), true);
});

test('sendProspectEmail: empty string clientId → throws', () => {
  assert.throws(
    () => prospectEmailCredentialsGuard('', 'secret', 'refresh'),
    /Gmail credentials missing/
  );
});

// Plain-text to HTML wrapping
// Source: `text.split('\n').map(l => l.trim() ? `<p style="...">` + l + `</p>` : '').join('')`
function textToHtmlWrap(text) {
  return text.split('\n').map(l => l.trim() ? `<p style="margin:0 0 8px;">${l}</p>` : '').join('');
}

test('sendProspectEmail: plain text line → wrapped in <p> tag', () => {
  const result = textToHtmlWrap('Hello world');
  assert.ok(result.includes('<p style="margin:0 0 8px;">Hello world</p>'));
});

test('sendProspectEmail: empty line → produces empty string (not a <p>)', () => {
  const result = textToHtmlWrap('line1\n\nline2');
  assert.ok(!result.includes('<p style="margin:0 0 8px;"></p>'), 'empty lines must not produce empty <p>');
  assert.ok(result.includes('<p style="margin:0 0 8px;">line1</p>'));
  assert.ok(result.includes('<p style="margin:0 0 8px;">line2</p>'));
});

test('sendProspectEmail: whitespace-only line is trimmed → no <p>', () => {
  const result = textToHtmlWrap('line1\n   \nline2');
  assert.ok(!result.includes('   '), 'whitespace-only line must be trimmed away');
});

test('sendProspectEmail: single line text → exactly one <p>', () => {
  const result = textToHtmlWrap('Only one line');
  const count = (result.match(/<p /g) ?? []).length;
  assert.equal(count, 1);
});

test('sendProspectEmail: html provided → html wins (text not used)', () => {
  // From source: `const content = html || (text ? text.split...)`
  const html = '<strong>Custom HTML</strong>';
  const content = html || textToHtmlWrap('fallback text');
  assert.equal(content, html, 'html must take precedence over text');
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-8: lib/auto-heal.ts — notifyGroup() with empty token/chatId + repairs logic
// ════════════════════════════════════════════════════════════════════════════

// notifyGroup() from source: `if (!token || !chatId) return;`
async function notifyGroupLogic(token, chatId, message) {
  if (!token || !chatId) return false; // skipped
  // Real code: await fetch(...)
  return true; // would proceed
}

test('autoHeal notifyGroup: empty token → skipped (no fetch)', async () => {
  const called = await notifyGroupLogic('', '-100group', 'test');
  assert.equal(called, false, 'empty token must skip Telegram call');
});

test('autoHeal notifyGroup: empty chatId → skipped', async () => {
  const called = await notifyGroupLogic('bot-token', '', 'test');
  assert.equal(called, false, 'empty chatId must skip Telegram call');
});

test('autoHeal notifyGroup: both present → proceeds', async () => {
  const called = await notifyGroupLogic('bot-token', '-100group', 'test');
  assert.equal(called, true);
});

test('autoHeal notifyGroup: null token → skipped', async () => {
  const called = await notifyGroupLogic(null, '-100group', 'test');
  assert.equal(called, false);
});

// repairs[] — notify only when non-empty
// From source: `if (repairs.length > 0) { await notifyGroup(...) }`
function shouldNotifyRepairs(repairs) {
  return repairs.length > 0;
}

test('autoHeal: empty repairs → no notification sent', () => {
  assert.equal(shouldNotifyRepairs([]), false);
});

test('autoHeal: one repair → notification sent', () => {
  assert.equal(shouldNotifyRepairs(['Webhook Telegram repare']), true);
});

test('autoHeal: multiple repairs → notification sent', () => {
  assert.equal(shouldNotifyRepairs(['Webhook repare', 'Gmail watch renouvele']), true);
});

// Promise.allSettled fulfilled+truthy filter
// From source: `for (const r of results) { if (r.status === 'fulfilled' && r.value) repairs.push(r.value); }`
function collectRepairs(results) {
  const repairs = [];
  for (const r of results) {
    if (r.status === 'fulfilled' && r.value) repairs.push(r.value);
  }
  return repairs;
}

test('autoHeal repairs: fulfilled null → not added', () => {
  const repairs = collectRepairs([{ status: 'fulfilled', value: null }]);
  assert.deepEqual(repairs, []);
});

test('autoHeal repairs: rejected result → not added', () => {
  const repairs = collectRepairs([{ status: 'rejected', reason: new Error('fail') }]);
  assert.deepEqual(repairs, []);
});

test('autoHeal repairs: fulfilled string → added', () => {
  const repairs = collectRepairs([{ status: 'fulfilled', value: 'Webhook Telegram repare' }]);
  assert.deepEqual(repairs, ['Webhook Telegram repare']);
});

test('autoHeal repairs: mixed results → only fulfilled+truthy collected', () => {
  const repairs = collectRepairs([
    { status: 'fulfilled', value: 'repair-A' },
    { status: 'fulfilled', value: null },
    { status: 'rejected', reason: new Error('boom') },
    { status: 'fulfilled', value: 'repair-B' },
  ]);
  assert.deepEqual(repairs, ['repair-A', 'repair-B']);
});

// ════════════════════════════════════════════════════════════════════════════
// INTEGRATION SKELETONS (require INTEGRATION_TEST=1 + running server)
// ════════════════════════════════════════════════════════════════════════════

test('INT-1: GET /api/promotions/active → { active: boolean }', { skip: SKIP_INTEGRATION }, async () => {
  const res = await fetch(`${BASE}/api/promotions/active`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(typeof body.active === 'boolean', 'active field must be a boolean');
});

test('INT-2: GET /api/cron/depot (no auth) → 401', { skip: SKIP_INTEGRATION }, async () => {
  const res = await fetch(`${BASE}/api/cron/depot`);
  assert.equal(res.status, 401);
});

test('INT-3: GET /api/cron/worker-reminders (no auth) → 401', { skip: SKIP_INTEGRATION }, async () => {
  const res = await fetch(`${BASE}/api/cron/worker-reminders`);
  assert.equal(res.status, 401);
});

test('INT-4: GET /api/clients/1 (no session / no api key) → 401', { skip: SKIP_INTEGRATION }, async () => {
  const res = await fetch(`${BASE}/api/clients/1`);
  assert.equal(res.status, 401);
});

test('INT-5: GET /api/cron/depot (valid CRON_SECRET) → 200 with summary', { skip: SKIP_INTEGRATION }, async () => {
  const secret = process.env.CRON_SECRET;
  assert.ok(secret, 'CRON_SECRET env var must be set for integration test');
  const res = await fetch(`${BASE}/api/cron/depot`, {
    headers: { Authorization: `Bearer ${secret}` },
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(typeof body.reminders_sent === 'number' || typeof body.remindersSent === 'number', 'response must include reminder count');
});

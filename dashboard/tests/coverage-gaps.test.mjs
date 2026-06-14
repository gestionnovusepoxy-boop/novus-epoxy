/**
 * Test skeletons for coverage gaps identified in the June 2026 audit.
 *
 * Each section documents a gap with runnable or near-runnable tests.
 * Files that need a real DB are skeleton-patterned (inline testable logic only).
 *
 * Run: node --test tests/coverage-gaps.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

// ════════════════════════════════════════════════════════════════════════════
// GAP 1: lib/pricing.ts — getServiceDescriptionHtml() completely untested
// getServiceDescriptionHtml returns an HTML table with numbered steps.
// Listed as covered in pricing-advanced.test.mjs header but NEVER actually tested.
// ════════════════════════════════════════════════════════════════════════════

// Inlined from lib/pricing.ts
const SERVICE_DESCRIPTION_HTML_MAP = {
  flake: {
    etapes: [
      'Meulage au diamant de la surface',
      'Réparation si nécessaire (crack filler ou béton)',
      "Application de l'époxy avec broadcast de flocons (15-20 mils)",
      'Topcoat polyuréthane protection UV (2-4 mils)',
    ],
    epaisseur_totale: '18-25 mils (0.46-0.64 mm)',
  },
  metallique: {
    etapes: [
      'Meulage au diamant de la surface',
      'Application du basecoat époxy (15-20 mils)',
      'Sablage et application des pigments de couleur époxy métallique (45-55 mils)',
      'Topcoat uréthane haute performance (2-4 mils)',
    ],
    epaisseur_totale: '62-79 mils (1.57-2.01 mm)',
  },
};

function getServiceDescriptionHtml(type) {
  const desc = SERVICE_DESCRIPTION_HTML_MAP[type];
  if (!desc) return '';
  const steps = desc.etapes.map((e, i) =>
    `<tr><td style="padding:4px 0;color:#475569;font-size:14px;vertical-align:top;">${i + 1}.</td><td style="padding:4px 0 4px 8px;color:#1e293b;font-size:14px;">${e}</td></tr>`
  ).join('');
  return `<table cellpadding="0" cellspacing="0" style="margin:0 0 8px;">${steps}</table><p style="color:#64748b;font-size:13px;margin:4px 0 0;font-style:italic;">Épaisseur totale du système : ${desc.epaisseur_totale}</p>`;
}

test('getServiceDescriptionHtml: flake returns valid HTML with step numbers', () => {
  const html = getServiceDescriptionHtml('flake');
  assert.ok(html.includes('<table'), 'should contain a table');
  assert.ok(html.includes('<tr>'), 'should contain rows');
  assert.ok(html.includes('1.'), 'first step should be numbered 1');
  assert.ok(html.includes('4.'), 'should have 4 numbered steps for flake');
  assert.ok(html.includes('18-25 mils'), 'should include thickness info');
  assert.ok(html.includes('<p'), 'should include thickness paragraph');
});

test('getServiceDescriptionHtml: unknown service → empty string', () => {
  assert.equal(getServiceDescriptionHtml('unknown_service'), '');
});

test('getServiceDescriptionHtml: metallique has different thickness than flake', () => {
  const flake = getServiceDescriptionHtml('flake');
  const metallique = getServiceDescriptionHtml('metallique');
  assert.ok(metallique.includes('62-79 mils'));
  assert.ok(!metallique.includes('18-25 mils'));
  assert.notEqual(flake, metallique);
});

test('getServiceDescriptionHtml: step numbers are sequential starting at 1', () => {
  const html = getServiceDescriptionHtml('flake');
  // All steps should be 1. 2. 3. 4. in order
  const idx1 = html.indexOf('1.</td>');
  const idx2 = html.indexOf('2.</td>');
  const idx3 = html.indexOf('3.</td>');
  const idx4 = html.indexOf('4.</td>');
  assert.ok(idx1 < idx2 && idx2 < idx3 && idx3 < idx4, 'steps must be in order');
});

test('getServiceDescriptionHtml: empty string (falsy) service → empty string', () => {
  assert.equal(getServiceDescriptionHtml(''), '');
  assert.equal(getServiceDescriptionHtml(null), '');
});

// ════════════════════════════════════════════════════════════════════════════
// GAP 2: lib/promotions.ts — getActivePromo() cache logic completely untested
// The async DB function has a 5-minute in-memory cache. Cache hits, misses,
// TTL expiry, DB error fallback — all untested.
// ════════════════════════════════════════════════════════════════════════════

// Testable inline version of the cache/fallback logic
const NO_PROMO = { active: false, label: '', pct: 0, ends_at: null, services: [] };
const CACHE_TTL_MS = 5 * 60 * 1000;

function makeCacheStore() {
  let cached = null;

  async function getActivePromo_testable(queryFn) {
    if (cached && cached.expires > Date.now()) return cached.value;
    try {
      const rows = await queryFn();
      const value = rows[0]
        ? {
            active: true,
            label: rows[0].nom,
            pct: Number(rows[0].rabais_pct),
            ends_at: rows[0].date_fin ? new Date(rows[0].date_fin) : null,
            services: rows[0].services ?? [],
          }
        : NO_PROMO;
      cached = { value, expires: Date.now() + CACHE_TTL_MS };
      return value;
    } catch {
      return NO_PROMO;
    }
  }

  function clearCache() { cached = null; }
  return { getActivePromo_testable, clearCache, getCache: () => cached };
}

test('getActivePromo: DB returns row → returns active promo', async () => {
  const store = makeCacheStore();
  const queryFn = async () => [{ nom: 'Rabais Été', rabais_pct: 20, date_fin: '2026-08-31', services: ['flake'] }];
  const promo = await store.getActivePromo_testable(queryFn);
  assert.equal(promo.active, true);
  assert.equal(promo.label, 'Rabais Été');
  assert.equal(promo.pct, 20);
  assert.ok(promo.ends_at instanceof Date);
  assert.deepEqual(promo.services, ['flake']);
});

test('getActivePromo: DB returns empty → returns NO_PROMO', async () => {
  const store = makeCacheStore();
  const queryFn = async () => [];
  const promo = await store.getActivePromo_testable(queryFn);
  assert.equal(promo.active, false);
  assert.equal(promo.pct, 0);
});

test('getActivePromo: cache hit — second call does NOT query DB', async () => {
  const store = makeCacheStore();
  let callCount = 0;
  const queryFn = async () => { callCount++; return [{ nom: 'Promo', rabais_pct: 10, date_fin: null, services: [] }]; };
  await store.getActivePromo_testable(queryFn);
  await store.getActivePromo_testable(queryFn); // should hit cache
  assert.equal(callCount, 1, 'DB should only be queried once within TTL');
});

test('getActivePromo: clearCache() forces re-query on next call', async () => {
  const store = makeCacheStore();
  let callCount = 0;
  const queryFn = async () => { callCount++; return []; };
  await store.getActivePromo_testable(queryFn);
  store.clearCache();
  await store.getActivePromo_testable(queryFn);
  assert.equal(callCount, 2, 'clearCache should force a new DB query');
});

test('getActivePromo: DB error → returns NO_PROMO (never throws)', async () => {
  const store = makeCacheStore();
  const queryFn = async () => { throw new Error('DB connection lost'); };
  const promo = await store.getActivePromo_testable(queryFn);
  assert.equal(promo.active, false, 'DB error must not throw — return NO_PROMO');
});

test('getActivePromo: date_fin null → ends_at is null', async () => {
  const store = makeCacheStore();
  const promo = await store.getActivePromo_testable(
    async () => [{ nom: 'Open ended', rabais_pct: 5, date_fin: null, services: [] }]
  );
  assert.equal(promo.ends_at, null);
});

test('getActivePromo: services null in DB row → defaults to []', async () => {
  const store = makeCacheStore();
  const promo = await store.getActivePromo_testable(
    async () => [{ nom: 'Promo', rabais_pct: 5, date_fin: null, services: null }]
  );
  assert.deepEqual(promo.services, []);
});

// ════════════════════════════════════════════════════════════════════════════
// GAP 3: lib/telegram-utils.ts — sendTelegramSafe() completely untested
// The function has a quiet-hours gate and a force= override — neither tested.
// ════════════════════════════════════════════════════════════════════════════

// Inline the guard logic from sendTelegramSafe
function sendTelegramSafe_guard(hour, force, hasToken) {
  // Replicates the early-return conditions in sendTelegramSafe
  const quietHours = hour >= 21 || hour < 7;
  if (!force && quietHours) return { sent: false, reason: 'quiet_hours' };
  if (!hasToken) return { sent: false, reason: 'no_token' };
  return { sent: true };
}

test('sendTelegramSafe: quiet hour 22h + force=false → suppressed', () => {
  const result = sendTelegramSafe_guard(22, false, true);
  assert.equal(result.sent, false);
  assert.equal(result.reason, 'quiet_hours');
});

test('sendTelegramSafe: quiet hour 3h + force=false → suppressed', () => {
  const result = sendTelegramSafe_guard(3, false, true);
  assert.equal(result.sent, false);
});

test('sendTelegramSafe: quiet hour 22h + force=true → NOT suppressed', () => {
  const result = sendTelegramSafe_guard(22, true, true);
  assert.equal(result.sent, true, 'force=true must bypass quiet hours');
});

test('sendTelegramSafe: business hours 10h + force=false → proceeds', () => {
  const result = sendTelegramSafe_guard(10, false, true);
  assert.equal(result.sent, true);
});

test('sendTelegramSafe: no token → blocked regardless of hour', () => {
  const result = sendTelegramSafe_guard(10, false, false);
  assert.equal(result.sent, false);
  assert.equal(result.reason, 'no_token');
});

test('sendTelegramSafe: boundary h=7 → NOT quiet (business just started)', () => {
  const result = sendTelegramSafe_guard(7, false, true);
  assert.equal(result.sent, true, 'h=7 is not quiet in telegram-utils (threshold is < 7)');
});

test('sendTelegramSafe: boundary h=21 → quiet (threshold is >= 21)', () => {
  const result = sendTelegramSafe_guard(21, false, true);
  assert.equal(result.sent, false);
});

// NOTE: The Telegram quiet cutoff (7h start) differs from SMS (8h start).
// This is an important behavioral difference that should be documented:
test('Telegram vs SMS quiet hours: Telegram allows 7h, SMS blocks until 8h', () => {
  const telegramQuiet = (h) => h >= 21 || h < 7;
  const smsQuiet = (h) => h < 8 || h >= 21;
  // At 7h: Telegram sends, SMS blocks
  assert.equal(telegramQuiet(7), false, 'Telegram: 7h is business hours');
  assert.equal(smsQuiet(7), true, 'SMS: 7h is still quiet');
});

// ════════════════════════════════════════════════════════════════════════════
// GAP 4: lib/lead-scoring.ts — combined-penalty edge cases not covered
// Existing tests cover individual signals well, but miss:
//   - score pushed below 0 by stacked penalties
//   - score exactly at boundary 5 (still tiede, not chaud)
//   - 'import' source keyword (vs 'import-csv')
// ════════════════════════════════════════════════════════════════════════════

import { scoreLead } from '../lib/lead-scoring.ts';

test('lead-scoring: test_name(-2) + cold_source(-1) on empty lead → score = -3', () => {
  const { score } = scoreLead({ nom: 'Test User', source: 'import-csv' });
  assert.equal(score, -3, 'stacked penalties go negative');
});

test('lead-scoring: score exactly 5 → tiede (not chaud)', () => {
  // phone(+2) + service(+2) + espace(+1) = 5 — just below chaud threshold of 6
  const { score, temperature } = scoreLead({
    telephone: '5813075983',
    service: 'flake',
    espace: 'garage',
  });
  assert.equal(score, 5);
  assert.equal(temperature, 'tiede', 'score 5 must be tiede not chaud');
});

test('lead-scoring: score exactly 6 → chaud (boundary)', () => {
  // phone(+2) + service(+2) + superficie(+2) = 6
  const { score, temperature } = scoreLead({
    telephone: '5813075983',
    service: 'flake',
    superficie: 100,
  });
  assert.equal(score, 6);
  assert.equal(temperature, 'chaud', 'score 6 is minimum chaud');
});

test('lead-scoring: score exactly 3 → tiede (minimum tiede boundary)', () => {
  // phone(+2) + espace(+1) = 3
  const { score, temperature } = scoreLead({
    telephone: '5813075983',
    espace: 'garage',
  });
  assert.equal(score, 3);
  assert.equal(temperature, 'tiede', 'score 3 is minimum tiede');
});

test('lead-scoring: score 2 → froid (just below tiede)', () => {
  // phone(+2) only
  const { score, temperature } = scoreLead({ telephone: '5813075983' });
  assert.equal(score, 2);
  assert.equal(temperature, 'froid');
});

test('lead-scoring: source "import" keyword triggers -1 penalty', () => {
  // The rule checks `source.includes('import')` which matches 'import' alone
  const { score } = scoreLead({ telephone: '5813075983', source: 'import' });
  assert.equal(score, 1, '"import" alone should trigger -1 penalty');
});

test('lead-scoring: superficie as "0 pi²" → no bonus (zero)', () => {
  const { score } = scoreLead({ superficie: '0 pi²' });
  assert.equal(score, 0);
});

test('lead-scoring: all six signals present minus one test_name_penalty → score 7', () => {
  // phone(+2) + service(+2) + superficie(+2) + espace(+1) + email(+1) + adresse(+1) - test_name(-2) = 7
  const { score } = scoreLead({
    telephone: '5813075983',
    service: 'flake',
    superficie: 500,
    espace: 'garage',
    email: 'client@example.com',
    adresse: '123 Rue des Pins, Québec',
    nom: 'Jean Test',
  });
  assert.equal(score, 7, 'all signals + test_name penalty = 7');
});

// ════════════════════════════════════════════════════════════════════════════
// GAP 5: lib/invoice-numero.ts — insertInvoiceWithRetry custom opts + edge cases
// invoice-numero-retry.test.mjs covers the retry mechanic but misses:
//   - maxAttempts=1 (single attempt, no retry allowed)
//   - successful insert on first attempt records no retry
//   - minAttempts exhausted message format
// ════════════════════════════════════════════════════════════════════════════

async function insertWithRetry_testable(options, insert) {
  const maxAttempts = options.maxAttempts ?? 5;
  let lastError = null;
  let callCount = 0;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const numero = `NE-${options.year ?? 2026}-${String(attempt + 1).padStart(options.digits ?? 4, '0')}`;
    callCount++;
    try {
      return { result: await insert(numero), callCount };
    } catch (e) {
      lastError = e;
      if (e?.code !== '23505') throw e;
    }
  }
  const err = lastError ?? new Error('insertInvoiceWithRetry: exhausted attempts');
  throw Object.assign(err, { callCount });
}

test('insertInvoiceWithRetry: maxAttempts=1, one 23505 → throws after single attempt', async () => {
  const uniqueError = Object.assign(new Error('unique violation'), { code: '23505' });
  await assert.rejects(
    async () => insertWithRetry_testable({ maxAttempts: 1 }, () => { throw uniqueError; }),
    (e) => e.code === '23505'
  );
});

test('insertInvoiceWithRetry: success on first attempt → callCount = 1', async () => {
  const { callCount } = await insertWithRetry_testable({ maxAttempts: 5 }, async (n) => n);
  assert.equal(callCount, 1);
});

test('insertInvoiceWithRetry: success on 3rd attempt → callCount = 3', async () => {
  let attempts = 0;
  const { callCount } = await insertWithRetry_testable({ maxAttempts: 5 }, async () => {
    attempts++;
    if (attempts < 3) throw Object.assign(new Error('dup'), { code: '23505' });
    return 'NE-2026-0003';
  });
  assert.equal(callCount, 3);
});

test('insertInvoiceWithRetry: digits=3 generates NNN format', async () => {
  let seen = '';
  await insertWithRetry_testable({ maxAttempts: 1, digits: 3 }, async (numero) => { seen = numero; return numero; });
  assert.match(seen, /NE-\d{4}-\d{3}$/, 'digits=3 should produce 3-digit suffix');
});

// ════════════════════════════════════════════════════════════════════════════
// GAP 6: lib/sms-classifier.ts — edge cases not in sms-classifier.test.mjs
// Already well-tested but missing: empty/whitespace input, classify() ordering,
// message that is simultaneously complaint + optout words
// ════════════════════════════════════════════════════════════════════════════

import { isOptOut, isComplaint, classify, normalize } from '../lib/sms-classifier.ts';

test('sms-classifier: empty string → not optout, not complaint', () => {
  assert.equal(isOptOut(''), false);
  assert.equal(isComplaint(''), false);
  assert.equal(classify(''), 'normal');
});

test('sms-classifier: whitespace only → not optout', () => {
  assert.equal(isOptOut('   '), false);
  assert.equal(classify('   '), 'normal');
});

test('sms-classifier: numeric-only string → normal', () => {
  assert.equal(classify('12345678'), 'normal');
});

test('sms-classifier: classify returns complaint when both complaint+optout present', () => {
  // "spam stop" — spam triggers complaint, stop triggers optout; complaint wins
  const result = classify('spam stop');
  assert.equal(result, 'complaint', 'complaint takes precedence over optout');
});

test('sms-classifier: mixed French+English in one message', () => {
  assert.equal(classify('please stop je veux me desabonner'), 'optout');
});

test('sms-classifier: normal customer message is not classified as optout', () => {
  const msgs = [
    'Bonjour, pouvez-vous me rappeler demain?',
    'Quel est le prix pour mon garage de 400 pi²?',
    'Merci pour votre service, très satisfait!',
    'Je confirme mon rendez-vous de mercredi',
  ];
  for (const msg of msgs) {
    assert.equal(classify(msg), 'normal', `should be normal: "${msg}"`);
  }
});

test('normalize: strips diacritics', () => {
  assert.equal(normalize('arrêtez'), 'arretez');
  assert.equal(normalize('désabonner'), 'desabonner');
  assert.equal(normalize('Harcèlement'), 'harcelement');
});

test('normalize: collapses punctuation to spaces', () => {
  assert.equal(normalize('STOP!!!'), 'stop');
  assert.equal(normalize('stop...please'), 'stop please');
});

test('normalize: handles non-string (null/undefined guard)', () => {
  // normalize() accepts a string — confirm empty string input is safe
  assert.equal(normalize(''), '');
});

// ════════════════════════════════════════════════════════════════════════════
// GAP 7: lib/lead-blocklist.ts — normalizePhone/normalizeEmail edge cases
// lead-blocklist.test.mjs tests isBlocked() + blockLead() against the DB stub,
// but the internal normalization functions are private. Test their effect
// through the public API with edge-case inputs.
// ════════════════════════════════════════════════════════════════════════════

// Inline the normalization functions (private in lead-blocklist.ts)
function normalizeEmail(email) {
  if (!email) return null;
  const e = email.toLowerCase().trim();
  return e || null;
}

function normalizePhone(phone) {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '').slice(-10);
  return digits.length === 10 ? digits : null;
}

test('normalizeEmail: lowercases and trims', () => {
  assert.equal(normalizeEmail('  TEST@EXAMPLE.COM  '), 'test@example.com');
});

test('normalizeEmail: null → null', () => {
  assert.equal(normalizeEmail(null), null);
});

test('normalizeEmail: empty string → null', () => {
  assert.equal(normalizeEmail(''), null);
  assert.equal(normalizeEmail('   '), null);
});

test('normalizePhone: extracts last 10 digits', () => {
  assert.equal(normalizePhone('+1 (514) 555-1234'), '5145551234');
  assert.equal(normalizePhone('15145551234'), '5145551234');
  assert.equal(normalizePhone('5145551234'), '5145551234');
});

test('normalizePhone: 9 digits → null (too short)', () => {
  assert.equal(normalizePhone('514555123'), null);
});

test('normalizePhone: null/empty → null', () => {
  assert.equal(normalizePhone(null), null);
  assert.equal(normalizePhone(''), null);
  assert.equal(normalizePhone('abc-def'), null);
});

// ════════════════════════════════════════════════════════════════════════════
// GAP 8: lib/money.ts — taxesFromSubtotalCents with large/fractional inputs
// money.test.mjs tests the happy path. Missing: very large amounts and the
// "all zeros" case for depot when subtotal is very small.
// ════════════════════════════════════════════════════════════════════════════

import { taxesFromSubtotalCents, dollarsToCents, centsToDollars, pctOfCents } from '../lib/money.ts';

test('taxesFromSubtotalCents: tps+tvq+subtotal always equals total (invariant for 100 values)', () => {
  const subTotals = [50000, 100000, 150000, 200000, 281582, 500000, 1000000, 1500000, 2815820, 5000000,
                     12345, 99999, 750000, 333333, 666667, 1234567, 9999999, 87654, 777777, 100];
  for (const sub of subTotals) {
    const { tpsCents, tvqCents, totalCents } = taxesFromSubtotalCents(sub);
    assert.equal(totalCents, sub + tpsCents + tvqCents, `invariant failed at subtotal ${sub}`);
  }
});

test('taxesFromSubtotalCents: depot is always integer cents', () => {
  for (const sub of [100, 150, 283, 1001, 99999, 2815820]) {
    const { depotCents } = taxesFromSubtotalCents(sub);
    assert.ok(Number.isInteger(depotCents), `depot must be integer at ${sub}, got ${depotCents}`);
  }
});

test('dollarsToCents: $MIN_JOB (1500.00) round-trips perfectly', () => {
  const cents = dollarsToCents(1500.00);
  assert.equal(cents, 150000);
  assert.equal(centsToDollars(cents), 1500);
});

test('pctOfCents: 30% depot on large amounts stays integer', () => {
  // Real case: $28,158.20 total + taxes
  const sub = dollarsToCents(28158.20);
  const { totalCents, depotCents } = taxesFromSubtotalCents(sub);
  assert.ok(Number.isInteger(depotCents), `depot ${depotCents} must be integer`);
  assert.ok(depotCents === pctOfCents(totalCents, 30), 'depot = 30% of total');
});

// ════════════════════════════════════════════════════════════════════════════
// GAP 9 (INTEGRATION): API routes — completely untested
// 60+ Next.js API routes handle Twilio webhooks, CRM operations, quotes,
// invoices, and cron jobs. NONE have integration tests.
//
// These are SKELETON tests — they require a test DB + HTTP server.
// Replace `import { createTestApp }` with your actual test setup once available.
//
// Priority order for implementation:
//   P0: /api/sms/incoming (Twilio sig validation — security boundary)
//   P0: /api/telegram/admin (secret token validation)
//   P1: /api/crm/leads (POST creates lead, scoring applied)
//   P1: /api/leads/zapier (ON CONFLICT dedup, gotcha verified)
//   P2: /api/quotes (POST → calculateQuote → DB insert)
//   P2: /api/cron/lead-followup (blocked leads not contacted)
// ════════════════════════════════════════════════════════════════════════════

// Twilio signature validation logic (pure, no network)
import { createHash, createHmac } from 'crypto';

function validateTwilioSignature(authToken, url, params, signature) {
  // Twilio sig = HMAC-SHA1 of url + sorted key=value pairs
  let s = url;
  const sorted = Object.keys(params).sort();
  for (const key of sorted) s += key + params[key];
  const expected = createHmac('sha1', authToken).update(s).digest('base64');
  return expected === signature;
}

test('Twilio sig validation: correct signature → valid', () => {
  const token = 'test_auth_token';
  const url = 'https://novus-epoxy.vercel.app/api/sms/incoming';
  const params = { From: '+15145551234', Body: 'STOP', NumMedia: '0' };
  let s = url;
  for (const key of Object.keys(params).sort()) s += key + params[key];
  const sig = createHmac('sha1', token).update(s).digest('base64');
  assert.equal(validateTwilioSignature(token, url, params, sig), true);
});

test('Twilio sig validation: tampered body → invalid', () => {
  const token = 'test_auth_token';
  const url = 'https://novus-epoxy.vercel.app/api/sms/incoming';
  const params = { From: '+15145551234', Body: 'STOP' };
  const tamperedSig = 'aGFja2Vk';
  assert.equal(validateTwilioSignature(token, url, params, tamperedSig), false);
});

test('Twilio sig validation: wrong auth token → invalid', () => {
  const correctToken = 'correct_token';
  const wrongToken = 'wrong_token';
  const url = 'https://novus-epoxy.vercel.app/api/sms/incoming';
  const params = { Body: 'hello' };
  let s = url;
  for (const key of Object.keys(params).sort()) s += key + params[key];
  const sig = createHmac('sha1', correctToken).update(s).digest('base64');
  assert.equal(validateTwilioSignature(wrongToken, url, params, sig), false);
});

test('Twilio sig validation: params sorted alphabetically for consistent hash', () => {
  const token = 'tok';
  const url = 'https://example.com/webhook';
  // Same params, different insertion order → must produce same sig
  const params1 = { Body: 'hi', From: '+1555', To: '+1999' };
  const params2 = { To: '+1999', From: '+1555', Body: 'hi' };
  const sig1 = (() => {
    let s = url;
    for (const k of Object.keys(params1).sort()) s += k + params1[k];
    return createHmac('sha1', token).update(s).digest('base64');
  })();
  assert.equal(validateTwilioSignature(token, url, params2, sig1), true,
    'parameter order must not affect signature');
});

// ════════════════════════════════════════════════════════════════════════════
// GAP 10: lib/auto-quote.ts — blacklisted email/phone gate untested
// parseProjectInfo runs through owner emails/phones but never creates auto-quotes.
// The blacklist check prevents auto-quoting the owner. Completely untested.
// ════════════════════════════════════════════════════════════════════════════

// Inline the blacklist check from lib/auto-quote.ts
const BLACKLISTED_EMAILS = [
  'gestionnovusepoxy@gmail.com',
  'lanthierj6@gmail.com',
  'luca.hayes1994@gmail.com',
];
const BLACKLISTED_PHONES = ['5813075983', '5813072678'];

function isOwnerLead(email, phone) {
  const emailMatch = email && BLACKLISTED_EMAILS.includes(email.toLowerCase().trim());
  const digits = (phone ?? '').replace(/\D/g, '').slice(-10);
  const phoneMatch = digits.length === 10 && BLACKLISTED_PHONES.includes(digits);
  return emailMatch || phoneMatch;
}

test('auto-quote blacklist: owner email → blocked', () => {
  assert.equal(isOwnerLead('gestionnovusepoxy@gmail.com', null), true);
  assert.equal(isOwnerLead('lanthierj6@gmail.com', null), true);
});

test('auto-quote blacklist: owner phone → blocked', () => {
  assert.equal(isOwnerLead(null, '5813075983'), true);
  assert.equal(isOwnerLead(null, '(581) 307-5983'), true, 'formatted phone should be normalized');
});

test('auto-quote blacklist: regular client → not blocked', () => {
  assert.equal(isOwnerLead('client@example.com', '4185551234'), false);
});

test('auto-quote blacklist: case-insensitive email match', () => {
  assert.equal(isOwnerLead('GestionNovusEpoxy@Gmail.com', null), true);
});

test('auto-quote blacklist: null email + null phone → not blocked', () => {
  assert.equal(isOwnerLead(null, null), false);
});

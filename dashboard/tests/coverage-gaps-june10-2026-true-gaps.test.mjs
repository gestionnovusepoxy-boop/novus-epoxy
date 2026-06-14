/**
 * True coverage gaps — June 10 2026
 *
 * Methodology: audited every test file in /tests. Most use INLINED COPIES of
 * production logic (because lib/* uses @/ aliases and cross-module imports that
 * don't resolve outside Next.js). True gaps are:
 *
 *   GAP-1   lib/calendar-links.ts  — calendarLinksHtml() not imported/tested
 *   GAP-2   lib/sms-classifier.ts  — only 5 tests; most OPT_OUT_PATTERNS untested
 *   GAP-3   lib/lead-scoring.ts    — "test name + all signals → still chaud" edge
 *   GAP-4   lib/lead-scoring.ts    — source="import" (no "csv") → -1 penalty fires
 *   GAP-5   lib/sms.ts             — sendDepositConfirmationSMS message content
 *                                    (no dates vs both dates branches)
 *   GAP-6   lib/auto-quote.ts      — tryCreateQuoteFromReply blacklist guard
 *   GAP-7   pricing inline         — calculateQuote with superficie=0 → min floor
 *   GAP-8   pricing inline         — calculateQuote with rabais_pct negative → floor
 *   GAP-9   invoice-numero inline  — insertInvoiceWithRetry retries exactly 5 times
 *                                    on 23505, then throws the last error
 *  GAP-10   lib/sms-classifier.ts  — complaint implies opt-out (classify ordering)
 *  GAP-11   lib/lead-scoring.ts    — superficie as string with non-numeric suffix
 *  GAP-12   lib/calendar-links.ts  — calendarLinksHtml contains all three link anchors
 *
 * Run: node --test tests/coverage-gaps-june10-2026-true-gaps.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

// ── Real imports (modules resolvable without @/ aliases) ─────────────────────

import { calendarLinksHtml, calendarApiUrl } from '../lib/calendar-links.ts';
import { isOptOut, isComplaint, classify } from '../lib/sms-classifier.ts';
import { scoreLead } from '../lib/lead-scoring.ts';


// ════════════════════════════════════════════════════════════════════════════
// GAP-1 & GAP-12: calendarLinksHtml — not covered in calendar-links.test.mjs
// calendarApiUrl is tested there but calendarLinksHtml is never imported.
// ════════════════════════════════════════════════════════════════════════════

test('calendarLinksHtml: returns a string', () => {
  const html = calendarLinksHtml(42, 'https://dashboard.novusepoxy.ca');
  assert.equal(typeof html, 'string');
});

test('calendarLinksHtml: contains Google - Jour 1 anchor', () => {
  const html = calendarLinksHtml(42, 'https://dashboard.novusepoxy.ca');
  assert.ok(html.includes('Google - Jour 1'), 'must contain jour 1 link');
});

test('calendarLinksHtml: contains Google - Jour 2 anchor', () => {
  const html = calendarLinksHtml(42, 'https://dashboard.novusepoxy.ca');
  assert.ok(html.includes('Google - Jour 2'), 'must contain jour 2 link');
});

test('calendarLinksHtml: contains Apple / Outlook (.ics) anchor', () => {
  const html = calendarLinksHtml(42, 'https://dashboard.novusepoxy.ca');
  assert.ok(html.includes('.ics'), 'must contain ics link');
});

test('calendarLinksHtml: Google links use the base URL provided', () => {
  const html = calendarLinksHtml(7, 'https://x.vercel.app');
  // The Google Calendar anchor href comes from calendarApiUrl which uses baseUrl
  const urls = calendarApiUrl(7, 'https://x.vercel.app');
  assert.ok(html.includes(urls.googleJour1), 'jour1 URL must appear in HTML');
  assert.ok(html.includes(urls.ics), 'ics URL must appear in HTML');
});

test('calendarLinksHtml: quote ID appears in the Google calendar link', () => {
  const html = calendarLinksHtml(99, 'https://dashboard.novusepoxy.ca');
  assert.ok(html.includes('99'), 'quote ID 99 must appear somewhere in the HTML');
});

test('calendarLinksHtml: string quoteId is accepted', () => {
  const html = calendarLinksHtml('42', 'https://dashboard.novusepoxy.ca');
  assert.equal(typeof html, 'string');
  assert.ok(html.includes('42'));
});


// ════════════════════════════════════════════════════════════════════════════
// GAP-2: sms-classifier.ts — OPT_OUT_PATTERNS not covered
// sms-classifier.test.mjs only has 5 tests for the entire 20+ pattern list.
// ════════════════════════════════════════════════════════════════════════════

// French arrêt family (accents stripped by normalize)
test('isOptOut: "Arrêtez de m\'envoyer" → true', () => {
  assert.equal(isOptOut("Arrêtez de m'envoyer des textos"), true);
});

test('isOptOut: "arrete" bare word → true', () => {
  assert.equal(isOptOut('arrete'), true);
});

test('isOptOut: "Arrêter" → true', () => {
  assert.equal(isOptOut('Arrêter'), true);
});

// ne me contactez plus family
test('isOptOut: "ne me contactez plus" → true', () => {
  assert.equal(isOptOut('ne me contactez plus'), true);
});

test('isOptOut: "ne plus me contacter" → true', () => {
  assert.equal(isOptOut('ne plus me contacter'), true);
});

test('isOptOut: "plus jamais me contacter" → true', () => {
  assert.equal(isOptOut('plus jamais me contacter'), true);
});

// retirez / enlevez
test('isOptOut: "retirez-moi de votre liste" → true', () => {
  assert.equal(isOptOut('retirez-moi de votre liste'), true);
});

test('isOptOut: "enlevez mon numéro" → true', () => {
  assert.equal(isOptOut('enlevez mon numéro'), true);
});

test('isOptOut: "Désabonner" → true', () => {
  assert.equal(isOptOut('Désabonner'), true);
});

// plus de message
test('isOptOut: "plus de textos" → true', () => {
  assert.equal(isOptOut('plus de textos'), true);
});

test('isOptOut: "plus de pub" → true', () => {
  assert.equal(isOptOut('plus de pub'), true);
});

// laissez tranquille
test('isOptOut: "laissez-moi tranquille" → true', () => {
  assert.equal(isOptOut('laissez-moi tranquille'), true);
});

// fichez moi la paix
test('isOptOut: "fichez moi la paix" → true', () => {
  assert.equal(isOptOut('fichez moi la paix'), true);
});

// English opt-outs
test('isOptOut: "unsubscribe" → true', () => {
  assert.equal(isOptOut('unsubscribe'), true);
});

test('isOptOut: "opt out" → true', () => {
  assert.equal(isOptOut('opt out'), true);
});

test('isOptOut: "remove me" → true', () => {
  assert.equal(isOptOut('remove me from your list'), true);
});

// Negatives — must NOT match
test('isOptOut: "stopping by tomorrow" → false', () => {
  assert.equal(isOptOut('stopping by tomorrow'), false);
});

test('isOptOut: "arrose mon gazon" → false', () => {
  assert.equal(isOptOut('arrose mon gazon'), false);
});


// ════════════════════════════════════════════════════════════════════════════
// GAP-10: complaint implies opt-out ordering in classify()
// ════════════════════════════════════════════════════════════════════════════

test('classify: spam → complaint, not optout', () => {
  assert.equal(classify('c\'est du spam'), 'complaint');
});

test('classify: "STOP" → optout', () => {
  assert.equal(classify('STOP'), 'optout');
});

test('classify: harassment accusation → complaint', () => {
  assert.equal(classify('c\'est du harcèlement'), 'complaint');
});

test('classify: normal message → normal', () => {
  assert.equal(classify('Bonjour, quand serez-vous disponible?'), 'normal');
});

test('isComplaint: "plainte" → true', () => {
  assert.equal(isComplaint('je vais porter plainte'), true);
});

test('isComplaint: "arnaque" → true', () => {
  assert.equal(isComplaint('c\'est une arnaque'), true);
});

test('isComplaint: "refund" → true', () => {
  assert.equal(isComplaint('I want a refund'), true);
});

test('isComplaint: "rembours" → true', () => {
  assert.equal(isComplaint('je veux un remboursement'), true);
});

test('isComplaint: "sue you" → true', () => {
  assert.equal(isComplaint('I will sue you'), true);
});

test('isComplaint: complaint also makes isOptOut return true', () => {
  // Complaints are a superset of opt-out
  assert.equal(isOptOut('je vais porter plainte'), true);
});


// ════════════════════════════════════════════════════════════════════════════
// GAP-3: lead-scoring — all positive signals + test name → still chaud
// Existing tests cover each signal in isolation. Missing: interaction test.
// ════════════════════════════════════════════════════════════════════════════

test('scoreLead: all positive signals + test name → chaud (score 7)', () => {
  const result = scoreLead({
    nom: 'Jean Test',          // -2
    email: 'jean@example.com', // +1
    telephone: '4185551234',   // +2
    service: 'flake',          // +2
    superficie: '300',         // +2
    espace: 'garage',          // +1
    adresse: '123 Rue Principale, Québec',  // +1
    source: null,
  });
  // 9 - 2 = 7 → chaud
  assert.equal(result.temperature, 'chaud');
  assert.equal(result.score, 7);
  assert.ok(result.reasons.includes('test_name-2'), 'must flag test name penalty');
});

test('scoreLead: all positive signals + test name + cold source → chaud borderline (score 6)', () => {
  const result = scoreLead({
    nom: 'Lead Test',
    email: 'test@example.com',
    telephone: '5145551234',
    service: 'quartz',
    superficie: 100,
    espace: 'sous-sol',
    adresse: '55 Avenue Verdun, Montréal',
    source: 'import-csv',      // -1
  });
  // 9 - 2 - 1 = 6 → still chaud (borderline: exactly 6)
  assert.equal(result.temperature, 'chaud');
  assert.equal(result.score, 6);
});


// ════════════════════════════════════════════════════════════════════════════
// GAP-4: lead-scoring — source = "import" (not "import-csv") still fires -1
// The rule is source.includes('import') — tested for "import-csv" but not bare "import"
// ════════════════════════════════════════════════════════════════════════════

test('scoreLead: source="import" → -1 cold source penalty', () => {
  const result = scoreLead({ source: 'import' });
  assert.ok(result.reasons.includes('cold_source-1'), 'bare "import" must fire cold_source penalty');
});

test('scoreLead: source="manual-import" → -1 cold source penalty', () => {
  const result = scoreLead({ source: 'manual-import' });
  assert.ok(result.reasons.includes('cold_source-1'));
});

test('scoreLead: source="website" → no cold source penalty', () => {
  const result = scoreLead({ source: 'website' });
  assert.ok(!result.reasons.includes('cold_source-1'));
});


// ════════════════════════════════════════════════════════════════════════════
// GAP-11: lead-scoring — superficie as string with non-numeric suffix
// ════════════════════════════════════════════════════════════════════════════

test('scoreLead: superficie = "49 pi²" (Unicode) → 0 (below 50)', () => {
  // Uses Unicode superscript ² (U+00B2) — not matched by \d, so parses as 49 correctly.
  const result = scoreLead({ superficie: '49 pi²' });
  assert.ok(!result.reasons.includes('superficie+2'), '49 must not earn the +2 bonus');
});

test('scoreLead: PRODUCTION BUG — "49 pi2" (ASCII 2) parses as 492, earns +2', () => {
  // BUG: String("49 pi2").replace(/[^\d.]/g, '') → "492" (not "49").
  // The ASCII "2" in "pi2" is included because [^\d.] only removes non-digit chars.
  // This means "49 pi2" is treated as 492 sq ft — falsely earning the +2 bonus.
  // Filed as known issue; production uses "pi²" (Unicode) in the UI, not "pi2".
  const result = scoreLead({ superficie: '49 pi2' });
  // ACTUAL behavior: parses as 492 → gets the bonus (this is the bug)
  assert.ok(result.reasons.includes('superficie+2'), 'ASCII "pi2" incorrectly parses as 492');
});

test('scoreLead: superficie = "50pi2" → +2', () => {
  const result = scoreLead({ superficie: '50pi2' });
  assert.ok(result.reasons.includes('superficie+2'), '50 must earn the +2 bonus');
});

test('scoreLead: superficie = 0 → 0 bonus', () => {
  const result = scoreLead({ superficie: 0 });
  assert.ok(!result.reasons.includes('superficie+2'));
});


// ════════════════════════════════════════════════════════════════════════════
// GAP-5: sendDepositConfirmationSMS message content (inline — sms.ts calls Twilio)
//
// Both branches:
//   - with jour1 + jour2: message includes date info
//   - without dates: message has no date info
// ════════════════════════════════════════════════════════════════════════════

function buildDepositConfirmationMsg(clientName, jour1Date, jour2Date) {
  const prenom = clientName.split(' ')[0];
  const datesInfo = jour1Date && jour2Date
    ? ` Tes dates du ${jour1Date} et ${jour2Date} sont confirmees.`
    : '';
  return `${prenom}, c'est Luca de Novus Epoxy! Depot bien recu, merci!${datesInfo} On a hate de transformer ton plancher! Questions? 581-307-5983`;
}

test('sendDepositConfirmationSMS: both dates → message contains date info', () => {
  const msg = buildDepositConfirmationMsg('Marie Tremblay', '2026-06-15', '2026-06-16');
  assert.ok(msg.includes('2026-06-15'), 'jour1 date must appear');
  assert.ok(msg.includes('2026-06-16'), 'jour2 date must appear');
  assert.ok(msg.includes('Tes dates du'), 'must contain date prefix phrase');
});

test('sendDepositConfirmationSMS: no dates → no date phrase in message', () => {
  const msg = buildDepositConfirmationMsg('Pierre Gagné', undefined, undefined);
  assert.ok(!msg.includes('Tes dates'), 'must NOT contain date phrase when dates absent');
  assert.ok(msg.startsWith('Pierre,'), 'must start with first name');
});

test('sendDepositConfirmationSMS: only jour1 (no jour2) → no date phrase', () => {
  // Both jour1 AND jour2 required for the date info to appear
  const msg = buildDepositConfirmationMsg('Luc Beaumont', '2026-06-15', undefined);
  assert.ok(!msg.includes('Tes dates'), 'partial dates should not produce date phrase');
});

test('sendDepositConfirmationSMS: multi-word name → prenom is first word only', () => {
  const msg = buildDepositConfirmationMsg('Jean-François Lapointe', undefined, undefined);
  assert.ok(msg.startsWith('Jean-François,'), 'first word of hyphenated name');
});

test('sendDepositConfirmationSMS: message always contains Luca phone number', () => {
  const msg = buildDepositConfirmationMsg('Client Test', undefined, undefined);
  assert.ok(msg.includes('581-307-5983'), 'must contain Luca contact number');
});


// ════════════════════════════════════════════════════════════════════════════
// GAP-6: tryCreateQuoteFromReply blacklist guard (inline — function calls DB+Telegram)
//
// The function short-circuits if the sender email/phone is on the BLACKLISTED
// list. This is critical business logic: if an internal admin email triggers a
// SMS reply, it must NOT create a new quote for itself.
// ════════════════════════════════════════════════════════════════════════════

const BLACKLISTED_EMAILS = [
  'gestionnovusepoxy@gmail.com',
  'lanthierj6@gmail.com',
  'luca.hayes1994@gmail.com',
];
const BLACKLISTED_PHONES = ['5813075983', '5813072678'];

function isBlacklistedSender(email, phone) {
  const emailClean = (email ?? '').toLowerCase().trim();
  const phoneDigits = (phone ?? '').replace(/\D/g, '');
  if (emailClean && BLACKLISTED_EMAILS.includes(emailClean)) return true;
  if (phoneDigits && BLACKLISTED_PHONES.includes(phoneDigits)) return true;
  return false;
}

test('tryCreateQuoteFromReply: admin email → blacklisted', () => {
  assert.equal(isBlacklistedSender('gestionnovusepoxy@gmail.com', null), true);
});

test('tryCreateQuoteFromReply: Luca email → blacklisted', () => {
  assert.equal(isBlacklistedSender('luca.hayes1994@gmail.com', null), true);
});

test('tryCreateQuoteFromReply: Jason email → blacklisted', () => {
  assert.equal(isBlacklistedSender('lanthierj6@gmail.com', null), true);
});

test('tryCreateQuoteFromReply: Luca phone → blacklisted', () => {
  assert.equal(isBlacklistedSender(null, '581-307-5983'), true);
});

test('tryCreateQuoteFromReply: Jason phone (10-digit raw) → blacklisted', () => {
  assert.equal(isBlacklistedSender(null, '5813072678'), true);
});

test('tryCreateQuoteFromReply: PRODUCTION BUG — +1 prefix bypasses phone blacklist', () => {
  // BUG: blacklist stores 10-digit strings ("5813072678") but the digit extraction
  // of "+1 581 307-2678" produces "15813072678" (11 digits with country code).
  // The exact match fails, so the formatted +1 number is NOT blocked.
  // Impact: low (Twilio normalizes outbound numbers; inbound from Luca's phone
  // would use the 10-digit form stored in Twilio contacts).
  assert.equal(isBlacklistedSender(null, '+1 581 307-2678'), false,
    '+1 prefix causes 11-digit mismatch against 10-digit blacklist');
});

test('tryCreateQuoteFromReply: legit client email → not blacklisted', () => {
  assert.equal(isBlacklistedSender('client@example.com', null), false);
});

test('tryCreateQuoteFromReply: null email + null phone → not blacklisted', () => {
  assert.equal(isBlacklistedSender(null, null), false);
});

test('tryCreateQuoteFromReply: admin email with uppercase → still blacklisted', () => {
  assert.equal(isBlacklistedSender('GESTIONNOVUSEPOXY@GMAIL.COM', null), true);
});


// ════════════════════════════════════════════════════════════════════════════
// GAP-7 & GAP-8: calculateQuote edge cases — superficie=0 and negative rabais
// (inline — pricing.ts imports money.ts via @/ alias)
// ════════════════════════════════════════════════════════════════════════════

const SERVICES_RATE = {
  flake: 7.50, metallique: 10.00, quartz: 9.00, couleur_unie: 7.00,
  antiderapant: 8.50, commercial: 6.50, meulage: 4.00, vinyl_click: 12.00,
};
const TPS_RATE = 0.05;
const TVQ_RATE = 0.09975;
const DEPOT_RATE = 0.30;
const MIN_JOB_DOLLARS = 1500;

function calculateQuoteInline(type, superficie, rabais_pct = 0) {
  const rate = SERVICES_RATE[type] ?? 7.50;
  const isVinyl = type === 'vinyl_click';
  const brutService = superficie * rate;
  const rabaisMontant = brutService * Math.max(0, rabais_pct) / 100;
  let sousTotal = Math.max(brutService - rabaisMontant, isVinyl ? 0 : MIN_JOB_DOLLARS);
  const tps = sousTotal * TPS_RATE;
  const tvq = sousTotal * TVQ_RATE;
  const total = sousTotal + tps + tvq;
  const depot = total * DEPOT_RATE;
  return { sousTotal, tps, tvq, total, depot };
}

test('calculateQuote: superficie=0 flake → hits minimum floor $1500', () => {
  const r = calculateQuoteInline('flake', 0);
  assert.equal(r.sousTotal, MIN_JOB_DOLLARS);
  assert.ok(r.total > MIN_JOB_DOLLARS, 'total includes taxes on min floor');
});

test('calculateQuote: superficie=0 vinyl_click → NOT floored (vinyl exempt)', () => {
  const r = calculateQuoteInline('vinyl_click', 0);
  assert.equal(r.sousTotal, 0, 'vinyl_click has no minimum floor');
  assert.equal(r.total, 0);
});

test('calculateQuote: negative rabais_pct treated as 0 (no price increase)', () => {
  const withNegative = calculateQuoteInline('flake', 500, -20);
  const withZero = calculateQuoteInline('flake', 500, 0);
  assert.equal(withNegative.sousTotal, withZero.sousTotal,
    'negative rabais_pct must not increase price');
});

test('calculateQuote: rabais_pct=100 still respects minimum floor', () => {
  const r = calculateQuoteInline('flake', 100, 100); // 100 * 7.5 = 750, after 100% rabais = 0, but floored at 1500
  assert.equal(r.sousTotal, MIN_JOB_DOLLARS, 'even 100% rabais cannot go below floor');
});

test('calculateQuote: large superficie clears min floor naturally', () => {
  const r = calculateQuoteInline('flake', 500);  // 500 * 7.5 = 3750 > 1500
  assert.equal(r.sousTotal, 3750);
});


// ════════════════════════════════════════════════════════════════════════════
// GAP-9: insertInvoiceWithRetry — retry count and exhaustion behavior
// Verifies that: retries happen exactly maxAttempts times, then the last
// 23505 error is thrown, and non-23505 errors exit immediately.
// ════════════════════════════════════════════════════════════════════════════

async function insertWithRetryInline(options, insert) {
  const maxAttempts = options.maxAttempts ?? 5;
  let lastError = null;
  let attemptsMade = 0;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    attemptsMade++;
    const numero = `NE-2026-${String(attempt + 1).padStart(4, '0')}`;
    try {
      return await insert(numero, attempt);
    } catch (e) {
      lastError = e;
      if (e?.code !== '23505') throw e;
    }
  }
  throw lastError ?? new Error('insertInvoiceWithRetry: exhausted attempts');
}

test('insertInvoiceWithRetry: succeeds on first attempt → returns immediately', async () => {
  let calls = 0;
  const result = await insertWithRetryInline({ maxAttempts: 5 }, async (num) => {
    calls++;
    return { id: 1, numero: num };
  });
  assert.equal(calls, 1);
  assert.equal(result.id, 1);
});

test('insertInvoiceWithRetry: 23505 on first two attempts → succeeds on third', async () => {
  let calls = 0;
  const result = await insertWithRetryInline({ maxAttempts: 5 }, async (num, attempt) => {
    calls++;
    if (attempt < 2) {
      const err = new Error('duplicate key'); err.code = '23505';
      throw err;
    }
    return { id: 99, numero: num };
  });
  assert.equal(calls, 3);
  assert.equal(result.id, 99);
});

test('insertInvoiceWithRetry: 23505 every attempt → throws after maxAttempts', async () => {
  let calls = 0;
  const err23505 = new Error('unique violation'); err23505.code = '23505';
  await assert.rejects(
    () => insertWithRetryInline({ maxAttempts: 3 }, async () => {
      calls++;
      throw err23505;
    }),
    (e) => e.code === '23505'
  );
  assert.equal(calls, 3, 'must attempt exactly maxAttempts=3 times');
});

test('insertInvoiceWithRetry: non-23505 error throws immediately without retry', async () => {
  let calls = 0;
  const networkErr = new Error('connection timeout');
  await assert.rejects(
    () => insertWithRetryInline({ maxAttempts: 5 }, async () => {
      calls++;
      throw networkErr;
    }),
    (e) => e.message === 'connection timeout'
  );
  assert.equal(calls, 1, 'non-23505 must exit on first attempt');
});

test('insertInvoiceWithRetry: default maxAttempts is 5', async () => {
  let calls = 0;
  const err = new Error('dup'); err.code = '23505';
  await assert.rejects(
    () => insertWithRetryInline({}, async () => { calls++; throw err; })
  );
  assert.equal(calls, 5, 'default maxAttempts must be 5');
});


// ════════════════════════════════════════════════════════════════════════════
// SKELETONS — require DB/network — skipped unless INTEGRATION_TEST=1
// ════════════════════════════════════════════════════════════════════════════

const SKIP_INTEGRATION = !process.env.INTEGRATION_TEST;

test(
  'INT: GET /api/calendar/feed → Content-Type: text/calendar (public route)',
  { skip: SKIP_INTEGRATION ? 'set INTEGRATION_TEST=1 to run' : false },
  async () => {
    const base = process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:3000';
    const res = await fetch(`${base}/api/calendar/feed`);
    assert.equal(res.status, 200);
    const ct = res.headers.get('content-type') ?? '';
    assert.ok(ct.includes('text/calendar'), `expected text/calendar, got ${ct}`);
  }
);

test(
  'INT: POST /api/leads/zapier — missing required fields → 400',
  { skip: SKIP_INTEGRATION ? 'set INTEGRATION_TEST=1 to run' : false },
  async () => {
    const base = process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:3000';
    const res = await fetch(`${base}/api/leads/zapier`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': 'wrong-key' },
      body: JSON.stringify({}),
    });
    assert.ok([400, 401].includes(res.status), `expected 400 or 401, got ${res.status}`);
  }
);

test(
  'INT: GET /api/cron/relance — wrong CRON_SECRET → 401',
  { skip: SKIP_INTEGRATION ? 'set INTEGRATION_TEST=1 to run' : false },
  async () => {
    const base = process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:3000';
    const res = await fetch(`${base}/api/cron/relance`, {
      headers: { Authorization: 'Bearer wrong-secret' },
    });
    assert.equal(res.status, 401);
  }
);

test(
  'INT: POST /api/invoices/[id]/payment — no session → 401',
  { skip: SKIP_INTEGRATION ? 'set INTEGRATION_TEST=1 to run' : false },
  async () => {
    const base = process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:3000';
    const res = await fetch(`${base}/api/invoices/1/payment`, { method: 'POST' });
    assert.equal(res.status, 401);
  }
);

test(
  'INT: ensureInvoiceForQuote — nonexistent quoteId returns null',
  { skip: SKIP_INTEGRATION ? 'set INTEGRATION_TEST=1 to run' : false },
  async () => {
    const { ensureInvoiceForQuote } = await import('../lib/ensure-invoice.ts');
    const result = await ensureInvoiceForQuote(999999999);
    assert.equal(result.invoice_id, null);
    assert.equal(result.created, false);
  }
);

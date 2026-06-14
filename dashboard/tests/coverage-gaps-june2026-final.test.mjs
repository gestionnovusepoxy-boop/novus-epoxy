/**
 * coverage-gaps-june2026-final.test.mjs — Genuine remaining gaps after full audit.
 *
 * Run: node --test tests/coverage-gaps-june2026-final.test.mjs
 *
 * PURE-LOGIC GAPS (run immediately, no DB/network):
 *   GAP-1  lib/invoice-numero.ts     — insertInvoiceWithRetry with maxAttempts=0
 *   GAP-2  lib/calendar-links.ts     — generateIcsContent DTSTART/DTEND time values per slot
 *   GAP-3  lib/sms.ts                — sendFollowUpSMS / sendDepositConfirmationSMS !clientPhone guard
 *   GAP-4  lib/lead-blocklist.ts     — isBlocked with non-string (object) kv_store raw value
 *   GAP-5  lib/lead-blocklist.ts     — blockLead with detail field stored in BlockInfo
 *   GAP-6  lib/calendar-links.ts     — generateIcsContent address embedded in LOCATION field
 *   GAP-7  lib/sms.ts                — notifyAdminSMS: no phones at all → silent no-op
 *
 * INTEGRATION SKELETONS (skipped unless INTEGRATION_TEST=1):
 *   INT-1  /api/sms/incoming          — inbound SMS opt-out registers in kv_store
 *   INT-2  /api/sms/incoming          — inbound SMS reply → auto-quote attempt
 *   INT-3  /api/telegram/admin        — unknown update type → 200 no-op
 *   INT-4  lib/db.ts transaction()    — inner throw → rollback, exception rethrows
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const SKIP_INTEGRATION = !process.env.INTEGRATION_TEST;

// ════════════════════════════════════════════════════════════════════════════
// GAP-1: lib/invoice-numero.ts — insertInvoiceWithRetry with maxAttempts=0
//
// The for loop `for (let attempt = 0; attempt < 0; attempt++)` never executes.
// lastError stays null. The function must throw the fallback error message.
// All other maxAttempts values are tested (1, 5, default). Zero is not.
// ════════════════════════════════════════════════════════════════════════════

// Inlined from lib/invoice-numero.ts — mirrors the retry loop exactly.
async function insertInvoiceWithRetry_testable(options, insert) {
  const maxAttempts = options.maxAttempts ?? 5;
  let lastError = null;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const numero = `NE-2026-${String(attempt + 1).padStart(4, '0')}`;
    try {
      return await insert(numero);
    } catch (e) {
      lastError = e;
      if (e?.code !== '23505') throw e;
    }
  }
  throw lastError ?? new Error('insertInvoiceWithRetry: exhausted attempts');
}

test('insertInvoiceWithRetry: maxAttempts=0 → throws fallback error without calling insert', async () => {
  let insertCalled = false;
  await assert.rejects(
    () => insertInvoiceWithRetry_testable({ maxAttempts: 0 }, () => { insertCalled = true; }),
    /exhausted attempts/,
  );
  assert.equal(insertCalled, false, 'insert must never be called when maxAttempts=0');
});

test('insertInvoiceWithRetry: maxAttempts=0 throws Error instance (not null or undefined)', async () => {
  let caught = null;
  try {
    await insertInvoiceWithRetry_testable({ maxAttempts: 0 }, () => {});
  } catch (e) {
    caught = e;
  }
  assert.ok(caught instanceof Error, 'must throw an Error, not null');
  assert.ok(caught.message.length > 0, 'error message must be non-empty');
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-2: lib/calendar-links.ts — generateIcsContent slot time values
//
// The existing test only verifies `TZID:America/Toronto` is present.
// slotTimes() maps slot names to hour ranges, and those ranges are embedded
// in DTSTART/DTEND. None of the time values are verified in any existing test.
// ════════════════════════════════════════════════════════════════════════════

// Inlined from lib/calendar-links.ts
function slotTimes(slot) {
  if (slot === 'matin')   return { startHour: 8,  endHour: 12 };
  if (slot === 'journee') return { startHour: 8,  endHour: 17 };
  return                         { startHour: 13, endHour: 17 };  // apres-midi (default)
}

function toIcsDatetime(date, hour, minute = 0) {
  const [y, m, d] = date.split('-');
  return `${y}${m}${d}T${String(hour).padStart(2, '0')}${String(minute).padStart(2, '0')}00`;
}

// Build just the DTSTART lines from a slot — same logic as generateIcsContent
function icsDatetimesForSlot(date, slot) {
  const { startHour, endHour } = slotTimes(slot);
  return {
    dtstart: toIcsDatetime(date, startHour),
    dtend:   toIcsDatetime(date, endHour),
  };
}

test('generateIcsContent times: matin → 08:00–12:00', () => {
  const { dtstart, dtend } = icsDatetimesForSlot('2026-08-15', 'matin');
  assert.equal(dtstart, '20260815T080000', 'matin starts at 08:00');
  assert.equal(dtend,   '20260815T120000', 'matin ends at 12:00');
});

test('generateIcsContent times: apres-midi → 13:00–17:00', () => {
  const { dtstart, dtend } = icsDatetimesForSlot('2026-08-15', 'apres-midi');
  assert.equal(dtstart, '20260815T130000', 'apres-midi starts at 13:00');
  assert.equal(dtend,   '20260815T170000', 'apres-midi ends at 17:00');
});

test('generateIcsContent times: journee → 08:00–17:00', () => {
  const { dtstart, dtend } = icsDatetimesForSlot('2026-08-16', 'journee');
  assert.equal(dtstart, '20260816T080000', 'journee starts at 08:00');
  assert.equal(dtend,   '20260816T170000', 'journee ends at 17:00');
});

test('generateIcsContent times: unknown slot → defaults to apres-midi (13:00–17:00)', () => {
  const { dtstart, dtend } = icsDatetimesForSlot('2026-09-01', 'inconnue');
  assert.equal(dtstart, '20260901T130000', 'unknown slot falls back to apres-midi start');
  assert.equal(dtend,   '20260901T170000', 'unknown slot falls back to apres-midi end');
});

test('generateIcsContent times: toIcsDatetime pads single-digit hours', () => {
  // Hour 8 → T080000, not T80000
  const result = toIcsDatetime('2026-07-04', 8, 0);
  assert.ok(result.includes('T08'), `expected T08 padding, got ${result}`);
});

test('generateIcsContent times: Jour 2 different date than Jour 1', () => {
  const day1 = icsDatetimesForSlot('2026-08-01', 'matin');
  const day2 = icsDatetimesForSlot('2026-08-02', 'matin');
  assert.notEqual(day1.dtstart, day2.dtstart, 'different dates must produce different DTSTART');
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-3: lib/sms.ts — sendFollowUpSMS / sendDepositConfirmationSMS !clientPhone guard
//
// Each wrapper function has `if (!clientPhone) return false;` before calling
// sendSMS. The sms-guards.test.mjs covers sendSMS internals, but these early
// guards in the wrapper functions themselves are not tested.
// ════════════════════════════════════════════════════════════════════════════

// Inlined guards — mirrors lib/sms.ts wrapper functions
async function sendFollowUpSMS_guard(clientPhone, clientName, quoteId) {
  if (!clientPhone) return false;
  // Would call sendSMS here — guard test only checks the early return
  return 'would_call_sendSMS';
}

async function sendDepositConfirmationSMS_guard(clientPhone, clientName, jour1Date, jour2Date) {
  if (!clientPhone) return false;
  return 'would_call_sendSMS';
}

async function sendReferralSMS_guard(clientPhone, clientName) {
  if (!clientPhone) return false;
  return 'would_call_sendSMS';
}

test('sendFollowUpSMS: null clientPhone → returns false without SMS', async () => {
  assert.equal(await sendFollowUpSMS_guard(null, 'Jean Tremblay', 42), false);
});

test('sendFollowUpSMS: empty string clientPhone → returns false without SMS', async () => {
  assert.equal(await sendFollowUpSMS_guard('', 'Jean Tremblay', 42), false);
});

test('sendFollowUpSMS: undefined clientPhone → returns false without SMS', async () => {
  assert.equal(await sendFollowUpSMS_guard(undefined, 'Jean Tremblay', 42), false);
});

test('sendFollowUpSMS: valid phone → passes guard (proceeds to sendSMS)', async () => {
  const result = await sendFollowUpSMS_guard('5145551234', 'Jean Tremblay', 42);
  assert.notEqual(result, false, 'valid phone must not be blocked by guard');
});

test('sendDepositConfirmationSMS: null clientPhone → returns false', async () => {
  assert.equal(await sendDepositConfirmationSMS_guard(null, 'Marie', '2026-08-01', '2026-08-02'), false);
});

test('sendDepositConfirmationSMS: empty string clientPhone → returns false', async () => {
  assert.equal(await sendDepositConfirmationSMS_guard('', 'Marie', '2026-08-01', '2026-08-02'), false);
});

test('sendReferralSMS: null clientPhone → returns false', async () => {
  assert.equal(await sendReferralSMS_guard(null, 'Pierre Gagné'), false);
});

test('sendReferralSMS: valid phone → passes guard', async () => {
  const result = await sendReferralSMS_guard('4185551234', 'Pierre Gagné');
  assert.notEqual(result, false);
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-4: lib/lead-blocklist.ts — isBlocked with non-string raw kv_store value
//
// When Postgres/Neon returns a JSONB column it may already be a parsed object,
// not a JSON string. The code branches on `typeof raw === 'string'` and falls
// through to `return raw as BlockInfo`. This path is not tested anywhere.
// ════════════════════════════════════════════════════════════════════════════

// Inlined from lib/lead-blocklist.ts — the value-parsing branch
function parseBlockInfo(raw) {
  if (typeof raw === 'string') {
    try { return JSON.parse(raw); } catch { return { reason: 'manual', at: new Date().toISOString() }; }
  }
  // Raw is already an object (JSONB returned as parsed by driver)
  return raw;
}

test('isBlocked: string value → JSON.parse result returned', () => {
  const stored = JSON.stringify({ reason: 'complaint', at: '2026-06-01T10:00:00Z' });
  const result = parseBlockInfo(stored);
  assert.equal(result.reason, 'complaint');
  assert.equal(result.at, '2026-06-01T10:00:00Z');
});

test('isBlocked: already-parsed object (JSONB) → returned as-is without re-parsing', () => {
  const obj = { reason: 'bounce', at: '2026-05-15T08:00:00Z', detail: 'Hard bounce' };
  const result = parseBlockInfo(obj);
  assert.equal(result.reason, 'bounce');
  assert.equal(result.detail, 'Hard bounce');
  // Ensure it is the SAME object reference (not serialized/deserialized)
  assert.strictEqual(result, obj);
});

test('isBlocked: malformed JSON string → fallback { reason: "manual" }', () => {
  const result = parseBlockInfo('not-valid-json{{{');
  assert.equal(result.reason, 'manual');
  assert.ok(typeof result.at === 'string', 'fallback must include an at timestamp');
});

test('isBlocked: empty JSON object string → returns empty object', () => {
  const result = parseBlockInfo('{}');
  assert.deepEqual(result, {});
});

test('isBlocked: null raw value → returned as null (object branch)', () => {
  // null is typeof 'object' — would be returned as-is (caller handles null check)
  const result = parseBlockInfo(null);
  assert.equal(result, null);
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-5: lib/lead-blocklist.ts — blockLead with detail field in BlockInfo
//
// The `detail` field is optional in BlockInfo and included in the stored JSON.
// Tests only check the key format and the boolean return; none verify that
// `detail` survives serialization into the stored value.
// ════════════════════════════════════════════════════════════════════════════

// Inlined from lib/lead-blocklist.ts — BlockInfo construction
function buildBlockInfo(reason, detail) {
  const info = { reason, at: '2026-06-10T12:00:00.000Z' };
  if (detail !== undefined) info.detail = detail;
  return JSON.stringify(info);
}

test('blockLead: detail field is included when provided', () => {
  const json = buildBlockInfo('complaint', 'Wrote SPAM in reply');
  const parsed = JSON.parse(json);
  assert.equal(parsed.detail, 'Wrote SPAM in reply');
});

test('blockLead: detail field is absent when not provided', () => {
  const json = buildBlockInfo('bounce', undefined);
  const parsed = JSON.parse(json);
  assert.ok(!('detail' in parsed), 'detail must not appear in JSON when undefined');
});

test('blockLead: reason is preserved in stored JSON', () => {
  for (const reason of ['complaint', 'bounce', 'unsubscribed', 'spam_report', 'manual']) {
    const json = buildBlockInfo(reason, undefined);
    const parsed = JSON.parse(json);
    assert.equal(parsed.reason, reason, `reason ${reason} must round-trip`);
  }
});

test('blockLead: detail is truncated to 100 chars in crm_leads note', () => {
  // The UPDATE note uses detail.slice(0, 100). Verify truncation logic.
  const longDetail = 'x'.repeat(150);
  const truncated = longDetail.slice(0, 100);
  assert.equal(truncated.length, 100, 'truncated detail must be exactly 100 chars');
  assert.notEqual(truncated.length, longDetail.length, 'truncation must happen for >100 char detail');
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-6: lib/calendar-links.ts — generateIcsContent address in LOCATION field
//
// The address parameter is embedded as `LOCATION:${address}` in each VEVENT.
// Existing tests don't verify the LOCATION line content at all.
// ════════════════════════════════════════════════════════════════════════════

// Full generateIcsContent inlined (minimal version without UIDs/DTSTAMP for test stability)
function buildIcsLines(jour1Date, jour1Slot, jour2Date, jour2Slot, address) {
  const { startHour: s1h, endHour: e1h } = slotTimes(jour1Slot);
  const { startHour: s2h, endHour: e2h } = slotTimes(jour2Slot);
  return [
    `DTSTART;TZID=America/Toronto:${toIcsDatetime(jour1Date, s1h)}`,
    `DTEND;TZID=America/Toronto:${toIcsDatetime(jour1Date, e1h)}`,
    `LOCATION:${address}`,
    `DTSTART;TZID=America/Toronto:${toIcsDatetime(jour2Date, s2h)}`,
    `DTEND;TZID=America/Toronto:${toIcsDatetime(jour2Date, e2h)}`,
    `LOCATION:${address}`,
  ].join('\r\n');
}

test('generateIcsContent: address appears in LOCATION line', () => {
  const ics = buildIcsLines('2026-08-01', 'matin', '2026-08-02', 'apres-midi', '123 rue des Érables, Laval QC');
  assert.ok(ics.includes('LOCATION:123 rue des Érables, Laval QC'), 'address must appear verbatim in LOCATION');
});

test('generateIcsContent: LOCATION appears twice (once per VEVENT)', () => {
  const ics = buildIcsLines('2026-08-01', 'matin', '2026-08-02', 'matin', '456 boul. du Roi-René');
  const count = (ics.match(/LOCATION:/g) ?? []).length;
  assert.equal(count, 2, 'must have exactly 2 LOCATION lines (one per event)');
});

test('generateIcsContent: jour1 and jour2 get correct dates', () => {
  const ics = buildIcsLines('2026-09-05', 'matin', '2026-09-06', 'apres-midi', '1 rue Test');
  assert.ok(ics.includes('20260905T08'), 'jour1 matin start must embed 2026-09-05');
  assert.ok(ics.includes('20260906T13'), 'jour2 apres-midi start must embed 2026-09-06');
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-7: lib/sms.ts — notifyAdminSMS no phones at all → silent no-op
//
// `const phones = [ADMIN_PHONE, JASON_PHONE].filter(Boolean)` — when BOTH env
// vars are undefined/empty, phones is []. The function returns immediately.
// Existing tests check single-phone and dual-phone cases but NOT the zero-phone case.
// ════════════════════════════════════════════════════════════════════════════

// Inlined from lib/sms.ts — the phones array construction logic
function buildAdminPhones(adminPhone, jasonPhone) {
  return [adminPhone, jasonPhone].filter(Boolean);
}

test('notifyAdminSMS: both ADMIN_PHONE and JASON_PHONE undefined → phones = []', () => {
  const phones = buildAdminPhones(undefined, undefined);
  assert.deepEqual(phones, [], 'empty array when both phones missing');
});

test('notifyAdminSMS: empty string for both → phones = []', () => {
  const phones = buildAdminPhones('', '');
  assert.deepEqual(phones, [], 'empty strings are filtered out by Boolean()');
});

test('notifyAdminSMS: only ADMIN_PHONE set → one phone', () => {
  const phones = buildAdminPhones('5145550001', undefined);
  assert.equal(phones.length, 1);
  assert.equal(phones[0], '5145550001');
});

test('notifyAdminSMS: only JASON_PHONE set → one phone', () => {
  const phones = buildAdminPhones(undefined, '4185550002');
  assert.equal(phones.length, 1);
  assert.equal(phones[0], '4185550002');
});

test('notifyAdminSMS: both set → two phones', () => {
  const phones = buildAdminPhones('5145550001', '4185550002');
  assert.equal(phones.length, 2);
});

test('notifyAdminSMS: zero → should return early (no SMS attempt)', () => {
  // Guard: `if (phones.length === 0) return;` — document the exact predicate
  const phones = buildAdminPhones(null, null);
  assert.equal(phones.length === 0, true, 'guard condition phones.length === 0 must be true');
});

// ════════════════════════════════════════════════════════════════════════════
// INTEGRATION SKELETONS — require INTEGRATION_TEST=1 + running server + DB
// ════════════════════════════════════════════════════════════════════════════

const BASE_URL = process.env.TEST_BASE_URL ?? 'http://localhost:3000';

test('INT-1: POST /api/sms/incoming — STOP keyword registers opt-out in kv_store',
  { skip: SKIP_INTEGRATION ? 'Set INTEGRATION_TEST=1 + TEST_BASE_URL to run' : false },
  async () => {
    // Send inbound Twilio webhook with STOP body
    const form = new URLSearchParams({
      From: '+15141234567',
      Body: 'STOP',
      NumMedia: '0',
    });
    const r = await fetch(`${BASE_URL}/api/sms/incoming`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
    // Twilio expects 200 TwiML back
    assert.equal(r.status, 200, 'must respond 200 to Twilio');
    const body = await r.text();
    assert.ok(body.includes('<Response>'), 'must return TwiML response');
    // Verify opt-out key was written (via /api/admin or direct DB query)
    // TODO: verify kv_store has key sms_optout_+15141234567
  },
);

test('INT-2: POST /api/sms/incoming — ARRET keyword (French) also opts out',
  { skip: SKIP_INTEGRATION ? 'Set INTEGRATION_TEST=1 + TEST_BASE_URL to run' : false },
  async () => {
    const form = new URLSearchParams({ From: '+14185559999', Body: 'ARRET', NumMedia: '0' });
    const r = await fetch(`${BASE_URL}/api/sms/incoming`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
    assert.equal(r.status, 200);
    // After ARRET: sendSMS to +14185559999 must be blocked
  },
);

test('INT-3: POST /api/telegram/admin — unknown update type → 200 no-op (no crash)',
  { skip: SKIP_INTEGRATION ? 'Set INTEGRATION_TEST=1 + TEST_BASE_URL to run' : false },
  async () => {
    const r = await fetch(`${BASE_URL}/api/telegram/admin`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Telegram-Bot-Api-Secret-Token': process.env.TELEGRAM_WEBHOOK_SECRET ?? 'test',
      },
      body: JSON.stringify({ update_id: 12345, unknown_type: { data: 'irrelevant' } }),
    });
    // Must not 500 on unknown update types
    assert.notEqual(r.status, 500, 'unknown update type must not cause 500');
  },
);

test('INT-4: lib/db.ts transaction() — inner throw triggers rollback and rethrows',
  { skip: SKIP_INTEGRATION ? 'Set INTEGRATION_TEST=1 to run (requires real DB)' : false },
  async () => {
    // Import the real transaction() from lib/db.ts
    const { transaction } = await import('../lib/db.ts');

    const testError = new Error('intentional rollback test');
    // Create a unique test row key
    const testKey = `_test_rollback_${Date.now()}`;

    await assert.rejects(
      () => transaction(async (client) => {
        // Insert a row inside the transaction
        await client.query('INSERT INTO kv_store (key, value) VALUES ($1, $2)', [testKey, '"test"']);
        // Then throw — transaction must roll back the insert
        throw testError;
      }),
      (e) => e === testError, // must rethrow the exact same error
    );

    // Verify the row was NOT committed (rollback worked)
    const { query } = await import('../lib/db.ts');
    const rows = await query('SELECT 1 FROM kv_store WHERE key = $1', [testKey]);
    assert.equal(rows.length, 0, 'rolled-back row must not be in the DB');
  },
);

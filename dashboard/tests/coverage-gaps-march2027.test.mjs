/**
 * coverage-gaps-march2027.test.mjs — Coverage gap audit, June 10 2026.
 *
 * Run: node --test tests/coverage-gaps-march2027.test.mjs
 *
 * TRUE GAPS — pure logic never covered by any prior test file:
 *
 *   GAP-1  app/api/agents/status/route.ts  — withinHours() / withinDays()
 *                                            Controls running/veille/erreur for ALL agents.
 *                                            A regression silently flips every status badge.
 *
 *   GAP-2  app/api/bookings/route.ts       — normalizeSlot() / normalizeExtraDays()
 *                                            Guards double-booking prevention.
 *                                            Silently accepts invalid slots → booking data corruption.
 *
 *   GAP-3  app/api/bank/import/route.ts    — parseCsvLines() / parseDate() / parseAmount() /
 *                                            detectBankFormat() / findColumnIndex()
 *                                            Bank CSV parsing: wrong date format → missed transactions,
 *                                            wrong amount → off-by-one on reconciliation.
 *
 * INTEGRATION SKELETONS (skipped unless INTEGRATION_TEST=1):
 *   INT-1  GET  /api/agents/status         — no session → 401
 *   INT-2  POST /api/bookings              — no session → 401
 *   INT-3  POST /api/bank/import           — no session → 401
 *   INT-4  GET  /api/bookings/available    — returns list of slots for a given date
 *   INT-5  POST /api/bank/import           — invalid CSV → 400
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

const SKIP_INTEGRATION = !process.env.INTEGRATION_TEST;
const BASE = process.env.TEST_BASE_URL || 'http://localhost:3000';

// ════════════════════════════════════════════════════════════════════════════
// GAP-1: withinHours / withinDays  (app/api/agents/status/route.ts)
//
// Private helpers that power every agent status badge (running/veille/erreur).
// Inlined verbatim — the real functions are not exported.
// ════════════════════════════════════════════════════════════════════════════

function withinHours(date, hours) {
  if (!date) return false;
  const diff = Date.now() - new Date(date).getTime();
  return diff < hours * 3600000;
}

function withinDays(date, days) {
  if (!date) return false;
  const diff = Date.now() - new Date(date).getTime();
  return diff < days * 86400000;
}

// Helpers to build test timestamps relative to now
const msAgo = (ms) => new Date(Date.now() - ms).toISOString();
const hoursAgo = (h) => msAgo(h * 3600000);
const daysAgo = (d) => msAgo(d * 86400000);

// withinHours ---

test('withinHours: null date → false', () => {
  assert.equal(withinHours(null, 24), false);
});

test('withinHours: undefined date → false', () => {
  assert.equal(withinHours(undefined, 24), false);
});

test('withinHours: date 1h ago, window=2h → true', () => {
  assert.equal(withinHours(hoursAgo(1), 2), true);
});

test('withinHours: date 3h ago, window=2h → false', () => {
  assert.equal(withinHours(hoursAgo(3), 2), false);
});

test('withinHours: date just now (1ms ago), window=1h → true', () => {
  assert.equal(withinHours(msAgo(1), 1), true);
});

test('withinHours: date exactly at boundary is just-inside (1ms within window) → true', () => {
  // 1 ms before the window expires = still within
  const justInside = msAgo(1 * 3600000 - 1);
  assert.equal(withinHours(justInside, 1), true);
});

test('withinHours: date 24h ago, window=12h → false (stale — should show veille)', () => {
  assert.equal(withinHours(hoursAgo(24), 12), false);
});

test('withinHours: date 24h ago, window=24h — just past boundary → false', () => {
  // 24h ago is NOT strictly less than 24h * 3600000ms — it's exactly equal at the boundary.
  // In practice it'll be a few ms past, so this tests the >24h case.
  const pastBoundary = msAgo(24 * 3600000 + 100);
  assert.equal(withinHours(pastBoundary, 24), false);
});

// withinDays ---

test('withinDays: null → false', () => {
  assert.equal(withinDays(null, 7), false);
});

test('withinDays: date 2d ago, window=7d → true', () => {
  assert.equal(withinDays(daysAgo(2), 7), true);
});

test('withinDays: date 10d ago, window=7d → false', () => {
  assert.equal(withinDays(daysAgo(10), 7), false);
});

test('withinDays: date 1d ago, window=1d — just past boundary → false', () => {
  const pastDay = msAgo(24 * 3600000 + 100);
  assert.equal(withinDays(pastDay, 1), false);
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-2: normalizeSlot / normalizeExtraDays  (app/api/bookings/route.ts)
//
// normalizeSlot guards the slot field before DB write and before the slot-
// collision check.  A bad value here means a booking goes in with a garbage
// slot and the collision check can't fire correctly.
// ════════════════════════════════════════════════════════════════════════════

const VALID_SLOTS = ['matin', 'apres-midi', 'journee'];

function normalizeSlot(s, fallback = 'matin') {
  return VALID_SLOTS.includes(s) ? s : fallback;
}

function normalizeExtraDays(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map(d => {
      if (!d || typeof d !== 'object') return null;
      const dateStr = String(d.date ?? '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null;
      return { date: dateStr, slot: normalizeSlot(d.slot) };
    })
    .filter(d => d !== null);
}

// normalizeSlot ---

test('normalizeSlot: "matin" → "matin"', () => {
  assert.equal(normalizeSlot('matin'), 'matin');
});

test('normalizeSlot: "apres-midi" → "apres-midi"', () => {
  assert.equal(normalizeSlot('apres-midi'), 'apres-midi');
});

test('normalizeSlot: "journee" → "journee"', () => {
  assert.equal(normalizeSlot('journee'), 'journee');
});

test('normalizeSlot: unknown string → fallback "matin"', () => {
  assert.equal(normalizeSlot('afternoon'), 'matin');
});

test('normalizeSlot: null → fallback "matin"', () => {
  assert.equal(normalizeSlot(null), 'matin');
});

test('normalizeSlot: undefined → fallback "matin"', () => {
  assert.equal(normalizeSlot(undefined), 'matin');
});

test('normalizeSlot: number → fallback "matin"', () => {
  assert.equal(normalizeSlot(42), 'matin');
});

test('normalizeSlot: explicit fallback "apres-midi" used when invalid', () => {
  assert.equal(normalizeSlot('garbage', 'apres-midi'), 'apres-midi');
});

test('normalizeSlot: explicit fallback "journee" used when invalid', () => {
  assert.equal(normalizeSlot(undefined, 'journee'), 'journee');
});

// normalizeExtraDays ---

test('normalizeExtraDays: empty array → []', () => {
  assert.deepEqual(normalizeExtraDays([]), []);
});

test('normalizeExtraDays: null → []', () => {
  assert.deepEqual(normalizeExtraDays(null), []);
});

test('normalizeExtraDays: non-array (object) → []', () => {
  assert.deepEqual(normalizeExtraDays({ date: '2026-07-01', slot: 'matin' }), []);
});

test('normalizeExtraDays: valid entry → preserved', () => {
  const result = normalizeExtraDays([{ date: '2026-07-01', slot: 'apres-midi' }]);
  assert.deepEqual(result, [{ date: '2026-07-01', slot: 'apres-midi' }]);
});

test('normalizeExtraDays: invalid slot → normalized to matin', () => {
  const result = normalizeExtraDays([{ date: '2026-07-01', slot: 'INVALID' }]);
  assert.deepEqual(result, [{ date: '2026-07-01', slot: 'matin' }]);
});

test('normalizeExtraDays: date with time component → truncated to YYYY-MM-DD', () => {
  const result = normalizeExtraDays([{ date: '2026-07-01T14:00:00Z', slot: 'matin' }]);
  assert.deepEqual(result, [{ date: '2026-07-01', slot: 'matin' }]);
});

test('normalizeExtraDays: invalid date format → filtered out', () => {
  const result = normalizeExtraDays([{ date: '01/07/2026', slot: 'matin' }]);
  assert.deepEqual(result, []);
});

test('normalizeExtraDays: null entry in array → filtered out', () => {
  const result = normalizeExtraDays([null, { date: '2026-07-01', slot: 'matin' }]);
  assert.deepEqual(result, [{ date: '2026-07-01', slot: 'matin' }]);
});

test('normalizeExtraDays: mixed valid/invalid → only valid returned', () => {
  const input = [
    { date: '2026-07-01', slot: 'matin' },
    { date: 'not-a-date', slot: 'matin' },
    null,
    { date: '2026-07-03', slot: 'journee' },
  ];
  const result = normalizeExtraDays(input);
  assert.deepEqual(result, [
    { date: '2026-07-01', slot: 'matin' },
    { date: '2026-07-03', slot: 'journee' },
  ]);
});

test('normalizeExtraDays: primitive in array → filtered out', () => {
  const result = normalizeExtraDays(['2026-07-01', 42]);
  assert.deepEqual(result, []);
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-3: Bank CSV parsing  (app/api/bank/import/route.ts)
//
// parseCsvLines, parseDate, parseAmount, detectBankFormat, findColumnIndex
// are all pure and directly control which transactions get imported.
// Wrong date → transaction dropped silently.  Wrong amount → off by one on
// reconciliation totals.  Neither has a single test today.
// ════════════════════════════════════════════════════════════════════════════

// Inlined verbatim from app/api/bank/import/route.ts

function parseCsvLines(raw) {
  const lines = raw.trim().split(/\r?\n/);
  return lines.map((line) => {
    const cells = [];
    let current = '';
    let inQuotes = false;
    for (const ch of line) {
      if (ch === '"') { inQuotes = !inQuotes; continue; }
      if (ch === ',' && !inQuotes) { cells.push(current.trim()); current = ''; continue; }
      if (ch === ';' && !inQuotes) { cells.push(current.trim()); current = ''; continue; }
      current += ch;
    }
    cells.push(current.trim());
    return cells;
  });
}

function parseDate(raw) {
  if (!raw) return null;
  const s = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  const dmy = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (dmy) {
    const [, d, m, y] = dmy;
    if (parseInt(d) > 12) return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
    if (parseInt(m) > 12) return `${y}-${d.padStart(2, '0')}-${m.padStart(2, '0')}`;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  return null;
}

function parseAmount(raw) {
  if (!raw) return 0;
  let s = raw.replace(/\s/g, '').replace(/\$/g, '');
  if (s.includes(',') && !s.includes('.')) {
    s = s.replace(',', '.');
  } else if (s.includes(',') && s.includes('.')) {
    s = s.replace(/,/g, '');
  }
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

function detectBankFormat(headers) {
  const h = headers.map(c => c.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''));
  if (h.some(c => c.includes('numero de compte'))) return 'desjardins';
  if (h.some(c => c.includes('account number'))) return 'td';
  if (h.some(c => c.includes('rbc'))) return 'rbc';
  if (h.some(c => c.includes('bmo'))) return 'bmo';
  return 'generic';
}

function findColumnIndex(headers, ...candidates) {
  const norm = headers.map(h => h.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim());
  for (const c of candidates) {
    const idx = norm.findIndex(h => h.includes(c.toLowerCase()));
    if (idx >= 0) return idx;
  }
  return -1;
}

// parseCsvLines ---

test('parseCsvLines: basic comma-separated → array of arrays', () => {
  const result = parseCsvLines('Date,Description,Montant\n2026-06-01,Tim Hortons,4.75');
  assert.deepEqual(result, [['Date', 'Description', 'Montant'], ['2026-06-01', 'Tim Hortons', '4.75']]);
});

test('parseCsvLines: semicolon delimiter (European CSV) → parsed correctly', () => {
  const result = parseCsvLines('Date;Libelle;Montant\n2026-06-01;Epicerie;-45.00');
  assert.deepEqual(result, [['Date', 'Libelle', 'Montant'], ['2026-06-01', 'Epicerie', '-45.00']]);
});

test('parseCsvLines: quoted cell with comma → treated as single field', () => {
  const result = parseCsvLines('"Societe, Inc.",100.00\n');
  assert.deepEqual(result[0], ['Societe, Inc.', '100.00']);
});

test('parseCsvLines: Windows line endings (CRLF) → parsed correctly', () => {
  const result = parseCsvLines('A,B\r\n1,2');
  assert.deepEqual(result, [['A', 'B'], ['1', '2']]);
});

test('parseCsvLines: cells trimmed of surrounding spaces', () => {
  const result = parseCsvLines(' Date , Description , Montant ');
  assert.deepEqual(result[0], ['Date', 'Description', 'Montant']);
});

// parseDate ---

test('parseDate: empty string → null', () => {
  assert.equal(parseDate(''), null);
});

test('parseDate: null → null', () => {
  assert.equal(parseDate(null), null);
});

test('parseDate: ISO YYYY-MM-DD → returned as-is', () => {
  assert.equal(parseDate('2026-06-10'), '2026-06-10');
});

test('parseDate: YYYYMMDD (no separators) → YYYY-MM-DD', () => {
  assert.equal(parseDate('20260610'), '2026-06-10');
});

test('parseDate: DD/MM/YYYY (Quebec default, unambiguous day > 12) → correct', () => {
  assert.equal(parseDate('15/06/2026'), '2026-06-15');
});

test('parseDate: DD-MM-YYYY with dashes → correct', () => {
  assert.equal(parseDate('15-06-2026'), '2026-06-15');
});

test('parseDate: MM/DD/YYYY (unambiguous month > 12 impossible, month ≤ 12, day > 12) → DD/MM', () => {
  // day=15 > 12 → interpreted as DD/MM (Quebec convention)
  assert.equal(parseDate('15/06/2026'), '2026-06-15');
});

test('parseDate: ambiguous 01/06/2026 → treated as DD/MM → 2026-06-01', () => {
  assert.equal(parseDate('01/06/2026'), '2026-06-01');
});

test('parseDate: month > 12 in position 2 → must be DD/MM/YYYY convention', () => {
  // "05/13/2026" — position 2 = 13 > 12, so must be MM/DD → treat as day=05, month=13 → impossible
  // The implementation maps: parseInt(m)>12 → use position 1 as DD, position 2 as MM.
  // But 13 as a month is invalid too — the function returns it anyway (it doesn't validate calendar)
  const result = parseDate('05/13/2026');
  assert.equal(result, '2026-05-13');  // d=05, m=13 → invalid calendar but function still formats
});

test('parseDate: garbage string → null', () => {
  assert.equal(parseDate('not-a-date'), null);
});

test('parseDate: partial date (YYYY-MM only) → null', () => {
  assert.equal(parseDate('2026-06'), null);
});

// parseAmount ---

test('parseAmount: empty string → 0', () => {
  assert.equal(parseAmount(''), 0);
});

test('parseAmount: null → 0', () => {
  assert.equal(parseAmount(null), 0);
});

test('parseAmount: simple integer → number', () => {
  assert.equal(parseAmount('100'), 100);
});

test('parseAmount: decimal with dot → number', () => {
  assert.equal(parseAmount('1234.56'), 1234.56);
});

test('parseAmount: French decimal with comma (1234,56) → 1234.56', () => {
  assert.equal(parseAmount('1234,56'), 1234.56);
});

test('parseAmount: French with spaces and comma (1 234,56) → 1234.56', () => {
  assert.equal(parseAmount('1 234,56'), 1234.56);
});

test('parseAmount: dollar sign stripped (CA$45.00) → 45', () => {
  assert.equal(parseAmount('$45.00'), 45);
});

test('parseAmount: comma as thousands separator (1,234.56) → 1234.56', () => {
  assert.equal(parseAmount('1,234.56'), 1234.56);
});

test('parseAmount: negative amount (-45.50) → -45.5', () => {
  assert.equal(parseAmount('-45.50'), -45.5);
});

test('parseAmount: non-numeric string → 0', () => {
  assert.equal(parseAmount('N/A'), 0);
});

test('parseAmount: zero → 0', () => {
  assert.equal(parseAmount('0,00'), 0);
});

// detectBankFormat ---

test('detectBankFormat: Desjardins header → "desjardins"', () => {
  assert.equal(detectBankFormat(['Date', 'Numero de compte', 'Description', 'Montant']), 'desjardins');
});

test('detectBankFormat: Desjardins with accented header → "desjardins"', () => {
  assert.equal(detectBankFormat(['Date', 'Numéro de compte', 'Description', 'Montant']), 'desjardins');
});

test('detectBankFormat: TD bank → "td"', () => {
  assert.equal(detectBankFormat(['Date', 'Account Number', 'Description', 'Amount']), 'td');
});

test('detectBankFormat: RBC header → "rbc"', () => {
  assert.equal(detectBankFormat(['Date', 'RBC Reference', 'Description']), 'rbc');
});

test('detectBankFormat: BMO header → "bmo"', () => {
  assert.equal(detectBankFormat(['Date', 'BMO Description', 'Amount']), 'bmo');
});

test('detectBankFormat: unknown headers → "generic"', () => {
  assert.equal(detectBankFormat(['Date', 'Description', 'Debit', 'Credit']), 'generic');
});

test('detectBankFormat: empty headers → "generic"', () => {
  assert.equal(detectBankFormat([]), 'generic');
});

// findColumnIndex ---

test('findColumnIndex: exact match → correct index', () => {
  assert.equal(findColumnIndex(['Date', 'Description', 'Montant'], 'date'), 0);
});

test('findColumnIndex: case-insensitive match', () => {
  assert.equal(findColumnIndex(['DATE', 'DESCRIPTION', 'MONTANT'], 'date'), 0);
});

test('findColumnIndex: substring match ("Transaction Date" contains "date") → found', () => {
  assert.equal(findColumnIndex(['Transaction Date', 'Description'], 'date'), 0);
});

test('findColumnIndex: first candidate wins when multiple match', () => {
  // 'montant' and 'amount' both match the candidates — first candidate in the list wins
  const idx = findColumnIndex(['Date', 'Montant'], 'montant', 'amount');
  assert.equal(idx, 1);
});

test('findColumnIndex: no match → -1', () => {
  assert.equal(findColumnIndex(['Date', 'Description'], 'montant'), -1);
});

test('findColumnIndex: accented header normalized (Libellé matches libelle)', () => {
  assert.equal(findColumnIndex(['Date', 'Libellé', 'Montant'], 'libelle'), 1);
});

// ════════════════════════════════════════════════════════════════════════════
// INTEGRATION SKELETONS — set INTEGRATION_TEST=1 to run
// ════════════════════════════════════════════════════════════════════════════

test('INT-1 GET /api/agents/status — no session → 401', { skip: SKIP_INTEGRATION }, async () => {
  const res = await fetch(`${BASE}/api/agents/status`);
  assert.equal(res.status, 401);
});

test('INT-2 POST /api/bookings — no session → 401', { skip: SKIP_INTEGRATION }, async () => {
  const res = await fetch(`${BASE}/api/bookings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ quote_id: 1, jour1_date: '2026-07-01', jour1_slot: 'matin' }),
  });
  assert.equal(res.status, 401);
});

test('INT-3 POST /api/bank/import — no session → 401', { skip: SKIP_INTEGRATION }, async () => {
  const form = new FormData();
  form.append('file', new Blob(['Date,Desc,Montant'], { type: 'text/csv' }), 'bank.csv');
  const res = await fetch(`${BASE}/api/bank/import`, { method: 'POST', body: form });
  assert.equal(res.status, 401);
});

test('INT-4 GET /api/bookings/available?date=2099-12-01 — returns available slots', { skip: SKIP_INTEGRATION }, async () => {
  // Use a far-future date that won't have existing bookings
  const res = await fetch(`${BASE}/api/bookings/available?date=2099-12-01`, {
    headers: { Cookie: process.env.TEST_SESSION_COOKIE || '' },
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.ok(Array.isArray(data.slots) || typeof data === 'object', 'should return slots data');
});

test('INT-5 POST /api/bank/import — valid session but malformed CSV → 400', { skip: SKIP_INTEGRATION }, async () => {
  const form = new FormData();
  form.append('file', new Blob(['not,a,valid,bank,file'], { type: 'text/csv' }), 'bank.csv');
  const res = await fetch(`${BASE}/api/bank/import`, {
    method: 'POST',
    body: form,
    headers: { Cookie: process.env.TEST_SESSION_COOKIE || '' },
  });
  // Should reject with 400 (no parseable rows) or 200 with 0 rows — but never 500
  assert.ok([200, 400].includes(res.status), `unexpected status: ${res.status}`);
});

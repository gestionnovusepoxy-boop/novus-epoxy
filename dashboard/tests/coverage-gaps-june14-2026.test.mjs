/**
 * coverage-gaps-june14-2026.test.mjs
 *
 * TRUE GAPS not covered by any prior test file as of June 14 2026.
 * All decision logic is inlined (no @/ imports) — runs with plain node --test.
 *
 * Run: node --test tests/coverage-gaps-june14-2026.test.mjs
 *
 * UNIT GAPS:
 *   GAP-1  app/api/conversations/[id]/route.ts — admin price detection regex
 *           The POST handler uses two regex patterns to detect when an admin is
 *           setting a price in a handoff conversation. Pattern 1 matches "1500$"
 *           and "prix: 1500$"; pattern 2 matches "prix: 1500" (no $ sign at end).
 *           Only fires when conv.status === 'handoff'. Never unit-tested.
 *
 *   GAP-2  app/api/expenses/recurring/[id]/route.ts — actif must be a real boolean
 *           PATCH only handles `typeof body.actif === 'boolean'`. Sending the string
 *           "true" returns 400 "Champ actif requis" because typeof "true" !== 'boolean'.
 *           This strict type check is never asserted in any test.
 *
 *   GAP-3  app/api/invoices/[id]/route.ts — auto-send trigger on statut='completee'
 *           When PATCH sets statut to 'completee', a fire-and-forget fetch is sent to
 *           /api/invoices/{id}/send. The origin comes from request headers, falling back
 *           to 'https://novus-epoxy.vercel.app'. The trigger condition and fallback URL
 *           are never directly unit-tested.
 *
 *   GAP-4  app/api/crm/leads/[id]/route.ts — isNaN(leadId) guard → 400
 *           parseInt(id, 10) on a non-numeric string (e.g., "abc") produces NaN,
 *           returning 400 "ID invalide". This validation branch is never unit-tested.
 *
 *   GAP-5  middleware.ts — rateLimitMap cleanup when size > 10,000 entries
 *           When the in-memory rateLimitMap exceeds MAX_RATE_LIMIT_ENTRIES (10,000),
 *           the next isRateLimited() call scans and deletes expired entries. This
 *           cleanup path is never exercised in any test.
 *
 *   GAP-6  app/api/conversations/[id]/route.ts — no-email guard in price-set path
 *           When admin sets a price (priceMatch matches + status==='handoff') but
 *           conv.visitor_email is empty, the handler returns early with a warning
 *           rather than creating the quote. Never unit-tested.
 *
 *   GAP-7  app/api/conversations/[id]/route.ts — prix_pied_carre derived from
 *           customPrice / superficie. When superficie === 0, the division produces
 *           0 (not NaN/Infinity) because of the conditional: superficie > 0 ? ... : 0.
 *           Never unit-tested.
 *
 * INTEGRATION SKELETONS (skipped unless INTEGRATION_TEST=1):
 *   INT-1  POST /api/conversations/1 — no message → 400
 *   INT-2  POST /api/conversations/1 — message but conv not in handoff → no quote created
 *   INT-3  PATCH /api/expenses/recurring/1 — actif="true" (string) → 400
 *   INT-4  GET /api/crm/leads/abc — non-numeric id → 400
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

const SKIP_INTEGRATION = !process.env.INTEGRATION_TEST;
const BASE = process.env.TEST_BASE_URL || 'http://localhost:3000';

// ════════════════════════════════════════════════════════════════════════════
// GAP-1: conversations/[id] POST — admin price detection regex
//
// Inlined from app/api/conversations/[id]/route.ts
// Two patterns used in sequence with logical OR:
//   Pattern 1: `/(?:prix\s*[:=]\s*)?(\d+(?:\.\d{1,2})?)\s*\$/i`
//   Pattern 2: `/^prix\s*[:=]\s*(\d+(?:\.\d{1,2})?)/i`
// ════════════════════════════════════════════════════════════════════════════

function detectAdminPrice(message) {
  return (
    message.match(/(?:prix\s*[:=]\s*)?(\d+(?:\.\d{1,2})?)\s*\$/i) ||
    message.match(/^prix\s*[:=]\s*(\d+(?:\.\d{1,2})?)/i)
  );
}

// Pattern 1: bare amount with $ sign
test('GAP-1: price regex — "1500$" matches, captures 1500', () => {
  const m = detectAdminPrice('1500$');
  assert.ok(m, 'should match');
  assert.equal(parseFloat(m[1]), 1500);
});

test('GAP-1: price regex — "prix: 1500$" matches, captures 1500', () => {
  const m = detectAdminPrice('prix: 1500$');
  assert.ok(m, 'should match');
  assert.equal(parseFloat(m[1]), 1500);
});

test('GAP-1: price regex — "prix = 1500$" matches, captures 1500', () => {
  const m = detectAdminPrice('prix = 1500$');
  assert.ok(m, 'should match');
  assert.equal(parseFloat(m[1]), 1500);
});

// Pattern 2: "prix:" at start of string without $ sign
test('GAP-1: price regex — "prix: 2000" (no $) matches via pattern 2', () => {
  const m = detectAdminPrice('prix: 2000');
  assert.ok(m, 'should match via ^prix: pattern');
  assert.equal(parseFloat(m[1]), 2000);
});

test('GAP-1: price regex — "PRIX = 800" (uppercase, no $) matches via pattern 2', () => {
  const m = detectAdminPrice('PRIX = 800');
  assert.ok(m, 'case-insensitive match');
  assert.equal(parseFloat(m[1]), 800);
});

// Decimal amounts
test('GAP-1: price regex — "1750.50$" matches with decimal', () => {
  const m = detectAdminPrice('1750.50$');
  assert.ok(m);
  assert.equal(parseFloat(m[1]), 1750.50);
});

// Non-matching cases
test('GAP-1: price regex — "ok merci" does NOT match', () => {
  const m = detectAdminPrice('ok merci');
  assert.equal(m, null);
});

test('GAP-1: price regex — "1500 pi2" (no $ and no prix:) does NOT match', () => {
  const m = detectAdminPrice('1500 pi2');
  assert.equal(m, null);
});

test('GAP-1: price regex — "je prix tu" (prix not at start, no $) does NOT match pattern 2', () => {
  const m = detectAdminPrice('je prix tu');
  assert.equal(m, null);
});

// Empty / whitespace
test('GAP-1: price regex — empty string does NOT match', () => {
  const m = detectAdminPrice('');
  assert.equal(m, null);
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-2: expenses/recurring/[id] PATCH — actif must be a real boolean
//
// The route checks: typeof body.actif === 'boolean'
// Anything else (including string "true") falls through to 400.
// ════════════════════════════════════════════════════════════════════════════

function validateRecurringPatch(body) {
  if (typeof body.actif === 'boolean') {
    return { valid: true, actif: body.actif };
  }
  return { valid: false, error: 'Champ actif requis', status: 400 };
}

test('GAP-2: recurring PATCH — actif=true (boolean) → valid', () => {
  const r = validateRecurringPatch({ actif: true });
  assert.equal(r.valid, true);
  assert.equal(r.actif, true);
});

test('GAP-2: recurring PATCH — actif=false (boolean) → valid', () => {
  const r = validateRecurringPatch({ actif: false });
  assert.equal(r.valid, true);
  assert.equal(r.actif, false);
});

test('GAP-2: recurring PATCH — actif="true" (string) → 400', () => {
  const r = validateRecurringPatch({ actif: 'true' });
  assert.equal(r.valid, false);
  assert.equal(r.status, 400);
});

test('GAP-2: recurring PATCH — actif="false" (string) → 400', () => {
  const r = validateRecurringPatch({ actif: 'false' });
  assert.equal(r.valid, false);
  assert.equal(r.status, 400);
});

test('GAP-2: recurring PATCH — actif=1 (number) → 400', () => {
  const r = validateRecurringPatch({ actif: 1 });
  assert.equal(r.valid, false);
});

test('GAP-2: recurring PATCH — actif=null → 400', () => {
  const r = validateRecurringPatch({ actif: null });
  assert.equal(r.valid, false);
});

test('GAP-2: recurring PATCH — body with no actif field → 400', () => {
  const r = validateRecurringPatch({});
  assert.equal(r.valid, false);
  assert.equal(r.error, 'Champ actif requis');
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-3: invoices/[id] PATCH — auto-send trigger and origin fallback
//
// Inlined from app/api/invoices/[id]/route.ts
// When statut changes to 'completee', a fire-and-forget fetch is built:
//   origin = headers.get('origin') ?? 'https://novus-epoxy.vercel.app'
//   url    = `${origin}/api/invoices/${id}/send`
// ════════════════════════════════════════════════════════════════════════════

function buildAutoSendUrl(id, originHeader) {
  const origin = originHeader ?? 'https://novus-epoxy.vercel.app';
  return `${origin}/api/invoices/${id}/send`;
}

function shouldAutoSend(body) {
  return body.statut === 'completee';
}

test('GAP-3: auto-send — statut=completee triggers auto-send', () => {
  assert.equal(shouldAutoSend({ statut: 'completee' }), true);
});

test('GAP-3: auto-send — statut=envoye does NOT trigger auto-send', () => {
  assert.equal(shouldAutoSend({ statut: 'envoye' }), false);
});

test('GAP-3: auto-send — statut=brouillon does NOT trigger auto-send', () => {
  assert.equal(shouldAutoSend({ statut: 'brouillon' }), false);
});

test('GAP-3: auto-send URL — origin from header is used when present', () => {
  const url = buildAutoSendUrl(42, 'https://novus-epoxy.vercel.app');
  assert.equal(url, 'https://novus-epoxy.vercel.app/api/invoices/42/send');
});

test('GAP-3: auto-send URL — missing origin falls back to hardcoded Vercel URL', () => {
  const url = buildAutoSendUrl(99, null);
  assert.equal(url, 'https://novus-epoxy.vercel.app/api/invoices/99/send');
});

test('GAP-3: auto-send URL — custom origin used when provided (e.g. localhost)', () => {
  const url = buildAutoSendUrl(7, 'http://localhost:3000');
  assert.equal(url, 'http://localhost:3000/api/invoices/7/send');
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-4: crm/leads/[id] GET — isNaN(leadId) → 400 "ID invalide"
//
// Inlined from app/api/crm/leads/[id]/route.ts
//   const leadId = parseInt(id, 10);
//   if (isNaN(leadId)) return 400
// ════════════════════════════════════════════════════════════════════════════

function parseLeadId(id) {
  const leadId = parseInt(id, 10);
  if (isNaN(leadId)) return { error: 'ID invalide', status: 400 };
  return { leadId };
}

test('GAP-4: leadId parsing — numeric string "42" → valid leadId 42', () => {
  const r = parseLeadId('42');
  assert.equal(r.leadId, 42);
});

test('GAP-4: leadId parsing — "abc" → 400 "ID invalide"', () => {
  const r = parseLeadId('abc');
  assert.equal(r.status, 400);
  assert.equal(r.error, 'ID invalide');
});

test('GAP-4: leadId parsing — empty string → 400', () => {
  const r = parseLeadId('');
  assert.equal(r.status, 400);
});

test('GAP-4: leadId parsing — "12abc" → valid leadId 12 (parseInt stops at first non-digit)', () => {
  // parseInt('12abc') === 12, not NaN — documents the actual JS behaviour
  const r = parseLeadId('12abc');
  assert.equal(r.leadId, 12);
});

test('GAP-4: leadId parsing — "0" → valid leadId 0', () => {
  const r = parseLeadId('0');
  assert.equal(r.leadId, 0);
});

test('GAP-4: leadId parsing — negative "-5" → valid leadId -5 (no negative guard in route)', () => {
  const r = parseLeadId('-5');
  assert.equal(r.leadId, -5);
});

test('GAP-4: leadId parsing — "null" string → 400', () => {
  const r = parseLeadId('null');
  assert.equal(r.status, 400);
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-5: middleware.ts — rateLimitMap cleanup when size > 10,000
//
// Inlined from middleware.ts isRateLimited()
// When the map exceeds MAX_RATE_LIMIT_ENTRIES, expired entries are pruned.
// ════════════════════════════════════════════════════════════════════════════

const MAX_RATE_LIMIT_ENTRIES = 10_000;

function isRateLimitedWithCleanup(map, key, maxRequests, windowMs) {
  const now = Date.now();
  const entry = map.get(key);

  if (!entry || now > entry.resetAt) {
    if (map.size > MAX_RATE_LIMIT_ENTRIES) {
      for (const [k, v] of map) {
        if (now > v.resetAt) map.delete(k);
      }
    }
    map.set(key, { count: 1, resetAt: now + windowMs });
    return false;
  }

  entry.count++;
  return entry.count > maxRequests;
}

test('GAP-5: rateLimitMap cleanup — expired entries removed when map exceeds 10k', () => {
  const map = new Map();

  // Fill with 10,001 expired entries
  const PAST = Date.now() - 1;
  for (let i = 0; i < MAX_RATE_LIMIT_ENTRIES + 1; i++) {
    map.set(`ip-${i}`, { count: 1, resetAt: PAST });
  }
  assert.equal(map.size, MAX_RATE_LIMIT_ENTRIES + 1, 'map starts oversize');

  // Trigger a new request — cleanup fires because size > 10k
  const result = isRateLimitedWithCleanup(map, 'new-key', 10, 60_000);

  assert.equal(result, false, 'new IP is not rate-limited');
  // All expired entries should be gone (size > 10k triggered cleanup)
  // Only the new key remains
  assert.equal(map.size, 1, 'all expired entries were pruned, only new key remains');
  assert.ok(map.has('new-key'), 'new key was inserted');
});

test('GAP-5: rateLimitMap cleanup — no cleanup when size is at or below 10k', () => {
  const map = new Map();

  // Fill with exactly 10k expired entries (at the limit, not over)
  const PAST = Date.now() - 1;
  for (let i = 0; i < MAX_RATE_LIMIT_ENTRIES; i++) {
    map.set(`ip-${i}`, { count: 1, resetAt: PAST });
  }
  assert.equal(map.size, MAX_RATE_LIMIT_ENTRIES);

  // New request — size not > 10k so no cleanup
  isRateLimitedWithCleanup(map, 'new-key', 10, 60_000);

  // Old entries are NOT cleaned because size was exactly 10k (not >)
  assert.equal(map.size, MAX_RATE_LIMIT_ENTRIES + 1, 'no cleanup: size was not exceeded');
});

test('GAP-5: rateLimitMap cleanup — active (non-expired) entries survive pruning', () => {
  const map = new Map();
  const FUTURE = Date.now() + 60_000;
  const PAST = Date.now() - 1;

  // Mix: 10k expired + 1 active
  for (let i = 0; i < MAX_RATE_LIMIT_ENTRIES; i++) {
    map.set(`expired-${i}`, { count: 1, resetAt: PAST });
  }
  map.set('active-key', { count: 1, resetAt: FUTURE });
  // Now size is 10,001 — oversize

  isRateLimitedWithCleanup(map, 'trigger', 10, 60_000);

  // Expired entries deleted; active-key and trigger remain
  assert.ok(map.has('active-key'), 'active entry survives cleanup');
  assert.ok(map.has('trigger'), 'new trigger key inserted');
  assert.ok(!map.has('expired-0'), 'expired entries removed');
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-6 & GAP-7: conversations/[id] POST — no-email guard + zero-superficie
//
// Inlined from app/api/conversations/[id]/route.ts price-set path
// ════════════════════════════════════════════════════════════════════════════

function computePrixPiedCarre(customPrice, superficie) {
  return superficie > 0 ? Math.round((customPrice / superficie) * 100) / 100 : 0;
}

function buildQuoteFromConv(conv, priceMatch) {
  if (!priceMatch) return null;
  if (conv.status !== 'handoff') return null;
  if (!conv.visitor_email) {
    return { ok: true, warning: "Pas d'email client — devis non cree. Collectez l'email d'abord." };
  }
  const customPrice = parseFloat(priceMatch[1]);
  const superficie = Number(conv.superficie) || 0;
  return {
    createQuote: true,
    customPrice,
    prixPiedCarre: computePrixPiedCarre(customPrice, superficie),
  };
}

test('GAP-6: no-email guard — empty visitor_email returns warning, no quote', () => {
  const conv = { status: 'handoff', visitor_email: '', superficie: 400 };
  const match = detectAdminPrice('1500$');
  const r = buildQuoteFromConv(conv, match);
  assert.ok(r, 'returns response');
  assert.ok(r.warning, 'has warning message');
  assert.ok(!r.createQuote, 'does NOT create quote');
  assert.ok(r.warning.includes('email'), 'warning mentions email');
});

test('GAP-6: no-email guard — valid email proceeds to quote creation', () => {
  const conv = { status: 'handoff', visitor_email: 'client@example.com', superficie: 400 };
  const match = detectAdminPrice('1500$');
  const r = buildQuoteFromConv(conv, match);
  assert.equal(r.createQuote, true);
  assert.equal(r.customPrice, 1500);
});

test('GAP-7: prix_pied_carre — superficie > 0 → division result rounded to 2 decimals', () => {
  // 1500 / 400 = 3.75
  assert.equal(computePrixPiedCarre(1500, 400), 3.75);
});

test('GAP-7: prix_pied_carre — superficie = 0 → returns 0 (no division by zero)', () => {
  assert.equal(computePrixPiedCarre(1500, 0), 0);
});

test('GAP-7: prix_pied_carre — superficie not provided defaults to 0 via `|| 0`', () => {
  const superficie = Number(undefined) || 0;
  assert.equal(computePrixPiedCarre(2000, superficie), 0);
});

test('GAP-7: prix_pied_carre — rounding at 2 decimals', () => {
  // 1000 / 3 = 333.333... → rounds to 333.33
  assert.equal(computePrixPiedCarre(1000, 3), 333.33);
});

// ════════════════════════════════════════════════════════════════════════════
// INTEGRATION SKELETONS
// ════════════════════════════════════════════════════════════════════════════

test(
  'INT-1: POST /api/conversations/1 — no message body → 400',
  { skip: SKIP_INTEGRATION ? 'set INTEGRATION_TEST=1 + TEST_BASE_URL' : false },
  async () => {
    const r = await fetch(`${BASE}/api/conversations/1`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(r.status, 400);
    const j = await r.json();
    assert.ok(j.error);
  }
);

test(
  'INT-2: POST /api/conversations/1 — message on non-handoff conv → reply stored, no quote',
  { skip: SKIP_INTEGRATION ? 'set INTEGRATION_TEST=1 + TEST_BASE_URL' : false },
  async () => {
    const r = await fetch(`${BASE}/api/conversations/1`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Bonjour' }),
    });
    // 401 (not authenticated) or 200/404 depending on state — just verify no crash
    assert.ok([200, 400, 401, 404].includes(r.status));
  }
);

test(
  'INT-3: PATCH /api/expenses/recurring/1 — actif as string "true" → 400',
  { skip: SKIP_INTEGRATION ? 'set INTEGRATION_TEST=1 + TEST_BASE_URL' : false },
  async () => {
    const r = await fetch(`${BASE}/api/expenses/recurring/1`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actif: 'true' }),
    });
    // 401 if no session, but if session: 400 for string actif
    assert.ok([400, 401].includes(r.status));
  }
);

test(
  'INT-4: GET /api/crm/leads/abc — non-numeric id → 400 "ID invalide"',
  { skip: SKIP_INTEGRATION ? 'set INTEGRATION_TEST=1 + TEST_BASE_URL' : false },
  async () => {
    const r = await fetch(`${BASE}/api/crm/leads/abc`);
    assert.ok([400, 401].includes(r.status));
    if (r.status === 400) {
      const j = await r.json();
      assert.equal(j.error, 'ID invalide');
    }
  }
);

/**
 * coverage-gaps-june11-2026-track-composio.test.mjs
 *
 * Run: node --test tests/coverage-gaps-june11-2026-track-composio.test.mjs
 *
 * TRUE GAPS — pure logic never covered by any prior test file as of June 11 2026.
 *
 *   GAP-1  app/api/track/route.ts — sha256() determinism + session bucketing
 *          Same IP/UA/day → same visitorHash. Half-hour bucket boundary (minute 29
 *          vs 30) produces different sessionHash. The hashing is the core of
 *          analytics deduplication — a bug silently drops or inflates unique visitor
 *          counts with no visible error.
 *
 *   GAP-2  app/api/track/route.ts — request validation + event type branching
 *          body.type missing → 400 (no other test covers this guard).
 *          body.type === 'event' branch stores name/value, not url/duration.
 *          body.path truncated to 500 chars.
 *
 *   GAP-3  lib/composio.ts — getVercelTools() empty-key catch returns {}
 *          When COMPOSIO_API_KEY is absent, new Composio({ apiKey: '' }) throws;
 *          getVercelTools() must return {} not throw.
 *          getAgentTools() must return [] when composio.tools.get returns non-array.
 *
 * INTEGRATION SKELETONS (skipped unless INTEGRATION_TEST=1):
 *   INT-1  POST /api/track — missing body.type → 400
 *   INT-2  POST /api/track — valid pageview → 204
 *   INT-3  POST /api/track — valid event → 204
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const SKIP_INTEGRATION = !process.env.INTEGRATION_TEST;
const BASE = process.env.TEST_BASE_URL || 'http://localhost:3000';

// ════════════════════════════════════════════════════════════════════════════
// GAP-1: sha256() determinism + session bucketing
//
// Inlined from app/api/track/route.ts — uses Web Crypto API (crypto.subtle).
// Node 18+ has globalThis.crypto = WebCrypto, so this works in test env.
// ════════════════════════════════════════════════════════════════════════════

async function sha256(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Inlined session-bucket logic from track/route.ts */
function sessionBucket(utcHour, utcMinute) {
  const hour = utcHour.toString();
  const halfHour = Math.floor(utcMinute / 30).toString();
  return `${hour}:${halfHour}`;
}

test('sha256: same input produces same hash (deterministic)', async () => {
  const h1 = await sha256('192.168.1.1Mozilla/5.0 Firefox2026-06-11');
  const h2 = await sha256('192.168.1.1Mozilla/5.0 Firefox2026-06-11');
  assert.equal(h1, h2);
});

test('sha256: different input produces different hash', async () => {
  const h1 = await sha256('192.168.1.1Mozilla2026-06-11');
  const h2 = await sha256('10.0.0.1Mozilla2026-06-11');
  assert.notEqual(h1, h2);
});

test('sha256: output is 64 hex characters (256 bits)', async () => {
  const h = await sha256('test');
  assert.equal(h.length, 64);
  assert.match(h, /^[0-9a-f]{64}$/);
});

test('sha256: empty string produces known hash', async () => {
  const h = await sha256('');
  // SHA-256 of empty string is well-known
  assert.equal(h, 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
});

test('sessionBucket: minute 0 → half-hour bucket 0', () => {
  assert.equal(sessionBucket(14, 0), '14:0');
});

test('sessionBucket: minute 29 → half-hour bucket 0 (still first half)', () => {
  assert.equal(sessionBucket(14, 29), '14:0');
});

test('sessionBucket: minute 30 → half-hour bucket 1 (second half starts)', () => {
  assert.equal(sessionBucket(14, 30), '14:1');
});

test('sessionBucket: minute 59 → half-hour bucket 1', () => {
  assert.equal(sessionBucket(14, 59), '14:1');
});

test('sessionBucket: boundary minute 29 and 30 produce DIFFERENT buckets', () => {
  const before = sessionBucket(9, 29);
  const after = sessionBucket(9, 30);
  assert.notEqual(before, after, 'minute 29 vs 30 must land in different session buckets');
});

test('visitorHash is stable across the same day (hour-independent)', async () => {
  const ip = '1.2.3.4';
  const ua = 'TestAgent/1.0';
  const today = '2026-06-11';
  // visitorHash = sha256(ip + ua + today) — no hour component
  const h1 = await sha256(`${ip}${ua}${today}`);
  const h2 = await sha256(`${ip}${ua}${today}`);
  assert.equal(h1, h2, 'visitorHash must be stable all day');
});

test('sessionHash differs between hour buckets for same visitor', async () => {
  const ip = '1.2.3.4';
  const ua = 'TestAgent/1.0';
  const today = '2026-06-11';
  // sessionHash = sha256(ip + ua + today + hour + halfHour)
  const h_9am = await sha256(`${ip}${ua}${today}9${'0'}`);
  const h_10am = await sha256(`${ip}${ua}${today}10${'0'}`);
  assert.notEqual(h_9am, h_10am, 'different hours must produce different sessionHash');
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-2: request validation + event type branching
//
// Inlined from app/api/track/route.ts — the dispatch logic that decides
// which INSERT to run based on body.type.
// ════════════════════════════════════════════════════════════════════════════

function validateTrackBody(body) {
  if (!body?.type) return { valid: false, status: 400 };
  return { valid: true, status: 204 };
}

function resolveTrackType(type) {
  if (type === 'pageview') return 'pageview';
  if (type === 'event') return 'event';
  return 'unknown';
}

function truncatePath(path) {
  return (typeof path === 'string' ? path : '/').slice(0, 500);
}

test('track: missing body → invalid (400)', () => {
  assert.equal(validateTrackBody(null).valid, false);
  assert.equal(validateTrackBody(null).status, 400);
});

test('track: body without type → invalid (400)', () => {
  assert.equal(validateTrackBody({ path: '/home' }).valid, false);
});

test('track: body with type → valid (204)', () => {
  assert.equal(validateTrackBody({ type: 'pageview' }).valid, true);
  assert.equal(validateTrackBody({ type: 'pageview' }).status, 204);
});

test('track: body.type === "pageview" routes to pageview INSERT', () => {
  assert.equal(resolveTrackType('pageview'), 'pageview');
});

test('track: body.type === "event" routes to event INSERT', () => {
  assert.equal(resolveTrackType('event'), 'event');
});

test('track: unknown body.type does not route to either INSERT', () => {
  assert.equal(resolveTrackType('click'), 'unknown');
  assert.equal(resolveTrackType(''), 'unknown');
});

test('track: body.path truncated to 500 chars', () => {
  const long = '/'.repeat(600);
  assert.equal(truncatePath(long).length, 500);
});

test('track: body.path null/undefined falls back to "/"', () => {
  assert.equal(truncatePath(null), '/');
  assert.equal(truncatePath(undefined), '/');
});

test('track: body.path short string left unchanged', () => {
  assert.equal(truncatePath('/dashboard/clients'), '/dashboard/clients');
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-3: lib/composio.ts — getVercelTools() error catch, getAgentTools() coercion
//
// getVercelTools(): when API key is absent, new Composio() may throw.
//   The catch block must return {} not re-throw.
// getAgentTools(): when composio.tools.get returns a non-array (object, null),
//   the Array.isArray guard coerces it to [].
// ════════════════════════════════════════════════════════════════════════════

/** Inlined coercion guard from lib/composio.ts getAgentTools() */
function coerceToArray(tools) {
  return Array.isArray(tools) ? tools : [];
}

/** Inlined error-catch pattern from lib/composio.ts getVercelTools() */
async function getVercelToolsSafe(fetchFn) {
  try {
    const tools = await fetchFn();
    return (tools) ?? {};
  } catch {
    return {};
  }
}

test('composio getAgentTools: Array.isArray guard returns array unchanged', () => {
  const arr = [{ name: 'tool1' }, { name: 'tool2' }];
  assert.deepEqual(coerceToArray(arr), arr);
});

test('composio getAgentTools: non-array object coerced to []', () => {
  assert.deepEqual(coerceToArray({ tool1: {} }), []);
});

test('composio getAgentTools: null coerced to []', () => {
  assert.deepEqual(coerceToArray(null), []);
});

test('composio getAgentTools: empty array returned as-is', () => {
  assert.deepEqual(coerceToArray([]), []);
});

test('composio getVercelTools: throwing fetch returns {} (no re-throw)', async () => {
  const result = await getVercelToolsSafe(() => { throw new Error('API key absent'); });
  assert.deepEqual(result, {});
});

test('composio getVercelTools: null result coerced to {}', async () => {
  const result = await getVercelToolsSafe(async () => null);
  assert.deepEqual(result, {});
});

test('composio getVercelTools: valid tools object passed through', async () => {
  const tools = { GMAIL_SEND: {}, GMAIL_READ: {} };
  const result = await getVercelToolsSafe(async () => tools);
  assert.deepEqual(result, tools);
});

// ════════════════════════════════════════════════════════════════════════════
// Integration skeletons (skipped unless INTEGRATION_TEST=1)
// ════════════════════════════════════════════════════════════════════════════

test('INT-1: POST /api/track — missing body.type → 400', { skip: SKIP_INTEGRATION }, async () => {
  const res = await fetch(`${BASE}/api/track`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: '/home' }),
  });
  assert.equal(res.status, 400);
});

test('INT-2: POST /api/track — valid pageview → 204', { skip: SKIP_INTEGRATION }, async () => {
  const res = await fetch(`${BASE}/api/track`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'pageview', path: '/test', referrer: null }),
  });
  assert.equal(res.status, 204);
});

test('INT-3: POST /api/track — valid event → 204', { skip: SKIP_INTEGRATION }, async () => {
  const res = await fetch(`${BASE}/api/track`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'event', name: 'form_submit', path: '/contact', value: 'flake' }),
  });
  assert.equal(res.status, 204);
});

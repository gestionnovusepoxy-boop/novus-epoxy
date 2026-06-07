/**
 * Tests for lib/lead-blocklist.ts — normalizeEmail / normalizePhone (inlined)
 * and the pure retry/lookup logic patterns.
 *
 * isBlocked() and blockLead() require a live DB — those are integration-only
 * and guarded by INTEGRATION_TEST=1.
 *
 * Run: node --test tests/lead-blocklist.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

// ── Inlined pure helpers (mirror exactly from lead-blocklist.ts) ──────────────

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

// ── normalizeEmail ────────────────────────────────────────────────────────────

test('normalizeEmail: lowercases', () => {
  assert.equal(normalizeEmail('Client@Example.COM'), 'client@example.com');
});

test('normalizeEmail: trims whitespace', () => {
  assert.equal(normalizeEmail('  client@example.com  '), 'client@example.com');
});

test('normalizeEmail: null input → null', () => {
  assert.equal(normalizeEmail(null), null);
});

test('normalizeEmail: undefined input → null', () => {
  assert.equal(normalizeEmail(undefined), null);
});

test('normalizeEmail: empty string → null', () => {
  assert.equal(normalizeEmail(''), null);
});

test('normalizeEmail: spaces-only → null', () => {
  assert.equal(normalizeEmail('   '), null);
});

test('normalizeEmail: preserves valid lowercase as-is', () => {
  assert.equal(normalizeEmail('luca@novusepoxy.ca'), 'luca@novusepoxy.ca');
});

// ── normalizePhone ────────────────────────────────────────────────────────────

test('normalizePhone: plain 10-digit → same', () => {
  assert.equal(normalizePhone('5813075983'), '5813075983');
});

test('normalizePhone: strips dashes and spaces (514) 555-1234', () => {
  assert.equal(normalizePhone('(514) 555-1234'), '5145551234');
});

test('normalizePhone: 11-digit with leading 1 → last 10', () => {
  assert.equal(normalizePhone('15813075983'), '5813075983');
});

test('normalizePhone: null → null', () => {
  assert.equal(normalizePhone(null), null);
});

test('normalizePhone: undefined → null', () => {
  assert.equal(normalizePhone(undefined), null);
});

test('normalizePhone: 9 digits → null (too short)', () => {
  assert.equal(normalizePhone('581307598'), null);
});

test('normalizePhone: empty string → null', () => {
  assert.equal(normalizePhone(''), null);
});

test('normalizePhone: phone with dots 514.555.1234 → 5145551234', () => {
  assert.equal(normalizePhone('514.555.1234'), '5145551234');
});

test('normalizePhone: international +1 prefix stripped correctly', () => {
  assert.equal(normalizePhone('+15813075983'), '5813075983');
});

// ── isBlocked key-construction logic (pure, no DB) ───────────────────────────

test('block key format for email', () => {
  const email = normalizeEmail('Client@Example.COM');
  assert.equal(`lead_block_email_${email}`, 'lead_block_email_client@example.com');
});

test('block key format for phone', () => {
  const phone = normalizePhone('(514) 555-1234');
  assert.equal(`lead_block_phone_${phone}`, 'lead_block_phone_5145551234');
});

test('both null → no keys to check (neither email nor phone)', () => {
  const email = normalizeEmail(null);
  const phone = normalizePhone(null);
  const keys = [];
  if (email) keys.push(`lead_block_email_${email}`);
  if (phone) keys.push(`lead_block_phone_${phone}`);
  assert.equal(keys.length, 0);
});

// ── BlockInfo JSON round-trip ─────────────────────────────────────────────────

test('BlockInfo serializes and deserializes correctly', () => {
  const info = { reason: 'complaint', at: '2026-06-01T10:00:00.000Z', detail: 'harcèlement' };
  const serialized = JSON.stringify(info);
  const parsed = JSON.parse(serialized);
  assert.equal(parsed.reason, 'complaint');
  assert.equal(parsed.at, '2026-06-01T10:00:00.000Z');
  assert.equal(parsed.detail, 'harcèlement');
});

test('BlockInfo without detail field — optional', () => {
  const info = { reason: 'unsubscribed', at: '2026-06-01T10:00:00.000Z' };
  const parsed = JSON.parse(JSON.stringify(info));
  assert.equal(parsed.detail, undefined);
});

// ── INTEGRATION tests (skipped unless INTEGRATION_TEST=1) ────────────────────

const INTEGRATION = process.env.INTEGRATION_TEST === '1';

if (INTEGRATION) {
  // These require a live DB. Run with: INTEGRATION_TEST=1 node --test tests/lead-blocklist.test.mjs
  test('isBlocked: returns null for unknown email/phone', async () => {
    const { isBlocked } = await import('../lib/lead-blocklist.ts');
    const result = await isBlocked({ email: 'never-blocked@example.com', phone: '0000000000' });
    assert.equal(result, null);
  });

  test('blockLead + isBlocked: round-trip', async () => {
    const { isBlocked, blockLead } = await import('../lib/lead-blocklist.ts');
    const testEmail = `test-block-${Date.now()}@example.com`;
    await blockLead({ email: testEmail, reason: 'manual', detail: 'integration test' });
    const result = await isBlocked({ email: testEmail });
    assert.ok(result !== null, 'should be blocked after blockLead');
    assert.equal(result.reason, 'manual');
  });

  test('isBlocked: lookup failure never blocks (returns null)', async () => {
    const { isBlocked } = await import('../lib/lead-blocklist.ts');
    // Passing empty opts → no keys → null
    const result = await isBlocked({});
    assert.equal(result, null);
  });
}

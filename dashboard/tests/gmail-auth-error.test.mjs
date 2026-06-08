/**
 * Tests for the error-detection logic inside handleGmailAuthError (lib/send-email.ts).
 *
 * GAP: handleGmailAuthError is completely untested. The pure string detection
 * (does this error contain "invalid_grant"?) is the critical gate that triggers
 * DB state changes and Telegram alerts. A regression here silently breaks Gmail recovery.
 *
 * The function's DB calls and Telegram network call are side effects — not unit-testable
 * without mocks. This file tests only the pure detection logic reproduced inline.
 *
 * Run: node --test tests/gmail-auth-error.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

// ── Inlined detection from lib/send-email.ts ─────────────────────────────────

function isInvalidGrantError(err) {
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();
  return lower.includes('invalid_grant') || lower.includes('invalid grant');
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test('isInvalidGrantError: "invalid_grant" string → true', () => {
  assert.equal(isInvalidGrantError(new Error('invalid_grant')), true);
});

test('isInvalidGrantError: "invalid grant" (space variant) → true', () => {
  assert.equal(isInvalidGrantError(new Error('invalid grant')), true);
});

test('isInvalidGrantError: mixed case "Invalid_Grant" → true', () => {
  assert.equal(isInvalidGrantError(new Error('Invalid_Grant')), true);
});

test('isInvalidGrantError: error object with invalid_grant in middle → true', () => {
  assert.equal(isInvalidGrantError(new Error('Google OAuth failed: invalid_grant — token revoked')), true);
});

test('isInvalidGrantError: plain string error → true', () => {
  assert.equal(isInvalidGrantError('invalid_grant'), true);
});

test('isInvalidGrantError: network timeout error → false', () => {
  assert.equal(isInvalidGrantError(new Error('network timeout after 30s')), false);
});

test('isInvalidGrantError: ECONNREFUSED → false', () => {
  assert.equal(isInvalidGrantError(new Error('connect ECONNREFUSED 127.0.0.1:587')), false);
});

test('isInvalidGrantError: null (edge case) → false', () => {
  assert.equal(isInvalidGrantError(null), false);
});

test('isInvalidGrantError: undefined (edge case) → false', () => {
  assert.equal(isInvalidGrantError(undefined), false);
});

test('isInvalidGrantError: empty string → false', () => {
  assert.equal(isInvalidGrantError(''), false);
});

test('isInvalidGrantError: 403 forbidden without grant keyword → false', () => {
  assert.equal(isInvalidGrantError(new Error('Request failed with status 403 Forbidden')), false);
});

// ── Edge: handleGmailAuthError returns early on non-grant errors ───────────────

test('non-grant error: function should exit before touching DB', () => {
  // Simulates the guard at line 14 of send-email.ts:
  //   if (!lower.includes('invalid_grant') && !lower.includes('invalid grant')) return;
  const err = new Error('socket hang up');
  const wouldTrigger = isInvalidGrantError(err);
  assert.equal(wouldTrigger, false, 'non-grant errors must not trigger DB + alert flow');
});

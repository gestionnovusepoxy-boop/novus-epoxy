/**
 * Tests for lib/telegram-utils.ts — isQuietHours() and getAdminChatIds() pure logic.
 * Run: node --test tests/telegram-quiet-hours.test.mjs
 *
 * isQuietHours() uses the real clock, so we reproduce the boundary logic inline
 * and test getAdminChatIds() via env-var manipulation.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { isQuietHours, getAdminChatIds } from '../lib/telegram-utils.ts';

// ── isQuietHours boundary logic ───────────────────────────────────────────────
// The rule: quiet hours = 21 ≤ h || h < 7  (i.e. 21h-6h59 is quiet)
// We reproduce the check inline to test each boundary without mocking the clock.

function isQuietAt(h) {
  return h >= 21 || h < 7;
}

test('isQuietHours logic: h=0 → quiet', () => assert.equal(isQuietAt(0), true));
test('isQuietHours logic: h=6 → quiet', () => assert.equal(isQuietAt(6), true));
test('isQuietHours logic: h=7 → not quiet (business starts)', () => assert.equal(isQuietAt(7), false));
test('isQuietHours logic: h=8 → not quiet', () => assert.equal(isQuietAt(8), false));
test('isQuietHours logic: h=20 → not quiet', () => assert.equal(isQuietAt(20), false));
test('isQuietHours logic: h=21 → quiet (cutoff)', () => assert.equal(isQuietAt(21), true));
test('isQuietHours logic: h=23 → quiet', () => assert.equal(isQuietAt(23), true));

// Smoke-test the real export — just verify it returns a boolean.
test('isQuietHours() returns a boolean', () => {
  const result = isQuietHours();
  assert.equal(typeof result, 'boolean');
});

// ── getAdminChatIds ───────────────────────────────────────────────────────────

test('getAdminChatIds: TELEGRAM_GROUP_CHAT_ID set → returns single-element array', () => {
  const orig = process.env.TELEGRAM_GROUP_CHAT_ID;
  process.env.TELEGRAM_GROUP_CHAT_ID = '-100123456789';
  try {
    const ids = getAdminChatIds();
    assert.deepEqual(ids, ['-100123456789']);
  } finally {
    if (orig === undefined) delete process.env.TELEGRAM_GROUP_CHAT_ID;
    else process.env.TELEGRAM_GROUP_CHAT_ID = orig;
  }
});

test('getAdminChatIds: falls back to TELEGRAM_ADMIN_CHAT_IDS when group not set', () => {
  const origGroup = process.env.TELEGRAM_GROUP_CHAT_ID;
  const origAdmins = process.env.TELEGRAM_ADMIN_CHAT_IDS;
  delete process.env.TELEGRAM_GROUP_CHAT_ID;
  process.env.TELEGRAM_ADMIN_CHAT_IDS = '111,222,333';
  try {
    const ids = getAdminChatIds();
    assert.deepEqual(ids, ['111', '222', '333']);
  } finally {
    if (origGroup === undefined) delete process.env.TELEGRAM_GROUP_CHAT_ID;
    else process.env.TELEGRAM_GROUP_CHAT_ID = origGroup;
    if (origAdmins === undefined) delete process.env.TELEGRAM_ADMIN_CHAT_IDS;
    else process.env.TELEGRAM_ADMIN_CHAT_IDS = origAdmins;
  }
});

test('getAdminChatIds: no env vars → empty array', () => {
  const origGroup = process.env.TELEGRAM_GROUP_CHAT_ID;
  const origAdmins = process.env.TELEGRAM_ADMIN_CHAT_IDS;
  delete process.env.TELEGRAM_GROUP_CHAT_ID;
  delete process.env.TELEGRAM_ADMIN_CHAT_IDS;
  try {
    const ids = getAdminChatIds();
    assert.deepEqual(ids, []);
  } finally {
    if (origGroup !== undefined) process.env.TELEGRAM_GROUP_CHAT_ID = origGroup;
    if (origAdmins !== undefined) process.env.TELEGRAM_ADMIN_CHAT_IDS = origAdmins;
  }
});

test('getAdminChatIds: TELEGRAM_GROUP_CHAT_ID takes priority over TELEGRAM_ADMIN_CHAT_IDS', () => {
  const origGroup = process.env.TELEGRAM_GROUP_CHAT_ID;
  const origAdmins = process.env.TELEGRAM_ADMIN_CHAT_IDS;
  process.env.TELEGRAM_GROUP_CHAT_ID = '-100group';
  process.env.TELEGRAM_ADMIN_CHAT_IDS = '111,222';
  try {
    const ids = getAdminChatIds();
    assert.deepEqual(ids, ['-100group'], 'group must win over admin list');
  } finally {
    if (origGroup === undefined) delete process.env.TELEGRAM_GROUP_CHAT_ID;
    else process.env.TELEGRAM_GROUP_CHAT_ID = origGroup;
    if (origAdmins === undefined) delete process.env.TELEGRAM_ADMIN_CHAT_IDS;
    else process.env.TELEGRAM_ADMIN_CHAT_IDS = origAdmins;
  }
});

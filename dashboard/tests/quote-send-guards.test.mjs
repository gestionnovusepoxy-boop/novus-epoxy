/**
 * quote-send-guards.test.mjs
 *
 * GAP: /api/quotes/[id]/send/route.ts contains two critical business guards
 * that have ZERO test coverage:
 *
 *   1. Anti-double-send:  blocks resends within 60 seconds (prevents duplicate emails)
 *   2. Statut allowlist:  only 6 statuts permit email delivery; others must be rejected
 *   3. Missing email guard: client with no/invalid email → 400
 *   4. LLM daily budget cap: `spent >= cap` comparison, env-var default $10
 *
 * All logic inlined from the route file to avoid Next.js/DB dependencies.
 * Run: node --test tests/quote-send-guards.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

// ════════════════════════════════════════════════════════════════════════════
// Inlined from /app/api/quotes/[id]/send/route.ts
// ════════════════════════════════════════════════════════════════════════════

const ALLOWED_SEND_STATUTS = ['approuve', 'envoye', 'contrat_signe', 'depot_paye', 'planifie', 'complete'];

function canSendQuoteEmail(statut) {
  return ALLOWED_SEND_STATUTS.includes(statut);
}

function isDoubleSubmit(sentAtIso, nowMs, windowMs = 60_000) {
  if (!sentAtIso) return false;
  return (nowMs - new Date(sentAtIso).getTime()) < windowMs;
}

function hasValidClientEmail(email) {
  return typeof email === 'string' && email.includes('@');
}

// Inlined from lib/llm.ts – assertWithinDailyBudget arithmetic
function isOverDailyBudget(spentUsd, capUsdEnvValue) {
  const cap = Number(capUsdEnvValue ?? '10');
  return spentUsd >= cap;
}

function llmCapErrorMessage(spent, cap) {
  return `LLM daily cap reached: $${spent.toFixed(2)} >= $${cap.toFixed(2)}`;
}

// ════════════════════════════════════════════════════════════════════════════
// 1. Statut allowlist
// ════════════════════════════════════════════════════════════════════════════

test('quote send: "approuve" statut → allowed', () => {
  assert.equal(canSendQuoteEmail('approuve'), true);
});

test('quote send: "envoye" statut → allowed', () => {
  assert.equal(canSendQuoteEmail('envoye'), true);
});

test('quote send: "contrat_signe" statut → allowed', () => {
  assert.equal(canSendQuoteEmail('contrat_signe'), true);
});

test('quote send: "depot_paye" statut → allowed', () => {
  assert.equal(canSendQuoteEmail('depot_paye'), true);
});

test('quote send: "planifie" statut → allowed', () => {
  assert.equal(canSendQuoteEmail('planifie'), true);
});

test('quote send: "complete" statut → allowed', () => {
  assert.equal(canSendQuoteEmail('complete'), true);
});

test('quote send: "brouillon" statut → rejected', () => {
  assert.equal(canSendQuoteEmail('brouillon'), false);
});

test('quote send: "annule" statut → rejected', () => {
  assert.equal(canSendQuoteEmail('annule'), false);
});

test('quote send: "en_attente" statut → rejected', () => {
  assert.equal(canSendQuoteEmail('en_attente'), false);
});

test('quote send: empty string statut → rejected', () => {
  assert.equal(canSendQuoteEmail(''), false);
});

test('quote send: undefined statut → rejected', () => {
  assert.equal(canSendQuoteEmail(undefined), false);
});

test('quote send: exactly 6 allowed statuts (no silent additions)', () => {
  assert.equal(ALLOWED_SEND_STATUTS.length, 6);
});

// ════════════════════════════════════════════════════════════════════════════
// 2. Anti-double-send guard (60-second window)
// ════════════════════════════════════════════════════════════════════════════

test('anti-double-send: null sent_at → not a double submit', () => {
  assert.equal(isDoubleSubmit(null, Date.now()), false);
});

test('anti-double-send: sent 30s ago → blocked (< 60s)', () => {
  const sentAt = new Date(Date.now() - 30_000).toISOString();
  assert.equal(isDoubleSubmit(sentAt, Date.now()), true);
});

test('anti-double-send: sent 59s ago → still blocked', () => {
  const sentAt = new Date(Date.now() - 59_000).toISOString();
  assert.equal(isDoubleSubmit(sentAt, Date.now()), true);
});

test('anti-double-send: sent exactly 60s ago → not blocked (boundary is strict <)', () => {
  const sentAt = new Date(Date.now() - 60_000).toISOString();
  assert.equal(isDoubleSubmit(sentAt, Date.now()), false);
});

test('anti-double-send: sent 61s ago → allowed', () => {
  const sentAt = new Date(Date.now() - 61_000).toISOString();
  assert.equal(isDoubleSubmit(sentAt, Date.now()), false);
});

test('anti-double-send: sent 5 minutes ago → allowed', () => {
  const sentAt = new Date(Date.now() - 5 * 60_000).toISOString();
  assert.equal(isDoubleSubmit(sentAt, Date.now()), false);
});

test('anti-double-send: future sent_at (clock skew) → IS blocked', () => {
  // nowMs - (nowMs + 5000) = -5000, and -5000 < 60000, so the guard fires.
  // A future sent_at is treated as "sent very recently" — the guard does not handle clock skew.
  const sentAt = new Date(Date.now() + 5_000).toISOString();
  assert.equal(isDoubleSubmit(sentAt, Date.now()), true);
});

// ════════════════════════════════════════════════════════════════════════════
// 3. Client email validation
// ════════════════════════════════════════════════════════════════════════════

test('hasValidClientEmail: normal email → valid', () => {
  assert.equal(hasValidClientEmail('client@gmail.com'), true);
});

test('hasValidClientEmail: null → invalid', () => {
  assert.equal(hasValidClientEmail(null), false);
});

test('hasValidClientEmail: empty string → invalid', () => {
  assert.equal(hasValidClientEmail(''), false);
});

test('hasValidClientEmail: no @ sign → invalid', () => {
  assert.equal(hasValidClientEmail('notanemail'), false);
});

test('hasValidClientEmail: email with spaces (not trimmed) still contains @', () => {
  // The route only checks includes('@'), not strict format
  assert.equal(hasValidClientEmail('  user@domain.com  '), true);
});

// ════════════════════════════════════════════════════════════════════════════
// 4. LLM daily budget cap logic (lib/llm.ts assertWithinDailyBudget)
// ════════════════════════════════════════════════════════════════════════════

test('LLM cap: spent < cap → not over budget', () => {
  assert.equal(isOverDailyBudget(5.00, '10'), false);
});

test('LLM cap: spent exactly at cap → over budget (>= is strict)', () => {
  assert.equal(isOverDailyBudget(10.00, '10'), true);
});

test('LLM cap: spent > cap → over budget', () => {
  assert.equal(isOverDailyBudget(10.01, '10'), true);
});

test('LLM cap: env var undefined → defaults to $10 cap', () => {
  assert.equal(isOverDailyBudget(9.99, undefined), false);
  assert.equal(isOverDailyBudget(10.00, undefined), true);
});

test('LLM cap: custom env cap $5 — $5 spent → over budget', () => {
  assert.equal(isOverDailyBudget(5.00, '5'), true);
});

test('LLM cap: custom env cap $5 — $4.99 spent → under budget', () => {
  assert.equal(isOverDailyBudget(4.99, '5'), false);
});

test('LLM cap: zero spent → never over budget regardless of cap', () => {
  assert.equal(isOverDailyBudget(0, '10'), false);
  assert.equal(isOverDailyBudget(0, '0.01'), false);
});

test('LLM cap: error message format is correct', () => {
  const msg = llmCapErrorMessage(10.50, 10.00);
  assert.equal(msg, 'LLM daily cap reached: $10.50 >= $10.00');
});

test('LLM cap: error message with cents', () => {
  const msg = llmCapErrorMessage(5.123, 5.00);
  assert.ok(msg.includes('$5.12'), 'toFixed(2) rounds to 2 decimal places');
});

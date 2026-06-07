/**
 * Edge-case tests for lib/sms-classifier.ts — gaps not covered in sms-classifier.test.mjs:
 *   - classify() returning 'normal'
 *   - Empty / whitespace / null-ish inputs
 *   - Unicode emoji in messages
 *   - Opt-out buried deep in a long message
 *   - Complaint takes precedence over optout in classify()
 *   - normalize() output shape
 *
 * Run: node --test tests/sms-classifier-edge.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { isOptOut, isComplaint, classify, normalize } from '../lib/sms-classifier.ts';

// ── classify() → 'normal' ─────────────────────────────────────────────────────

test('classify: regular reply → normal', () => {
  assert.equal(classify('Oui parfait merci, à demain!'), 'normal');
});

test('classify: question → normal', () => {
  assert.equal(classify('Quel est le prix pour 400 pi² de flake?'), 'normal');
});

test('classify: empty string → normal', () => {
  assert.equal(classify(''), 'normal');
});

test('classify: phone number only → normal', () => {
  assert.equal(classify('5813075983'), 'normal');
});

test('classify: numeric message → normal', () => {
  assert.equal(classify('1234567890'), 'normal');
});

// ── classify() precedence: complaint > optout ──────────────────────────────────

test('classify: complaint beats optout — "stop c\'est du spam" → complaint', () => {
  assert.equal(classify("stop c'est du spam"), 'complaint');
});

test('classify: complaint beats optout — "STOP je vais porter plainte" → complaint', () => {
  assert.equal(classify('STOP je vais porter plainte'), 'complaint');
});

// ── normalize() ───────────────────────────────────────────────────────────────

test('normalize: lowercases', () => {
  assert.equal(normalize('STOP'), 'stop');
});

test('normalize: strips diacritics é→e, à→a, ç→c', () => {
  const out = normalize('arrête');
  assert.ok(!out.includes('ê'), `diacritics not stripped: ${out}`);
  assert.ok(out.includes('arrete'), `expected arrete, got: ${out}`);
});

test('normalize: collapses punctuation to space', () => {
  const out = normalize('STOP!!!');
  assert.equal(out, 'stop');
});

test('normalize: trims result', () => {
  assert.equal(normalize('  stop  '), 'stop');
});

test('normalize: empty string → empty string', () => {
  assert.equal(normalize(''), '');
});

test('normalize: emoji is stripped (non-letter)', () => {
  const out = normalize('stop 🚫');
  // emoji becomes non-letter chars → collapsed to space → trim
  assert.equal(out, 'stop');
});

// ── Emoji in messages ─────────────────────────────────────────────────────────

test('isOptOut: "STOP 🚫" with emoji → true', () => {
  assert.equal(isOptOut('STOP 🚫'), true);
});

test('isComplaint: "spam 🤬" → true', () => {
  assert.equal(isComplaint('spam 🤬'), true);
});

test('classify: "normal text 😊" → normal', () => {
  assert.equal(classify('Merci pour le devis! 😊'), 'normal');
});

// ── Opt-out buried in a long message ─────────────────────────────────────────

test('isOptOut: opt-out at start of long message', () => {
  assert.equal(
    isOptOut('STOP svp, je ne suis plus intéressé, merci quand même pour votre service'),
    true,
  );
});

test('isOptOut: opt-out at end of long message', () => {
  assert.equal(
    isOptOut('Votre service a lair bien mais bon je ne suis pas intéressé, enleve mon numero'),
    true,
  );
});

// ── Case insensitivity ────────────────────────────────────────────────────────

test('isOptOut: "Stop" mixed case → true', () => {
  assert.equal(isOptOut('Stop'), true);
});

test('isComplaint: "Spam" capitalized → true', () => {
  assert.equal(isComplaint('Spam'), true);
});

test('isComplaint: "HARCELEMENT" all caps → true', () => {
  assert.equal(isComplaint('HARCELEMENT'), true);
});

// ── False positives that should NOT trigger ───────────────────────────────────

test('isOptOut: "bistop" → false (word boundary matters)', () => {
  // "stop" must appear as a whole word
  assert.equal(isOptOut('bistop'), false);
});

test('isOptOut: "unstoppable" → false', () => {
  assert.equal(isOptOut('unstoppable'), false);
});

test('isComplaint: "infranchissable" → false (not "arnaque")', () => {
  assert.equal(isComplaint('infranchissable'), false);
});

// ── Bilingual / mixed phrases ─────────────────────────────────────────────────

test('isOptOut: "remove me from your list" (EN) → true', () => {
  assert.equal(isOptOut('remove me from your list'), true);
});

test('isOptOut: "unsubscribe me" (EN) → true', () => {
  assert.equal(isOptOut('unsubscribe me please'), true);
});

test('isComplaint: "this is spam" (EN) → true', () => {
  assert.equal(isComplaint('this is spam'), true);
});

test('isComplaint: "sue you" (EN) → true', () => {
  assert.equal(isComplaint('sue you'), true);
});

test('isComplaint: "lawsuit" (EN) → true', () => {
  assert.equal(isComplaint('I will file a lawsuit'), true);
});

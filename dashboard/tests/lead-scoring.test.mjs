/**
 * Tests for lib/lead-scoring.ts — chaud / tiède / froid classification.
 * Run: node --test tests/lead-scoring.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { scoreLead } from '../lib/lead-scoring.ts';

// ── Thresholds ──────────────────────────────────────────────────────────────

test('score ≥ 6 → chaud', () => {
  // phone(+2) + service(+2) + superficie(+2) = 6
  const { temperature } = scoreLead({
    telephone: '5813075983',
    service: 'flake',
    superficie: 500,
  });
  assert.equal(temperature, 'chaud');
});

test('score 3–5 → tiede', () => {
  // phone(+2) + service(+2) = 4 — espace alone doesn't add
  const { temperature } = scoreLead({
    telephone: '5813075983',
    service: 'flake',
  });
  assert.equal(temperature, 'tiede');
});

test('score < 3 → froid', () => {
  const { temperature } = scoreLead({ email: 'not-valid', telephone: '123' });
  assert.equal(temperature, 'froid');
});

// ── Individual signals ───────────────────────────────────────────────────────

test('phone 10 digits → +2', () => {
  const { score } = scoreLead({ telephone: '5813075983' });
  assert.equal(score, 2);
});

test('phone 11 digits (with leading 1) → +2', () => {
  const { score } = scoreLead({ telephone: '15813075983' });
  assert.equal(score, 2);
});

test('phone 9 digits → no bonus', () => {
  const { score } = scoreLead({ telephone: '581307598' });
  assert.equal(score, 0);
});

test('phone with formatting (514) 555-1234 → +2', () => {
  const { score } = scoreLead({ telephone: '(514) 555-1234' });
  assert.equal(score, 2);
});

test('known service → +2', () => {
  for (const s of ['flake', 'metallique', 'métallique', 'quartz', 'commercial', 'vinyl_click']) {
    const { score } = scoreLead({ service: s });
    assert.equal(score, 2, `service "${s}" should score +2`);
  }
});

test('unknown service → 0', () => {
  const { score } = scoreLead({ service: 'peinture' });
  assert.equal(score, 0);
});

test('superficie ≥ 50 → +2', () => {
  const { score } = scoreLead({ superficie: 50 });
  assert.equal(score, 2);
});

test('superficie 49 → 0', () => {
  const { score } = scoreLead({ superficie: 49 });
  assert.equal(score, 0);
});

test('superficie as string "400 pi2" → +2', () => {
  const { score } = scoreLead({ superficie: '400 pi2' });
  assert.equal(score, 2);
});

test('known espace → +1', () => {
  for (const e of ['garage', 'sous-sol', 'basement', 'balcon', 'commercial']) {
    const { score } = scoreLead({ espace: e });
    assert.equal(score, 1, `espace "${e}" should score +1`);
  }
});

test('unknown espace → 0', () => {
  const { score } = scoreLead({ espace: 'jardin' });
  assert.equal(score, 0);
});

test('valid email → +1', () => {
  const { score } = scoreLead({ email: 'client@example.com' });
  assert.equal(score, 1);
});

test('facebook no-email placeholder → 0', () => {
  const { score } = scoreLead({ email: 'no-email@facebook.com' });
  assert.equal(score, 0);
});

test('invalid email → 0', () => {
  const { score } = scoreLead({ email: 'not-an-email' });
  assert.equal(score, 0);
});

test('valid adresse (≥10 chars with digit + word) → +1', () => {
  const { score } = scoreLead({ adresse: '123 Rue des Pins, Québec' });
  assert.equal(score, 1);
});

test('adresse too short → 0', () => {
  const { score } = scoreLead({ adresse: '123 Rue' }); // only 7 chars
  assert.equal(score, 0);
});

test('adresse without digits → 0', () => {
  const { score } = scoreLead({ adresse: 'Rue des Marronniers nord' });
  assert.equal(score, 0);
});

// ── Penalties ────────────────────────────────────────────────────────────────

test('test-flavored name → -2', () => {
  // phone+2, name-2 → net 0
  const { score, reasons } = scoreLead({ telephone: '5813075983', nom: 'Jean Test' });
  assert.equal(score, 0);
  assert.ok(reasons.includes('test_name-2'));
});

test('name "Lead Test" → -2', () => {
  const { score } = scoreLead({ nom: 'Lead Test', telephone: '5813075983' });
  assert.equal(score, 0);
});

test('name "asdfasdf" → -2', () => {
  const { score } = scoreLead({ nom: 'asdfasdf' });
  assert.equal(score, -2);
});

test('source import-csv → -1', () => {
  const { score } = scoreLead({ telephone: '5813075983', source: 'import-csv' });
  assert.equal(score, 1); // 2 - 1
});

test('source scraper → -1', () => {
  const { score } = scoreLead({ telephone: '5813075983', source: 'scraper' });
  assert.equal(score, 1);
});

// ── Edge cases ───────────────────────────────────────────────────────────────

test('empty input → froid, score 0', () => {
  const { temperature, score } = scoreLead({});
  assert.equal(temperature, 'froid');
  assert.equal(score, 0);
});

test('all nulls → froid', () => {
  const { temperature } = scoreLead({
    nom: null, email: null, telephone: null,
    service: null, superficie: null, espace: null, adresse: null,
  });
  assert.equal(temperature, 'froid');
});

test('perfect lead (all signals) → chaud with score 9', () => {
  const { score, temperature } = scoreLead({
    telephone: '5813075983',
    service: 'flake',
    superficie: 500,
    espace: 'garage',
    email: 'client@gmail.com',
    adresse: '123 Avenue des Pins, Québec, QC',
  });
  assert.equal(temperature, 'chaud');
  assert.equal(score, 9); // 2+2+2+1+1+1
});

test('reasons array documents each signal', () => {
  const { reasons } = scoreLead({ telephone: '5813075983', service: 'flake' });
  assert.ok(reasons.includes('phone+2'));
  assert.ok(reasons.includes('service+2'));
});

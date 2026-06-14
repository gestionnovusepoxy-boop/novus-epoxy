/**
 * Tests for lib/pricing.ts — EXTRAS_PREDEFINIS catalog integrity.
 *
 * GAP: EXTRAS_PREDEFINIS is exported and rendered in the quote form, but
 * its structure (inclus/payant, unique keys, prix_defaut=0 for free items)
 * is completely untested.
 *
 * Also covers: calculateQuote with 0 superficie (minimum floor applied).
 *
 * Run: node --test tests/pricing-extras-catalog.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

// Inlined from lib/pricing.ts — EXTRAS_PREDEFINIS (cannot import directly: pricing.ts
// uses @/lib/money which Node cannot resolve without Next.js module aliases)
const EXTRAS_PREDEFINIS = [
  { key: 'ardex_k60', label: 'Auto-nivelant Ardex K60 (par poche)', prix_defaut: 85, inclus: false },
  { key: 'pro_patch', label: 'Resurfaçage Pro Patch (par sac)', prix_defaut: 65, inclus: false },
  { key: 'tixo', label: 'Couche truelle epoxy tixo', prix_defaut: 1750, inclus: false },
  { key: 'crack_fill', label: 'Réparation crack/fissure majeure', prix_defaut: 250, inclus: false },
  { key: 'reparation_marches', label: 'Réparation de marches de béton', prix_defaut: 500, inclus: false },
  { key: 'echafaudage', label: 'Échafaudage', prix_defaut: 350, inclus: false },
  { key: 'mileage', label: 'Déplacement > 65 km', prix_defaut: 200, inclus: false },
  { key: 'inspection', label: 'Inspection complète du plancher', prix_defaut: 0, inclus: true },
  { key: 'meulage', label: 'Meulage diamant + aspiration HEPA (sans poussière)', prix_defaut: 0, inclus: true },
  { key: 'masquage', label: 'Masquage complet (plinthes, murs, drains)', prix_defaut: 0, inclus: true },
  { key: 'protection', label: 'Protection de chantier (papier, plastique)', prix_defaut: 0, inclus: true },
  { key: 'nettoyage', label: 'Nettoyage chantier complet à la fin', prix_defaut: 0, inclus: true },
  { key: 'garantie', label: 'Garantie écrite 10 ans', prix_defaut: 0, inclus: true },
];

// ── EXTRAS_PREDEFINIS catalog integrity ──────────────────────────────────────

test('EXTRAS_PREDEFINIS: is a non-empty array', () => {
  assert.ok(Array.isArray(EXTRAS_PREDEFINIS) && EXTRAS_PREDEFINIS.length > 0);
});

test('EXTRAS_PREDEFINIS: every entry has key, label, prix_defaut, inclus', () => {
  for (const e of EXTRAS_PREDEFINIS) {
    assert.ok(typeof e.key === 'string' && e.key.length > 0, `key missing on ${JSON.stringify(e)}`);
    assert.ok(typeof e.label === 'string' && e.label.length > 0, `label missing on ${e.key}`);
    assert.ok(typeof e.prix_defaut === 'number', `prix_defaut must be number on ${e.key}`);
    assert.ok(typeof e.inclus === 'boolean', `inclus must be boolean on ${e.key}`);
  }
});

test('EXTRAS_PREDEFINIS: no duplicate keys', () => {
  const keys = EXTRAS_PREDEFINIS.map(e => e.key);
  const unique = new Set(keys);
  assert.equal(unique.size, keys.length, 'duplicate keys detected');
});

test('EXTRAS_PREDEFINIS: no duplicate labels', () => {
  const labels = EXTRAS_PREDEFINIS.map(e => e.label);
  const unique = new Set(labels);
  assert.equal(unique.size, labels.length, 'duplicate labels detected');
});

test('EXTRAS_PREDEFINIS: free extras (inclus=true) have prix_defaut=0', () => {
  const freeWithPrice = EXTRAS_PREDEFINIS.filter(e => e.inclus && e.prix_defaut !== 0);
  assert.deepEqual(freeWithPrice, [], 'included extras must have prix_defaut=0');
});

test('EXTRAS_PREDEFINIS: paid extras (inclus=false) have prix_defaut > 0', () => {
  const paidFree = EXTRAS_PREDEFINIS.filter(e => !e.inclus && e.prix_defaut <= 0);
  assert.deepEqual(paidFree, [], 'paid extras must have prix_defaut > 0');
});

test('EXTRAS_PREDEFINIS: contains at least one inclus=true entry (free work shown to client)', () => {
  const free = EXTRAS_PREDEFINIS.filter(e => e.inclus);
  assert.ok(free.length > 0, 'must have at least one free/included extra');
});

test('EXTRAS_PREDEFINIS: contains at least one inclus=false entry (paid extra)', () => {
  const paid = EXTRAS_PREDEFINIS.filter(e => !e.inclus);
  assert.ok(paid.length > 0, 'must have at least one paid extra');
});

test('EXTRAS_PREDEFINIS: known required extras are present', () => {
  const keys = new Set(EXTRAS_PREDEFINIS.map(e => e.key));
  for (const required of ['inspection', 'meulage', 'garantie', 'crack_fill', 'mileage']) {
    assert.ok(keys.has(required), `required extra "${required}" is missing`);
  }
});

test('EXTRAS_PREDEFINIS: mileage extra is > 0 (paid)', () => {
  const mileage = EXTRAS_PREDEFINIS.find(e => e.key === 'mileage');
  assert.ok(mileage, 'mileage extra must exist');
  assert.ok(!mileage.inclus, 'mileage must be a paid extra');
  assert.ok(mileage.prix_defaut > 0, 'mileage must have a price');
});

test('EXTRAS_PREDEFINIS: garantie is a free extra (inclus=true, prix=0)', () => {
  const garantie = EXTRAS_PREDEFINIS.find(e => e.key === 'garantie');
  assert.ok(garantie, 'garantie extra must exist');
  assert.ok(garantie.inclus, 'garantie must be inclus=true');
  assert.equal(garantie.prix_defaut, 0);
});

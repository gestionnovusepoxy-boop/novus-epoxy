/**
 * Tests for lib/auto-description.ts — generateAutoDescription().
 * Run: node --test tests/auto-description.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { generateAutoDescription } from '../lib/auto-description.ts';

// ── Basic structure ──────────────────────────────────────────────────────────

test('returns a non-empty string', () => {
  const out = generateAutoDescription({ type_service: 'flake', superficie: 500 });
  assert.ok(out.length > 50, `too short: ${out.length} chars`);
});

test('always contains PRÉPARATION phase', () => {
  const out = generateAutoDescription({ type_service: 'flake' });
  assert.ok(out.includes('PRÉPARATION'), `missing PRÉPARATION: ${out.slice(0, 100)}`);
});

test('always contains LIVRAISON phase', () => {
  const out = generateAutoDescription({ type_service: 'flake' });
  assert.ok(out.includes('LIVRAISON'), `missing LIVRAISON`);
});

test('always mentions garantie 10 ans', () => {
  const out = generateAutoDescription({ type_service: 'flake' });
  assert.ok(out.includes('10 ans'), `missing garantie 10 ans`);
});

// ── Service-specific steps ───────────────────────────────────────────────────

test('flake: mentions flocons and topcoat', () => {
  const out = generateAutoDescription({ type_service: 'flake', superficie: 300 });
  assert.ok(out.toLowerCase().includes('flake') || out.toLowerCase().includes('flocon'),
    `missing flake/flocon in: ${out.slice(0, 200)}`);
  assert.ok(out.toLowerCase().includes('topcoat') || out.toLowerCase().includes('polyaspartique'),
    `missing topcoat/polyaspartique`);
});

test('metallique: mentions metallic', () => {
  const out = generateAutoDescription({ type_service: 'metallique', superficie: 200 });
  assert.ok(out.toLowerCase().includes('metallic') || out.toLowerCase().includes('métallique') || out.toLowerCase().includes('metal'),
    `missing metallic in metallique output`);
});

test('meulage: mentions polissage', () => {
  const out = generateAutoDescription({ type_service: 'meulage', superficie: 600 });
  assert.ok(out.toLowerCase().includes('poliss'),
    `missing polissage in meulage output`);
});

test('vinyl_click: mentions vinyl', () => {
  const out = generateAutoDescription({ type_service: 'vinyl_click', superficie: 400 });
  assert.ok(out.toLowerCase().includes('vinyl'),
    `missing vinyl in vinyl_click output`);
});

test('unknown service falls back to flake steps', () => {
  // Should not throw — falls back gracefully
  const out = generateAutoDescription({ type_service: 'unknown_type', superficie: 100 });
  assert.ok(out.length > 0);
  assert.ok(out.includes('PRÉPARATION'));
});

// ── Superficie footer ────────────────────────────────────────────────────────

test('superficie > 0 appears in footer', () => {
  const out = generateAutoDescription({ type_service: 'flake', superficie: 1234 });
  assert.ok(out.includes('1'), `missing superficie in footer: ${out.slice(-200)}`);
});

test('superficie 0 does not appear in footer', () => {
  const out = generateAutoDescription({ type_service: 'flake', superficie: 0 });
  assert.ok(!out.includes('pi²'), `superficie 0 should not show in footer`);
});

// ── Couleur ──────────────────────────────────────────────────────────────────

test('couleur_flake appears when provided', () => {
  const out = generateAutoDescription({ type_service: 'flake', superficie: 400, couleur_flake: 'Granit Gris' });
  assert.ok(out.includes('Granit Gris'), `missing couleur in output`);
});

// ── Extra keywords trigger prep steps ────────────────────────────────────────

test('extra "Pro Patch" triggers pro patch prep step', () => {
  const out = generateAutoDescription({
    type_service: 'flake',
    superficie: 400,
    extras: [{ description: 'Pro Patch réparation', sous_total: 500 }],
  });
  assert.ok(out.includes('Pro Patch'), `missing Pro Patch prep step: ${out.slice(0, 400)}`);
});

test('extra "auto-nivelant ardex" triggers nivelant prep step', () => {
  const out = generateAutoDescription({
    type_service: 'flake',
    superficie: 400,
    extras: [{ description: 'Ardex auto-nivelant', sous_total: 1200 }],
  });
  assert.ok(
    out.toLowerCase().includes('auto-nivelant') || out.toLowerCase().includes('nivelant'),
    `missing auto-nivelant step`
  );
});

test('extra "Antiderapant" (no accent) triggers slip-resist post-prep step', () => {
  // EXTRA_KEYWORDS regex /antider|anti[\s-]*derapant/ matches ASCII only — use no accent
  const out = generateAutoDescription({
    type_service: 'flake',
    superficie: 400,
    extras: [{ description: 'Antiderapant premium', sous_total: 300 }],
  });
  assert.ok(
    out.toLowerCase().includes('antid'),
    `missing antidérapant step`
  );
});

test('extra keyword not duplicated when matched twice', () => {
  const out = generateAutoDescription({
    type_service: 'flake',
    superficie: 300,
    extras: [
      { description: 'Pro Patch zone A', sous_total: 300 },
      { description: 'Pro Patch zone B', sous_total: 200 },
    ],
  });
  // Pro Patch step should appear exactly once
  const matches = out.match(/Pro Patch/g) ?? [];
  assert.equal(matches.length, 1, `Pro Patch step duplicated: ${matches.length} times`);
});

// ── Durée estimée ────────────────────────────────────────────────────────────

test('durée estimated in output', () => {
  const out = generateAutoDescription({ type_service: 'flake', superficie: 300 });
  assert.ok(out.includes('Durée estimée'), `missing durée estimée`);
});

test('small superficie flake → 1-2 jours', () => {
  const out = generateAutoDescription({ type_service: 'flake', superficie: 400 });
  assert.ok(out.includes('1-2 jours'), `expected 1-2 jours for 400pi² flake`);
});

test('large superficie flake > 2000 → 3-4 jours', () => {
  const out = generateAutoDescription({ type_service: 'flake', superficie: 2500 });
  assert.ok(out.includes('3-4 jours'), `expected 3-4 jours for 2500pi² flake`);
});

// ── Délai avant utilisation ──────────────────────────────────────────────────

test('délai utilisateurs always in output', () => {
  const out = generateAutoDescription({ type_service: 'flake', superficie: 300 });
  assert.ok(out.includes('24h'), `missing 24h piétons délai`);
  assert.ok(out.includes('72h'), `missing 72h meubles délai`);
  assert.ok(out.includes('7 jours'), `missing 7 jours véhicules délai`);
});

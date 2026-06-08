/**
 * Tests for lib/torginol.ts — color catalog pure functions.
 * Run: node --test tests/torginol.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  FLAKE_COLORS,
  CATEGORY_LABELS,
  getColorsByCategory,
  searchColors,
  getColorCatalogText,
} from '../lib/torginol.ts';

// ── Catalog integrity ────────────────────────────────────────────────────────

test('FLAKE_COLORS: non-empty catalog', () => {
  assert.ok(FLAKE_COLORS.length > 0, 'catalog must have entries');
});

test('FLAKE_COLORS: every entry has required fields', () => {
  for (const c of FLAKE_COLORS) {
    assert.ok(typeof c.name === 'string' && c.name.length > 0, `name missing on ${JSON.stringify(c)}`);
    assert.ok(typeof c.code === 'string' && c.code.length > 0, `code missing on ${c.name}`);
    assert.ok(typeof c.category === 'string', `category missing on ${c.name}`);
    assert.ok(typeof c.hex === 'string' && c.hex.startsWith('#'), `hex missing on ${c.name}`);
  }
});

test('CATEGORY_LABELS: covers all categories used in FLAKE_COLORS', () => {
  const usedCats = new Set(FLAKE_COLORS.map(c => c.category));
  for (const cat of usedCats) {
    assert.ok(
      CATEGORY_LABELS[cat] !== undefined,
      `category "${cat}" used in FLAKE_COLORS but missing from CATEGORY_LABELS`
    );
  }
});

// ── getColorsByCategory ───────────────────────────────────────────────────────

test('getColorsByCategory: neutre returns non-empty subset', () => {
  const result = getColorsByCategory('neutre');
  assert.ok(result.length > 0, 'neutre category must have entries');
});

test('getColorsByCategory: returns only items matching that category', () => {
  for (const cat of Object.keys(CATEGORY_LABELS)) {
    const result = getColorsByCategory(cat);
    for (const c of result) {
      assert.equal(c.category, cat, `unexpected category ${c.category} in results for ${cat}`);
    }
  }
});

test('getColorsByCategory: bleu returns only bleu colors', () => {
  const result = getColorsByCategory('bleu');
  assert.ok(result.length > 0, 'bleu must have entries');
  assert.ok(result.every(c => c.category === 'bleu'));
});

test('getColorsByCategory: sum of all categories = total FLAKE_COLORS', () => {
  const cats = [...new Set(FLAKE_COLORS.map(c => c.category))];
  const total = cats.reduce((n, cat) => n + getColorsByCategory(cat).length, 0);
  assert.equal(total, FLAKE_COLORS.length, 'categories must partition catalog without overlap');
});

// ── searchColors ─────────────────────────────────────────────────────────────

test('searchColors: "gris" matches at least one color', () => {
  const result = searchColors('gris');
  assert.ok(result.length > 0, '"gris" must match at least one entry');
});

test('searchColors: case-insensitive match on name', () => {
  const lower = searchColors('sand dollar');
  const upper = searchColors('SAND DOLLAR');
  assert.deepEqual(lower, upper, 'search must be case-insensitive');
});

test('searchColors: match by category keyword', () => {
  const result = searchColors('neutre');
  assert.ok(result.length > 0, 'category name "neutre" must match entries in that category');
});

test('searchColors: no match for nonsense query returns empty array', () => {
  const result = searchColors('zzz_no_such_color_xyz');
  assert.deepEqual(result, []);
});

test('searchColors: empty string returns all colors', () => {
  const result = searchColors('');
  assert.equal(result.length, FLAKE_COLORS.length, 'empty query must return full catalog');
});

test('searchColors: match by colors description field', () => {
  // "blanc" appears in the colors description of many entries
  const result = searchColors('blanc');
  assert.ok(result.length > 0, '"blanc" must match via colors description');
});

// ── getColorCatalogText ───────────────────────────────────────────────────────

test('getColorCatalogText: returns non-empty string', () => {
  const text = getColorCatalogText();
  assert.ok(typeof text === 'string' && text.length > 0);
});

test('getColorCatalogText: contains each category label', () => {
  const text = getColorCatalogText();
  for (const label of Object.values(CATEGORY_LABELS)) {
    // Only check categories that have entries
    const cat = Object.entries(CATEGORY_LABELS).find(([, v]) => v === label)[0];
    if (getColorsByCategory(cat).length > 0) {
      assert.ok(text.includes(label), `catalog text must include label "${label}"`);
    }
  }
});

test('getColorCatalogText: each color name appears in catalog text', () => {
  const text = getColorCatalogText();
  for (const c of FLAKE_COLORS) {
    assert.ok(text.includes(c.name), `color name "${c.name}" must appear in catalog text`);
  }
});

test('getColorCatalogText: empty categories are skipped (no empty section)', () => {
  const text = getColorCatalogText();
  // Should not have a label immediately followed by another label (empty section)
  // Very basic: just confirm all listed labels have at least one "- " entry after them
  const lines = text.split('\n').filter(l => l.trim());
  let lastLabel = null;
  for (const line of lines) {
    const isLabel = Object.values(CATEGORY_LABELS).some(l => line.includes(l));
    if (lastLabel !== null && isLabel) {
      // Two consecutive label lines = empty section bug
      assert.fail(`Empty section detected: "${lastLabel}" followed immediately by "${line}"`);
    }
    lastLabel = isLabel ? line : null;
  }
});

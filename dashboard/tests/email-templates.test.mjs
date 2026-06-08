/**
 * Tests for lib/email-templates.ts — brandedEmailHtml().
 * Run: node --test tests/email-templates.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { brandedEmailHtml } from '../lib/email-templates.ts';

// ── Default output structure ──────────────────────────────────────────────────

test('brandedEmailHtml: includes body content', () => {
  const out = brandedEmailHtml('<p>Bonjour client</p>');
  assert.ok(out.includes('Bonjour client'), 'body must appear in output');
});

test('brandedEmailHtml: includes default CTA button by default', () => {
  const out = brandedEmailHtml('<p>test</p>');
  assert.ok(out.includes('Demander ma soumission gratuite'), 'default CTA label must appear');
  assert.ok(out.includes('https://novus-epoxy.vercel.app/#contact'), 'default CTA URL must appear');
});

test('brandedEmailHtml: CTA button is an anchor tag', () => {
  const out = brandedEmailHtml('<p>test</p>');
  assert.ok(out.includes('<a href='), 'CTA must be an anchor');
});

// ── showQuoteButton: false ────────────────────────────────────────────────────

test('brandedEmailHtml: showQuoteButton=false omits CTA', () => {
  const out = brandedEmailHtml('<p>Sans CTA</p>', { showQuoteButton: false });
  assert.ok(!out.includes('Demander ma soumission gratuite'), 'CTA label must be absent');
  assert.ok(!out.includes('novus-epoxy.vercel.app/#contact'), 'CTA URL must be absent');
});

test('brandedEmailHtml: showQuoteButton=false still includes signature', () => {
  const out = brandedEmailHtml('<p>test</p>', { showQuoteButton: false });
  assert.ok(out.includes('Luca'), 'signature must always appear');
  assert.ok(out.includes('Jason'), 'signature must always appear');
});

// ── Custom CTA overrides ──────────────────────────────────────────────────────

test('brandedEmailHtml: custom cta label overrides default', () => {
  const out = brandedEmailHtml('<p>test</p>', { cta: 'Confirmer mon rendez-vous' });
  assert.ok(out.includes('Confirmer mon rendez-vous'), 'custom label must appear');
  assert.ok(!out.includes('Demander ma soumission gratuite'), 'default label must be replaced');
});

test('brandedEmailHtml: custom ctaUrl overrides default', () => {
  const out = brandedEmailHtml('<p>test</p>', { ctaUrl: 'https://calendly.com/novusepoxy' });
  assert.ok(out.includes('https://calendly.com/novusepoxy'), 'custom URL must appear');
  assert.ok(!out.includes('https://novus-epoxy.vercel.app/#contact'), 'default URL must be replaced');
});

// ── Signature content ────────────────────────────────────────────────────────

test('brandedEmailHtml: contains Luca phone', () => {
  const out = brandedEmailHtml('<p>test</p>');
  assert.ok(out.includes('581-307-5983'), 'Luca phone must appear');
});

test('brandedEmailHtml: contains Jason phone', () => {
  const out = brandedEmailHtml('<p>test</p>');
  assert.ok(out.includes('581-307-2678'), 'Jason phone must appear');
});

test('brandedEmailHtml: contains novusepoxy.ca link', () => {
  const out = brandedEmailHtml('<p>test</p>');
  assert.ok(out.includes('novusepoxy.ca'), 'website link must appear');
});

// ── Edge cases ───────────────────────────────────────────────────────────────

test('brandedEmailHtml: empty bodyHtml does not throw', () => {
  assert.doesNotThrow(() => brandedEmailHtml(''));
});

test('brandedEmailHtml: empty bodyHtml still renders outer shell', () => {
  const out = brandedEmailHtml('');
  assert.ok(out.includes('Novus Epoxy'), 'brand name must appear even with empty body');
});

test('brandedEmailHtml: no options arg uses defaults', () => {
  const out = brandedEmailHtml('<p>test</p>');
  assert.ok(out.includes('Demander ma soumission gratuite'), 'defaults apply when opts omitted');
});

test('brandedEmailHtml: returns a string', () => {
  const out = brandedEmailHtml('<p>test</p>');
  assert.equal(typeof out, 'string');
});

test('brandedEmailHtml: output contains valid HTML structure', () => {
  const out = brandedEmailHtml('<p>test</p>');
  assert.ok(out.includes('<div'), 'must contain div');
  assert.ok(out.includes('</div>'), 'must close div');
});

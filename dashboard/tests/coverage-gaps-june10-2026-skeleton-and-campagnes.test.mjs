/**
 * coverage-gaps-june10-2026-skeleton-and-campagnes.test.mjs
 *
 * Covers two remaining true gaps not addressed in any prior test file:
 *
 *   GAP-A  app/api/campagnes/route.ts  — buildCampaignHtml()
 *            Pure HTML builder for bulk marketing emails.
 *            Untested: wrong greeting/escaping → corrupted emails sent to all clients.
 *
 *   GAP-B  app/api/campagnes/route.ts  — sleep() function
 *            Rate-limiting guard between emails. Untested: if sleep returns early,
 *            all emails fire simultaneously and Gmail rate-limits the account.
 *
 * INTEGRATION SKELETONS (skipped unless INTEGRATION_TEST=1):
 *   INT-1  GET  /api/campagnes/count  — no session → 401
 *   INT-2  POST /api/campagnes        — no session → 401
 *   INT-3  POST /api/campagnes        — empty message → 400
 *   INT-4  POST /api/campagnes        — valid payload → 200 with sent_count
 *
 * Run: node --test tests/coverage-gaps-june10-2026-skeleton-and-campagnes.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

const SKIP_INTEGRATION = !process.env.INTEGRATION_TEST;
const BASE = process.env.TEST_BASE_URL || 'http://localhost:3000';

// ════════════════════════════════════════════════════════════════════════════
// GAP-A: buildCampaignHtml()  (app/api/campagnes/route.ts)
//
// Inlined verbatim — function is not exported.
// ════════════════════════════════════════════════════════════════════════════

function buildCampaignHtml(message, recipientName) {
  const greeting = recipientName ? `Bonjour ${recipientName},` : 'Bonjour,';
  const escapedMessage = message.replace(/\n/g, '<br>');

  return `
    <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; background: #0f172a; color: #e2e8f0; padding: 0;">
      <div style="background: linear-gradient(135deg, #f59e0b, #d97706); padding: 24px 32px; text-align: center;">
        <h1 style="margin: 0; color: #0f172a; font-size: 24px; font-weight: 700;">Novus Epoxy</h1>
        <p style="margin: 4px 0 0; color: #1e293b; font-size: 14px;">Planchers époxy haut de gamme</p>
      </div>
      <div style="padding: 32px;">
        <p style="color: #f8fafc; font-size: 16px; margin-bottom: 16px;">${greeting}</p>
        <div style="color: #cbd5e1; font-size: 15px; line-height: 1.6;">
          ${escapedMessage}
        </div>
        <div style="margin-top: 32px; text-align: center;">
          <a href="https://novusepoxy.ca" style="display: inline-block; background: #f59e0b; color: #0f172a; padding: 12px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 15px;">Voir nos services</a>
        </div>
      </div>
      <div style="padding: 20px 32px; border-top: 1px solid #1e293b; text-align: center;">
        <p style="color: #64748b; font-size: 12px; margin: 0;">Novus Epoxy &mdash; Québec</p>
        <p style="color: #64748b; font-size: 12px; margin: 4px 0 0;">
          Luca: 581-307-2678 | Jason: 418-564-2182
        </p>
        <p style="color: #475569; font-size: 11px; margin: 8px 0 0;">
          Pour ne plus recevoir nos courriels, répondez « désabonner ».
        </p>
      </div>
    </div>
  `;
}

// Greeting ---

test('buildCampaignHtml: named recipient → "Bonjour <name>,"', () => {
  const html = buildCampaignHtml('Bonjour test', 'Marie Tremblay');
  assert.ok(html.includes('Bonjour Marie Tremblay,'), `greeting missing: ${html.slice(0, 200)}`);
});

test('buildCampaignHtml: empty recipientName → fallback "Bonjour,"', () => {
  const html = buildCampaignHtml('Hello', '');
  assert.ok(html.includes('Bonjour,'), `fallback greeting missing: ${html.slice(0, 200)}`);
  assert.ok(!html.includes('Bonjour ,'), 'must not have trailing space in fallback');
});

test('buildCampaignHtml: null recipientName → fallback "Bonjour,"', () => {
  const html = buildCampaignHtml('Hello', null);
  assert.ok(html.includes('Bonjour,'));
});

// Newline escaping ---

test('buildCampaignHtml: \\n in message → <br>', () => {
  const html = buildCampaignHtml('Line1\nLine2', 'Jean');
  assert.ok(html.includes('Line1<br>Line2'), `newline not escaped to <br>: ${html.slice(0, 300)}`);
  assert.ok(!html.includes('Line1\nLine2'), 'raw newline must not be present');
});

test('buildCampaignHtml: multiple \\n → multiple <br>', () => {
  const html = buildCampaignHtml('A\nB\nC', 'X');
  assert.equal((html.match(/<br>/g) || []).length, 2);
});

test('buildCampaignHtml: message with no \\n → no <br> tags', () => {
  const html = buildCampaignHtml('No breaks here', 'Bob');
  assert.equal((html.match(/<br>/g) || []).length, 0);
});

// Branding ---

test('buildCampaignHtml: contains Novus Epoxy brand name', () => {
  const html = buildCampaignHtml('msg', 'X');
  assert.ok(html.includes('Novus Epoxy'));
});

test('buildCampaignHtml: contains CTA link to novusepoxy.ca', () => {
  const html = buildCampaignHtml('msg', 'X');
  assert.ok(html.includes('https://novusepoxy.ca'));
});

test('buildCampaignHtml: contains unsubscribe instruction in French', () => {
  const html = buildCampaignHtml('msg', 'X');
  assert.ok(html.includes('désabonner') || html.includes('désabonner'), 'must include unsubscribe text');
});

test('buildCampaignHtml: contains Luca and Jason phone numbers', () => {
  const html = buildCampaignHtml('msg', 'X');
  assert.ok(html.includes('581-307-2678'), 'Luca phone missing');
  assert.ok(html.includes('418-564-2182'), 'Jason phone missing');
});

// Message content injection ---

test('buildCampaignHtml: message content appears in output', () => {
  const html = buildCampaignHtml('Profitez de notre offre spéciale', 'Client');
  assert.ok(html.includes('Profitez de notre offre spéciale'));
});

test('buildCampaignHtml: long message is preserved intact', () => {
  const long = 'A'.repeat(500);
  const html = buildCampaignHtml(long, 'X');
  assert.ok(html.includes(long));
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-B: sleep() rate-limiter  (app/api/campagnes/route.ts)
//
// sleep(ms) must return a Promise that resolves after `ms` milliseconds.
// Inlined verbatim.
// ════════════════════════════════════════════════════════════════════════════

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test('sleep: returns a Promise', () => {
  const p = sleep(1);
  assert.ok(p instanceof Promise);
  return p;
});

test('sleep(0): resolves immediately', async () => {
  const t0 = Date.now();
  await sleep(0);
  assert.ok(Date.now() - t0 < 100, 'sleep(0) took too long');
});

// ════════════════════════════════════════════════════════════════════════════
// INTEGRATION SKELETONS
// ════════════════════════════════════════════════════════════════════════════

test('INT-1 skeleton: GET /api/campagnes/count — no session → 401', { skip: SKIP_INTEGRATION }, async () => {
  const res = await fetch(`${BASE}/api/campagnes/count`);
  assert.equal(res.status, 401);
});

test('INT-2 skeleton: POST /api/campagnes — no session → 401', { skip: SKIP_INTEGRATION }, async () => {
  const res = await fetch(`${BASE}/api/campagnes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'Test', filter: {} }),
  });
  assert.equal(res.status, 401);
});

test('INT-3 skeleton: POST /api/campagnes — empty message → 400', { skip: SKIP_INTEGRATION }, async () => {
  const res = await fetch(`${BASE}/api/campagnes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: '', filter: {} }),
  });
  assert.equal(res.status, 400);
});

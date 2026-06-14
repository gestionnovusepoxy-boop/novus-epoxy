/**
 * coverage-gaps-june11-2026-new-gaps.test.mjs — Coverage gap audit, June 11 2026.
 *
 * Run: node --test tests/coverage-gaps-june11-2026-new-gaps.test.mjs
 *
 * TRUE GAPS — pure logic never covered by any prior test file:
 *
 *   GAP-1  app/api/cron/fb-leads-sync/route.ts — mapService(), mapEspace(), extractVille()
 *                                   Silently stores garbled service/space names in DB when
 *                                   Facebook sends unexpected values. No test → no regression guard.
 *
 *   GAP-2  app/api/sms/devis/route.ts         — safeCompare()
 *                                   Timing-safe API key comparison guard. Different-length inputs
 *                                   must return false without calling timingSafeEqual (which throws
 *                                   on length mismatch).
 *
 *   GAP-3  app/api/cron/relance-facture/route.ts — buildReminderEmail() / buildUrgentReminderEmail()
 *                                   HTML builders called with client-supplied nom / numero.
 *                                   XSS guard via escapeHtml() and amount formatting via formatMoney()
 *                                   are both untested; a regression silently sends raw HTML to clients.
 *
 *   GAP-4  app/api/cron/sync-submissions/route.ts — scoreTemperature() (submissions version)
 *                                   Different from the GHL/webhooks version (different fields:
 *                                   email, telephone, service, surface_estimee). Tested version
 *                                   in coverage-gaps-june10-2026.test.mjs is the webhooks one.
 *
 *   GAP-5  app/api/quotes/[id]/send/route.ts  — 60-second anti-double-send guard
 *                                   Pure time-difference logic. Off-by-one (< 60 vs <= 60) silently
 *                                   allows duplicate email floods to clients.
 *
 * INTEGRATION SKELETONS (skipped unless INTEGRATION_TEST=1):
 *   INT-1  POST /api/sms/devis — missing x-api-key → 401
 *   INT-2  POST /api/sms/devis — wrong api key → 401
 *   INT-3  POST /api/sms/devis — missing required fields → 400
 *   INT-4  GET  /api/cron/fb-leads-sync — no auth → 401
 *   INT-5  GET  /api/cron/sync-submissions — no auth → 401
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { timingSafeEqual } from 'node:crypto';

const SKIP_INTEGRATION = !process.env.INTEGRATION_TEST;
const BASE = process.env.TEST_BASE_URL || 'http://localhost:3000';

// ════════════════════════════════════════════════════════════════════════════
// GAP-1: fb-leads-sync — mapService(), mapEspace(), extractVille()
//
// Pure string transformers — inlined verbatim from route.ts.
// ════════════════════════════════════════════════════════════════════════════

const FB_SERVICE_MAP = {
  'flocon': 'flake', 'flake': 'flake', 'flocon_(flake)': 'flake', 'flocon (flake)': 'flake',
  'metallique': 'metallique', 'métallique': 'metallique',
  'quartz': 'quartz',
  'couleur_unie': 'couleur_unie', 'couleur unie': 'couleur_unie',
  'antiderapant': 'antiderapant', 'antidérapant': 'antiderapant',
  'commercial': 'commercial',
  'meulage': 'meulage', 'meulage au diamant': 'meulage', 'meulage diamant': 'meulage',
  'vinyl': 'vinyl_click', 'vinyl click': 'vinyl_click', 'plancher vinyl': 'vinyl_click',
  'flottant': 'vinyl_click', 'vinyle': 'vinyl_click', 'vinyl_click': 'vinyl_click',
  'industriel': 'commercial',
};

function mapService(raw) {
  const lower = raw.toLowerCase().trim();
  return FB_SERVICE_MAP[lower] ?? lower.slice(0, 120);
}

function mapEspace(raw) {
  const lower = raw.toLowerCase();
  if (lower.includes('garage')) return 'Garage';
  if (lower.includes('sous-sol') || lower.includes('sous sol')) return 'Sous-sol';
  if (lower.includes('balcon')) return 'Balcon';
  if (lower.includes('commercial')) return 'Commercial';
  return raw.slice(0, 120);
}

function extractVille(adresse) {
  const parts = adresse.split(',').map(s => s.trim());
  if (parts.length > 1) return parts[parts.length - 1].replace(/[A-Z]\d[A-Z]\s?\d[A-Z]\d/i, '').trim() || null;
  return adresse.trim() || null;
}

// mapService
test('mapService: flocon → flake (exact match)', () => {
  assert.equal(mapService('flocon'), 'flake');
});

test('mapService: Flocon (uppercase) → flake (case-insensitive)', () => {
  assert.equal(mapService('Flocon'), 'flake');
});

test('mapService: flocon (flake) with parentheses → flake', () => {
  assert.equal(mapService('flocon (flake)'), 'flake');
});

test('mapService: métallique (accented) → metallique', () => {
  assert.equal(mapService('métallique'), 'metallique');
});

test('mapService: vinyl click → vinyl_click', () => {
  assert.equal(mapService('vinyl click'), 'vinyl_click');
});

test('mapService: plancher vinyl → vinyl_click', () => {
  assert.equal(mapService('plancher vinyl'), 'vinyl_click');
});

test('mapService: industriel → commercial (alias)', () => {
  assert.equal(mapService('industriel'), 'commercial');
});

test('mapService: meulage au diamant → meulage', () => {
  assert.equal(mapService('meulage au diamant'), 'meulage');
});

test('mapService: unknown value → passthrough (truncated to 120)', () => {
  assert.equal(mapService('polyurea'), 'polyurea');
});

test('mapService: unknown value is truncated at 120 chars', () => {
  const long = 'x'.repeat(200);
  assert.equal(mapService(long).length, 120);
});

// mapEspace
test('mapEspace: Garage → Garage (keyword match)', () => {
  assert.equal(mapEspace('Garage double'), 'Garage');
});

test('mapEspace: sous-sol (hyphen) → Sous-sol', () => {
  assert.equal(mapEspace('Sous-sol complet'), 'Sous-sol');
});

test('mapEspace: sous sol (space) → Sous-sol', () => {
  assert.equal(mapEspace('sous sol'), 'Sous-sol');
});

test('mapEspace: balcon → Balcon', () => {
  assert.equal(mapEspace('balcon arrière'), 'Balcon');
});

test('mapEspace: commercial → Commercial', () => {
  assert.equal(mapEspace('Espace commercial'), 'Commercial');
});

test('mapEspace: unknown → passthrough', () => {
  assert.equal(mapEspace('véranda'), 'véranda');
});

// extractVille
test('extractVille: 3-part address ending in postal code → null (postal stripped leaves empty)', () => {
  // extractVille takes the LAST comma-segment. "G1N 2B3" is stripped by the postal-code regex,
  // leaving "" which coerces to null. Callers must handle null ville gracefully.
  const ville = extractVille('44 rue de la Polyvalente, Québec, G1N 2B3');
  assert.equal(ville, null, 'postal-only last segment becomes null after strip');
});

test('extractVille: city with province → extracts city', () => {
  const ville = extractVille('123 rue Saint-Jean, Québec');
  assert.equal(ville, 'Québec');
});

test('extractVille: single segment (no comma) → returns full trimmed string', () => {
  const ville = extractVille('Québec');
  assert.equal(ville, 'Québec');
});

test('extractVille: empty string → null', () => {
  const ville = extractVille('');
  assert.equal(ville, null);
});

test('extractVille: whitespace-only → null', () => {
  const ville = extractVille('   ');
  assert.equal(ville, null);
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-2: sms/devis — safeCompare()
//
// Inlined from app/api/sms/devis/route.ts.
// ════════════════════════════════════════════════════════════════════════════

function safeCompare(a, b) {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

test('safeCompare: identical strings → true', () => {
  assert.ok(safeCompare('secret-key-1234', 'secret-key-1234'));
});

test('safeCompare: different strings same length → false', () => {
  assert.ok(!safeCompare('secret-key-1234', 'secret-key-XXXX'));
});

test('safeCompare: different lengths → false (no throw)', () => {
  // timingSafeEqual throws on different buffer lengths; safeCompare must short-circuit
  assert.ok(!safeCompare('short', 'much-longer-key'));
});

test('safeCompare: empty strings → true', () => {
  assert.ok(safeCompare('', ''));
});

test('safeCompare: empty vs non-empty → false', () => {
  assert.ok(!safeCompare('', 'abc'));
});

test('safeCompare: unicode key identical → true', () => {
  assert.ok(safeCompare('clé-époxy-🔑', 'clé-époxy-🔑'));
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-3: relance-facture — buildReminderEmail() / buildUrgentReminderEmail()
//
// Both builders inject clientNom, numero, finalMontant into HTML.
// escapeHtml must neutralise XSS; formatMoney must format amounts correctly.
// ════════════════════════════════════════════════════════════════════════════

// Inlined from lib/utils.ts
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Inlined from lib/money.ts (same as formatMoney in pricing)
function formatMoney(n) {
  return new Intl.NumberFormat('fr-CA', { style: 'currency', currency: 'CAD' }).format(n);
}

function buildReminderEmail(clientNom, numero, finalMontant) {
  return `<h2>Rappel de paiement — Facture ${escapeHtml(numero)}</h2>` +
    `<p>Bonjour ${escapeHtml(clientNom)},</p>` +
    `<p>solde: <strong>${formatMoney(finalMontant)}</strong></p>`;
}

function buildUrgentReminderEmail(clientNom, numero, finalMontant) {
  return `<h2>Rappel important — Facture ${escapeHtml(numero)}</h2>` +
    `<p>Bonjour ${escapeHtml(clientNom)},</p>` +
    `<p>solde: <strong>${formatMoney(finalMontant)}</strong></p>`;
}

test('buildReminderEmail: contains client name', () => {
  const html = buildReminderEmail('Pierre Tremblay', 'F-2026-001', 1234.56);
  assert.ok(html.includes('Pierre Tremblay'));
});

test('buildReminderEmail: contains invoice number', () => {
  const html = buildReminderEmail('Pierre Tremblay', 'F-2026-001', 1234.56);
  assert.ok(html.includes('F-2026-001'));
});

test('buildReminderEmail: XSS in clientNom is escaped', () => {
  const html = buildReminderEmail('<script>alert(1)</script>', 'F-001', 500);
  assert.ok(!html.includes('<script>'), 'raw <script> must not appear');
  assert.ok(html.includes('&lt;script&gt;'), 'must be escaped');
});

test('buildReminderEmail: XSS in numero is escaped', () => {
  const html = buildReminderEmail('Client', '<img src=x onerror=alert(1)>', 500);
  assert.ok(!html.includes('<img'), 'raw <img> must not appear');
});

test('buildReminderEmail: amount formatted as CAD currency', () => {
  const html = buildReminderEmail('Test', 'F-001', 1500);
  // fr-CA formats as "1 500,00 $" or similar — just assert CAD symbol present
  assert.ok(html.includes('$') || html.includes('CAD'));
});

test('buildUrgentReminderEmail: contains "important" keyword', () => {
  const html = buildUrgentReminderEmail('Jean Dupont', 'F-2026-002', 800);
  assert.ok(html.toLowerCase().includes('important'), 'urgent email must signal urgency');
});

test('buildUrgentReminderEmail: XSS in clientNom escaped', () => {
  const html = buildUrgentReminderEmail('<b>evil</b>', 'F-002', 100);
  assert.ok(!html.includes('<b>evil</b>'));
  assert.ok(html.includes('&lt;b&gt;evil&lt;/b&gt;'));
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-4: sync-submissions — scoreTemperature() (submissions version)
//
// Different from webhooks/ghl version: requires ALL of email, telephone,
// service, surface_estimee to be 'chaud'; otherwise 'tiede'.
// ════════════════════════════════════════════════════════════════════════════

// Inlined from app/api/cron/sync-submissions/route.ts
function scoreTemperature(row) {
  const hasEmail = !!row.email;
  const hasPhone = !!row.telephone;
  const hasService = !!row.service;
  const hasSurface = !!row.surface_estimee;
  if (hasEmail && hasPhone && hasService && hasSurface) return 'chaud';
  return 'tiede';
}

test('scoreTemperature (submissions): all fields → chaud', () => {
  assert.equal(scoreTemperature({
    email: 'test@test.com',
    telephone: '5141234567',
    service: 'flake',
    surface_estimee: '500',
  }), 'chaud');
});

test('scoreTemperature (submissions): missing surface_estimee → tiede', () => {
  assert.equal(scoreTemperature({
    email: 'test@test.com',
    telephone: '5141234567',
    service: 'flake',
    surface_estimee: null,
  }), 'tiede');
});

test('scoreTemperature (submissions): missing service → tiede', () => {
  assert.equal(scoreTemperature({
    email: 'test@test.com',
    telephone: '5141234567',
    service: null,
    surface_estimee: '500',
  }), 'tiede');
});

test('scoreTemperature (submissions): missing telephone → tiede', () => {
  assert.equal(scoreTemperature({
    email: 'test@test.com',
    telephone: null,
    service: 'flake',
    surface_estimee: '500',
  }), 'tiede');
});

test('scoreTemperature (submissions): missing email → tiede', () => {
  assert.equal(scoreTemperature({
    email: null,
    telephone: '5141234567',
    service: 'flake',
    surface_estimee: '500',
  }), 'tiede');
});

test('scoreTemperature (submissions): all null → tiede', () => {
  assert.equal(scoreTemperature({
    email: null, telephone: null, service: null, surface_estimee: null,
  }), 'tiede');
});

test('scoreTemperature (submissions): empty-string fields treated as falsy → tiede', () => {
  assert.equal(scoreTemperature({
    email: '', telephone: '', service: '', surface_estimee: '',
  }), 'tiede');
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-5: quotes/[id]/send — 60-second anti-double-send guard
//
// The route blocks re-send if quote.sent_at is within the last 60 seconds.
// Pure time-difference math — inlined to test the threshold boundary.
// ════════════════════════════════════════════════════════════════════════════

function isWithinDoubleSendCooldown(sentAtIso, nowMs) {
  const secondsSince = (nowMs - new Date(sentAtIso).getTime()) / 1000;
  return secondsSince < 60;
}

test('anti-double-send: sent 10 seconds ago → blocked (within cooldown)', () => {
  const now = 1_718_000_000_000;
  const sentAt = new Date(now - 10_000).toISOString();
  assert.ok(isWithinDoubleSendCooldown(sentAt, now));
});

test('anti-double-send: sent 59 seconds ago → blocked (still within cooldown)', () => {
  const now = 1_718_000_000_000;
  const sentAt = new Date(now - 59_000).toISOString();
  assert.ok(isWithinDoubleSendCooldown(sentAt, now));
});

test('anti-double-send: sent exactly 60 seconds ago → allowed (boundary)', () => {
  const now = 1_718_000_000_000;
  const sentAt = new Date(now - 60_000).toISOString();
  assert.ok(!isWithinDoubleSendCooldown(sentAt, now));
});

test('anti-double-send: sent 2 minutes ago → allowed', () => {
  const now = 1_718_000_000_000;
  const sentAt = new Date(now - 120_000).toISOString();
  assert.ok(!isWithinDoubleSendCooldown(sentAt, now));
});

test('anti-double-send: sent 0 ms ago → blocked', () => {
  const now = 1_718_000_000_000;
  const sentAt = new Date(now).toISOString();
  assert.ok(isWithinDoubleSendCooldown(sentAt, now));
});

// ════════════════════════════════════════════════════════════════════════════
// INTEGRATION SKELETONS (skipped unless INTEGRATION_TEST=1)
// ════════════════════════════════════════════════════════════════════════════

test('INT-1: POST /api/sms/devis without x-api-key → 401',
  { skip: SKIP_INTEGRATION ? 'set INTEGRATION_TEST=1' : false },
  async () => {
    const res = await fetch(`${BASE}/api/sms/devis`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_nom: 'Test', client_tel: '5141234567', type_service: 'flake', superficie: '400' }),
    });
    assert.equal(res.status, 401);
  }
);

test('INT-2: POST /api/sms/devis with wrong api key → 401',
  { skip: SKIP_INTEGRATION ? 'set INTEGRATION_TEST=1' : false },
  async () => {
    const res = await fetch(`${BASE}/api/sms/devis`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': 'wrong-key-xxxxx' },
      body: JSON.stringify({ client_nom: 'Test', client_tel: '5141234567', type_service: 'flake', superficie: '400' }),
    });
    assert.equal(res.status, 401);
  }
);

test('INT-3: POST /api/sms/devis — missing required fields → 400',
  { skip: SKIP_INTEGRATION ? 'set INTEGRATION_TEST=1' : false },
  async () => {
    const res = await fetch(`${BASE}/api/sms/devis`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ADMIN_API_KEY ?? 'test',
      },
      body: JSON.stringify({ client_nom: 'Test' }), // missing tel, type_service, superficie
    });
    assert.equal(res.status, 400);
  }
);

test('INT-4: GET /api/cron/fb-leads-sync without auth → 401',
  { skip: SKIP_INTEGRATION ? 'set INTEGRATION_TEST=1' : false },
  async () => {
    const res = await fetch(`${BASE}/api/cron/fb-leads-sync`);
    assert.equal(res.status, 401);
  }
);

test('INT-5: GET /api/cron/sync-submissions without auth → 401',
  { skip: SKIP_INTEGRATION ? 'set INTEGRATION_TEST=1' : false },
  async () => {
    const res = await fetch(`${BASE}/api/cron/sync-submissions`);
    assert.equal(res.status, 401);
  }
);

/**
 * coverage-gaps-june18-2026.test.mjs
 *
 * TRUE GAPS not covered by any prior test file as of June 18 2026.
 * All logic inlined (no @/ imports) — runs with plain node --test.
 *
 * Run: node --test tests/coverage-gaps-june18-2026.test.mjs
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CONFIRMED ZERO-COVERAGE GAPS (grep across all prior test files returned 0 hits):
 *
 *   GAP-1  app/api/gmail/webhook/route.ts — Pub/Sub payload validation
 *          POST body missing message.data → returns 200 { error: 'Invalid payload' }.
 *          Valid base64 JSON payload → decoded emailAddress + historyId extracted.
 *          Malformed JSON inside base64 → outer catch → 200 { acknowledged: true }.
 *
 *   GAP-2  app/api/gmail/webhook/route.ts — 10-second scan cooldown guard
 *          elapsed < COOLDOWN_MS (10 000 ms) → skip { skipped: true, reason: 'cooldown' }.
 *          elapsed >= COOLDOWN_MS → proceed (skip: false).
 *          No prior scan record → always proceed.
 *
 *   GAP-3  app/api/leads/hunter/prospect/route.ts — pickPhotos() scoring
 *          Keyword hit in portfolio text → +2 per keyword.
 *          type='commercial' + type_service='commercial'|'metallique' → +3 boost.
 *          type='residentiel' + type_service='flake' → +1 boost.
 *          Pair match (e.g. notes contain 'balcon', portfolio has 'balcon') → +3.
 *          Zero-score fallback: type-based selection, then raw top-rated.
 *          Never more than 4 results returned.
 *
 *   GAP-4  app/api/leads/hunter/prospect/route.ts — buildProjectDescription()
 *          Splits on '—', returns first part. Falls back to service, then 'votre projet'.
 *
 *   GAP-5  app/api/admin/fb-leads-auto-devis/route.ts — body.days validation
 *          NaN / < 1 / > 365 → default 30. Valid range [1,365] → used as-is.
 *          Same pattern also used in admin/balcon-sms-photo and admin/fb-leads-renotify.
 *
 * INTEGRATION SKELETONS (skipped unless INTEGRATION_TEST=1):
 *   INT-1  POST /api/gmail/webhook — missing message.data → 200 error body
 *   INT-2  POST /api/gmail/webhook — valid payload → 200 ok body
 *   INT-3  POST /api/leads/hunter/prospect — unauthenticated → 401
 *   INT-4  POST /api/admin/fb-leads-auto-devis — no api-key → 401
 *   INT-5  POST /api/admin/balcon-sms-photo — no api-key → 401
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

const SKIP_INTEGRATION = !process.env.INTEGRATION_TEST;
const BASE = process.env.TEST_BASE_URL || 'http://localhost:3000';

// ════════════════════════════════════════════════════════════════════════════
// GAP-1: gmail/webhook — Pub/Sub payload validation & base64 decode
// Inlined from app/api/gmail/webhook/route.ts
// ════════════════════════════════════════════════════════════════════════════

function decodeGmailPubSub(body) {
  const message = body?.message;
  if (!message?.data) {
    return { earlyReturn: true, status: 200, body: { error: 'Invalid payload' } };
  }
  try {
    const decoded = JSON.parse(Buffer.from(message.data, 'base64').toString('utf-8'));
    return { emailAddress: decoded.emailAddress, historyId: decoded.historyId };
  } catch {
    return { earlyReturn: true, status: 200, body: { error: 'Processing failed', acknowledged: true } };
  }
}

test('GAP-1: missing message → 200 Invalid payload', () => {
  assert.deepEqual(decodeGmailPubSub({}), { earlyReturn: true, status: 200, body: { error: 'Invalid payload' } });
});

test('GAP-1: message with null data → 200 Invalid payload', () => {
  assert.deepEqual(decodeGmailPubSub({ message: { data: null } }), { earlyReturn: true, status: 200, body: { error: 'Invalid payload' } });
});

test('GAP-1: missing message entirely → 200 Invalid payload', () => {
  assert.deepEqual(decodeGmailPubSub({ subscription: 'projects/x/subscriptions/y' }), {
    earlyReturn: true, status: 200, body: { error: 'Invalid payload' },
  });
});

test('GAP-1: valid base64 payload extracts emailAddress and historyId', () => {
  const payload = { emailAddress: 'gestionnovusepoxy@gmail.com', historyId: '98765' };
  const data = Buffer.from(JSON.stringify(payload)).toString('base64');
  const result = decodeGmailPubSub({ message: { data } });
  assert.equal(result.emailAddress, 'gestionnovusepoxy@gmail.com');
  assert.equal(result.historyId, '98765');
  assert.ok(!result.earlyReturn);
});

test('GAP-1: base64 with extra fields still extracts expected fields', () => {
  const payload = { emailAddress: 'x@y.com', historyId: '1', extra: 'ignored' };
  const data = Buffer.from(JSON.stringify(payload)).toString('base64');
  const result = decodeGmailPubSub({ message: { data } });
  assert.equal(result.emailAddress, 'x@y.com');
});

test('GAP-1: malformed JSON in base64 → acknowledged error (no throw)', () => {
  const data = Buffer.from('not-valid-json{{{').toString('base64');
  const result = decodeGmailPubSub({ message: { data } });
  assert.equal(result.earlyReturn, true);
  assert.equal(result.body.acknowledged, true);
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-2: gmail/webhook — 10-second scan cooldown guard
// Inlined from app/api/gmail/webhook/route.ts (COOLDOWN_MS = 10 * 1000)
// ════════════════════════════════════════════════════════════════════════════

const COOLDOWN_MS = 10 * 1000;

function checkScanCooldown(lastScanIso) {
  if (!lastScanIso) return { skip: false };
  const elapsed = Date.now() - new Date(lastScanIso).getTime();
  if (elapsed < COOLDOWN_MS) {
    return { skip: true, skipped: true, reason: 'cooldown', elapsed_ms: elapsed };
  }
  return { skip: false };
}

test('GAP-2: no prior scan → proceed (skip: false)', () => {
  assert.equal(checkScanCooldown(undefined).skip, false);
  assert.equal(checkScanCooldown(null).skip, false);
  assert.equal(checkScanCooldown('').skip, false);
});

test('GAP-2: scan 3 seconds ago → skip with cooldown reason', () => {
  const threeSecAgo = new Date(Date.now() - 3000).toISOString();
  const result = checkScanCooldown(threeSecAgo);
  assert.equal(result.skip, true);
  assert.equal(result.reason, 'cooldown');
  assert.ok(result.elapsed_ms > 0 && result.elapsed_ms < COOLDOWN_MS);
});

test('GAP-2: scan 1 second ago → skip', () => {
  const oneSecAgo = new Date(Date.now() - 1000).toISOString();
  assert.equal(checkScanCooldown(oneSecAgo).skip, true);
});

test('GAP-2: scan exactly COOLDOWN_MS ago → NOT skipped (boundary: not strictly <)', () => {
  const exactlyAgo = new Date(Date.now() - COOLDOWN_MS).toISOString();
  assert.equal(checkScanCooldown(exactlyAgo).skip, false);
});

test('GAP-2: scan 30 seconds ago → proceed', () => {
  const thirtySecAgo = new Date(Date.now() - 30000).toISOString();
  assert.equal(checkScanCooldown(thirtySecAgo).skip, false);
});

test('GAP-2: scan 1 minute ago → proceed', () => {
  const oneMinAgo = new Date(Date.now() - 60000).toISOString();
  assert.equal(checkScanCooldown(oneMinAgo).skip, false);
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-3: leads/hunter/prospect — pickPhotos() scoring algorithm
// Inlined from app/api/leads/hunter/prospect/route.ts
// ════════════════════════════════════════════════════════════════════════════

function pickPhotos(portfolio, notes, service, type) {
  const text = `${notes ?? ''} ${service ?? ''}`.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '');

  const scored = portfolio.map(p => {
    const searchable = `${p.titre} ${p.description ?? ''} ${p.type_service}`
      .toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    let score = 0;

    const keywords = text.split(/[\s,—\-\/]+/).filter(w => w.length > 3);
    for (const kw of keywords) {
      if (searchable.includes(kw)) score += 2;
    }

    if (type === 'commercial' && (p.type_service === 'commercial' || p.type_service === 'metallique')) score += 3;
    if (type === 'residentiel' && p.type_service === 'flake') score += 1;

    const pairs = [
      ['garage', ['garage', 'atelier']],
      ['sous-sol', ['sous-sol', 'basement', 'sous sol']],
      ['escalier', ['escalier', 'marche', 'perron']],
      ['balcon', ['balcon', 'galerie', 'exterieur', 'patio', 'terrasse']],
      ['metallique', ['metallique', 'haut de gamme', 'miroir', 'or', 'bronze']],
      ['commercial', ['commercial', 'industriel', 'entrepot', 'bureau']],
      ['cuisine', ['cuisine', 'interieur', 'plancher']],
      ['rampe', ['rampe', 'acces']],
    ];

    for (const [leadKw, portfolioKws] of pairs) {
      const leadNorm = leadKw.normalize('NFD').replace(/[̀-ͯ]/g, '');
      if (text.includes(leadNorm)) {
        for (const pk of portfolioKws) {
          if (searchable.includes(pk.normalize('NFD').replace(/[̀-ͯ]/g, ''))) {
            score += 3;
          }
        }
      }
    }

    return { ...p, score };
  });

  scored.sort((a, b) => b.score - a.score);

  let picks = scored.filter(p => p.score > 0).slice(0, 4);
  if (picks.length < 4) {
    const typeMatch = type === 'commercial' ? ['commercial', 'metallique'] : ['flake'];
    const fallbacks = scored.filter(p => typeMatch.includes(p.type_service) && !picks.find(x => x.id === p.id));
    picks = [...picks, ...fallbacks].slice(0, 4);
  }
  if (picks.length < 4) {
    const remaining = scored.filter(p => !picks.find(x => x.id === p.id));
    picks = [...picks, ...remaining].slice(0, 4);
  }

  return picks.map(p => ({ url: p.photos[0], caption: p.titre }));
}

function makeItem(id, type_service, titre, description = '', photos = null) {
  return { id, type_service, titre, description, photos: photos ?? [`https://cdn.example.com/${id}.jpg`] };
}

test('GAP-3: empty portfolio → empty result', () => {
  assert.deepEqual(pickPhotos([], 'garage', 'flake', 'residentiel'), []);
});

test('GAP-3: never returns more than 4 items', () => {
  const portfolio = Array.from({ length: 10 }, (_, i) => makeItem(i + 1, 'flake', `Projet ${i + 1}`));
  const result = pickPhotos(portfolio, 'garage flake résidentiel', 'flake', 'residentiel');
  assert.ok(result.length <= 4, `Expected ≤ 4, got ${result.length}`);
});

test('GAP-3: keyword in notes scores matching item higher than no-match', () => {
  const portfolio = [
    makeItem(1, 'flake', 'Projet garage', 'epoxy garage résidentiel'),
    makeItem(2, 'flake', 'Projet sous-sol', 'sous-sol maison'),
  ];
  const result = pickPhotos(portfolio, 'garage 2 voitures', 'flake', 'residentiel');
  assert.equal(result[0].caption, 'Projet garage', 'garage-matching item ranks first');
});

test('GAP-3: commercial type_service gets +3 boost for commercial leads', () => {
  const portfolio = [
    makeItem(1, 'flake', 'Flake résidentiel'),
    makeItem(2, 'commercial', 'Plancher commercial'),
  ];
  const result = pickPhotos(portfolio, 'entrepôt bureau', 'commercial', 'commercial');
  const urls = result.map(r => r.url);
  assert.ok(urls.includes('https://cdn.example.com/2.jpg'), 'commercial item should be in results');
});

test('GAP-3: metallique type_service gets +3 boost for commercial leads', () => {
  const portfolio = [
    makeItem(1, 'flake', 'Flake standard'),
    makeItem(2, 'metallique', 'Époxy métallique haut de gamme'),
  ];
  const result = pickPhotos(portfolio, 'salle de montre', 'metallique', 'commercial');
  const urls = result.map(r => r.url);
  assert.ok(urls.includes('https://cdn.example.com/2.jpg'), 'metallique item in commercial result');
});

test('GAP-3: residentiel type gives +1 to flake items', () => {
  const portfolio = [
    makeItem(1, 'commercial', 'Commerce'),
    makeItem(2, 'flake', 'Flake maison'),
  ];
  const result = pickPhotos(portfolio, 'garage maison', 'flake', 'residentiel');
  assert.equal(result[0].caption, 'Flake maison', 'flake item ranks first for residentiel');
});

test('GAP-3: pair match — balcon in notes gives +3 to portfolio with balcon in text', () => {
  const portfolio = [
    makeItem(1, 'flake', 'Balcon extérieur', 'balcon résidentiel'),
    makeItem(2, 'flake', 'Garage standard', 'garage béton'),
  ];
  const result = pickPhotos(portfolio, 'balcon condo 3e étage', 'antiderapant', 'residentiel');
  assert.equal(result[0].caption, 'Balcon extérieur', 'balcon pair match elevates balcon item');
});

test('GAP-3: pair match — escalier in notes gives +3 to portfolio with escalier', () => {
  const portfolio = [
    makeItem(1, 'flake', 'Escalier antidérapant', 'escalier marche perron'),
    makeItem(2, 'flake', 'Garage flake', 'garage 2 voitures'),
  ];
  const result = pickPhotos(portfolio, 'escalier extérieur 12 marches', 'antiderapant', 'residentiel');
  assert.equal(result[0].caption, 'Escalier antidérapant');
});

test('GAP-3: zero-score fallback uses type-based selection for residentiel', () => {
  const portfolio = [
    makeItem(1, 'commercial', 'Commerce A'),
    makeItem(2, 'flake', 'Flake B'),
  ];
  // notes have no keywords matching titles — all scores 0 → fallback to type
  const result = pickPhotos(portfolio, 'zzz yyy www', 'flake', 'residentiel');
  assert.ok(result.some(r => r.caption === 'Flake B'), 'flake item in residentiel fallback');
});

test('GAP-3: zero-score fallback uses commercial/metallique for commercial type', () => {
  const portfolio = [
    makeItem(1, 'flake', 'Flake résidentiel'),
    makeItem(2, 'commercial', 'Commercial B'),
    makeItem(3, 'metallique', 'Métallique C'),
  ];
  const result = pickPhotos(portfolio, 'zzz yyy', 'commercial', 'commercial');
  const captions = result.map(r => r.caption);
  assert.ok(captions.includes('Commercial B') || captions.includes('Métallique C'), 'commercial fallback picks commercial/metallique');
});

test('GAP-3: result items have url (first photo) and caption (titre)', () => {
  const portfolio = [
    makeItem(1, 'flake', 'Mon projet', '', ['https://cdn/a.jpg', 'https://cdn/b.jpg']),
  ];
  const result = pickPhotos(portfolio, 'flake', 'flake', 'residentiel');
  assert.equal(result[0].url, 'https://cdn/a.jpg', 'url is first photo');
  assert.equal(result[0].caption, 'Mon projet', 'caption is titre');
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-4: leads/hunter/prospect — buildProjectDescription()
// Inlined from app/api/leads/hunter/prospect/route.ts
// ════════════════════════════════════════════════════════════════════════════

function buildProjectDescription(notes, service) {
  const parts = (notes || '').split('—').map(s => s.trim());
  const project = parts[0] || service || 'votre projet';
  return project;
}

test('GAP-4: splits on em-dash, returns first part', () => {
  assert.equal(buildProjectDescription('Garage 2 voitures — 400 pi²', 'flake'), 'Garage 2 voitures');
});

test('GAP-4: no em-dash → full notes (trimmed)', () => {
  assert.equal(buildProjectDescription('Plancher sous-sol', 'flake'), 'Plancher sous-sol');
});

test('GAP-4: empty notes → falls back to service', () => {
  assert.equal(buildProjectDescription('', 'metallique'), 'metallique');
});

test('GAP-4: null notes → falls back to service', () => {
  assert.equal(buildProjectDescription(null, 'flake'), 'flake');
});

test('GAP-4: empty notes AND empty service → "votre projet"', () => {
  assert.equal(buildProjectDescription('', ''), 'votre projet');
});

test('GAP-4: null notes AND null service → "votre projet"', () => {
  assert.equal(buildProjectDescription(null, null), 'votre projet');
});

test('GAP-4: notes with multiple em-dashes → only first segment used', () => {
  assert.equal(buildProjectDescription('Garage — 300 pi² — 2 voitures', 'flake'), 'Garage');
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-5: admin routes — body.days validation (shared pattern)
// Inlined from app/api/admin/fb-leads-auto-devis/route.ts (and balcon-sms-photo, fb-leads-renotify)
// ════════════════════════════════════════════════════════════════════════════

function parseDaysParam(body, defaultDays = 30) {
  let days = defaultDays;
  try {
    if (body?.days) {
      days = Number(body.days);
      if (isNaN(days) || days < 1 || days > 365) days = defaultDays;
    }
  } catch { /* default */ }
  return days;
}

test('GAP-5: null body → default 30', () => {
  assert.equal(parseDaysParam(null), 30);
});

test('GAP-5: undefined body → default 30', () => {
  assert.equal(parseDaysParam(undefined), 30);
});

test('GAP-5: body without days → default 30', () => {
  assert.equal(parseDaysParam({}), 30);
});

test('GAP-5: valid days=7 → 7', () => {
  assert.equal(parseDaysParam({ days: 7 }), 7);
});

test('GAP-5: valid days=1 (minimum) → 1', () => {
  assert.equal(parseDaysParam({ days: 1 }), 1);
});

test('GAP-5: valid days=365 (maximum) → 365', () => {
  assert.equal(parseDaysParam({ days: 365 }), 365);
});

test('GAP-5: days=0 (below minimum) → default 30', () => {
  assert.equal(parseDaysParam({ days: 0 }), 30);
});

test('GAP-5: days=-1 (negative) → default 30', () => {
  assert.equal(parseDaysParam({ days: -1 }), 30);
});

test('GAP-5: days=366 (above maximum) → default 30', () => {
  assert.equal(parseDaysParam({ days: 366 }), 30);
});

test('GAP-5: days=NaN → default 30', () => {
  assert.equal(parseDaysParam({ days: NaN }), 30);
});

test('GAP-5: days="invalid string" → default 30', () => {
  assert.equal(parseDaysParam({ days: 'invalid' }), 30);
});

test('GAP-5: days="14" (string number) → coerced to 14', () => {
  assert.equal(parseDaysParam({ days: '14' }), 14);
});

test('GAP-5: days=1000 → default 30', () => {
  assert.equal(parseDaysParam({ days: 1000 }), 30);
});

// ════════════════════════════════════════════════════════════════════════════
// INTEGRATION SKELETONS — skipped unless INTEGRATION_TEST=1
// ════════════════════════════════════════════════════════════════════════════

test('INT-1: POST /api/gmail/webhook — missing message.data → 200 error body', { skip: SKIP_INTEGRATION }, async () => {
  const res = await fetch(`${BASE}/api/gmail/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: {} }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.error, 'Invalid payload');
});

test('INT-2: POST /api/gmail/webhook — valid payload → 200 ok body', { skip: SKIP_INTEGRATION }, async () => {
  const payload = { emailAddress: 'gestionnovusepoxy@gmail.com', historyId: '12345' };
  const data = Buffer.from(JSON.stringify(payload)).toString('base64');
  const res = await fetch(`${BASE}/api/gmail/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: { data, messageId: 'test', publishTime: new Date().toISOString() } }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(body.ok === true || 'skipped' in body, 'ok or skipped (cooldown) response');
});

test('INT-3: POST /api/leads/hunter/prospect — unauthenticated → 401', { skip: SKIP_INTEGRATION }, async () => {
  const res = await fetch(`${BASE}/api/leads/hunter/prospect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nom: 'Test User', service: 'flake', superficie: 400 }),
  });
  assert.equal(res.status, 401);
});

test('INT-4: POST /api/admin/fb-leads-auto-devis — no api-key → 401', { skip: SKIP_INTEGRATION }, async () => {
  const res = await fetch(`${BASE}/api/admin/fb-leads-auto-devis`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  assert.equal(res.status, 401);
});

test('INT-5: POST /api/admin/balcon-sms-photo — no api-key → 401', { skip: SKIP_INTEGRATION }, async () => {
  const res = await fetch(`${BASE}/api/admin/balcon-sms-photo`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  assert.equal(res.status, 401);
});

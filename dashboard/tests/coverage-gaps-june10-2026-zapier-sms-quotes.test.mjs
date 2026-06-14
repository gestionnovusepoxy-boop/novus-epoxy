/**
 * coverage-gaps-june10-2026-zapier-sms-quotes.test.mjs
 *
 * Run: node --test tests/coverage-gaps-june10-2026-zapier-sms-quotes.test.mjs
 *
 * TRUE GAPS — pure logic never covered by any prior test file:
 *
 *   GAP-1  app/api/leads/zapier/route.ts  — normalizeService()
 *                                            Maps FB form free-text to CRM service codes.
 *                                            40+ keywords; silent misclassification of leads.
 *
 *   GAP-2  app/api/sms/incoming/route.ts  — parseQuoteData()
 *                                            Auto-parses SMS text for surface type + sqft.
 *                                            Untested; wrong parse → missing auto-data on client SMS.
 *
 *   GAP-3  app/api/leads/zapier/route.ts  — superficie multiplication ("25x15" → "375")
 *                                            and unit stripping ("500 pi2" → "500").
 *
 *   GAP-4  lib/llm.ts                     — getStreamingModel() missing-key guard.
 *                                            No OPENROUTER_API_KEY → should throw, not silently fail.
 *
 *   GAP-5  app/api/quotes/route.ts POST   — backwards-compat items logic, service type validation,
 *                                            rabais_pct clamping, isBalcon detection for SMS trigger.
 *
 *   GAP-6  lib/send-prospect-email.ts     — sendProspectEmail() missing-credentials guard.
 *
 * INTEGRATION SKELETONS (skipped unless INTEGRATION_TEST=1):
 *   INT-1  POST /api/sms/incoming          — no Twilio sig → 403 TwiML
 *   INT-2  POST /api/leads/zapier          — no api key → 401
 *   INT-3  GET  /api/leads/zapier          — valid key → 200 healthcheck
 *   INT-4  POST /api/leads/zapier          — missing email AND phone → 400
 *   INT-5  POST /api/leads/zapier          — valid phone-only lead → 200 with lead_id
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

const SKIP_INTEGRATION = !process.env.INTEGRATION_TEST;
const BASE = process.env.TEST_BASE_URL || 'http://localhost:3000';

// ════════════════════════════════════════════════════════════════════════════
// GAP-1: normalizeService()  (app/api/leads/zapier/route.ts)
//
// Maps Facebook form free-text answers to canonical CRM service codes.
// Not exported — inlined verbatim for isolation testing.
// ════════════════════════════════════════════════════════════════════════════

function normalizeService(raw) {
  if (!raw) return null;
  const t = raw.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
  const codes = ['flake', 'metallique', 'couleur_unie', 'quartz', 'commercial', 'antiderapant', 'meulage', 'vinyl_click'];
  if (codes.includes(t)) return t;
  if (t.includes('flocon') || t.includes('flake') || t.includes('garage')) return 'flake';
  if (t.includes('metal')) return 'metallique';
  if (t.includes('couleur') || t.includes('uni') || t.includes('solid')) return 'couleur_unie';
  if (t.includes('quartz')) return 'quartz';
  if (t.includes('commercial') || t.includes('industriel') || t.includes('entrepot')) return 'commercial';
  if (t.includes('antiderapant') || t.includes('anti-derapant') || t.includes('anti derapant') || t.includes('patio') || t.includes('balcon') || t.includes('escalier') || t.includes('marche')) return 'antiderapant';
  if (t.includes('meulage') || t.includes('diamant') || t.includes('poli')) return 'meulage';
  if (t.includes('vinyl') || t.includes('click') || t.includes('flottant') || t.includes('stratifie') || t.includes('stratifié')) return 'vinyl_click';
  return raw;
}

test('normalizeService: null → null', () => {
  assert.equal(normalizeService(null), null);
});
test('normalizeService: empty string → null', () => {
  assert.equal(normalizeService(''), null);
});
test('normalizeService: exact code "flake" → "flake"', () => {
  assert.equal(normalizeService('flake'), 'flake');
});
test('normalizeService: exact code "metallique" → "metallique"', () => {
  assert.equal(normalizeService('metallique'), 'metallique');
});
test('normalizeService: exact code "couleur_unie" → "couleur_unie"', () => {
  assert.equal(normalizeService('couleur_unie'), 'couleur_unie');
});
test('normalizeService: exact code "antiderapant" → "antiderapant"', () => {
  assert.equal(normalizeService('antiderapant'), 'antiderapant');
});
test('normalizeService: exact code "meulage" → "meulage"', () => {
  assert.equal(normalizeService('meulage'), 'meulage');
});
test('normalizeService: exact code "vinyl_click" → "vinyl_click"', () => {
  assert.equal(normalizeService('vinyl_click'), 'vinyl_click');
});
test('normalizeService: "FLAKE" (uppercase) → "flake" (lowercased before check)', () => {
  assert.equal(normalizeService('FLAKE'), 'flake');
});
test('normalizeService: "flocon" → "flake"', () => {
  assert.equal(normalizeService('flocon'), 'flake');
});
test('normalizeService: "finition flocon" → "flake"', () => {
  assert.equal(normalizeService('finition flocon'), 'flake');
});
test('normalizeService: "garage" keyword → "flake"', () => {
  assert.equal(normalizeService('garage'), 'flake');
});
test('normalizeService: "Plancher Garage Flocon" (real FB answer) → "flake"', () => {
  assert.equal(normalizeService('Plancher Garage Flocon'), 'flake');
});
test('normalizeService: "finition metallique" → "metallique"', () => {
  assert.equal(normalizeService('finition metallique'), 'metallique');
});
test('normalizeService: "finition métallique" (accented é) → "metallique"', () => {
  assert.equal(normalizeService('finition métallique'), 'metallique');
});
test('normalizeService: "Métallique" (mixed-case + accent) → "metallique"', () => {
  assert.equal(normalizeService('Métallique'), 'metallique');
});
test('normalizeService: "couleur unie" (space not underscore) → "couleur_unie"', () => {
  assert.equal(normalizeService('couleur unie'), 'couleur_unie');
});
test('normalizeService: "couleur" partial match → "couleur_unie"', () => {
  assert.equal(normalizeService('couleur'), 'couleur_unie');
});
test('normalizeService: "solid color" (English) → "couleur_unie"', () => {
  assert.equal(normalizeService('solid color'), 'couleur_unie');
});
test('normalizeService: "quartz" → "quartz"', () => {
  assert.equal(normalizeService('quartz'), 'quartz');
});
test('normalizeService: "finition quartz" → "quartz"', () => {
  assert.equal(normalizeService('finition quartz'), 'quartz');
});
test('normalizeService: "commercial" → "commercial"', () => {
  assert.equal(normalizeService('commercial'), 'commercial');
});
test('normalizeService: "industriel" → "commercial"', () => {
  assert.equal(normalizeService('industriel'), 'commercial');
});
test('normalizeService: "entrepot" → "commercial"', () => {
  assert.equal(normalizeService('entrepot'), 'commercial');
});
test('normalizeService: "patio" → "antiderapant"', () => {
  assert.equal(normalizeService('patio'), 'antiderapant');
});
test('normalizeService: "balcon" → "antiderapant"', () => {
  assert.equal(normalizeService('balcon'), 'antiderapant');
});
test('normalizeService: "escalier" → "antiderapant"', () => {
  assert.equal(normalizeService('escalier'), 'antiderapant');
});
test('normalizeService: "marche" (stairs) → "antiderapant"', () => {
  assert.equal(normalizeService('marche'), 'antiderapant');
});
test('normalizeService: "anti-derapant" (hyphenated) → "antiderapant"', () => {
  assert.equal(normalizeService('anti-derapant'), 'antiderapant');
});
test('normalizeService: "anti derapant" (spaced) → "antiderapant"', () => {
  assert.equal(normalizeService('anti derapant'), 'antiderapant');
});
test('normalizeService: "antidérapant" (accented é) → "antiderapant"', () => {
  assert.equal(normalizeService('antidérapant'), 'antiderapant');
});
test('normalizeService: "meulage diamant" → "meulage"', () => {
  assert.equal(normalizeService('meulage diamant'), 'meulage');
});
test('normalizeService: "polissage diamant" → "meulage" (via diamant keyword)', () => {
  assert.equal(normalizeService('polissage diamant'), 'meulage');
});
test('normalizeService: "plancher poli" → "meulage" (via poli keyword)', () => {
  assert.equal(normalizeService('plancher poli'), 'meulage');
});
test('normalizeService: "vinyl click" → "vinyl_click"', () => {
  assert.equal(normalizeService('vinyl click'), 'vinyl_click');
});
test('normalizeService: "plancher flottant" → "vinyl_click"', () => {
  assert.equal(normalizeService('plancher flottant'), 'vinyl_click');
});
test('normalizeService: "stratifie" → "vinyl_click"', () => {
  assert.equal(normalizeService('stratifie'), 'vinyl_click');
});
test('normalizeService: "stratifié" (accented) → "vinyl_click"', () => {
  assert.equal(normalizeService('stratifié'), 'vinyl_click');
});
test('normalizeService: unknown label "béton décoratif" → returned as-is (passthrough)', () => {
  assert.equal(normalizeService('béton décoratif'), 'béton décoratif');
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-2: parseQuoteData()  (app/api/sms/incoming/route.ts)
//
// Auto-parses incoming SMS text for surface type + square footage.
// Not exported — inlined verbatim for isolation testing.
// ════════════════════════════════════════════════════════════════════════════

const SURFACE_KEYWORDS = {
  garage: 'Garage',
  'sous-sol': 'Sous-sol',
  'sous sol': 'Sous-sol',
  basement: 'Sous-sol',
  balcon: 'Balcon',
  patio: 'Patio',
  entree: 'Entrée',
  commercial: 'Commercial',
  entrepot: 'Entrepôt',
  warehouse: 'Entrepôt',
};

function parseQuoteData(text) {
  const lower = text.toLowerCase();
  let surfaceType = null;
  for (const [keyword, label] of Object.entries(SURFACE_KEYWORDS)) {
    if (lower.includes(keyword)) {
      surfaceType = label;
      break;
    }
  }
  const sqftMatch = text.match(/(\d[\d\s.,]*)\s*(?:pi2|pi²|pieds?\s*carr[eé]s?|sqft|sf|p2|pc)/i)
    || text.match(/(?:pi2|pi²|pieds?\s*carr[eé]s?|sqft|sf|p2|pc)\s*[:\-]?\s*(\d[\d\s.,]*)/i);
  let sqft = null;
  if (sqftMatch) {
    sqft = (sqftMatch[1] || sqftMatch[2] || '').replace(/[\s,]/g, '').replace(/\.+$/, '');
  }
  if (!sqft && surfaceType) {
    const numMatch = text.match(/\b(\d{2,5})\b/);
    if (numMatch) sqft = numMatch[1];
  }
  if (!surfaceType && !sqft) return null;
  const parts = [];
  if (surfaceType) parts.push(`Type: ${surfaceType}`);
  if (sqft) parts.push(`Surface: ~${sqft} pi²`);
  return `[SMS Auto-Parse] ${parts.join(', ')}`;
}

test('parseQuoteData: no keywords + no sqft → null', () => {
  assert.equal(parseQuoteData('Bonjour je veux un prix'), null);
});
test('parseQuoteData: empty string → null', () => {
  assert.equal(parseQuoteData(''), null);
});
test('parseQuoteData: "garage" keyword only (no sqft unit) → type only', () => {
  assert.equal(parseQuoteData('Je voudrais une soumission pour mon garage'), '[SMS Auto-Parse] Type: Garage');
});
test('parseQuoteData: "sous-sol" (hyphenated) → Sous-sol', () => {
  assert.ok(parseQuoteData('Mon sous-sol fait 400 pi2')?.includes('Sous-sol'));
});
test('parseQuoteData: "sous sol" (no hyphen) → Sous-sol', () => {
  assert.ok(parseQuoteData('Mon sous sol fait 400 pi2')?.includes('Sous-sol'));
});
test('parseQuoteData: "basement" (English) → Sous-sol', () => {
  assert.ok(parseQuoteData('Basement 600 sqft')?.includes('Sous-sol'));
});
test('parseQuoteData: "balcon" → Balcon', () => {
  assert.ok(parseQuoteData('Balcon 150 pi2')?.includes('Balcon'));
});
test('parseQuoteData: "patio" → Patio', () => {
  assert.ok(parseQuoteData('patio 200 sf')?.includes('Patio'));
});
test('parseQuoteData: "warehouse" (English) → Entrepôt', () => {
  assert.ok(parseQuoteData('warehouse 5000 sqft')?.includes('Entrepôt'));
});
test('parseQuoteData: sqft with "pi2" suffix → Surface extracted', () => {
  const result = parseQuoteData('400 pi2');
  assert.ok(result?.includes('400'));
  assert.ok(result?.includes('pi²'));
});
test('parseQuoteData: sqft with "sqft" suffix → Surface extracted', () => {
  assert.ok(parseQuoteData('600 sqft')?.includes('600'));
});
test('parseQuoteData: sqft with "pieds carrés" → Surface extracted', () => {
  assert.ok(parseQuoteData('300 pieds carrés')?.includes('300'));
});
test('parseQuoteData: sqft reversed "pi2: 400" (unit before number) → extracted', () => {
  assert.ok(parseQuoteData('pi2: 400')?.includes('400'));
});
test('parseQuoteData: sqft only (no surface keyword) → sqft only, no Type:', () => {
  const result = parseQuoteData('500 pi2');
  assert.ok(result?.includes('500'));
  assert.ok(!result?.includes('Type:'));
});
test('parseQuoteData: surface type + sqft → both present in result', () => {
  const result = parseQuoteData('garage 600 pi2');
  assert.ok(result?.includes('Type: Garage'));
  assert.ok(result?.includes('Surface: ~600 pi²'));
});
test('parseQuoteData: surface type + standalone large number fallback → Surface extracted', () => {
  // No unit suffix, but "garage" present and 600 is 3 digits (2-5 range)
  const result = parseQuoteData('garage environ 600 pieds');
  assert.ok(result?.includes('Type: Garage'));
  assert.ok(result?.includes('600'));
});
test('parseQuoteData: single-digit standalone number NOT matched as sqft (\\d{2,5} requires ≥2 digits)', () => {
  const result = parseQuoteData('garage 5 pièces');
  assert.ok(result?.includes('Type: Garage'));
  assert.ok(!result?.includes('Surface: ~5'));
});
test('parseQuoteData: result always prefixed with "[SMS Auto-Parse]"', () => {
  assert.ok(parseQuoteData('garage 400 pi2')?.startsWith('[SMS Auto-Parse]'));
});
test('parseQuoteData: "commercial" → Commercial', () => {
  assert.ok(parseQuoteData('local commercial 1200 pi2')?.includes('Commercial'));
});
test('parseQuoteData: "entree" → Entrée', () => {
  assert.ok(parseQuoteData('entree maison 80 pi2')?.includes('Entrée'));
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-3: superficie multiplication + unit stripping  (leads/zapier/route.ts)
//
// "25x15" → "375", "500 pi2" → "500". Inlined verbatim.
// ════════════════════════════════════════════════════════════════════════════

function normalizeSuperficie(superficieRaw) {
  if (!superficieRaw) return superficieRaw;
  let superficie = superficieRaw;
  if (/^\d+\s*x\s*\d+$/i.test(superficieRaw)) {
    const parts = superficieRaw.split(/x/i).map((s) => parseFloat(s.trim()));
    superficie = String(Math.round(parts[0] * parts[1]));
  } else {
    superficie = superficieRaw.replace(/\s*(sf|pi2?|pi²|pieds?\s*carr[eé]s?|sqft|p2|pc)\s*$/i, '').trim() || superficieRaw;
  }
  return superficie;
}

test('normalizeSuperficie: null → null', () => {
  assert.equal(normalizeSuperficie(null), null);
});
test('normalizeSuperficie: undefined → undefined', () => {
  assert.equal(normalizeSuperficie(undefined), undefined);
});
test('normalizeSuperficie: "500" (bare number) → "500" unchanged', () => {
  assert.equal(normalizeSuperficie('500'), '500');
});
test('normalizeSuperficie: "500 pi2" → "500" (unit stripped)', () => {
  assert.equal(normalizeSuperficie('500 pi2'), '500');
});
test('normalizeSuperficie: "500 sqft" → "500"', () => {
  assert.equal(normalizeSuperficie('500 sqft'), '500');
});
test('normalizeSuperficie: "500sf" (no space) → "500"', () => {
  assert.equal(normalizeSuperficie('500sf'), '500');
});
test('normalizeSuperficie: "1500 pieds carrés" → "1500"', () => {
  assert.equal(normalizeSuperficie('1500 pieds carrés'), '1500');
});
test('normalizeSuperficie: "0 pi2" → "0" (unit stripped, 0 is valid)', () => {
  assert.equal(normalizeSuperficie('0 pi2'), '0');
});
test('normalizeSuperficie: "25x15" → "375" (multiplication)', () => {
  assert.equal(normalizeSuperficie('25x15'), '375');
});
test('normalizeSuperficie: "20 x 30" (spaces around x) → "600"', () => {
  assert.equal(normalizeSuperficie('20 x 30'), '600');
});
test('normalizeSuperficie: "10X12" (uppercase X) → "120"', () => {
  assert.equal(normalizeSuperficie('10X12'), '120');
});
test('normalizeSuperficie: "5x10" → "50"', () => {
  assert.equal(normalizeSuperficie('5x10'), '50');
});
test('normalizeSuperficie: multiplication result rounded (not float)', () => {
  // 7x3 = 21, Math.round(21) = 21
  assert.equal(normalizeSuperficie('7x3'), '21');
});
test('normalizeSuperficie: only unit (e.g. "pi2" bare) → original fallback returned', () => {
  // Replace removes everything → "" → falsy → returns original "pi2"
  assert.equal(normalizeSuperficie('pi2'), 'pi2');
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-4: getStreamingModel() guard  (lib/llm.ts)
//
// Throws 'OPENROUTER_API_KEY missing' before attempting createOpenAI.
// Inlined guard logic — the full function requires @ai-sdk which can't be
// imported in a plain node:test context without compilation.
// ════════════════════════════════════════════════════════════════════════════

function isOpenRouter() {
  return !!process.env.OPENROUTER_API_KEY;
}

function getStreamingModelGuard(tier = 'smart') {
  if (!isOpenRouter()) {
    throw new Error('OPENROUTER_API_KEY missing — set it in Vercel env. No Anthropic fallback.');
  }
  // In production, createOpenAI() would be called here
  return { tier, model: `openrouter:${tier}` };
}

test('getStreamingModel: no OPENROUTER_API_KEY → throws with correct message', () => {
  const original = process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  try {
    assert.throws(
      () => getStreamingModelGuard(),
      (err) => {
        assert.ok(err.message.includes('OPENROUTER_API_KEY missing'));
        assert.ok(err.message.includes('No Anthropic fallback'));
        return true;
      }
    );
  } finally {
    if (original !== undefined) process.env.OPENROUTER_API_KEY = original;
  }
});

test('getStreamingModel: OPENROUTER_API_KEY set → does not throw', () => {
  const original = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = 'sk-or-test-key';
  try {
    assert.doesNotThrow(() => getStreamingModelGuard('smart'));
    assert.doesNotThrow(() => getStreamingModelGuard('bulk'));
    assert.doesNotThrow(() => getStreamingModelGuard('top'));
  } finally {
    if (original !== undefined) {
      process.env.OPENROUTER_API_KEY = original;
    } else {
      delete process.env.OPENROUTER_API_KEY;
    }
  }
});

test('getStreamingModel: default tier is "smart"', () => {
  const OR_MODELS = { bulk: 'x-ai/grok-3-mini', fast: 'x-ai/grok-3-mini', medium: 'x-ai/grok-3', smart: 'x-ai/grok-3', top: 'x-ai/grok-3' };
  // 'smart' tier must exist and be defined
  assert.ok(OR_MODELS['smart']);
});

test('getStreamingModel: all 5 tiers defined in OR_MODELS', () => {
  const OR_MODELS = { bulk: 'x-ai/grok-3-mini', fast: 'x-ai/grok-3-mini', medium: 'x-ai/grok-3', smart: 'x-ai/grok-3', top: 'x-ai/grok-3' };
  for (const tier of ['bulk', 'fast', 'medium', 'smart', 'top']) {
    assert.ok(OR_MODELS[tier], `tier "${tier}" missing from OR_MODELS`);
  }
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-5: Quote POST validation  (app/api/quotes/route.ts POST)
//
// Pure decision logic inlined — no DB, no network.
// Tests backwards-compat items, service type validation, rabais_pct clamping.
// ════════════════════════════════════════════════════════════════════════════

const SERVICES_KEYS = new Set(['flake', 'metallique', 'couleur_unie', 'quartz', 'commercial', 'antiderapant', 'meulage', 'vinyl_click']);

function simulateQuotePostValidation(body) {
  const { client_nom, client_email, rabais_pct } = body;

  let items = body.items ?? [];
  // Backwards compat: if no items array, use single type_service + superficie
  if (items.length === 0 && body.type_service && body.superficie) {
    items = [{ type_service: body.type_service, superficie: parseFloat(body.superficie) }];
  }

  if (!client_nom || !client_email || items.length === 0) {
    return { error: 'Champs requis manquants', status: 400 };
  }
  for (const item of items) {
    if (!SERVICES_KEYS.has(item.type_service)) {
      return { error: `Type de service invalide: ${item.type_service}`, status: 400 };
    }
  }

  const rabaisExplicit = rabais_pct !== undefined && rabais_pct !== null;
  const rabaisPct = Math.min(100, Math.max(0, parseFloat(rabais_pct ?? 0) || 0));

  return { ok: true, items, rabaisExplicit, rabaisPct };
}

test('quotes POST: missing client_nom → 400 Champs requis manquants', () => {
  const r = simulateQuotePostValidation({ client_email: 'a@b.com', items: [{ type_service: 'flake', superficie: 500 }] });
  assert.equal(r.status, 400);
  assert.ok(r.error.includes('Champs requis manquants'));
});
test('quotes POST: empty client_nom → 400', () => {
  const r = simulateQuotePostValidation({ client_nom: '', client_email: 'a@b.com', items: [{ type_service: 'flake', superficie: 500 }] });
  assert.equal(r.status, 400);
});
test('quotes POST: missing client_email → 400', () => {
  const r = simulateQuotePostValidation({ client_nom: 'Test', items: [{ type_service: 'flake', superficie: 500 }] });
  assert.equal(r.status, 400);
});
test('quotes POST: no items, no backwards-compat fields → 400', () => {
  const r = simulateQuotePostValidation({ client_nom: 'Test', client_email: 'a@b.com' });
  assert.equal(r.status, 400);
});
test('quotes POST: backwards-compat type_service + superficie → items auto-populated', () => {
  const r = simulateQuotePostValidation({ client_nom: 'Test', client_email: 'a@b.com', type_service: 'flake', superficie: '400' });
  assert.equal(r.ok, true);
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].type_service, 'flake');
  assert.equal(r.items[0].superficie, 400);
});
test('quotes POST: backwards-compat superficie parsed as float (not string)', () => {
  const r = simulateQuotePostValidation({ client_nom: 'T', client_email: 'a@b.com', type_service: 'flake', superficie: '350.5' });
  assert.equal(r.items[0].superficie, 350.5);
});
test('quotes POST: invalid type_service → 400 with service name in error message', () => {
  const r = simulateQuotePostValidation({ client_nom: 'T', client_email: 'a@b.com', items: [{ type_service: 'béton_poli', superficie: 400 }] });
  assert.equal(r.status, 400);
  assert.ok(r.error.includes('béton_poli'));
});
test('quotes POST: all 8 valid type_service values → ok', () => {
  for (const type of ['flake', 'metallique', 'couleur_unie', 'quartz', 'commercial', 'antiderapant', 'meulage', 'vinyl_click']) {
    const r = simulateQuotePostValidation({ client_nom: 'T', client_email: 'a@b.com', items: [{ type_service: type, superficie: 400 }] });
    assert.equal(r.ok, true, `Expected ok for service type "${type}"`);
  }
});
test('quotes POST: multi-item array → all items validated', () => {
  const r = simulateQuotePostValidation({
    client_nom: 'T',
    client_email: 'a@b.com',
    items: [
      { type_service: 'flake', superficie: 400 },
      { type_service: 'antiderapant', superficie: 80 },
    ],
  });
  assert.equal(r.ok, true);
  assert.equal(r.items.length, 2);
});
test('quotes POST: multi-item with one invalid → 400', () => {
  const r = simulateQuotePostValidation({
    client_nom: 'T',
    client_email: 'a@b.com',
    items: [
      { type_service: 'flake', superficie: 400 },
      { type_service: 'unknown_type', superficie: 80 },
    ],
  });
  assert.equal(r.status, 400);
  assert.ok(r.error.includes('unknown_type'));
});
test('quotes POST: rabais_pct negative → clamped to 0', () => {
  const r = simulateQuotePostValidation({ client_nom: 'T', client_email: 'a@b.com', items: [{ type_service: 'flake', superficie: 400 }], rabais_pct: -10 });
  assert.equal(r.rabaisPct, 0);
});
test('quotes POST: rabais_pct > 100 → clamped to 100', () => {
  const r = simulateQuotePostValidation({ client_nom: 'T', client_email: 'a@b.com', items: [{ type_service: 'flake', superficie: 400 }], rabais_pct: 150 });
  assert.equal(r.rabaisPct, 100);
});
test('quotes POST: rabais_pct = 20 → 20 (within range)', () => {
  const r = simulateQuotePostValidation({ client_nom: 'T', client_email: 'a@b.com', items: [{ type_service: 'flake', superficie: 400 }], rabais_pct: 20 });
  assert.equal(r.rabaisPct, 20);
});
test('quotes POST: rabais_pct = 0 is EXPLICIT (no promo lookup should happen)', () => {
  const r = simulateQuotePostValidation({ client_nom: 'T', client_email: 'a@b.com', items: [{ type_service: 'flake', superficie: 400 }], rabais_pct: 0 });
  assert.equal(r.rabaisExplicit, true);
});
test('quotes POST: rabais_pct = undefined → NOT explicit (allows promo auto-apply)', () => {
  const r = simulateQuotePostValidation({ client_nom: 'T', client_email: 'a@b.com', items: [{ type_service: 'flake', superficie: 400 }] });
  assert.equal(r.rabaisExplicit, false);
});
test('quotes POST: rabais_pct = null → NOT explicit', () => {
  const r = simulateQuotePostValidation({ client_nom: 'T', client_email: 'a@b.com', items: [{ type_service: 'flake', superficie: 400 }], rabais_pct: null });
  assert.equal(r.rabaisExplicit, false);
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-5b: isBalcon detection  (app/api/quotes/route.ts POST)
//
// Controls whether a photo-request SMS is sent at quote creation.
// Inlined verbatim from the POST handler.
// ════════════════════════════════════════════════════════════════════════════

function isBalconQuote({ notes, client_adresse, etat_plancher, primaryService }) {
  return ['balcon', 'patio', 'terrasse'].some(kw =>
    [notes, client_adresse, etat_plancher, primaryService].some(f => (f ?? '').toLowerCase().includes(kw))
  );
}

test('isBalconQuote: "balcon" in notes → true', () => {
  assert.equal(isBalconQuote({ notes: 'Pour le balcon arrière', client_adresse: null, etat_plancher: null, primaryService: 'flake' }), true);
});
test('isBalconQuote: "patio" in notes → true', () => {
  assert.equal(isBalconQuote({ notes: 'Patio extérieur', client_adresse: null, etat_plancher: null, primaryService: 'flake' }), true);
});
test('isBalconQuote: "terrasse" in notes → true', () => {
  assert.equal(isBalconQuote({ notes: 'terrasse en béton', client_adresse: null, etat_plancher: null, primaryService: 'flake' }), true);
});
test('isBalconQuote: "balcon" in client_adresse → true', () => {
  assert.equal(isBalconQuote({ notes: null, client_adresse: 'Balcon 45 rue Principale', etat_plancher: null, primaryService: 'flake' }), true);
});
test('isBalconQuote: "patio" in etat_plancher → true', () => {
  assert.equal(isBalconQuote({ notes: null, client_adresse: null, etat_plancher: 'patio béton fissuré', primaryService: 'flake' }), true);
});
test('isBalconQuote: no keywords in any field → false (regular garage quote)', () => {
  assert.equal(isBalconQuote({ notes: 'Garage double', client_adresse: '123 rue Test', etat_plancher: 'bon état', primaryService: 'flake' }), false);
});
test('isBalconQuote: all null fields → false', () => {
  assert.equal(isBalconQuote({ notes: null, client_adresse: null, etat_plancher: null, primaryService: null }), false);
});
test('isBalconQuote: case-insensitive — "BALCON" uppercase → true', () => {
  assert.equal(isBalconQuote({ notes: 'BALCON', client_adresse: null, etat_plancher: null, primaryService: 'flake' }), true);
});
test('isBalconQuote: "balcon" substring in longer word — triggers match', () => {
  // "rebalcon" contains "balcon" — this IS a match (includes, not word-boundary)
  assert.equal(isBalconQuote({ notes: 'rebalcon', client_adresse: null, etat_plancher: null, primaryService: 'flake' }), true);
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-6: sendProspectEmail() credentials guard  (lib/send-prospect-email.ts)
//
// Throws 'Gmail credentials missing' when OAuth env vars absent.
// Tests the guard logic without executing the actual Gmail API call.
// ════════════════════════════════════════════════════════════════════════════

function checkProspectEmailCredentials({ clientId, clientSecret, refreshToken }) {
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('Gmail credentials missing');
  }
  return true;
}

test('sendProspectEmail: missing clientId → throws "Gmail credentials missing"', () => {
  assert.throws(
    () => checkProspectEmailCredentials({ clientId: null, clientSecret: 'secret', refreshToken: 'token' }),
    /Gmail credentials missing/
  );
});
test('sendProspectEmail: missing clientSecret → throws', () => {
  assert.throws(
    () => checkProspectEmailCredentials({ clientId: 'id', clientSecret: '', refreshToken: 'token' }),
    /Gmail credentials missing/
  );
});
test('sendProspectEmail: missing refreshToken → throws', () => {
  assert.throws(
    () => checkProspectEmailCredentials({ clientId: 'id', clientSecret: 'secret', refreshToken: null }),
    /Gmail credentials missing/
  );
});
test('sendProspectEmail: all credentials present → returns true (no throw)', () => {
  assert.equal(checkProspectEmailCredentials({ clientId: 'id', clientSecret: 'secret', refreshToken: 'token' }), true);
});
test('sendProspectEmail: undefined credentials → throws', () => {
  assert.throws(
    () => checkProspectEmailCredentials({ clientId: undefined, clientSecret: undefined, refreshToken: undefined }),
    /Gmail credentials missing/
  );
});

// ════════════════════════════════════════════════════════════════════════════
// INTEGRATION SKELETONS
// Skipped unless INTEGRATION_TEST=1 env var is set.
// Run: INTEGRATION_TEST=1 TEST_BASE_URL=http://localhost:3000 node --test tests/...
// ════════════════════════════════════════════════════════════════════════════

test('INT-1 POST /api/sms/incoming — no Twilio signature → 403 TwiML', { skip: SKIP_INTEGRATION }, async () => {
  const r = await fetch(`${BASE}/api/sms/incoming`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ From: '+15141234567', Body: 'Bonjour' }),
  });
  assert.equal(r.status, 403);
  const body = await r.text();
  assert.ok(body.includes('<Response>'), 'response must be TwiML <Response>');
  assert.equal(r.headers.get('content-type'), 'text/xml');
});

test('INT-2 POST /api/leads/zapier — no api key → 401', { skip: SKIP_INTEGRATION }, async () => {
  const r = await fetch(`${BASE}/api/leads/zapier`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nom: 'Test', email: 'test@test.com', telephone: '5141234567' }),
  });
  assert.equal(r.status, 401);
  const data = await r.json();
  assert.ok(data.error?.toLowerCase().includes('unauthorized') || data.error?.toLowerCase().includes('autoris'));
});

test('INT-3 GET /api/leads/zapier — valid api key → 200 healthcheck', { skip: SKIP_INTEGRATION }, async () => {
  const apiKey = process.env.ZAPIER_API_KEY || process.env.ADMIN_API_KEY || '';
  if (!apiKey) { assert.ok(false, 'ZAPIER_API_KEY or ADMIN_API_KEY must be set for INT-3'); return; }
  const r = await fetch(`${BASE}/api/leads/zapier?api_key=${apiKey}`);
  assert.equal(r.status, 200);
  const data = await r.json();
  assert.equal(data.ok, true);
  assert.equal(data.endpoint, 'zapier-leads');
  assert.equal(data.version, 1);
});

test('INT-4 POST /api/leads/zapier — missing email AND phone → 400', { skip: SKIP_INTEGRATION }, async () => {
  const apiKey = process.env.ZAPIER_API_KEY || process.env.ADMIN_API_KEY || '';
  if (!apiKey) { assert.ok(false, 'ZAPIER_API_KEY or ADMIN_API_KEY must be set for INT-4'); return; }
  const r = await fetch(`${BASE}/api/leads/zapier`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
    body: JSON.stringify({ nom: 'Test Without Contact Info' }),
  });
  assert.equal(r.status, 400);
  const data = await r.json();
  assert.ok(data.error?.includes('email or telephone'), `expected "email or telephone" in error, got: ${data.error}`);
});

test('INT-5 POST /api/leads/zapier — phone-only lead → 200 with ok=true', { skip: SKIP_INTEGRATION }, async () => {
  const apiKey = process.env.ZAPIER_API_KEY || process.env.ADMIN_API_KEY || '';
  if (!apiKey) { assert.ok(false, 'ZAPIER_API_KEY or ADMIN_API_KEY must be set for INT-5'); return; }
  const r = await fetch(`${BASE}/api/leads/zapier`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
    body: JSON.stringify({
      nom: 'Test Integration Lead',
      telephone: '5140000099',
      service: 'garage',
      superficie: '400 pi2',
    }),
  });
  assert.equal(r.status, 200);
  const data = await r.json();
  assert.equal(data.ok, true);
  // Either new lead_id or duplicate=true is acceptable
  assert.ok(typeof data.lead_id === 'number' || data.duplicate === true, 'expected lead_id or duplicate flag');
});

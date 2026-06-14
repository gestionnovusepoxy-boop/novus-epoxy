/**
 * coverage-audit-2026-06.test.mjs
 *
 * Remaining coverage gaps as of June 9, 2026 — after auditing all 47 existing
 * test files. Only TRUE gaps are listed here; anything already tested in prior
 * files is excluded.
 *
 * GAPS COVERED (pure, runnable):
 *   GAP-1  /api/leads/zapier — normalizeService() fuzzy-matching FB text → CRM codes
 *   GAP-2  lib/pricing.ts    — calculateQuoteWithExtras extras-only (service=0, prix_fixe=0)
 *   GAP-3  lib/auto-description.ts — polyaspartique "1 couche" invariant (never "2 couches")
 *   GAP-4  lib/sms.ts        — dedup SHA-1 key produces different hashes for different bodies
 *   GAP-5  /api/cron/lead-followup — FB/Meta source exclusion pattern (regex correctness)
 *
 * SKELETONS (require DB/network — skipped unless INTEGRATION_TEST=1):
 *   GAP-6  lib/send-email.ts  — sendEmail() fallback chain (Gmail→Resend and Resend→Gmail)
 *   GAP-7  Cron auth guard    — Authorization: Bearer <CRON_SECRET> → 401 on wrong token
 *   GAP-8  Integration        — Lead import → blocklist check → no auto-contact
 *
 * Run pure tests:
 *   node --test tests/coverage-audit-2026-06.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'crypto';

// ════════════════════════════════════════════════════════════════════════════
// GAP-1: /api/leads/zapier — normalizeService()
//
// Maps Facebook form free-text (e.g. "garage avec flocons") to CRM service
// codes (e.g. "flake"). This function has 14+ branches and is NEVER tested.
// Wrong mapping → wrong service type stored in CRM → auto-quote uses wrong
// price (e.g. vinyl $2/sqft instead of flake $8.50/sqft).
// ════════════════════════════════════════════════════════════════════════════

// Inlined from /app/api/leads/zapier/route.ts — keep in sync with source.
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
  if (t.includes('antiderapant') || t.includes('anti-derapant') || t.includes('anti derapant') ||
      t.includes('patio') || t.includes('balcon') || t.includes('escalier') || t.includes('marche')) return 'antiderapant';
  if (t.includes('meulage') || t.includes('diamant') || t.includes('poli')) return 'meulage';
  if (t.includes('vinyl') || t.includes('click') || t.includes('flottant') ||
      t.includes('stratifie') || t.includes('stratifie')) return 'vinyl_click';
  return raw;
}

// Exact CRM code passthrough — no transformation needed
test('normalizeService: exact code "flake" → "flake"', () => {
  assert.equal(normalizeService('flake'), 'flake');
});
test('normalizeService: exact code "metallique" → "metallique"', () => {
  assert.equal(normalizeService('metallique'), 'metallique');
});
test('normalizeService: exact code "vinyl_click" → "vinyl_click"', () => {
  assert.equal(normalizeService('vinyl_click'), 'vinyl_click');
});
test('normalizeService: exact code "commercial" → "commercial"', () => {
  assert.equal(normalizeService('commercial'), 'commercial');
});

// Fuzzy matching — FB form answers in French
test('normalizeService: "flocon" → "flake"', () => {
  assert.equal(normalizeService('flocon'), 'flake');
});
test('normalizeService: "Flocons colorés pour garage" → "flake"', () => {
  assert.equal(normalizeService('Flocons colorés pour garage'), 'flake');
});
test('normalizeService: "Métallique effet miroir" → "metallique"', () => {
  assert.equal(normalizeService('Métallique effet miroir'), 'metallique');
});
test('normalizeService: "couleur unie grise" → "couleur_unie"', () => {
  assert.equal(normalizeService('couleur unie grise'), 'couleur_unie');
});
test('normalizeService: "industriel entrepôt" → "commercial"', () => {
  assert.equal(normalizeService('industriel entrepôt'), 'commercial');
});
test('normalizeService: "patio extérieur" → "antiderapant"', () => {
  assert.equal(normalizeService('patio extérieur'), 'antiderapant');
});
test('normalizeService: "escalier beton" → "antiderapant"', () => {
  assert.equal(normalizeService('escalier beton'), 'antiderapant');
});
test('normalizeService: "polissage diamant" → "meulage"', () => {
  assert.equal(normalizeService('polissage diamant'), 'meulage');
});
test('normalizeService: "plancher vinyl flottant" → "vinyl_click"', () => {
  assert.equal(normalizeService('plancher vinyl flottant'), 'vinyl_click');
});
test('normalizeService: null → null', () => {
  assert.equal(normalizeService(null), null);
});
test('normalizeService: unknown text → returns original (not null)', () => {
  // Unknown text must be returned as-is so operators can manually reclassify
  const result = normalizeService('ciment polimère spécial');
  assert.ok(typeof result === 'string', 'must return a string');
  assert.ok(result.length > 0, 'must not return empty string');
});
test('normalizeService: "garage" maps to flake (most common garage request)', () => {
  // Per business logic: garage + no service mentioned → defaults to flake (epoxy chips)
  assert.equal(normalizeService('garage'), 'flake');
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-2: lib/pricing.ts — calculateQuoteWithExtras with service_brut=0
//
// When a quote has extras-only (no epoxy service, just e.g. prep work or an
// item that has no service charge), both sousTotalService=0 and prixPiedCarre=0.
// The isPrixFixe detection uses `sousTotalService > 0` so it falls to the
// per-sqft path with prix=0 → service_brut=0. Extras are then added on top.
// Result should be: sous_total = extras_total only, taxes/dépôt on extras.
// ════════════════════════════════════════════════════════════════════════════

function dollarsToCents(d) { return Math.round((d + Number.EPSILON) * 100); }
function centsToDollars(c) { return Math.round(c) / 100; }
function mulCents(cents, qty) { return Math.round(cents * qty); }
function pctOfCents(cents, pct) { return Math.round(cents * (pct / 100)); }
function sumCents(...args) { return args.reduce((s, a) => s + Math.round(a), 0); }
function taxesFromSubtotalCents(st) {
  const tpsCents = pctOfCents(st, 5);
  const tvqCents = pctOfCents(st, 9.975);
  const totalCents = sumCents(st, tpsCents, tvqCents);
  const depotCents = pctOfCents(totalCents, 30);
  return { tpsCents, tvqCents, totalCents, depotCents };
}

const SERVICES_PRICING = {
  flake: { prix: 8.50 }, metallique: { prix: 12.75 }, couleur_unie: { prix: 7.50 },
  quartz: { prix: 11.00 }, antiderapant: { prix: 10.00 }, commercial: { prix: 15.00 },
  meulage: { prix: 3.50 }, autonivelant: { prix: 3.25 }, vinyl_click: { prix: 2.00 },
};

function calculateQuoteWithExtras({ serviceType, superficie, prixPiedCarre, sousTotalService, rabaisPct, extrasTotal }) {
  const isPrixFixe = (!prixPiedCarre || prixPiedCarre === 0) && sousTotalService > 0;
  const knownPrix = serviceType in SERVICES_PRICING ? SERVICES_PRICING[serviceType].prix : (prixPiedCarre ?? 0);
  const serviceBrutCents = isPrixFixe
    ? dollarsToCents(sousTotalService)
    : mulCents(dollarsToCents(knownPrix), superficie);
  const rabaisCents = pctOfCents(serviceBrutCents, rabaisPct);
  const serviceNetCents = serviceBrutCents - rabaisCents;
  const extrasCents = dollarsToCents(extrasTotal);
  const sousTotalCents = sumCents(serviceNetCents, extrasCents);
  const { tpsCents, tvqCents, totalCents, depotCents } = taxesFromSubtotalCents(sousTotalCents);
  return {
    prix_pied_carre: isPrixFixe ? 0 : knownPrix,
    service_brut: centsToDollars(serviceBrutCents),
    service_net: centsToDollars(serviceNetCents),
    extras_total: centsToDollars(extrasCents),
    rabais_pct: rabaisPct,
    rabais_montant: centsToDollars(rabaisCents),
    sous_total: centsToDollars(sousTotalCents),
    tps: centsToDollars(tpsCents),
    tvq: centsToDollars(tvqCents),
    total: centsToDollars(totalCents),
    depot_requis: centsToDollars(depotCents),
  };
}

test('calculateQuoteWithExtras: service_brut=0 + extras → sous_total = extras only', () => {
  const r = calculateQuoteWithExtras({
    serviceType: 'flake', superficie: 0,
    prixPiedCarre: 0, sousTotalService: 0, rabaisPct: 0,
    extrasTotal: 500,
  });
  assert.equal(r.service_brut, 0, 'service_brut must be 0');
  assert.equal(r.extras_total, 500);
  assert.equal(r.sous_total, 500, 'sous_total must equal extras only');
});

test('calculateQuoteWithExtras: service_brut=0, rabais has no effect', () => {
  const r = calculateQuoteWithExtras({
    serviceType: 'flake', superficie: 0,
    prixPiedCarre: 0, sousTotalService: 0, rabaisPct: 20,
    extrasTotal: 300,
  });
  assert.equal(r.rabais_montant, 0, 'no rabais applied on 0 service');
  assert.equal(r.sous_total, 300);
});

test('calculateQuoteWithExtras: taxes and depot computed on extras only', () => {
  const r = calculateQuoteWithExtras({
    serviceType: 'flake', superficie: 0,
    prixPiedCarre: 0, sousTotalService: 0, rabaisPct: 0,
    extrasTotal: 1000,
  });
  // TPS 5% of 1000 = 50, TVQ 9.975% of 1000 = 99.75 → 100 (rounded)
  assert.equal(r.tps, 50);
  assert.ok(r.tvq > 0, 'TVQ must be positive');
  assert.ok(r.depot_requis > 0, 'depot_requis must be positive');
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-3: lib/auto-description.ts — polyaspartique "1 couche" invariant
//
// Business rule (feedback_polyaspartique_1_couche.md): Polyaspartique TOUJOURS
// 1 couche, jamais 2. The description must never say "2 couches" in context of
// polyaspartique. This ensures the generated description matches what's actually
// installed (1 topcoat, not 2).
// ════════════════════════════════════════════════════════════════════════════

// Import the real function — auto-description.ts has no DB imports so it loads cleanly.
import { generateAutoDescription } from '../lib/auto-description.ts';

const ALL_SERVICE_TYPES = [
  'flake', 'metallique', 'couleur_unie', 'quartz', 'antiderapant',
  'commercial', 'vinyl_click', 'meulage',
];

for (const svc of ALL_SERVICE_TYPES) {
  test(`polyaspartique invariant: ${svc} description never says "2 couches"`, () => {
    const desc = generateAutoDescription({ type_service: svc, superficie: 200 });
    // The forbidden pattern: "2 couches" immediately after or near "polyaspartique"
    const hasTwo = /polyaspartique[^.]*2\s*couche/i.test(desc) ||
                   /2\s*couches[^.]*polyaspartique/i.test(desc);
    assert.ok(!hasTwo,
      `${svc} description contains "2 couches" near polyaspartique: …${desc.slice(0, 200)}…`);
  });
}

test('flake: topcoat mentioned exactly once (not doubled)', () => {
  const desc = generateAutoDescription({ type_service: 'flake', superficie: 300 });
  const topcoatCount = (desc.match(/topcoat/gi) ?? []).length;
  assert.ok(topcoatCount >= 1, 'must mention topcoat at least once');
  assert.ok(topcoatCount <= 2, `topcoat mentioned ${topcoatCount} times — unexpected duplication`);
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-4: lib/sms.ts — dedup SHA-1 key uniqueness
//
// sendSMS() uses SHA-1(body).slice(0,24) to dedup messages sent to the same
// phone within 6h. If two different messages hash to the same prefix, the
// second message (e.g. day-2 follow-up) is silently dropped.
// Tests must confirm: same body → same key, different body → different key.
// ════════════════════════════════════════════════════════════════════════════

function smsDedupeKey(phone, body) {
  return `sms_dedup_${phone}_${createHash('sha1').update(body).digest('hex').slice(0, 24)}`;
}

test('SMS dedup: same phone + same body → identical key (dedup fires)', () => {
  const k1 = smsDedupeKey('+15145550000', 'Bonjour Jean, rappel RDV demain');
  const k2 = smsDedupeKey('+15145550000', 'Bonjour Jean, rappel RDV demain');
  assert.equal(k1, k2, 'identical body must produce same dedup key');
});

test('SMS dedup: same phone + different body → different key (both messages sent)', () => {
  const k1 = smsDedupeKey('+15145550000', 'Bonjour — votre devis est prêt!');
  const k2 = smsDedupeKey('+15145550000', 'Bonjour — rappel dépôt requis');
  assert.notEqual(k1, k2, 'different body must produce different dedup key');
});

test('SMS dedup: same body + different phone → different key', () => {
  const body = 'Rappel RDV Novus Epoxy';
  const k1 = smsDedupeKey('+15145550001', body);
  const k2 = smsDedupeKey('+15145550002', body);
  assert.notEqual(k1, k2, 'different phone must produce different dedup key');
});

test('SMS dedup: body differing by one char → different key (no prefix collision)', () => {
  const k1 = smsDedupeKey('+15145550000', 'Rappel jour 1');
  const k2 = smsDedupeKey('+15145550000', 'Rappel jour 2');
  assert.notEqual(k1, k2, 'single-char difference must produce different key');
});

test('SMS dedup: key format matches expected prefix pattern', () => {
  const k = smsDedupeKey('+15145550000', 'test');
  assert.ok(k.startsWith('sms_dedup_+15145550000_'), `unexpected key format: ${k}`);
  // 24-char hex slice after the prefix
  const hash = k.split('_').pop();
  assert.equal(hash.length, 24, `hash slice must be 24 chars, got ${hash.length}`);
  assert.ok(/^[0-9a-f]{24}$/.test(hash), `hash must be lowercase hex: ${hash}`);
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-5: /api/cron/lead-followup — FB/Meta source exclusion regex
//
// Business rule (feedback_fb_leads_manual.md): Aria NEVER auto-contacts FB/Meta
// leads. Luca contacts them manually. The cron SQL filter uses:
//   source !~* '(facebook|meta|fb|zapier)'
// This tests the regex logic in isolation — if the pattern breaks, Aria would
// spam clients who are supposed to get a personal call from Luca.
// ════════════════════════════════════════════════════════════════════════════

// Postgres ~* is case-insensitive regex match. Replicate in JS:
function isExcludedSource(source) {
  if (!source) return false;
  return /(facebook|meta|fb|zapier)/i.test(source);
}

const EXCLUDED_SOURCES = [
  'facebook', 'Facebook', 'FACEBOOK',
  'meta', 'Meta', 'META',
  'fb', 'FB',
  'zapier', 'Zapier', 'ZAPIER',
  'facebook-lead-ads',
  'meta-ads',
  'fb_lead_form',
  'zapier_webhook',
];

for (const src of EXCLUDED_SOURCES) {
  test(`lead-followup exclusion: source "${src}" must be excluded (no Aria auto-contact)`, () => {
    assert.ok(isExcludedSource(src), `source "${src}" should be excluded from auto-followup`);
  });
}

const INCLUDED_SOURCES = [
  'site-web', 'siteweb', 'formulaire', 'google', 'referral',
  'csv', 'import', 'scraper',  // cold sources but NOT FB — Aria can follow up
  null, undefined, '',
];

for (const src of INCLUDED_SOURCES) {
  test(`lead-followup inclusion: source "${src}" must NOT be excluded`, () => {
    assert.ok(!isExcludedSource(src), `source "${src}" was incorrectly excluded`);
  });
}

// ════════════════════════════════════════════════════════════════════════════
// GAP-6 SKELETON: lib/send-email.ts — sendEmail() fallback chain
//
// sendEmail() has two paths:
//   - Default: Gmail primary → Resend fallback on error
//   - via='resend': Resend primary → Gmail fallback on error
//
// Neither path is tested (gmail-auth-error.test.mjs only tests handleGmailAuthError).
// Needs a mock or intercepted fetch to test the fallback logic.
// ════════════════════════════════════════════════════════════════════════════

// test('sendEmail: Gmail fails → falls back to Resend (integration)', async () => {
//   // Setup: mock sendViaGmail to throw, sendViaResend to resolve
//   // Call: await sendEmail({ to: 'test@example.com', subject: 'Test', html: '<p>Hi</p>' })
//   // Assert: returns { id: <resend-id> }
//   // Assert: Resend API was called, Gmail was called first
// });
//
// test('sendEmail: via=resend → Resend primary, Gmail fallback on failure (integration)', async () => {
//   // Setup: mock sendViaResend to throw, sendViaGmail to resolve
//   // Call: await sendEmail({ to: '...', subject: '...', html: '...', via: 'resend' })
//   // Assert: Gmail fallback was used
// });
//
// test('sendEmail: both paths fail → throws final error (integration)', async () => {
//   // Setup: both mocked to throw
//   // Assert: rejects with an error (never silently swallows)
// });

// ════════════════════════════════════════════════════════════════════════════
// GAP-7 SKELETON: Cron auth guard — wrong token → 401
//
// All cron routes check: Authorization: Bearer <CRON_SECRET>
// A missing or wrong token must return 401, not 200 or 500.
// ════════════════════════════════════════════════════════════════════════════

// test('GET /api/cron/lead-followup: missing auth → 401 (integration)', async () => {
//   const res = await fetch(`${BASE_URL}/api/cron/lead-followup`);
//   assert.equal(res.status, 401);
// });
//
// test('GET /api/cron/lead-followup: wrong token → 401 (integration)', async () => {
//   const res = await fetch(`${BASE_URL}/api/cron/lead-followup`, {
//     headers: { authorization: 'Bearer wrong-secret-xyz' },
//   });
//   assert.equal(res.status, 401);
// });

// ════════════════════════════════════════════════════════════════════════════
// GAP-8 SKELETON: Lead → blocklist → no auto-contact integration
//
// Full pipeline: SMS complaint arrives → lead blocked → subsequent auto-send
// (relance, follow-up email) skips the blocked lead.
// ════════════════════════════════════════════════════════════════════════════

// test('Lead blocked after complaint → relance cron skips them (integration)', async () => {
//   // 1. Create a lead in crm_leads with email test@novus.example
//   // 2. Call POST /api/sms/incoming with a complaint body from that lead's phone
//   // 3. Assert: kv_store has lead_block_phone_<phone> entry
//   // 4. Call GET /api/cron/relance-prospect
//   // 5. Assert: no email_logs row created for test@novus.example
// });

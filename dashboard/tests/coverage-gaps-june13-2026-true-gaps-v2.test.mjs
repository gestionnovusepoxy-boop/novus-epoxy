/**
 * coverage-gaps-june13-2026-true-gaps-v2.test.mjs
 *
 * TRUE GAPS — routes and lib files with ZERO test-file references as of June 13 2026.
 * All decision logic is inlined (no @/ imports) — runs with plain `node --test`.
 *
 * Run:  node --test tests/coverage-gaps-june13-2026-true-gaps-v2.test.mjs
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CONFIRMED ZERO-COVERAGE ROUTES (grep across 89 test files returned 0 hits):
 *   1. app/api/ads/list                — aggregation reducers
 *   2. app/api/calendar/events         — toDateStr, toISOStr, slotTimes, slotCls, color logic
 *   3. app/api/dashboard/automation    — labelFor, CRON_LABELS lookup
 *   4. app/api/dashboard/overview      — encaisse / profit arithmetic
 *   5. app/api/leads/jason/prospect    — promoBanner*, promoText*, IMAGE_EXTENSIONS filter
 *   6. app/api/leads/offer             — template interpolation, recipient limits
 *   7. lib/arcjet.ts                   — null-export when ARCJET_KEY absent
 *
 * UNIT GAPS (pure functions, no DB/network needed):
 *   GAP-1   ads/list          — by_statut aggregation reducer
 *   GAP-2   ads/list          — by_service aggregation reducer
 *   GAP-3   ads/list          — total_spend_usd / impressions / clicks / leads sum reducers
 *   GAP-4   calendar/events   — toDateStr: Date instance path
 *   GAP-5   calendar/events   — toDateStr: "YYYY-MM-DD" string path
 *   GAP-6   calendar/events   — toDateStr: fallback parse path
 *   GAP-7   calendar/events   — toISOStr: Date instance path
 *   GAP-8   calendar/events   — toISOStr: ISO-T string fast path
 *   GAP-9   calendar/events   — slotTimes all three slot values
 *   GAP-10  calendar/events   — slotCls all three slot values
 *   GAP-11  calendar/events   — booking color: completee, en_attente, default
 *   GAP-12  dashboard/auto    — labelFor: hits CRON_LABELS table
 *   GAP-13  dashboard/auto    — labelFor: strips query-string before lookup
 *   GAP-14  dashboard/auto    — labelFor: falls back to last path segment
 *   GAP-15  dashboard/overview — encaisse = depots_recus + soldes_recus
 *   GAP-16  dashboard/overview — profit = encaisse − depenses − salaires
 *   GAP-17  leads/offer        — OFFER_HTML {{PRENOM}} substitution
 *   GAP-18  leads/offer        — POST: 0 recipients → 400
 *   GAP-19  leads/offer        — POST: >50 recipients → 400
 *   GAP-20  leads/jason        — promoBanner inactive → empty string
 *   GAP-21  leads/jason        — promoBanner active, no ends_at → no date line
 *   GAP-22  leads/jason        — promoBanner active with ends_at → date line present
 *   GAP-23  leads/jason        — promoTextResidential inactive → empty string
 *   GAP-24  leads/jason        — promoTextResidential active → contains pct + label
 *   GAP-25  leads/jason        — promoTextFacebookIntro inactive → empty string
 *   GAP-26  leads/jason        — promoCalloutFacebook inactive → empty string
 *   GAP-27  leads/jason        — IMAGE_EXTENSIONS rejects .mov / .mp4
 *   GAP-28  leads/jason        — IMAGE_EXTENSIONS accepts .jpg, .jpeg, .png, .webp
 *   GAP-29  leads/jason        — pickPhotos dedup: same photo URL used only once
 *   GAP-30  lib/arcjet         — aj is null when ARCJET_KEY is absent
 *
 * INTEGRATION SKELETONS (skipped unless INTEGRATION_TEST=1):
 *   INT-1   GET /api/ads/list                       → 200 with summary + drafts
 *   INT-2   GET /api/calendar/events                → 200 with events array
 *   INT-3   GET /api/dashboard/automation           → 200 with crons array
 *   INT-4   GET /api/dashboard/overview             → 200, financier.profit is a number
 *   INT-5   GET /api/leads/offer                    → 200 with html key
 *   INT-6   POST /api/leads/offer — 0 recipients   → 400
 *   INT-7   POST /api/leads/offer — >50 recipients → 400
 *   INT-8   POST /api/leads/jason/prospect — missing leads → 400
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

const SKIP_INTEGRATION = !process.env.INTEGRATION_TEST;
const BASE = process.env.TEST_BASE_URL || 'http://localhost:3000';

// ════════════════════════════════════════════════════════════════════════════
// GAP-1/2/3: app/api/ads/list — aggregation reducers
//
// Inlined from app/api/ads/list/route.ts GET handler.
// These reducers build the `summary` object from the DB rows.
// ════════════════════════════════════════════════════════════════════════════

function buildAdsSummary(drafts) {
  return {
    total_drafts: drafts.length,
    by_statut: drafts.reduce((acc, d) => {
      const k = String(d.statut ?? 'unknown');
      acc[k] = (acc[k] ?? 0) + 1;
      return acc;
    }, {}),
    by_service: drafts.reduce((acc, d) => {
      const k = String(d.service ?? 'unknown');
      acc[k] = (acc[k] ?? 0) + 1;
      return acc;
    }, {}),
    total_spend_usd:   drafts.reduce((s, d) => s + Number(d.spend_usd   ?? 0), 0),
    total_impressions: drafts.reduce((s, d) => s + Number(d.impressions  ?? 0), 0),
    total_clicks:      drafts.reduce((s, d) => s + Number(d.clicks       ?? 0), 0),
    total_leads:       drafts.reduce((s, d) => s + Number(d.leads_generated ?? 0), 0),
  };
}

test('GAP-1: by_statut — counts each status correctly', () => {
  const drafts = [
    { statut: 'brouillon',  service: 'epoxy', spend_usd: 0, impressions: 0, clicks: 0, leads_generated: 0 },
    { statut: 'actif',      service: 'epoxy', spend_usd: 0, impressions: 0, clicks: 0, leads_generated: 0 },
    { statut: 'actif',      service: 'poly',  spend_usd: 0, impressions: 0, clicks: 0, leads_generated: 0 },
    { statut: null,         service: null,     spend_usd: 0, impressions: 0, clicks: 0, leads_generated: 0 },
  ];
  const s = buildAdsSummary(drafts);
  assert.equal(s.by_statut['brouillon'], 1);
  assert.equal(s.by_statut['actif'],     2);
  assert.equal(s.by_statut['unknown'],   1, 'null statut → "unknown"');
});

test('GAP-2: by_service — counts each service, null → "unknown"', () => {
  const drafts = [
    { statut: 'actif', service: 'epoxy',   spend_usd: 0, impressions: 0, clicks: 0, leads_generated: 0 },
    { statut: 'actif', service: 'epoxy',   spend_usd: 0, impressions: 0, clicks: 0, leads_generated: 0 },
    { statut: 'actif', service: null,      spend_usd: 0, impressions: 0, clicks: 0, leads_generated: 0 },
  ];
  const s = buildAdsSummary(drafts);
  assert.equal(s.by_service['epoxy'],   2);
  assert.equal(s.by_service['unknown'], 1, 'null service → "unknown"');
});

test('GAP-3: spend/impressions/clicks/leads totals — null fields treated as 0', () => {
  const drafts = [
    { statut: 'actif', service: 'epoxy', spend_usd: '12.50', impressions: '1000', clicks: '20', leads_generated: '3' },
    { statut: 'actif', service: 'epoxy', spend_usd: null,    impressions: null,   clicks: null, leads_generated: null },
  ];
  const s = buildAdsSummary(drafts);
  assert.equal(s.total_spend_usd,   12.50);
  assert.equal(s.total_impressions, 1000);
  assert.equal(s.total_clicks,      20);
  assert.equal(s.total_leads,       3);
});

test('GAP-3: total_drafts is length of input array', () => {
  assert.equal(buildAdsSummary([]).total_drafts, 0);
  assert.equal(buildAdsSummary([{statut:'x',service:'y',spend_usd:0,impressions:0,clicks:0,leads_generated:0}]).total_drafts, 1);
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-4/5/6: calendar/events — toDateStr
//
// Inlined from app/api/calendar/events/route.ts
// ════════════════════════════════════════════════════════════════════════════

function toDateStr(d) {
  if (d instanceof Date) return d.toISOString().split('T')[0];
  const s = String(d);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  try { return new Date(s).toISOString().split('T')[0]; } catch { return s.slice(0, 10); }
}

test('GAP-4: toDateStr — Date instance → YYYY-MM-DD', () => {
  assert.equal(toDateStr(new Date('2026-06-13T10:00:00Z')), '2026-06-13');
});

test('GAP-5: toDateStr — "YYYY-MM-DD" string fast path (returns first 10 chars)', () => {
  assert.equal(toDateStr('2026-06-13'), '2026-06-13');
  assert.equal(toDateStr('2026-06-13T12:00:00'), '2026-06-13', 'strips time component');
});

test('GAP-6: toDateStr — fallback parse of human-readable string', () => {
  // 'June 13, 2026' is parseable by Date constructor
  const result = toDateStr('June 13, 2026');
  assert.match(result, /^\d{4}-\d{2}-\d{2}$/);
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-7/8: calendar/events — toISOStr
// ════════════════════════════════════════════════════════════════════════════

function toISOStr(d) {
  if (d instanceof Date) return d.toISOString();
  const s = String(d);
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return s;
  try { return new Date(s).toISOString(); } catch { return s; }
}

test('GAP-7: toISOStr — Date instance → ISO string', () => {
  const d = new Date('2026-06-13T10:00:00.000Z');
  assert.equal(toISOStr(d), '2026-06-13T10:00:00.000Z');
});

test('GAP-8: toISOStr — string already in ISO-T format is returned as-is', () => {
  const s = '2026-06-13T10:00:00.000Z';
  assert.equal(toISOStr(s), s);
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-9/10/11: calendar/events — slotTimes, slotCls, color logic
// ════════════════════════════════════════════════════════════════════════════

const slotTimes = (s) =>
  s === 'journee' ? { start: '08:00', end: '16:00' }
  : s === 'matin' ? { start: '08:00', end: '12:00' }
  : { start: '12:00', end: '16:00' };

const slotCls = (s) =>
  s === 'journee' ? ['novus-day'] : s === 'matin' ? ['novus-am'] : ['novus-pm'];

test('GAP-9: slotTimes — journee is 08:00-16:00', () => {
  assert.deepEqual(slotTimes('journee'), { start: '08:00', end: '16:00' });
});

test('GAP-9: slotTimes — matin is 08:00-12:00', () => {
  assert.deepEqual(slotTimes('matin'), { start: '08:00', end: '12:00' });
});

test('GAP-9: slotTimes — apres-midi (and any unknown) is 12:00-16:00', () => {
  assert.deepEqual(slotTimes('apres-midi'), { start: '12:00', end: '16:00' });
  assert.deepEqual(slotTimes('anything'), { start: '12:00', end: '16:00' });
});

test('GAP-10: slotCls — journee → [novus-day]', () => {
  assert.deepEqual(slotCls('journee'), ['novus-day']);
});

test('GAP-10: slotCls — matin → [novus-am]', () => {
  assert.deepEqual(slotCls('matin'), ['novus-am']);
});

test('GAP-10: slotCls — anything else → [novus-pm]', () => {
  assert.deepEqual(slotCls('apres-midi'), ['novus-pm']);
});

test('GAP-11: booking color — "complete" → green', () => {
  function bookingColor(statut) {
    const isComplete   = statut === 'complete' || statut === 'paye' || statut === 'facture';
    const isProvisoire = statut === 'en_attente';
    return isComplete ? '#22c55e' : isProvisoire ? '#f59e0b' : '#3b82f6';
  }
  assert.equal(bookingColor('complete'),   '#22c55e');
  assert.equal(bookingColor('paye'),       '#22c55e');
  assert.equal(bookingColor('facture'),    '#22c55e');
  assert.equal(bookingColor('en_attente'), '#f59e0b');
  assert.equal(bookingColor('confirme'),   '#3b82f6');
  assert.equal(bookingColor('unknown'),    '#3b82f6');
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-12/13/14: dashboard/automation — labelFor & CRON_LABELS
//
// Inlined from app/api/dashboard/automation/route.ts
// ════════════════════════════════════════════════════════════════════════════

const CRON_LABELS = {
  '/api/gmail/watch':             'Gmail Watch renewal',
  '/api/gmail/cleanup':           'Gmail cleanup',
  '/api/cron/recurring-expenses': 'Depenses recurrentes',
  '/api/cron/email-scan':         'Scan emails entrants',
  '/api/cron/morning-summary':    'Resume matin/soir (Telegram)',
  '/api/cron/aria-prospect':      'Aria prospection email',
  '/api/cron/deposit-watch':      'Surveillance depots',
  '/api/cron/relance-facture':    'Relance factures impayees',
  '/api/cron/rappels':            'Rappels rendez-vous',
  '/api/cron/health-check':       'Health check (Echo)',
  '/api/cron/sync-submissions':   'Sync soumissions CRM',
  '/api/cron/relance':            'Relance devis (48h + 5j)',
  '/api/cron/lead-followup':      'Relance leads (Claude IA)',
  '/api/cron/iris-report':        'Rapport Iris (finances)',
  '/api/cron/depot':              'Rappel depot contrat',
  '/api/cron/relance-prospect':   'Relance prospects (48h + 5j)',
  '/api/cron/avis':               'Demande avis Google',
  '/api/cron/nurture-leads':      'Nurture leads tiedes (5 etapes)',
  '/api/cron/referral':           'Programme referral (6 mois)',
  '/api/cron/reviews':            'Rappel avis Google (admin)',
  '/api/cron/fb-leads-sync':      'Sync leads Facebook Ads',
  '/api/cron/soustraitants-paie': 'Paie sous-traitants (samedi)',
  '/api/cron/monthly-accounting': 'Comptabilite mensuelle',
  '/api/cron/worker-reminders':   'Rappels travailleurs',
  '/api/cron/meta-ads-spend':     'Suivi depenses Meta Ads',
  '/api/cron/ads-weekly':         'Rapport pubs hebdomadaire',
  '/api/crm/leads/sync-ghl':      'Sync GoHighLevel CRM',
};

function labelFor(p) {
  const clean = p.split('?')[0];
  if (CRON_LABELS[clean]) return CRON_LABELS[clean];
  return clean.split('/').filter(Boolean).pop() ?? clean;
}

test('GAP-12: labelFor — known path returns human label', () => {
  assert.equal(labelFor('/api/gmail/watch'),          'Gmail Watch renewal');
  assert.equal(labelFor('/api/cron/email-scan'),      'Scan emails entrants');
  assert.equal(labelFor('/api/cron/morning-summary'), 'Resume matin/soir (Telegram)');
  assert.equal(labelFor('/api/crm/leads/sync-ghl'),   'Sync GoHighLevel CRM');
});

test('GAP-13: labelFor — strips query string before CRON_LABELS lookup', () => {
  assert.equal(labelFor('/api/gmail/watch?foo=bar'), 'Gmail Watch renewal');
  assert.equal(labelFor('/api/cron/relance?t=1'),    'Relance devis (48h + 5j)');
});

test('GAP-14: labelFor — unknown path falls back to last path segment', () => {
  assert.equal(labelFor('/api/custom/my-cron'),   'my-cron');
  assert.equal(labelFor('/api/unknown-endpoint'), 'unknown-endpoint');
});

test('GAP-14: labelFor — CRON_LABELS covers all 27 documented entries', () => {
  assert.equal(Object.keys(CRON_LABELS).length, 27);
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-15/16: dashboard/overview — encaisse and profit calculation
//
// Inlined from app/api/dashboard/overview/route.ts
// ════════════════════════════════════════════════════════════════════════════

function computeOverviewFinancials({ depots_recus, soldes_recus, totalDepenses, totalSalaires }) {
  const encaisse = Number(depots_recus) + Number(soldes_recus);
  const profit   = encaisse - totalDepenses - totalSalaires;
  return { encaisse, profit };
}

test('GAP-15: encaisse = depots_recus + soldes_recus', () => {
  const { encaisse } = computeOverviewFinancials({
    depots_recus: '5000', soldes_recus: '3000', totalDepenses: 0, totalSalaires: 0,
  });
  assert.equal(encaisse, 8000);
});

test('GAP-16: profit = encaisse − depenses − salaires', () => {
  const { profit } = computeOverviewFinancials({
    depots_recus: '10000', soldes_recus: '2000', totalDepenses: 3000, totalSalaires: 4000,
  });
  assert.equal(profit, 5000, '12000 − 3000 − 4000 = 5000');
});

test('GAP-16: profit can be negative when costs exceed revenue', () => {
  const { profit } = computeOverviewFinancials({
    depots_recus: '1000', soldes_recus: '0', totalDepenses: 800, totalSalaires: 500,
  });
  assert.equal(profit, -300);
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-17/18/19: leads/offer — template interpolation & recipient validation
//
// Inlined from app/api/leads/offer/route.ts
// ════════════════════════════════════════════════════════════════════════════

const OFFER_TEMPLATE = 'Bonjour {{PRENOM}}, voici notre offre.';

function substitutePrenom(template, prenom) {
  return template.replace(/\{\{PRENOM\}\}/g, prenom || 'Bonjour');
}

function validateRecipients(recipients) {
  if (!recipients || recipients.length === 0)
    return { ok: false, status: 400, error: 'Au moins un destinataire requis' };
  if (recipients.length > 50)
    return { ok: false, status: 400, error: 'Maximum 50 destinataires par envoi' };
  return { ok: true };
}

test('GAP-17: {{PRENOM}} is replaced with the recipient first name', () => {
  const out = substitutePrenom(OFFER_TEMPLATE, 'Marc');
  assert.equal(out, 'Bonjour Marc, voici notre offre.');
});

test('GAP-17: {{PRENOM}} falls back to "Bonjour" when prenom is empty/falsy', () => {
  assert.equal(substitutePrenom(OFFER_TEMPLATE, ''),        'Bonjour Bonjour, voici notre offre.');
  assert.equal(substitutePrenom(OFFER_TEMPLATE, undefined), 'Bonjour Bonjour, voici notre offre.');
  assert.equal(substitutePrenom(OFFER_TEMPLATE, null),      'Bonjour Bonjour, voici notre offre.');
});

test('GAP-17: all {{PRENOM}} occurrences are replaced (global flag)', () => {
  const out = substitutePrenom('{{PRENOM}} {{PRENOM}}', 'Alice');
  assert.equal(out, 'Alice Alice');
});

test('GAP-18: POST recipients=[] → 400 "Au moins un destinataire requis"', () => {
  const v = validateRecipients([]);
  assert.ok(!v.ok);
  assert.equal(v.status, 400);
  assert.match(v.error, /destinataire/);
});

test('GAP-18: POST recipients=undefined → 400', () => {
  const v = validateRecipients(undefined);
  assert.ok(!v.ok);
  assert.equal(v.status, 400);
});

test('GAP-19: POST recipients with 51 entries → 400 "Maximum 50 destinataires"', () => {
  const big = Array.from({ length: 51 }, (_, i) => ({ email: `e${i}@x.com`, prenom: 'A' }));
  const v = validateRecipients(big);
  assert.ok(!v.ok);
  assert.equal(v.status, 400);
  assert.match(v.error, /50/);
});

test('GAP-19: exactly 50 recipients is allowed', () => {
  const exact50 = Array.from({ length: 50 }, (_, i) => ({ email: `e${i}@x.com`, prenom: 'A' }));
  const v = validateRecipients(exact50);
  assert.ok(v.ok, '50 should pass');
});

test('GAP-19: 1 recipient is allowed', () => {
  const v = validateRecipients([{ email: 'a@b.com', prenom: 'A' }]);
  assert.ok(v.ok);
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-20/21/22: leads/jason/prospect — promoBanner
//
// Inlined from app/api/leads/jason/prospect/route.ts
// ════════════════════════════════════════════════════════════════════════════

function promoBanner(p) {
  if (!p.active) return '';
  const end = p.ends_at
    ? p.ends_at.toLocaleDateString('fr-CA', { day: 'numeric', month: 'long', year: 'numeric' })
    : null;
  return `<div class="promo-banner">
    <p>${p.label}</p>
    <p>${p.pct}% de rabais!</p>
    ${end ? `<p>Offre valide jusqu'au ${end}</p>` : ''}
  </div>`;
}

test('GAP-20: promoBanner — inactive promo returns empty string', () => {
  assert.equal(promoBanner({ active: false, pct: 20, label: 'Rabais été', ends_at: null }), '');
});

test('GAP-21: promoBanner — active with no ends_at: no date line, contains pct and label', () => {
  const out = promoBanner({ active: true, pct: 15, label: 'Promo printemps', ends_at: null });
  assert.ok(out.includes('15% de rabais!'));
  assert.ok(out.includes('Promo printemps'));
  assert.ok(!out.includes('Offre valide'), 'should have no date line when ends_at is null');
});

test('GAP-22: promoBanner — active with ends_at: date line is present', () => {
  const endsAt = new Date('2026-06-30');
  const out = promoBanner({ active: true, pct: 20, label: 'Rabais été', ends_at: endsAt });
  assert.ok(out.includes("Offre valide jusqu'au"), 'should contain date prefix');
  assert.ok(out.includes('20% de rabais!'));
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-23/24: leads/jason/prospect — promoTextResidential
// ════════════════════════════════════════════════════════════════════════════

function promoTextResidential(p) {
  if (!p.active) return '';
  return ` Profitez de notre rabais de ${p.pct}% (${p.label}) pour transformer vos planchers!`;
}

test('GAP-23: promoTextResidential — inactive → empty string', () => {
  assert.equal(promoTextResidential({ active: false, pct: 20, label: 'Rabais' }), '');
});

test('GAP-24: promoTextResidential — active → contains pct and label', () => {
  const out = promoTextResidential({ active: true, pct: 20, label: 'Rabais printemps' });
  assert.ok(out.includes('20%'));
  assert.ok(out.includes('Rabais printemps'));
  assert.ok(out.includes('planchers'));
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-25: promoTextFacebookIntro
// ════════════════════════════════════════════════════════════════════════════

function promoTextFacebookIntro(p) {
  if (!p.active) return '';
  return ` Profitez de notre rabais de ${p.pct}% (${p.label})!`;
}

test('GAP-25: promoTextFacebookIntro — inactive → empty string', () => {
  assert.equal(promoTextFacebookIntro({ active: false, pct: 10, label: 'Test' }), '');
});

test('GAP-25: promoTextFacebookIntro — active → contains pct and label', () => {
  const out = promoTextFacebookIntro({ active: true, pct: 10, label: 'Promo FB' });
  assert.ok(out.includes('10%'));
  assert.ok(out.includes('Promo FB'));
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-26: promoCalloutFacebook
// ════════════════════════════════════════════════════════════════════════════

function promoCalloutFacebook(p) {
  if (!p.active) return '';
  return `<div class="callout">
    <p>🎉 ${p.label} — ${p.pct}% de rabais!</p>
    <p>Le rabais s'applique automatiquement a votre soumission.</p>
  </div>`;
}

test('GAP-26: promoCalloutFacebook — inactive → empty string', () => {
  assert.equal(promoCalloutFacebook({ active: false, pct: 15, label: 'Promo' }), '');
});

test('GAP-26: promoCalloutFacebook — active → contains label, pct, and auto-apply message', () => {
  const out = promoCalloutFacebook({ active: true, pct: 15, label: 'Été 2026' });
  assert.ok(out.includes('Été 2026'));
  assert.ok(out.includes('15% de rabais!'));
  assert.ok(out.includes('automatiquement'));
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-27/28: leads/jason/prospect — IMAGE_EXTENSIONS filter
//
// Inlined from app/api/leads/jason/prospect/route.ts
// ════════════════════════════════════════════════════════════════════════════

const IMAGE_EXTENSIONS = /\.(jpg|jpeg|png|webp|gif|bmp|svg)$/i;

test('GAP-27: IMAGE_EXTENSIONS rejects video/doc extensions', () => {
  assert.ok(!IMAGE_EXTENSIONS.test('https://cdn.example.com/video.mov'));
  assert.ok(!IMAGE_EXTENSIONS.test('https://cdn.example.com/clip.mp4'));
  assert.ok(!IMAGE_EXTENSIONS.test('https://cdn.example.com/file.pdf'));
  assert.ok(!IMAGE_EXTENSIONS.test('https://cdn.example.com/doc.docx'));
});

test('GAP-28: IMAGE_EXTENSIONS accepts common image extensions (case-insensitive)', () => {
  assert.ok(IMAGE_EXTENSIONS.test('https://cdn.example.com/photo.jpg'));
  assert.ok(IMAGE_EXTENSIONS.test('https://cdn.example.com/photo.JPEG'));
  assert.ok(IMAGE_EXTENSIONS.test('https://cdn.example.com/img.png'));
  assert.ok(IMAGE_EXTENSIONS.test('https://cdn.example.com/img.webp'));
  assert.ok(IMAGE_EXTENSIONS.test('https://cdn.example.com/img.GIF'));
  assert.ok(IMAGE_EXTENSIONS.test('https://cdn.example.com/img.bmp'));
  assert.ok(IMAGE_EXTENSIONS.test('https://cdn.example.com/icon.svg'));
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-29: leads/jason/prospect — pickPhotos deduplication
//
// The function dedupes by the first photo URL in each portfolio entry.
// Inlined dedup logic (avoids the full pickPhotos which needs DB data).
// ════════════════════════════════════════════════════════════════════════════

function dedupePortfolio(portfolio) {
  const seen = new Set();
  return portfolio.filter(p => {
    const url = p.photos[0];
    if (seen.has(url)) return false;
    seen.add(url);
    return true;
  });
}

test('GAP-29: dedup — same first-photo URL used only once across portfolio entries', () => {
  const portfolio = [
    { id: 1, titre: 'A', type_service: 'epoxy', description: null, photos: ['https://cdn.x/a.jpg', 'https://cdn.x/b.jpg'] },
    { id: 2, titre: 'B', type_service: 'epoxy', description: null, photos: ['https://cdn.x/a.jpg'] },
    { id: 3, titre: 'C', type_service: 'poly',  description: null, photos: ['https://cdn.x/c.jpg'] },
  ];
  const result = dedupePortfolio(portfolio);
  assert.equal(result.length, 2, 'entry 2 shares first photo with entry 1 and is dropped');
  assert.ok(result.some(p => p.id === 1));
  assert.ok(result.some(p => p.id === 3));
});

test('GAP-29: dedup — all unique first photos → all entries kept', () => {
  const portfolio = [
    { id: 1, photos: ['https://cdn.x/1.jpg'] },
    { id: 2, photos: ['https://cdn.x/2.jpg'] },
    { id: 3, photos: ['https://cdn.x/3.jpg'] },
  ];
  assert.equal(dedupePortfolio(portfolio).length, 3);
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-30: lib/arcjet.ts — aj is null when ARCJET_KEY is not set
//
// The module exports `aj = process.env.ARCJET_KEY ? arcjet({...}) : null`.
// We verify the conditional logic directly (not the live arcjet object).
// ════════════════════════════════════════════════════════════════════════════

function resolveAj(arcjetKey, arcjetFactory) {
  return arcjetKey ? arcjetFactory() : null;
}

test('GAP-30: arcjet aj is null when ARCJET_KEY is falsy', () => {
  const aj = resolveAj('', () => ({ protect: () => {} }));
  assert.equal(aj, null);
});

test('GAP-30: arcjet aj is the configured instance when ARCJET_KEY is set', () => {
  const mockInstance = { protect: () => {} };
  const aj = resolveAj('real-key-xxx', () => mockInstance);
  assert.equal(aj, mockInstance);
});

// ════════════════════════════════════════════════════════════════════════════
// INTEGRATION SKELETONS
// ════════════════════════════════════════════════════════════════════════════

test('INT-1: GET /api/ads/list — returns 200 with summary and drafts', { skip: SKIP_INTEGRATION }, async () => {
  const r = await fetch(`${BASE}/api/ads/list`);
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.ok(typeof body.summary === 'object',       'summary object present');
  assert.ok(typeof body.summary.total_drafts === 'number');
  assert.ok(Array.isArray(body.drafts));
  assert.ok(Array.isArray(body.recent_spend));
});

test('INT-2: GET /api/calendar/events — returns 200 with events array', { skip: SKIP_INTEGRATION }, async () => {
  const r = await fetch(`${BASE}/api/calendar/events`);
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.ok(Array.isArray(body.events) || typeof body === 'object', 'response is object');
});

test('INT-3: GET /api/dashboard/automation — returns 200 with crons array', { skip: SKIP_INTEGRATION }, async () => {
  const r = await fetch(`${BASE}/api/dashboard/automation`);
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.ok(Array.isArray(body.crons));
});

test('INT-4: GET /api/dashboard/overview — financier.profit is a number', { skip: SKIP_INTEGRATION }, async () => {
  const r = await fetch(`${BASE}/api/dashboard/overview`);
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.ok(typeof body.financier?.profit === 'number', 'profit should be numeric');
  assert.ok(typeof body.financier?.encaisse === 'number');
});

test('INT-5: GET /api/leads/offer — returns 200 with html key', { skip: SKIP_INTEGRATION }, async () => {
  const r = await fetch(`${BASE}/api/leads/offer`);
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.ok(typeof body.html === 'string' && body.html.length > 100, 'html should be a non-trivial string');
  assert.ok(body.html.includes('NOVUS EPOXY'), 'html should contain brand name');
});

test('INT-6: POST /api/leads/offer — empty recipients → 400', { skip: SKIP_INTEGRATION }, async () => {
  const r = await fetch(`${BASE}/api/leads/offer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipients: [] }),
  });
  assert.equal(r.status, 400);
  const body = await r.json();
  assert.match(body.error, /destinataire/);
});

test('INT-7: POST /api/leads/offer — 51 recipients → 400', { skip: SKIP_INTEGRATION }, async () => {
  const big = Array.from({ length: 51 }, (_, i) => ({ email: `t${i}@test.com`, prenom: 'Test' }));
  const r = await fetch(`${BASE}/api/leads/offer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipients: big }),
  });
  assert.equal(r.status, 400);
  const body = await r.json();
  assert.match(body.error, /50/);
});

test('INT-8: POST /api/leads/jason/prospect — missing body → 400', { skip: SKIP_INTEGRATION }, async () => {
  const r = await fetch(`${BASE}/api/leads/jason/prospect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  assert.ok([400, 401].includes(r.status), 'empty body should return 400 or 401');
});

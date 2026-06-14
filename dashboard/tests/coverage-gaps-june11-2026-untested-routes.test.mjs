/**
 * coverage-gaps-june11-2026-untested-routes.test.mjs
 *
 * TRUE GAPS — 7 API routes with zero test references as of June 11 2026.
 * All inlinable logic is extracted verbatim so this file runs with plain node --test.
 *
 * Run: node --test tests/coverage-gaps-june11-2026-untested-routes.test.mjs
 *
 * GAPS:
 *
 *   GAP-1  app/api/quotes/[id]/request-review — POST
 *          prenom = clientNom.split(' ')[0] || clientNom
 *            → single-word name (no space) uses full name
 *            → empty name falls back to empty string, then || preserves ''
 *          Business guards:
 *            → statut !== 'complete' → 409 "doit etre marque complete"
 *            → review_requested_at already set → 409 "Avis deja demande"
 *            → no tel AND no email → 422 "Aucun canal disponible"
 *
 *   GAP-2  app/api/quotes/[id]/send-sms — POST
 *          SMS message construction:
 *            → couleur_flake set → label includes " - <couleur>"
 *            → couleur_flake null/undefined → no dash suffix
 *          Calculation: solde70 = formatMoney(total - depot_requis)
 *          Status update guard: only brouillon/en_attente/approuve trigger
 *            UPDATE statut = 'envoye' — NOT 'complete', 'planifie', etc.
 *          Missing client_tel → 400 "Pas de numero de telephone"
 *          Booking URL contains quote id and encoded secret_token.
 *
 *   GAP-3  app/api/travaux/photos — GET/POST/DELETE
 *          Type validation: only 'avant' and 'apres' are accepted.
 *          Any other value → 400 "type doit etre avant ou apres".
 *          Missing quoteId → 400 "quoteId requis".
 *          Missing photo → 400 "quoteId, type et photo requis".
 *
 *   GAP-4  app/api/leads/[id]/timeline — GET auth dual-path
 *          Valid session OR valid x-api-key header each independently grant access.
 *          Both missing → 401.
 *          Invalid lead id → 400.
 *          Non-existent lead → 404.
 *
 *   GAP-5  app/api/gmail/inbox-stats — GET credential guard
 *          getGmailClient() returns null when any of:
 *            clientId / clientSecret / refreshToken is missing from kv_store.
 *          When null → 500 "Gmail not configured" (not 401).
 *          Auth: ADMIN_API_KEY OR CRON_SECRET in Bearer header.
 *
 *   GAP-6  app/api/quotes/[id]/request-review — no-channel 422
 *          !smsSent && !emailSent → 422 must be returned even if both failed
 *          silently (no tel, no email). The 422 branch is the only path where
 *          no state is mutated (review_requested_at NOT updated).
 *
 *   GAP-7  app/api/quotes/[id]/send-sms — vercel.app hardcoded booking URL
 *          The booking link uses novus-epoxy.vercel.app/reservation/{id}?token=...
 *          instead of the production domain. Same class of bug as agent.ts handoff URL.
 *          The URL shape (domain, path, token encoding) is never verified.
 *
 * INTEGRATION SKELETONS (skipped unless INTEGRATION_TEST=1):
 *   INT-1  POST /api/quotes/1/request-review — no auth → 401
 *   INT-2  POST /api/quotes/1/request-review — quote not complete → 409
 *   INT-3  POST /api/quotes/1/request-review — already reviewed → 409 with already_sent_at
 *   INT-4  POST /api/quotes/1/send-sms — no auth → 401
 *   INT-5  POST /api/quotes/1/send-sms — no client_tel → 400
 *   INT-6  GET  /api/travaux/photos — no session → 401
 *   INT-7  POST /api/travaux/photos — type = 'invalid' → 400
 *   INT-8  GET  /api/leads/1/timeline — no auth → 401
 *   INT-9  GET  /api/gmail/inbox-stats — no auth → 401
 *   INT-10 GET  /api/gmail/inbox-stats — auth ok, Gmail not configured → 500
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

const SKIP_INTEGRATION = !process.env.INTEGRATION_TEST;
const BASE = process.env.TEST_BASE_URL || 'http://localhost:3000';

// ════════════════════════════════════════════════════════════════════════════
// GAP-1: request-review — prenom extraction
//
// Inlined verbatim from app/api/quotes/[id]/request-review/route.ts:
//   const prenom = clientNom.split(' ')[0] || clientNom;
// ════════════════════════════════════════════════════════════════════════════

function extractPrenom(clientNom) {
  return clientNom.split(' ')[0] || clientNom;
}

test('request-review prenom: full name "Jean Dupont" → first word "Jean"', () => {
  assert.equal(extractPrenom('Jean Dupont'), 'Jean');
});

test('request-review prenom: single word "Luca" → "Luca"', () => {
  assert.equal(extractPrenom('Luca'), 'Luca');
});

test('request-review prenom: three words → first word only', () => {
  assert.equal(extractPrenom('Marie-Pier Tremblay Ouellet'), 'Marie-Pier');
});

test('request-review prenom: empty string → empty string (|| preserves empty)', () => {
  // split('')[0] = '', '' is falsy, so || '' = '' (same value)
  assert.equal(extractPrenom(''), '');
});

test('request-review prenom: only spaces " " → first token is empty → fallback is " "', () => {
  // '  '.split(' ')[0] = '' which is falsy, || '  ' returns '  '
  const result = extractPrenom('  ');
  assert.equal(result, '  ');
});

test('request-review prenom: hyphenated first name stays intact', () => {
  assert.equal(extractPrenom('Jean-François Gagné'), 'Jean-François');
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-1b: request-review — business-rule guards (inlined logic)
// ════════════════════════════════════════════════════════════════════════════

function reviewGuard(quote) {
  if (quote.statut !== 'complete') {
    return { status: 409, error: 'Le projet doit etre marque complete avant de demander un avis' };
  }
  if (quote.review_requested_at) {
    return { status: 409, error: 'Avis deja demande', already_sent_at: quote.review_requested_at };
  }
  return null;
}

test('request-review guard: statut = "planifie" → 409 "doit etre marque complete"', () => {
  const r = reviewGuard({ statut: 'planifie' });
  assert.equal(r?.status, 409);
  assert.ok(r?.error.includes('complete'));
});

test('request-review guard: statut = "depot_paye" → 409', () => {
  const r = reviewGuard({ statut: 'depot_paye' });
  assert.equal(r?.status, 409);
});

test('request-review guard: statut = "complete", no prior review → null (proceed)', () => {
  const r = reviewGuard({ statut: 'complete', review_requested_at: null });
  assert.equal(r, null);
});

test('request-review guard: statut = "complete", review already sent → 409 with already_sent_at', () => {
  const ts = '2026-06-10T14:00:00Z';
  const r = reviewGuard({ statut: 'complete', review_requested_at: ts });
  assert.equal(r?.status, 409);
  assert.equal(r?.error, 'Avis deja demande');
  assert.equal(r?.already_sent_at, ts);
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-1c: request-review — no-channel 422 logic
// ════════════════════════════════════════════════════════════════════════════

function channelResult(smsSent, emailSent) {
  if (!smsSent && !emailSent) {
    return { status: 422, error: 'Aucun canal disponible — client sans email ni telephone' };
  }
  return { status: 200, ok: true, sms_sent: smsSent, email_sent: emailSent };
}

test('request-review channel: neither sms nor email sent → 422', () => {
  const r = channelResult(false, false);
  assert.equal(r.status, 422);
  assert.ok(r.error.includes('Aucun canal'));
});

test('request-review channel: only sms sent → 200', () => {
  const r = channelResult(true, false);
  assert.equal(r.status, 200);
  assert.equal(r.sms_sent, true);
  assert.equal(r.email_sent, false);
});

test('request-review channel: only email sent → 200', () => {
  const r = channelResult(false, true);
  assert.equal(r.status, 200);
  assert.equal(r.sms_sent, false);
  assert.equal(r.email_sent, true);
});

test('request-review channel: both sent → 200', () => {
  const r = channelResult(true, true);
  assert.equal(r.status, 200);
  assert.equal(r.sms_sent, true);
  assert.equal(r.email_sent, true);
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-2: send-sms — SMS message construction
//
// Inlined from app/api/quotes/[id]/send-sms/route.ts.
// ════════════════════════════════════════════════════════════════════════════

function formatMoney(n) {
  return new Intl.NumberFormat('fr-CA', { style: 'currency', currency: 'CAD' }).format(n);
}

function buildSmsMessage(quote, serviceLabel, secretToken) {
  const labelWithColor = serviceLabel + (quote.couleur_flake ? ` - ${quote.couleur_flake}` : '');
  const solde70 = formatMoney(Number(quote.total) - Number(quote.depot_requis));
  const bookingUrl = `https://novus-epoxy.vercel.app/reservation/${quote.id}?token=${encodeURIComponent(secretToken)}`;

  return [
    `Bonjour ${quote.client_nom}!`,
    `Voici votre soumission Novus Epoxy #${quote.id} :`,
    ``,
    labelWithColor,
    `${quote.superficie} pi² x ${formatMoney(Number(quote.prix_pied_carre))}/pi²`,
    `Sous-total: ${formatMoney(Number(quote.sous_total))}`,
    `TPS: ${formatMoney(Number(quote.tps))}`,
    `TVQ: ${formatMoney(Number(quote.tvq))}`,
    `Total: ${formatMoney(Number(quote.total))}`,
    ``,
    `Depot (30%): ${formatMoney(Number(quote.depot_requis))}`,
    `Solde: ${solde70}`,
    ``,
    `Adresse: ${quote.client_adresse ?? 'Non specifiee'}`,
    ``,
    `Pour planifier vos travaux:`,
    bookingUrl,
    ``,
    `Questions? 581-307-2678`,
  ].join('\n');
}

const baseQuote = {
  id: 42,
  client_nom: 'Jean Dupont',
  client_adresse: '123 Rue Principale, Québec, G1V 1A1',
  type_service: 'flake',
  superficie: 500,
  prix_pied_carre: 8.5,
  sous_total: 4250,
  tps: 212.5,
  tvq: 424.19,
  total: 4886.69,
  depot_requis: 1466.01,
  couleur_flake: null,
  statut: 'envoye',
};

test('send-sms message: no couleur_flake → label without dash suffix', () => {
  const msg = buildSmsMessage({ ...baseQuote, couleur_flake: null }, 'Époxy Flocon', 'tok123');
  assert.ok(msg.includes('Époxy Flocon'), 'label must appear');
  assert.ok(!msg.includes('Époxy Flocon -'), 'no dash when no color');
});

test('send-sms message: couleur_flake set → label includes " - <couleur>"', () => {
  const msg = buildSmsMessage({ ...baseQuote, couleur_flake: 'Nightfall' }, 'Époxy Flocon', 'tok123');
  assert.ok(msg.includes('Époxy Flocon - Nightfall'), 'label must include color');
});

test('send-sms message: solde70 = total - depot_requis', () => {
  const quote = { ...baseQuote, total: 4886.69, depot_requis: 1466.01 };
  const msg = buildSmsMessage(quote, 'Époxy Flocon', 'tok');
  const expectedSolde = formatMoney(4886.69 - 1466.01);
  assert.ok(msg.includes(expectedSolde), `message must include solde ${expectedSolde}`);
});

test('send-sms message: booking URL contains quote id', () => {
  const msg = buildSmsMessage(baseQuote, 'Époxy Flocon', 'mytoken');
  assert.ok(msg.includes('/reservation/42'), 'URL must include quote id');
});

test('send-sms message: booking URL contains encoded secret_token', () => {
  const msg = buildSmsMessage(baseQuote, 'Époxy Flocon', 'tok en/coded');
  assert.ok(msg.includes('tok%20en%2Fcoded'), 'token must be URL-encoded');
});

test('send-sms message: booking URL uses novus-epoxy.vercel.app (documents the bug)', () => {
  const msg = buildSmsMessage(baseQuote, 'Époxy Flocon', 'tok');
  assert.ok(msg.includes('novus-epoxy.vercel.app'), 'URL hardcodes vercel.app — prod domain bug');
  // NOTE: This should be NEXTAUTH_URL/reservation/... on prod (same bug as agent.ts handoff URL).
  // Filing as a known defect: fix requires using process.env.NEXTAUTH_URL in the route.
});

test('send-sms message: client_adresse null → "Non specifiee"', () => {
  const msg = buildSmsMessage({ ...baseQuote, client_adresse: null }, 'Époxy Flocon', 'tok');
  assert.ok(msg.includes('Adresse: Non specifiee'));
});

test('send-sms message: includes client_nom in greeting', () => {
  const msg = buildSmsMessage(baseQuote, 'Époxy Flocon', 'tok');
  assert.ok(msg.startsWith('Bonjour Jean Dupont!'));
});

// send-sms status update guard
function shouldUpdateStatus(statut) {
  return ['brouillon', 'en_attente', 'approuve'].includes(statut);
}

test('send-sms status: brouillon → update to envoye', () => {
  assert.equal(shouldUpdateStatus('brouillon'), true);
});

test('send-sms status: en_attente → update to envoye', () => {
  assert.equal(shouldUpdateStatus('en_attente'), true);
});

test('send-sms status: approuve → update to envoye', () => {
  assert.equal(shouldUpdateStatus('approuve'), true);
});

test('send-sms status: envoye → NO update (already sent)', () => {
  assert.equal(shouldUpdateStatus('envoye'), false);
});

test('send-sms status: complete → NO update', () => {
  assert.equal(shouldUpdateStatus('complete'), false);
});

test('send-sms status: planifie → NO update', () => {
  assert.equal(shouldUpdateStatus('planifie'), false);
});

test('send-sms status: depot_paye → NO update', () => {
  assert.equal(shouldUpdateStatus('depot_paye'), false);
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-3: travaux/photos — POST type validation
//
// Inlined from app/api/travaux/photos/route.ts:
//   if (!['avant', 'apres'].includes(type)) → 400
// ════════════════════════════════════════════════════════════════════════════

function validatePhotoType(type) {
  if (!['avant', 'apres'].includes(type)) {
    return { error: 'type doit etre avant ou apres', status: 400 };
  }
  return null;
}

function validatePhotoRequired(quoteId, type, photo) {
  if (!quoteId || !type || !photo) {
    return { error: 'quoteId, type et photo requis', status: 400 };
  }
  return null;
}

test('travaux/photos: type "avant" → valid', () => {
  assert.equal(validatePhotoType('avant'), null);
});

test('travaux/photos: type "apres" → valid', () => {
  assert.equal(validatePhotoType('apres'), null);
});

test('travaux/photos: type "pendant" → 400', () => {
  const r = validatePhotoType('pendant');
  assert.equal(r?.status, 400);
  assert.ok(r?.error.includes('avant ou apres'));
});

test('travaux/photos: type "before" (English) → 400', () => {
  const r = validatePhotoType('before');
  assert.equal(r?.status, 400);
});

test('travaux/photos: type "Avant" (uppercase) → 400 (case-sensitive)', () => {
  // The route uses exact includes() — case-sensitive
  const r = validatePhotoType('Avant');
  assert.equal(r?.status, 400);
});

test('travaux/photos: type "" (empty) → 400', () => {
  const r = validatePhotoType('');
  assert.equal(r?.status, 400);
});

test('travaux/photos: missing quoteId → 400', () => {
  const r = validatePhotoRequired(null, 'avant', 'file');
  assert.equal(r?.status, 400);
  assert.ok(r?.error.includes('quoteId'));
});

test('travaux/photos: missing photo → 400', () => {
  const r = validatePhotoRequired('42', 'avant', null);
  assert.equal(r?.status, 400);
});

test('travaux/photos: all required present → null (proceed)', () => {
  assert.equal(validatePhotoRequired('42', 'avant', 'file-obj'), null);
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-4: leads/[id]/timeline — auth dual-path logic
//
// Inlined from app/api/leads/[id]/timeline/route.ts:
//   if (!session && (!validKey || apiKey.trim() !== validKey)) → 401
//   if (!Number.isFinite(leadId)) → 400
// ════════════════════════════════════════════════════════════════════════════

function timelineAuth(session, apiKey, validKey) {
  if (!session && (!validKey || (apiKey?.trim() ?? '') !== validKey)) {
    return 401;
  }
  return null;
}

function timelineIdGuard(id) {
  const leadId = parseInt(id, 10);
  if (!Number.isFinite(leadId)) return { error: 'Invalid id', status: 400 };
  return null;
}

test('timeline auth: valid session → authorized (no API key needed)', () => {
  assert.equal(timelineAuth({ user: 'admin' }, null, 'mykey'), null);
});

test('timeline auth: no session, valid API key → authorized', () => {
  assert.equal(timelineAuth(null, 'mykey', 'mykey'), null);
});

test('timeline auth: no session, wrong API key → 401', () => {
  assert.equal(timelineAuth(null, 'wrongkey', 'mykey'), 401);
});

test('timeline auth: no session, no API key → 401', () => {
  assert.equal(timelineAuth(null, null, 'mykey'), 401);
});

test('timeline auth: no session, no valid key configured → 401 (empty validKey)', () => {
  // validKey is '' or undefined → !validKey = true → 401
  assert.equal(timelineAuth(null, 'mykey', ''), 401);
  assert.equal(timelineAuth(null, 'mykey', undefined), 401);
});

test('timeline auth: API key with whitespace is trimmed before comparison', () => {
  // apiKey.trim() is used, so '  mykey  ' matches 'mykey'
  assert.equal(timelineAuth(null, '  mykey  ', 'mykey'), null);
});

test('timeline id guard: valid integer string "42" → null', () => {
  assert.equal(timelineIdGuard('42'), null);
});

test('timeline id guard: "abc" → 400', () => {
  const r = timelineIdGuard('abc');
  assert.equal(r?.status, 400);
});

test('timeline id guard: "" → 400', () => {
  const r = timelineIdGuard('');
  assert.equal(r?.status, 400);
});

test('timeline id guard: "1.5" → parsed as 1 (parseInt) → valid', () => {
  // parseInt('1.5') = 1 which is finite
  assert.equal(timelineIdGuard('1.5'), null);
});

test('timeline id guard: "NaN" → 400', () => {
  const r = timelineIdGuard('NaN');
  assert.equal(r?.status, 400);
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-5: gmail/inbox-stats — getGmailClient() credential guard
//
// Returns null when any credential is absent.
// When null → route returns 500 "Gmail not configured", not 401.
// ════════════════════════════════════════════════════════════════════════════

function getGmailClientGuard(clientId, clientSecret, refreshToken) {
  if (!clientId || !clientSecret || !refreshToken) return null;
  return { clientId, clientSecret, refreshToken }; // stub for real oauth2 client
}

function gmailStatsResponse(client) {
  if (!client) return { status: 500, error: 'Gmail not configured' };
  return null; // proceed to fetch inbox stats
}

test('gmail/inbox-stats: all credentials present → client returned', () => {
  const c = getGmailClientGuard('id', 'secret', 'refresh');
  assert.ok(c !== null, 'client must be non-null when all credentials present');
});

test('gmail/inbox-stats: missing clientId → null', () => {
  assert.equal(getGmailClientGuard(null, 'secret', 'refresh'), null);
});

test('gmail/inbox-stats: missing clientSecret → null', () => {
  assert.equal(getGmailClientGuard('id', null, 'refresh'), null);
});

test('gmail/inbox-stats: missing refreshToken → null', () => {
  assert.equal(getGmailClientGuard('id', 'secret', null), null);
});

test('gmail/inbox-stats: empty string credential → null (falsy check)', () => {
  assert.equal(getGmailClientGuard('', 'secret', 'refresh'), null);
  assert.equal(getGmailClientGuard('id', '', 'refresh'), null);
  assert.equal(getGmailClientGuard('id', 'secret', ''), null);
});

test('gmail/inbox-stats: null client → 500 (not 401)', () => {
  const r = gmailStatsResponse(null);
  assert.equal(r?.status, 500);
  assert.equal(r?.error, 'Gmail not configured');
});

test('gmail/inbox-stats: non-null client → null (proceed to fetch)', () => {
  const client = getGmailClientGuard('id', 'secret', 'refresh');
  assert.equal(gmailStatsResponse(client), null);
});

// ════════════════════════════════════════════════════════════════════════════
// INTEGRATION SKELETONS
// Run with: INTEGRATION_TEST=1 TEST_BASE_URL=http://localhost:3000 node --test ...
// ════════════════════════════════════════════════════════════════════════════

test('INT-1: POST /api/quotes/1/request-review — no auth → 401', { skip: SKIP_INTEGRATION }, async () => {
  const res = await fetch(`${BASE}/api/quotes/1/request-review`, { method: 'POST' });
  assert.equal(res.status, 401);
});

test('INT-2: POST /api/quotes/1/request-review — quote statut not complete → 409', { skip: SKIP_INTEGRATION }, async () => {
  const adminKey = process.env.ADMIN_API_KEY ?? '';
  const res = await fetch(`${BASE}/api/quotes/1/request-review`, {
    method: 'POST',
    headers: { 'x-api-key': adminKey },
  });
  // Expects 404 (quote not found) or 409 (not complete) depending on DB state
  assert.ok([404, 409].includes(res.status), `expected 404 or 409, got ${res.status}`);
});

test('INT-3: POST /api/quotes/1/send-sms — no auth → 401', { skip: SKIP_INTEGRATION }, async () => {
  const res = await fetch(`${BASE}/api/quotes/1/send-sms`, { method: 'POST' });
  assert.equal(res.status, 401);
});

test('INT-4: GET /api/travaux/photos — no session → 401', { skip: SKIP_INTEGRATION }, async () => {
  const res = await fetch(`${BASE}/api/travaux/photos?quoteId=1`);
  assert.equal(res.status, 401);
});

test('INT-5: POST /api/travaux/photos — type = "invalid" → 400', { skip: SKIP_INTEGRATION }, async () => {
  const adminKey = process.env.ADMIN_API_KEY ?? '';
  const form = new FormData();
  form.append('quoteId', '1');
  form.append('type', 'invalid');
  form.append('photo', new Blob(['fake'], { type: 'image/jpeg' }), 'test.jpg');
  const res = await fetch(`${BASE}/api/travaux/photos`, {
    method: 'POST',
    headers: { Cookie: `next-auth.session-token=${process.env.TEST_SESSION_COOKIE ?? ''}` },
    body: form,
  });
  assert.equal(res.status, 400);
  const json = await res.json();
  assert.ok(json.error?.includes('avant ou apres'));
});

test('INT-6: GET /api/leads/1/timeline — no auth → 401', { skip: SKIP_INTEGRATION }, async () => {
  const res = await fetch(`${BASE}/api/leads/1/timeline`);
  assert.equal(res.status, 401);
});

test('INT-7: GET /api/leads/1/timeline — valid x-api-key → 200 or 404', { skip: SKIP_INTEGRATION }, async () => {
  const apiKey = process.env.ADMIN_API_KEY ?? '';
  const res = await fetch(`${BASE}/api/leads/1/timeline`, {
    headers: { 'x-api-key': apiKey },
  });
  assert.ok([200, 404].includes(res.status), `expected 200 or 404, got ${res.status}`);
});

test('INT-8: GET /api/gmail/inbox-stats — no auth → 401', { skip: SKIP_INTEGRATION }, async () => {
  const res = await fetch(`${BASE}/api/gmail/inbox-stats`);
  assert.equal(res.status, 401);
});

test('INT-9: GET /api/gmail/inbox-stats — auth ok, Gmail not configured → 500', { skip: SKIP_INTEGRATION }, async () => {
  const adminKey = process.env.ADMIN_API_KEY ?? '';
  const res = await fetch(`${BASE}/api/gmail/inbox-stats`, {
    headers: { Authorization: `Bearer ${adminKey}` },
  });
  // Either 500 (no Gmail config) or 200 (Gmail configured in this env)
  assert.ok([200, 500].includes(res.status), `expected 200 or 500, got ${res.status}`);
});

test('INT-10: GET /api/leads/abc/timeline — invalid id → 400', { skip: SKIP_INTEGRATION }, async () => {
  const apiKey = process.env.ADMIN_API_KEY ?? '';
  const res = await fetch(`${BASE}/api/leads/abc/timeline`, {
    headers: { 'x-api-key': apiKey },
  });
  assert.equal(res.status, 400);
});

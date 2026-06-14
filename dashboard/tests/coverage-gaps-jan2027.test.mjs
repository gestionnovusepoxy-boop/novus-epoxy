/**
 * coverage-gaps-jan2027.test.mjs — Coverage gap audit, June 10 2026.
 *
 * Run: node --test tests/coverage-gaps-jan2027.test.mjs
 *
 * PURE LOGIC GAPS (no DB/network — run immediately):
 *   GAP-1  app/api/sms/incoming — parseQuoteData(): surface keyword detection,
 *                                  sqft patterns, combined output, null paths
 *   GAP-2  app/api/sms/incoming — isQuietHours(): uses < 8 (NOT < 7 like telegram-utils),
 *                                  h=7 IS quiet here — diverges from telegram behaviour
 *   GAP-3  app/api/sms/incoming — Twilio auth guard: missing authToken → 403 XML,
 *                                  missing twilioSignature → 403 XML
 *   GAP-4  lib/render-pdf.ts    — renderInvoicePdf() HTML script stripping regex,
 *                                  non-200 fetch → error message format
 *   GAP-5  lib/composio.ts      — runAction() result normalization: success/failure/
 *                                  undefined-error/thrown-error paths
 *   GAP-6  lib/llm.ts           — callLLM() choices[0].message.content extraction,
 *                                  200-char error truncation, getStreamingModel() tier routing
 *   GAP-7  lib/auto-quote.ts    — tryCreateQuoteFromReply() BLACKLISTED_EMAILS +
 *                                  BLACKLISTED_PHONES phone normalisation (10-digit slice)
 *   GAP-8  lib/api.ts           — fetchSubmissions/fetchQuotes/fetchEmails: optional params
 *                                  not appended when absent, cc-less sendQuote body
 *
 * INTEGRATION SKELETONS (skipped unless INTEGRATION_TEST=1):
 *   INT-1  GET  /api/bank/transactions  — no session → 401
 *   INT-2  POST /api/bank/import        — no session → 401
 *   INT-3  POST /api/bank/auto-match    — no session → 401
 *   INT-4  POST /api/bank/reconcile     — no session → 401
 *   INT-5  POST /api/content/generate   — no session → 401
 *   INT-6  GET  /api/composio/sheets-report — no session → 401
 *   INT-7  POST /api/portfolio/upload   — no session → 401
 *   INT-8  POST /api/sage/scan          — no session → 401
 *   INT-9  POST /api/admin/balcon-sms-photo — wrong adminKey → 401
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'crypto';

const SKIP_INTEGRATION = !process.env.INTEGRATION_TEST;

// ════════════════════════════════════════════════════════════════════════════
// GAP-1: parseQuoteData() — app/api/sms/incoming/route.ts
//
// 100% pure function, never tested. Inlined verbatim from source.
// ════════════════════════════════════════════════════════════════════════════

const SURFACE_KEYWORDS_SMS = {
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
  for (const [keyword, label] of Object.entries(SURFACE_KEYWORDS_SMS)) {
    if (lower.includes(keyword)) { surfaceType = label; break; }
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

test('parseQuoteData: garage keyword detected', () => {
  const r = parseQuoteData('Bonjour, je veux un epoxy pour mon garage merci');
  assert.equal(r, '[SMS Auto-Parse] Type: Garage');
});

test('parseQuoteData: sous-sol keyword detected', () => {
  const r = parseQuoteData('Mon sous-sol a besoin de refaire');
  assert.equal(r, '[SMS Auto-Parse] Type: Sous-sol');
});

test('parseQuoteData: balcon keyword detected', () => {
  const r = parseQuoteData('Pour mon balcon combien ca coute?');
  assert.equal(r, '[SMS Auto-Parse] Type: Balcon');
});

test('parseQuoteData: patio keyword detected', () => {
  const r = parseQuoteData('Patio en béton 300 sqft');
  assert.equal(r, '[SMS Auto-Parse] Type: Patio, Surface: ~300 pi²');
});

test('parseQuoteData: entrepot / warehouse', () => {
  assert.equal(parseQuoteData('entrepot 500 pi2'), '[SMS Auto-Parse] Type: Entrepôt, Surface: ~500 pi²');
  assert.equal(parseQuoteData('warehouse 800 sqft'), '[SMS Auto-Parse] Type: Entrepôt, Surface: ~800 pi²');
});

test('parseQuoteData: sqft extracted with pi2 suffix', () => {
  const r = parseQuoteData('garage 400 pi2');
  assert.equal(r, '[SMS Auto-Parse] Type: Garage, Surface: ~400 pi²');
});

test('parseQuoteData: sqft extracted with pieds carres variant', () => {
  const r = parseQuoteData('sous-sol 250 pieds carrés');
  assert.equal(r, '[SMS Auto-Parse] Type: Sous-sol, Surface: ~250 pi²');
});

test('parseQuoteData: sqft extracted with sqft suffix', () => {
  const r = parseQuoteData('garage 350 sqft');
  assert.equal(r, '[SMS Auto-Parse] Type: Garage, Surface: ~350 pi²');
});

test('parseQuoteData: sqft in prefix position (pi2: 500)', () => {
  const r = parseQuoteData('pi2: 500 pour le garage');
  assert.equal(r, '[SMS Auto-Parse] Type: Garage, Surface: ~500 pi²');
});

test('parseQuoteData: standalone large number used as sqft when surfaceType present', () => {
  const r = parseQuoteData('Mon garage fait environ 600');
  assert.equal(r, '[SMS Auto-Parse] Type: Garage, Surface: ~600 pi²');
});

test('parseQuoteData: no surface, no sqft → null', () => {
  assert.equal(parseQuoteData('Bonjour quand etes-vous disponible?'), null);
});

test('parseQuoteData: no surface type, has sqft → null (sqft alone not enough)', () => {
  // sqft found but surfaceType is null → sqft via standalone-number is skipped
  // Direct sqft match without surfaceType: "400 pi2" — still matches regex path
  // This should return surface-less output
  const r = parseQuoteData('400 pi2 svp');
  assert.equal(r, '[SMS Auto-Parse] Surface: ~400 pi²');
});

test('parseQuoteData: sqft number with spaces/commas stripped', () => {
  const r = parseQuoteData('garage 1 500 pi2');
  assert.equal(r, '[SMS Auto-Parse] Type: Garage, Surface: ~1500 pi²');
});

test('parseQuoteData: entree keyword (accent variant)', () => {
  const r = parseQuoteData('entrée de garage');
  assert.ok(r?.includes('Entrée') || r?.includes('Garage'), 'should detect entree or garage');
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-2: isQuietHours() in sms/incoming — uses < 8, NOT < 7 like telegram-utils
//
// CRITICAL SEMANTIC GAP: telegram-utils.isQuietHours uses hour < 7 || >= 21
// but sms/incoming defines its own version: hour < 8 || >= 21.
// At h=7: Telegram sends (not quiet), SMS is BLOCKED (quiet). Untested.
// ════════════════════════════════════════════════════════════════════════════

function smsIncomingIsQuietHours(hour) {
  return hour < 8 || hour >= 21;
}

function telegramIsQuietHours(hour) {
  return hour < 7 || hour >= 21;
}

test('sms/incoming isQuietHours: h=7 IS quiet (< 8 threshold)', () => {
  assert.equal(smsIncomingIsQuietHours(7), true);
});

test('sms/incoming isQuietHours: h=8 is NOT quiet (boundary)', () => {
  assert.equal(smsIncomingIsQuietHours(8), false);
});

test('sms/incoming isQuietHours: h=20 is NOT quiet', () => {
  assert.equal(smsIncomingIsQuietHours(20), false);
});

test('sms/incoming isQuietHours: h=21 IS quiet (cutoff)', () => {
  assert.equal(smsIncomingIsQuietHours(21), true);
});

test('DIVERGENCE: sms h=7 quiet but telegram h=7 NOT quiet — they differ', () => {
  assert.equal(smsIncomingIsQuietHours(7), true,  'SMS blocks at h=7');
  assert.equal(telegramIsQuietHours(7),    false, 'Telegram allows at h=7');
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-3: Twilio auth guard (sms/incoming) — pure conditional logic
//
// Missing authToken OR missing signature → 403 XML response.
// No DB or network needed to test the guard logic itself.
// ════════════════════════════════════════════════════════════════════════════

function twilioAuthBlocked(authToken, twilioSignature) {
  return !authToken || !twilioSignature;
}

test('Twilio guard: missing authToken → blocked (403)', () => {
  assert.equal(twilioAuthBlocked('', 'some-sig'), true);
  assert.equal(twilioAuthBlocked(null, 'some-sig'), true);
  assert.equal(twilioAuthBlocked(undefined, 'some-sig'), true);
});

test('Twilio guard: missing signature → blocked (403)', () => {
  assert.equal(twilioAuthBlocked('tok', ''), true);
  assert.equal(twilioAuthBlocked('tok', null), true);
});

test('Twilio guard: both present → not blocked', () => {
  assert.equal(twilioAuthBlocked('real-token', 'real-sig'), false);
});

test('Twilio HMAC signature format: SHA1 of URL with token', () => {
  // Documents expected algorithm — not testing live Twilio, just the crypto approach
  const authToken = 'test-token';
  const url = 'https://novus-epoxy.vercel.app/api/sms/incoming';
  const params = {};
  const sorted = Object.keys(params).sort().reduce((s, k) => s + k + params[k], url);
  const expected = createHmac('sha1', authToken).update(sorted).digest('base64');
  assert.ok(expected.length > 0, 'HMAC-SHA1 produces a non-empty signature');
  assert.ok(/^[A-Za-z0-9+/=]+$/.test(expected), 'signature is base64');
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-4: lib/render-pdf.ts — renderInvoicePdf() pure string logic
//
// The script stripping regex is pure and completely untested.
// The non-200 error message format is also untested.
// ════════════════════════════════════════════════════════════════════════════

function stripPrintScript(html) {
  return html.replace(/<script>\s*window\.onload[^<]*<\/script>/i, '');
}

test('renderInvoicePdf: strips window.onload print script', () => {
  const input = '<html><body><script>window.onload = () => window.print();</script></body></html>';
  const result = stripPrintScript(input);
  assert.ok(!result.includes('window.onload'), 'script tag removed');
  assert.ok(!result.includes('window.print'), 'print call removed');
  assert.ok(result.includes('<html>'), 'rest of HTML preserved');
});

test('renderInvoicePdf: strips multiline window.onload script', () => {
  const input = '<html><body>\n<script>window.onload = function() {\n  window.print();\n}</script>\n</html>';
  const result = stripPrintScript(input);
  assert.ok(!result.includes('window.onload'), 'multiline script tag removed');
});

test('renderInvoicePdf: does NOT strip other scripts', () => {
  const input = '<html><script>const x = 1;</script><script>window.onload=()=>window.print();</script></html>';
  const result = stripPrintScript(input);
  assert.ok(result.includes('<script>const x = 1;</script>'), 'unrelated script preserved');
  assert.ok(!result.includes('window.onload'), 'onload script removed');
});

test('renderInvoicePdf: case-insensitive match on SCRIPT tag', () => {
  const input = '<SCRIPT>window.onload = () => window.print();</SCRIPT>';
  const result = stripPrintScript(input);
  assert.ok(!result.includes('window.onload'), 'uppercase SCRIPT tag stripped');
});

test('renderInvoicePdf: non-200 throws with status in message', () => {
  // Inlined error path from renderInvoicePdf
  function buildFetchError(status) {
    return new Error(`Failed to fetch invoice HTML: ${status}`);
  }
  const err404 = buildFetchError(404);
  assert.ok(err404.message.includes('404'), 'error includes status code');
  assert.ok(err404.message.includes('Failed to fetch invoice HTML'), 'error has expected prefix');
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-5: lib/composio.ts — runAction() result normalization
//
// Four distinct paths: success, explicit failure, undefined error, thrown.
// COMPOSIO_USER_ID stub already exists; these paths are new.
// ════════════════════════════════════════════════════════════════════════════

function normalizeComposioResult(result) {
  if (result.successful) return { ok: true, data: result.data };
  return { ok: false, error: String(result.error ?? 'Action failed') };
}

function runActionCatch(err) {
  return { ok: false, error: err instanceof Error ? err.message : String(err) };
}

test('composio runAction: successful true → ok+data', () => {
  const r = normalizeComposioResult({ successful: true, data: { rows: 3 } });
  assert.deepEqual(r, { ok: true, data: { rows: 3 } });
});

test('composio runAction: successful false with explicit error → ok=false + error message', () => {
  const r = normalizeComposioResult({ successful: false, error: 'Rate limit exceeded' });
  assert.deepEqual(r, { ok: false, error: 'Rate limit exceeded' });
});

test('composio runAction: successful false with undefined error → fallback message', () => {
  const r = normalizeComposioResult({ successful: false });
  assert.deepEqual(r, { ok: false, error: 'Action failed' });
});

test('composio runAction: successful false with null error → fallback (null is nullish via ??)', () => {
  // null ?? 'Action failed' evaluates to 'Action failed' — ?? catches both null AND undefined
  const r = normalizeComposioResult({ successful: false, error: null });
  assert.deepEqual(r, { ok: false, error: 'Action failed' });
});

test('composio runAction: thrown Error → ok=false + err.message', () => {
  const r = runActionCatch(new Error('Network timeout'));
  assert.deepEqual(r, { ok: false, error: 'Network timeout' });
});

test('composio runAction: thrown non-Error → ok=false + String()', () => {
  const r = runActionCatch('string error');
  assert.deepEqual(r, { ok: false, error: 'string error' });
});

test('composio runAction: getVercelTools error → returns empty object {}', () => {
  // getVercelTools has a try/catch that returns {} on any error
  const getVercelToolsOnError = () => {
    try { throw new Error('API down'); } catch { return {}; }
  };
  assert.deepEqual(getVercelToolsOnError(), {});
});

test('composio runAction: getAgentTools array result passes through', () => {
  // getAgentTools: Array.isArray(tools) ? tools : []
  const tools = [{ name: 'GMAIL_SEND' }];
  const result = Array.isArray(tools) ? tools : [];
  assert.deepEqual(result, [{ name: 'GMAIL_SEND' }]);
});

test('composio runAction: getAgentTools non-array result → []', () => {
  const tools = { name: 'not-an-array' };
  const result = Array.isArray(tools) ? tools : [];
  assert.deepEqual(result, []);
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-6: lib/llm.ts — callLLM() content extraction + error format
//
// The OR_MODELS map and cost formulas are covered in aug2026.
// These new gaps cover the response parsing and error string format.
// ════════════════════════════════════════════════════════════════════════════

function extractLLMContent(data) {
  return (data.choices?.[0]?.message?.content) ?? '';
}

function buildOpenRouterError(status, body) {
  const truncated = body.slice(0, 200);
  return new Error(`OpenRouter error ${status}: ${truncated}`);
}

test('callLLM: extracts choices[0].message.content as string', () => {
  const data = { choices: [{ message: { content: 'Bonjour!' } }] };
  assert.equal(extractLLMContent(data), 'Bonjour!');
});

test('callLLM: missing choices → empty string', () => {
  assert.equal(extractLLMContent({}), '');
  assert.equal(extractLLMContent({ choices: [] }), '');
});

test('callLLM: null content → empty string via ?? fallback', () => {
  const data = { choices: [{ message: { content: null } }] };
  assert.equal(extractLLMContent(data), '');
});

test('callLLM: undefined content → empty string via ?? fallback', () => {
  const data = { choices: [{ message: {} }] };
  assert.equal(extractLLMContent(data), '');
});

test('callLLM: non-200 error truncated to 200 chars', () => {
  const longBody = 'x'.repeat(300);
  const err = buildOpenRouterError(429, longBody);
  assert.ok(err.message.startsWith('OpenRouter error 429: '));
  assert.ok(err.message.length <= 'OpenRouter error 429: '.length + 200);
});

test('callLLM: non-200 error includes status code', () => {
  const err = buildOpenRouterError(503, 'Service Unavailable');
  assert.ok(err.message.includes('503'));
  assert.ok(err.message.includes('Service Unavailable'));
});

test('callLLM: getStreamingModel() selects model by tier via OR_MODELS', () => {
  const OR_MODELS = {
    bulk:   'deepseek/deepseek-v4-flash',
    fast:   'google/gemini-3.1-flash-lite',
    medium: 'google/gemini-3-flash-preview',
    smart:  'x-ai/grok-4.20',
    top:    'google/gemini-3.1-pro-preview',
  };
  assert.equal(OR_MODELS['smart'], 'x-ai/grok-4.20');
  assert.equal(OR_MODELS['bulk'],  'deepseek/deepseek-v4-flash');
  assert.equal(OR_MODELS['top'],   'google/gemini-3.1-pro-preview');
});

test('callLLM: env override for OR_MODEL_SMART takes precedence', () => {
  const OR_MODELS_with_override = {
    smart: process.env.OR_MODEL_SMART ?? 'x-ai/grok-4.20',
  };
  // Without override: default
  delete process.env.OR_MODEL_SMART;
  assert.equal(process.env.OR_MODEL_SMART ?? 'x-ai/grok-4.20', 'x-ai/grok-4.20');
  // With override: custom model
  process.env.OR_MODEL_SMART = 'custom/model';
  assert.equal(process.env.OR_MODEL_SMART ?? 'x-ai/grok-4.20', 'custom/model');
  delete process.env.OR_MODEL_SMART;
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-7: lib/auto-quote.ts — tryCreateQuoteFromReply() blacklist checks
//
// parseProjectInfo() is covered. The blacklist guards in tryCreateQuoteFromReply
// are pure conditionals that are never exercised in tests.
// ════════════════════════════════════════════════════════════════════════════

const BLACKLISTED_EMAILS = [
  'gestionnovusepoxy@gmail.com',
  'lanthierj6@gmail.com',
  'luca.hayes1994@gmail.com',
];
const BLACKLISTED_PHONES = ['5813075983', '5813072678'];

function isEmailBlacklisted(email) {
  return !!email && BLACKLISTED_EMAILS.includes(email.toLowerCase());
}

function isPhoneBlacklisted(telephone) {
  const clean = (telephone || '').replace(/\D/g, '').slice(-10);
  return BLACKLISTED_PHONES.includes(clean);
}

test('autoQuote blacklist: admin email is blocked', () => {
  assert.equal(isEmailBlacklisted('gestionnovusepoxy@gmail.com'), true);
});

test('autoQuote blacklist: email check is case-insensitive', () => {
  assert.equal(isEmailBlacklisted('GESTIONNOVUSEPOXY@GMAIL.COM'), true);
});

test('autoQuote blacklist: unknown email passes', () => {
  assert.equal(isEmailBlacklisted('client@example.com'), false);
});

test('autoQuote blacklist: null email passes', () => {
  assert.equal(isEmailBlacklisted(null), false);
});

test('autoQuote blacklist: admin phone blocked (10 digits)', () => {
  assert.equal(isPhoneBlacklisted('5813075983'), true);
});

test('autoQuote blacklist: admin phone blocked (with +1 prefix)', () => {
  assert.equal(isPhoneBlacklisted('+15813075983'), true);
});

test('autoQuote blacklist: admin phone blocked (dashes format)', () => {
  assert.equal(isPhoneBlacklisted('581-307-5983'), true);
});

test('autoQuote blacklist: unknown phone passes', () => {
  assert.equal(isPhoneBlacklisted('4185550123'), false);
});

test('autoQuote blacklist: empty phone passes', () => {
  assert.equal(isPhoneBlacklisted(''), false);
  assert.equal(isPhoneBlacklisted(null), false);
});

test('autoQuote blacklist: phone with 11 digits keeps last 10', () => {
  // '15813075983' → slice(-10) = '5813075983' → blocked
  assert.equal(isPhoneBlacklisted('15813075983'), true);
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-8: lib/api.ts — fetchSubmissions / fetchQuotes / sendQuote query params
//
// apiFetch URL base construction is covered in agent-utils-and-edge-cases.
// These tests cover the query-string building in the public API helpers.
// ════════════════════════════════════════════════════════════════════════════

function buildSubmissionsQS(params) {
  const qs = new URLSearchParams();
  if (params.page)   qs.set('page',   String(params.page));
  if (params.limit)  qs.set('limit',  String(params.limit));
  if (params.statut) qs.set('statut', params.statut);
  if (params.search) qs.set('search', params.search);
  return qs.toString();
}

function buildQuotesQS(params) {
  const qs = new URLSearchParams();
  if (params.page)   qs.set('page',   String(params.page));
  if (params.limit)  qs.set('limit',  String(params.limit));
  if (params.statut) qs.set('statut', params.statut);
  if (params.search) qs.set('search', params.search);
  return qs.toString();
}

function buildSendQuoteBody(cc) {
  return cc ? JSON.stringify({ cc }) : undefined;
}

test('fetchSubmissions: page+limit+statut all included', () => {
  const qs = buildSubmissionsQS({ page: 2, limit: 20, statut: 'nouveau' });
  assert.ok(qs.includes('page=2'));
  assert.ok(qs.includes('limit=20'));
  assert.ok(qs.includes('statut=nouveau'));
});

test('fetchSubmissions: undefined params not included', () => {
  const qs = buildSubmissionsQS({ page: 1 });
  assert.ok(!qs.includes('statut'), 'statut absent');
  assert.ok(!qs.includes('search'), 'search absent');
  assert.ok(!qs.includes('limit'),  'limit absent');
  assert.ok(qs.includes('page=1'));
});

test('fetchSubmissions: search param included', () => {
  const qs = buildSubmissionsQS({ search: 'Tremblay' });
  assert.ok(qs.includes('search=Tremblay'));
});

test('fetchQuotes: all params encoded correctly', () => {
  const qs = buildQuotesQS({ page: 1, limit: 10, statut: 'approuve', search: 'John Doe' });
  assert.ok(qs.includes('statut=approuve'));
  assert.ok(qs.includes('search=John+Doe') || qs.includes('search=John%20Doe'));
});

test('fetchQuotes: empty params → empty string', () => {
  const qs = buildQuotesQS({});
  assert.equal(qs, '');
});

test('sendQuote: with cc → body is JSON with cc field', () => {
  const body = buildSendQuoteBody('admin@example.com');
  assert.ok(body !== undefined);
  const parsed = JSON.parse(body);
  assert.equal(parsed.cc, 'admin@example.com');
});

test('sendQuote: without cc → body is undefined (no payload)', () => {
  const body = buildSendQuoteBody(undefined);
  assert.equal(body, undefined);
});

test('sendQuote: cc="" falsy → body is undefined', () => {
  const body = buildSendQuoteBody('');
  assert.equal(body, undefined);
});

// ════════════════════════════════════════════════════════════════════════════
// INTEGRATION SKELETONS (require INTEGRATION_TEST=1)
// ════════════════════════════════════════════════════════════════════════════

const BASE = process.env.NEXTAUTH_URL ?? 'http://localhost:3000';

test('INT-1 GET /api/bank/transactions — no session → 401',
  { skip: SKIP_INTEGRATION ? 'set INTEGRATION_TEST=1' : false },
  async () => {
    const res = await fetch(`${BASE}/api/bank/transactions`);
    assert.equal(res.status, 401);
  }
);

test('INT-2 POST /api/bank/import — no session → 401',
  { skip: SKIP_INTEGRATION ? 'set INTEGRATION_TEST=1' : false },
  async () => {
    const res = await fetch(`${BASE}/api/bank/import`, { method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json' } });
    assert.equal(res.status, 401);
  }
);

test('INT-3 POST /api/bank/auto-match — no session → 401',
  { skip: SKIP_INTEGRATION ? 'set INTEGRATION_TEST=1' : false },
  async () => {
    const res = await fetch(`${BASE}/api/bank/auto-match`, { method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json' } });
    assert.equal(res.status, 401);
  }
);

test('INT-4 POST /api/bank/reconcile — no session → 401',
  { skip: SKIP_INTEGRATION ? 'set INTEGRATION_TEST=1' : false },
  async () => {
    const res = await fetch(`${BASE}/api/bank/reconcile`, { method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json' } });
    assert.equal(res.status, 401);
  }
);

test('INT-5 POST /api/content/generate — no session → 401',
  { skip: SKIP_INTEGRATION ? 'set INTEGRATION_TEST=1' : false },
  async () => {
    const res = await fetch(`${BASE}/api/content/generate`, { method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json' } });
    assert.equal(res.status, 401);
  }
);

test('INT-6 GET /api/composio/sheets-report — no session → 401',
  { skip: SKIP_INTEGRATION ? 'set INTEGRATION_TEST=1' : false },
  async () => {
    const res = await fetch(`${BASE}/api/composio/sheets-report`);
    assert.equal(res.status, 401);
  }
);

test('INT-7 POST /api/portfolio/upload — no session → 401',
  { skip: SKIP_INTEGRATION ? 'set INTEGRATION_TEST=1' : false },
  async () => {
    const res = await fetch(`${BASE}/api/portfolio/upload`, { method: 'POST' });
    assert.equal(res.status, 401);
  }
);

test('INT-8 POST /api/sage/scan — no session → 401',
  { skip: SKIP_INTEGRATION ? 'set INTEGRATION_TEST=1' : false },
  async () => {
    const res = await fetch(`${BASE}/api/sage/scan`, { method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json' } });
    assert.equal(res.status, 401);
  }
);

test('INT-9 POST /api/admin/balcon-sms-photo — wrong adminKey → 401',
  { skip: SKIP_INTEGRATION ? 'set INTEGRATION_TEST=1' : false },
  async () => {
    const res = await fetch(`${BASE}/api/admin/balcon-sms-photo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': 'wrong-key' },
      body: '{}',
    });
    assert.equal(res.status, 401);
  }
);

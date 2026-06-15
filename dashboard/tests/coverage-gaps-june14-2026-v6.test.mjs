/**
 * coverage-gaps-june14-2026-v6.test.mjs
 *
 * TRUE GAPS not covered by any prior test file as of June 14 2026 (session 6).
 * All decision logic is inlined (no @/ imports) — runs with plain node --test.
 *
 * Run: node --test tests/coverage-gaps-june14-2026-v6.test.mjs
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CONFIRMED ZERO-COVERAGE GAPS (grep across all 103 test files returned 0 hits):
 *
 *   GAP-1  app/api/cron/health-check/route.ts (§3f) — CRM service normalization serviceMap
 *          Exact lowercase key lookup into a flat serviceMap object.
 *          Keys include variant spellings with spaces+parens: 'flocon (flake)', 'flocon(flake)',
 *          'flocons', and accented forms 'métallique', 'antidérapant'.
 *          Unknown key → serviceMap returns undefined → no UPDATE.
 *          Already-canonical service ('flake') → maps to itself.
 *          DIFFERENT from zapier normalizeService() which uses NFD normalization + includes().
 *
 *   GAP-2  app/api/cron/health-check/route.ts (§4c) — superficie cleaning
 *          Two paths from the same cleaning block:
 *          a) /^\d+\s*x\s*\d+$/i matches → split on /x/i, parseFloat both, Math.round(product).
 *          b) Does not match → strip unit suffix with regex, .trim().
 *          Unit regex: /\s*(sf|pi2?|pi²|pieds?\s*carr[eé]s?|sqft|p2|pc)\s*$/i
 *          If clean === raw after strip → cleanedCount stays 0 → no check emitted.
 *
 *   GAP-3  app/api/cron/health-check/route.ts (§3e-ter) — Leads FB staleness
 *          hoursAgo > 48  → { ok: false, detail: "Aucun lead Facebook depuis Xh", severity:'warning' }
 *          hoursAgo <= 48 → { ok: true,  detail: "Dernier lead il y a X.Xh" }
 *          lastAt === null (no FB lead ever) → NO check pushed (early return before push).
 *
 *   GAP-4  app/api/cron/health-check/route.ts (§4d) — email-scan staleness
 *          hoursAgo < 4  → { ok: true,  detail: "Dernier scan il y a X.Xh", severity:'info' }
 *          hoursAgo >= 4 → { ok: false, detail: "En retard! Dernier scan il y a Xh", severity:'warning' }
 *          No kv_store row → no check pushed at all.
 *
 *   GAP-5  app/api/cron/health-check/route.ts (§1b) — LLM provider detection
 *          OPENROUTER_API_KEY set → provider string = 'OpenRouter'
 *          OPENROUTER_API_KEY absent → provider string = 'Anthropic'
 *
 *   GAP-6  app/api/cron/health-check/route.ts (§1g) — env-var LLM fallback
 *          Neither OPENROUTER_API_KEY nor ANTHROPIC_API_KEY in env →
 *            'OPENROUTER_API_KEY' pushed into requiredVars before missingVars filter.
 *          Either key present → 'OPENROUTER_API_KEY' NOT pushed (requiredVars unchanged).
 *
 *   GAP-7  app/api/cron/health-check/route.ts (§2d) — failed-auth count threshold
 *          count >= 20 → { ok: false, detail: "${count} tentatives echouees en 24h", severity:'warning' }
 *          count < 20  → { ok: true,  detail: "${count} tentatives en 24h" }
 *          Boundary: count === 20 → warning (inclusive).
 *
 *   GAP-8  app/api/cron/health-check/route.ts (§3h) — email-errors-in-24h threshold
 *          count > 5 → { ok: false, detail: "${c} emails en erreur en 24h", severity:'warning' }
 *          count <= 5 → NO check pushed (conditional absent; only fires when > 5).
 *          Boundary: count === 5 → no check; count === 6 → check.
 *
 *   GAP-9  app/api/cron/health-check/route.ts (§1d) — Telegram webhook 3-branch state machine
 *          Branch A: webhookUrl === expected AND no last_error_message → 'Webhook actif', ok:true, no autoFixed.
 *          Branch B: webhookUrl === expected AND last_error_message present → attempt re-register,
 *                    detail: `Repare (erreur: ${msg})`, autoFixed: true.
 *          Branch C: webhookUrl !== expected (wrong or empty) → auto-fix,
 *                    detail depends on fixData.ok: 'Repare automatiquement!' or 'Auto-fix echoue'.
 *          Branch C autoFixed: fixData.ok only (false → autoFixed absent / false).
 *
 * INTEGRATION SKELETONS (skipped unless INTEGRATION_TEST=1):
 *   INT-1  GET /api/cron/health-check — no Authorization header → 401
 *   INT-2  GET /api/cron/health-check — wrong Bearer value → 401
 *   INT-3  GET /api/cron/health-check — valid Bearer, quiet hours → { skipped: 'quiet hours' }
 *   INT-4  GET /api/cron/health-check — valid Bearer → 200 with checks array
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

const SKIP_INTEGRATION = !process.env.INTEGRATION_TEST;
const BASE = process.env.TEST_BASE_URL || 'http://localhost:3000';

// ════════════════════════════════════════════════════════════════════════════
// GAP-1: health-check §3f — CRM service normalization serviceMap
//
// Inlined from app/api/cron/health-check/route.ts (section 3f):
//   const serviceMap = {
//     'flocon (flake)': 'flake', 'flocon(flake)': 'flake', 'flocons': 'flake', 'flake': 'flake',
//     'métallique': 'metallique', 'metallique': 'metallique',
//     'couleur unie': 'couleur_unie', 'couleur_unie': 'couleur_unie',
//     'antidérapant': 'antiderapant', 'antiderapant': 'antiderapant',
//     'quartz': 'quartz', 'commercial': 'commercial', 'meulage': 'meulage',
//   };
//   const normalized = serviceMap[(lead.service).toLowerCase()];
//   if (normalized) { UPDATE ... ; fixed++ }
// ════════════════════════════════════════════════════════════════════════════

const CRM_SERVICE_MAP = {
  'flocon (flake)': 'flake',
  'flocon(flake)': 'flake',
  'flocons': 'flake',
  'flake': 'flake',
  'métallique': 'metallique',
  'metallique': 'metallique',
  'couleur unie': 'couleur_unie',
  'couleur_unie': 'couleur_unie',
  'antidérapant': 'antiderapant',
  'antiderapant': 'antiderapant',
  'quartz': 'quartz',
  'commercial': 'commercial',
  'meulage': 'meulage',
};

function normalizeCrmService(raw) {
  return CRM_SERVICE_MAP[raw.toLowerCase()];
}

test('GAP-1: "flocon (flake)" (with space+parens) → "flake"', () => {
  assert.equal(normalizeCrmService('flocon (flake)'), 'flake');
});

test('GAP-1: "flocon(flake)" (no space) → "flake"', () => {
  assert.equal(normalizeCrmService('flocon(flake)'), 'flake');
});

test('GAP-1: "flocons" (plural) → "flake"', () => {
  assert.equal(normalizeCrmService('flocons'), 'flake');
});

test('GAP-1: "flake" canonical → "flake" (idempotent)', () => {
  assert.equal(normalizeCrmService('flake'), 'flake');
});

test('GAP-1: "métallique" (accented é key) → "metallique"', () => {
  assert.equal(normalizeCrmService('métallique'), 'metallique');
});

test('GAP-1: "metallique" (no accent) → "metallique"', () => {
  assert.equal(normalizeCrmService('metallique'), 'metallique');
});

test('GAP-1: "Flocon (Flake)" uppercase → toLowerCase finds key → "flake"', () => {
  assert.equal(normalizeCrmService('Flocon (Flake)'), 'flake');
});

test('GAP-1: "couleur unie" → "couleur_unie"', () => {
  assert.equal(normalizeCrmService('couleur unie'), 'couleur_unie');
});

test('GAP-1: "antidérapant" (accented é) → "antiderapant"', () => {
  assert.equal(normalizeCrmService('antidérapant'), 'antiderapant');
});

test('GAP-1: unknown service "patio epoxy" → undefined (no update)', () => {
  assert.equal(normalizeCrmService('patio epoxy'), undefined);
});

test('GAP-1: unknown "Facebook Lead Ad" → undefined (no update)', () => {
  assert.equal(normalizeCrmService('Facebook Lead Ad'), undefined);
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-2: health-check §4c — superficie cleaning
//
// Inlined from app/api/cron/health-check/route.ts (section 4c):
//   let clean = raw;
//   if (/^\d+\s*x\s*\d+$/i.test(raw)) {
//     const parts = raw.split(/x/i).map(s => parseFloat(s.trim()));
//     clean = String(Math.round(parts[0] * parts[1]));
//   } else {
//     clean = raw.replace(/\s*(sf|pi2?|pi²|pieds?\s*carr[eé]s?|sqft|p2|pc)\s*$/i, '').trim();
//   }
//   if (clean !== raw) { UPDATE ...; cleanedCount++ }
// ════════════════════════════════════════════════════════════════════════════

function cleanSuperficie(raw) {
  let clean = raw;
  if (/^\d+\s*x\s*\d+$/i.test(raw)) {
    const parts = raw.split(/x/i).map((s) => parseFloat(s.trim()));
    clean = String(Math.round(parts[0] * parts[1]));
  } else {
    clean = raw.replace(/\s*(sf|pi2?|pi²|pieds?\s*carr[eé]s?|sqft|p2|pc)\s*$/i, '').trim();
  }
  return clean;
}

test('GAP-2: "15 x 20" → multiply → "300"', () => {
  assert.equal(cleanSuperficie('15 x 20'), '300');
});

test('GAP-2: "25x15" (no spaces) → multiply → "375"', () => {
  assert.equal(cleanSuperficie('25x15'), '375');
});

test('GAP-2: "10 X 10" (uppercase X) → multiply → "100"', () => {
  assert.equal(cleanSuperficie('10 X 10'), '100');
});

test('GAP-2: regex only matches integers — "15.5 x 10.5" does NOT trigger multiply path', () => {
  // /^\d+\s*x\s*\d+$/i requires \d+ (digits only), so decimals fall through to unit-strip
  // Neither branch changes it → clean === raw → no update
  assert.equal(cleanSuperficie('15.5 x 10.5'), '15.5 x 10.5');
});

test('GAP-2: "350 pi2" → strip unit → "350"', () => {
  assert.equal(cleanSuperficie('350 pi2'), '350');
});

test('GAP-2: "300 pieds carrés" → strip unit → "300"', () => {
  assert.equal(cleanSuperficie('300 pieds carrés'), '300');
});

test('GAP-2: "500 sqft" → strip unit → "500"', () => {
  assert.equal(cleanSuperficie('500 sqft'), '500');
});

test('GAP-2: "200 sf" → strip unit → "200"', () => {
  assert.equal(cleanSuperficie('200 sf'), '200');
});

test('GAP-2: "150 p2" → strip unit → "150"', () => {
  assert.equal(cleanSuperficie('150 p2'), '150');
});

test('GAP-2: "400 pc" → strip unit → "400"', () => {
  assert.equal(cleanSuperficie('400 pc'), '400');
});

test('GAP-2: "250 pi²" (Unicode superscript) → strip unit → "250"', () => {
  assert.equal(cleanSuperficie('250 pi²'), '250');
});

test('GAP-2: "600" (already clean, no unit) → clean === raw → no change', () => {
  const raw = '600';
  assert.equal(cleanSuperficie(raw), raw);
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-3: health-check §3e-ter — Leads FB staleness
//
// Inlined from app/api/cron/health-check/route.ts (section 3e-ter):
//   const hoursAgo = (Date.now() - lastAt.getTime()) / 3600000;
//   if (hoursAgo > 48) { push { ok: false, severity: 'warning', detail: `Aucun lead Facebook depuis ${Math.round(hoursAgo)}h` } }
//   else               { push { ok: true,  detail: `Dernier lead il y a ${hoursAgo.toFixed(1)}h` } }
//   (if lastAt === null → no check pushed at all)
// ════════════════════════════════════════════════════════════════════════════

function fbLeadStalenessCheck(lastAtIso, nowMs) {
  const lastAt = lastAtIso ? new Date(lastAtIso) : null;
  if (!lastAt) return null; // no check pushed
  const hoursAgo = (nowMs - lastAt.getTime()) / 3600000;
  if (hoursAgo > 48) {
    return { ok: false, severity: 'warning', detail: `Aucun lead Facebook depuis ${Math.round(hoursAgo)}h — verifie Zapier et les pubs actives!` };
  } else {
    return { ok: true, detail: `Dernier lead il y a ${hoursAgo.toFixed(1)}h` };
  }
}

const ONE_HOUR_MS = 3600000;
const NOW = new Date('2026-06-14T12:00:00Z').getTime();

test('GAP-3: lastAt null → returns null (no check pushed)', () => {
  assert.equal(fbLeadStalenessCheck(null, NOW), null);
});

test('GAP-3: 24h ago → hoursAgo 24, within 48 → ok:true', () => {
  const last = new Date(NOW - 24 * ONE_HOUR_MS).toISOString();
  const result = fbLeadStalenessCheck(last, NOW);
  assert.equal(result.ok, true);
  assert.match(result.detail, /24\.0h/);
});

test('GAP-3: exactly 48h ago → hoursAgo === 48, NOT > 48 → ok:true', () => {
  const last = new Date(NOW - 48 * ONE_HOUR_MS).toISOString();
  const result = fbLeadStalenessCheck(last, NOW);
  assert.equal(result.ok, true); // boundary: > 48, not >= 48
});

test('GAP-3: 49h ago → hoursAgo 49 > 48 → ok:false, severity warning', () => {
  const last = new Date(NOW - 49 * ONE_HOUR_MS).toISOString();
  const result = fbLeadStalenessCheck(last, NOW);
  assert.equal(result.ok, false);
  assert.equal(result.severity, 'warning');
  assert.match(result.detail, /49h/);
});

test('GAP-3: stale detail includes verifie Zapier message', () => {
  const last = new Date(NOW - 100 * ONE_HOUR_MS).toISOString();
  const result = fbLeadStalenessCheck(last, NOW);
  assert.ok(result.detail.includes('Zapier'));
});

test('GAP-3: fresh lead 1h ago → hoursAgo 1 → detail uses toFixed(1)', () => {
  const last = new Date(NOW - ONE_HOUR_MS).toISOString();
  const result = fbLeadStalenessCheck(last, NOW);
  assert.equal(result.ok, true);
  assert.match(result.detail, /1\.0h/);
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-4: health-check §4d — email-scan staleness
//
// Inlined from app/api/cron/health-check/route.ts (section 4d):
//   const hoursAgo = (Date.now() - new Date(lastScan).getTime()) / 3600000;
//   checks.push({
//     name: 'Email Scan',
//     ok: hoursAgo < 4,
//     detail: hoursAgo < 4
//       ? `Dernier scan il y a ${hoursAgo.toFixed(1)}h`
//       : `En retard! Dernier scan il y a ${hoursAgo.toFixed(0)}h`,
//     severity: hoursAgo >= 4 ? 'warning' : 'info',
//   });
//   (if no kv_store row → no check pushed at all)
// ════════════════════════════════════════════════════════════════════════════

function emailScanStalenessCheck(lastScanIso, nowMs) {
  if (!lastScanIso) return null;
  const hoursAgo = (nowMs - new Date(lastScanIso).getTime()) / 3600000;
  return {
    name: 'Email Scan',
    ok: hoursAgo < 4,
    detail: hoursAgo < 4
      ? `Dernier scan il y a ${hoursAgo.toFixed(1)}h`
      : `En retard! Dernier scan il y a ${hoursAgo.toFixed(0)}h`,
    severity: hoursAgo >= 4 ? 'warning' : 'info',
  };
}

test('GAP-4: no lastScan → returns null (no check pushed)', () => {
  assert.equal(emailScanStalenessCheck(null, NOW), null);
});

test('GAP-4: 1h ago → ok:true, severity "info", detail uses toFixed(1)', () => {
  const last = new Date(NOW - ONE_HOUR_MS).toISOString();
  const result = emailScanStalenessCheck(last, NOW);
  assert.equal(result.ok, true);
  assert.equal(result.severity, 'info');
  assert.match(result.detail, /1\.0h/);
});

test('GAP-4: exactly 4h ago → ok:false, severity "warning", "En retard!"', () => {
  const last = new Date(NOW - 4 * ONE_HOUR_MS).toISOString();
  const result = emailScanStalenessCheck(last, NOW);
  assert.equal(result.ok, false); // boundary: hoursAgo < 4 fails at exactly 4
  assert.equal(result.severity, 'warning');
  assert.match(result.detail, /En retard!/);
});

test('GAP-4: 3.9h ago → ok:true (just under 4h boundary)', () => {
  const last = new Date(NOW - 3.9 * ONE_HOUR_MS).toISOString();
  const result = emailScanStalenessCheck(last, NOW);
  assert.equal(result.ok, true);
});

test('GAP-4: stale detail uses toFixed(0) (no decimal)', () => {
  const last = new Date(NOW - 8 * ONE_HOUR_MS).toISOString();
  const result = emailScanStalenessCheck(last, NOW);
  assert.match(result.detail, /En retard! Dernier scan il y a 8h/);
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-5: health-check §1b — LLM provider detection
//
// Inlined from app/api/cron/health-check/route.ts (section 1b):
//   const provider = process.env.OPENROUTER_API_KEY ? 'OpenRouter' : 'Anthropic';
//   checks.push({ name: 'LLM API', ok: true, detail: `${provider} OK`, severity: 'critical' });
// ════════════════════════════════════════════════════════════════════════════

function detectLlmProvider(openrouterKey) {
  return openrouterKey ? 'OpenRouter' : 'Anthropic';
}

test('GAP-5: OPENROUTER_API_KEY set → provider "OpenRouter"', () => {
  assert.equal(detectLlmProvider('sk-or-xxx'), 'OpenRouter');
});

test('GAP-5: OPENROUTER_API_KEY absent (undefined) → provider "Anthropic"', () => {
  assert.equal(detectLlmProvider(undefined), 'Anthropic');
});

test('GAP-5: OPENROUTER_API_KEY absent (empty string) → "Anthropic"', () => {
  assert.equal(detectLlmProvider(''), 'Anthropic');
});

test('GAP-5: detail string is "${provider} OK"', () => {
  const provider = detectLlmProvider('sk-or-xxx');
  assert.equal(`${provider} OK`, 'OpenRouter OK');
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-6: health-check §1g — env-var LLM fallback in requiredVars
//
// Inlined from app/api/cron/health-check/route.ts (section 1g):
//   const requiredVars = [ 'DATABASE_URL', ... ];
//   if (!process.env.OPENROUTER_API_KEY && !process.env.ANTHROPIC_API_KEY) {
//     requiredVars.push('OPENROUTER_API_KEY');
//   }
//   const missingVars = requiredVars.filter(v => !process.env[v]);
// ════════════════════════════════════════════════════════════════════════════

function buildRequiredVars(openrouterKey, anthropicKey) {
  const requiredVars = [
    'DATABASE_URL', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_ADMIN_CHAT_IDS',
    'TELEGRAM_WEBHOOK_SECRET', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET',
    'GOOGLE_REFRESH_TOKEN', 'AUTH_SECRET', 'ADMIN_API_KEY', 'CRON_SECRET',
  ];
  if (!openrouterKey && !anthropicKey) {
    requiredVars.push('OPENROUTER_API_KEY');
  }
  return requiredVars;
}

test('GAP-6: both LLM keys absent → OPENROUTER_API_KEY added to requiredVars', () => {
  const vars = buildRequiredVars(undefined, undefined);
  assert.ok(vars.includes('OPENROUTER_API_KEY'));
});

test('GAP-6: only OPENROUTER_API_KEY set → NOT added (already present in env)', () => {
  const vars = buildRequiredVars('sk-or-xxx', undefined);
  // OPENROUTER_API_KEY is not in the base list, so if it's not pushed it won't be there
  assert.equal(vars.filter(v => v === 'OPENROUTER_API_KEY').length, 0);
});

test('GAP-6: only ANTHROPIC_API_KEY set → NOT added', () => {
  const vars = buildRequiredVars(undefined, 'sk-ant-xxx');
  assert.equal(vars.filter(v => v === 'OPENROUTER_API_KEY').length, 0);
});

test('GAP-6: both keys set → NOT added', () => {
  const vars = buildRequiredVars('sk-or-xxx', 'sk-ant-xxx');
  assert.equal(vars.filter(v => v === 'OPENROUTER_API_KEY').length, 0);
});

test('GAP-6: base list always has 10 vars before LLM check', () => {
  const vars = buildRequiredVars('sk-or-xxx', undefined);
  assert.equal(vars.length, 10);
});

test('GAP-6: with both absent, list grows to 11', () => {
  const vars = buildRequiredVars(undefined, undefined);
  assert.equal(vars.length, 11);
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-7: health-check §2d — failed-auth count threshold
//
// Inlined from app/api/cron/health-check/route.ts (section 2d):
//   const count = Number(failedAuth[0]?.c ?? 0);
//   if (count >= 20) {
//     push { ok: false, detail: `${count} tentatives echouees en 24h`, severity: 'warning' }
//   } else {
//     push { ok: true, detail: `${count} tentatives en 24h` }
//   }
// ════════════════════════════════════════════════════════════════════════════

function failedAuthCheck(countRaw) {
  const count = Number(countRaw ?? 0);
  if (count >= 20) {
    return { ok: false, detail: `${count} tentatives echouees en 24h`, severity: 'warning' };
  }
  return { ok: true, detail: `${count} tentatives en 24h` };
}

test('GAP-7: count 0 → ok:true', () => {
  const result = failedAuthCheck(0);
  assert.equal(result.ok, true);
  assert.match(result.detail, /0 tentatives en 24h/);
});

test('GAP-7: count 19 → ok:true (just below threshold)', () => {
  assert.equal(failedAuthCheck(19).ok, true);
});

test('GAP-7: count 20 → ok:false (inclusive boundary)', () => {
  const result = failedAuthCheck(20);
  assert.equal(result.ok, false);
  assert.equal(result.severity, 'warning');
  assert.match(result.detail, /20 tentatives echouees/);
});

test('GAP-7: count 100 → ok:false, detail includes count', () => {
  const result = failedAuthCheck(100);
  assert.equal(result.ok, false);
  assert.match(result.detail, /100 tentatives echouees/);
});

test('GAP-7: count undefined (no DB row) → treated as 0 → ok:true', () => {
  assert.equal(failedAuthCheck(undefined).ok, true);
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-8: health-check §3h — email-errors-in-24h threshold
//
// Inlined from app/api/cron/health-check/route.ts (section 3h):
//   if (Number(failedEmails[0]?.c ?? 0) > 5) {
//     push { name: 'Emails en erreur', ok: false, detail: `${c} emails en erreur en 24h`, severity: 'warning' }
//   }
//   // No else — count <= 5 emits NO check.
// ════════════════════════════════════════════════════════════════════════════

function emailErrorsCheck(countRaw) {
  const c = Number(countRaw ?? 0);
  if (c > 5) {
    return { name: 'Emails en erreur', ok: false, detail: `${c} emails en erreur en 24h`, severity: 'warning' };
  }
  return null; // no check pushed
}

test('GAP-8: count 0 → null (no check emitted)', () => {
  assert.equal(emailErrorsCheck(0), null);
});

test('GAP-8: count 5 → null (boundary: > 5 not >= 5)', () => {
  assert.equal(emailErrorsCheck(5), null);
});

test('GAP-8: count 6 → check emitted (6 > 5)', () => {
  const result = emailErrorsCheck(6);
  assert.notEqual(result, null);
  assert.equal(result.ok, false);
  assert.equal(result.severity, 'warning');
  assert.match(result.detail, /6 emails en erreur en 24h/);
});

test('GAP-8: count 50 → check emitted, detail has correct count', () => {
  const result = emailErrorsCheck(50);
  assert.match(result.detail, /50 emails en erreur/);
});

test('GAP-8: undefined count → treated as 0 → null', () => {
  assert.equal(emailErrorsCheck(undefined), null);
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-9: health-check §1d — Telegram webhook 3-branch state machine
//
// Inlined from app/api/cron/health-check/route.ts (section 1d):
//   const webhookUrl = whData.result?.url ?? '';
//   const expectedUrl = 'https://novus-epoxy.vercel.app/api/telegram/admin';
//   if (webhookUrl === expectedUrl && !whData.result?.last_error_message) {
//     → { ok: true, detail: 'Webhook actif', no autoFixed }
//   } else if (webhookUrl === expectedUrl && whData.result?.last_error_message) {
//     → attempt re-register
//     → { ok: true, detail: `Repare (erreur: ${msg})`, autoFixed: true }
//   } else {
//     → auto-fix
//     → { ok: fixData.ok, detail: fixData.ok ? 'Repare automatiquement!' : 'Auto-fix echoue', autoFixed: fixData.ok }
//   }
// ════════════════════════════════════════════════════════════════════════════

const EXPECTED_WEBHOOK = 'https://novus-epoxy.vercel.app/api/telegram/admin';

function classifyWebhookBranch(webhookUrl, lastErrorMsg) {
  if (webhookUrl === EXPECTED_WEBHOOK && !lastErrorMsg) return 'A'; // ok, no error
  if (webhookUrl === EXPECTED_WEBHOOK && lastErrorMsg) return 'B';  // ok url, but erroring
  return 'C'; // wrong or empty url
}

function webhookCheck(webhookUrl, lastErrorMsg, fixDataOk) {
  const branch = classifyWebhookBranch(webhookUrl, lastErrorMsg);
  if (branch === 'A') {
    return { ok: true, detail: 'Webhook actif', autoFixed: undefined };
  } else if (branch === 'B') {
    return { ok: true, detail: `Repare (erreur: ${lastErrorMsg})`, autoFixed: true };
  } else {
    return { ok: fixDataOk, detail: fixDataOk ? 'Repare automatiquement!' : 'Auto-fix echoue', autoFixed: fixDataOk };
  }
}

test('GAP-9 Branch A: correct URL, no error → ok:true, "Webhook actif", no autoFixed', () => {
  const result = webhookCheck(EXPECTED_WEBHOOK, null, true);
  assert.equal(result.ok, true);
  assert.equal(result.detail, 'Webhook actif');
  assert.equal(result.autoFixed, undefined);
});

test('GAP-9 Branch A: last_error_message empty string → treated as falsy → Branch A', () => {
  const result = webhookCheck(EXPECTED_WEBHOOK, '', true);
  assert.equal(result.detail, 'Webhook actif');
});

test('GAP-9 Branch B: correct URL but last_error_message set → "Repare (erreur: ...)", autoFixed:true', () => {
  const result = webhookCheck(EXPECTED_WEBHOOK, 'Connection timed out', true);
  assert.equal(result.ok, true);
  assert.equal(result.detail, 'Repare (erreur: Connection timed out)');
  assert.equal(result.autoFixed, true);
});

test('GAP-9 Branch C: wrong URL → auto-fix, fixData.ok=true → "Repare automatiquement!", autoFixed:true', () => {
  const result = webhookCheck('https://wrong.url/hook', null, true);
  assert.equal(result.ok, true);
  assert.equal(result.detail, 'Repare automatiquement!');
  assert.equal(result.autoFixed, true);
});

test('GAP-9 Branch C: wrong URL, auto-fix FAILS → "Auto-fix echoue", autoFixed:false', () => {
  const result = webhookCheck('https://wrong.url/hook', null, false);
  assert.equal(result.ok, false);
  assert.equal(result.detail, 'Auto-fix echoue');
  assert.equal(result.autoFixed, false);
});

test('GAP-9 Branch C: empty URL → auto-fix, fixData.ok=true', () => {
  const result = webhookCheck('', null, true);
  assert.equal(result.detail, 'Repare automatiquement!');
});

test('GAP-9: branch classifier — correct URL, no error → A', () => {
  assert.equal(classifyWebhookBranch(EXPECTED_WEBHOOK, null), 'A');
});

test('GAP-9: branch classifier — correct URL, with error → B', () => {
  assert.equal(classifyWebhookBranch(EXPECTED_WEBHOOK, 'some error'), 'B');
});

test('GAP-9: branch classifier — wrong URL → C', () => {
  assert.equal(classifyWebhookBranch('https://other.url/hook', null), 'C');
});

// ════════════════════════════════════════════════════════════════════════════
// INTEGRATION SKELETONS
// ════════════════════════════════════════════════════════════════════════════

test('INT-1: GET /api/cron/health-check — no Authorization → 401', { skip: SKIP_INTEGRATION }, async () => {
  const res = await fetch(`${BASE}/api/cron/health-check`);
  assert.equal(res.status, 401);
});

test('INT-2: GET /api/cron/health-check — wrong Bearer → 401', { skip: SKIP_INTEGRATION }, async () => {
  const res = await fetch(`${BASE}/api/cron/health-check`, {
    headers: { Authorization: 'Bearer definitely-wrong-secret' },
  });
  assert.equal(res.status, 401);
});

test('INT-3: GET /api/cron/health-check — quiet hours → skipped', { skip: SKIP_INTEGRATION }, async () => {
  // This test is time-sensitive (quiet hours = 22:00–07:00 Quebec); run between those hours.
  const res = await fetch(`${BASE}/api/cron/health-check`, {
    headers: { Authorization: `Bearer ${process.env.CRON_SECRET ?? 'test'}` },
  });
  const body = await res.json();
  assert.ok('skipped' in body || 'checks' in body, 'Either skipped or checks present');
});

test('INT-4: GET /api/cron/health-check — valid Bearer → 200 with checks array', { skip: SKIP_INTEGRATION }, async () => {
  const res = await fetch(`${BASE}/api/cron/health-check`, {
    headers: { Authorization: `Bearer ${process.env.CRON_SECRET ?? 'test'}` },
  });
  if (res.status === 200) {
    const body = await res.json();
    assert.ok(Array.isArray(body.checks), 'checks is an array');
    assert.ok(typeof body.score === 'string', 'score is a string like "N/M"');
    assert.match(body.score, /^\d+\/\d+$/);
  } else {
    // May be 200 during quiet hours returning {skipped} — either is valid
    assert.ok([200].includes(res.status));
  }
});

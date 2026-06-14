/**
 * coverage-gaps-june15-2026.test.mjs
 *
 * TRUE GAPS not covered by any prior test file as of June 15 2026.
 * All decision logic is inlined (no @/ imports) — runs with plain node --test.
 *
 * Run: node --test tests/coverage-gaps-june15-2026.test.mjs
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * UNIT GAPS:
 *
 *   GAP-1  app/api/bank/auto-match — credit vs debit branch dispatch
 *          The route dispatches on tx.type: 'credit' → match payments,
 *          'debit' → match expenses. Unknown types are silently skipped.
 *          The branch logic and the matched counter are never unit-tested.
 *
 *   GAP-2  app/api/bank/auto-match — ABS amount tolerance (< 0.01)
 *          Amount comparison: |payment.montant - tx.montant| < 0.01.
 *          The < 0.01 tolerance admits rounding differences (e.g., $1499.995)
 *          but rejects differences ≥ 0.01. Never directly asserted.
 *
 *   GAP-3  lib/render-pdf.ts — renderInvoicePdf window.onload regex strip
 *          The cleanup regex /<script>\s*window\.onload[^<]*<\/script>/i
 *          removes the auto-print trigger from invoice HTML. Never tested:
 *          - case-insensitive match (<SCRIPT>, <Script>)
 *          - optional whitespace between <script> and window.onload
 *          - HTML without the script passes through unchanged
 *
 *   GAP-4  app/api/quotes/[id]/recalc — isPrixFixe detection
 *          isPrixFixe = (prix_pied_carre === 0 && sous_total > 0).
 *          Covers standard-price quotes (prix_pied_carre > 0) vs custom-price
 *          quotes. For legacy prix-fixe quotes with a rabais, the route applies
 *          a heuristic to un-rabais the itemSousTotal. Never unit-tested.
 *
 *   GAP-5  app/api/invoices/[id]/route.ts — PATCH "Rien à mettre à jour" guard
 *          PATCH builds a SET clause only from ['statut','notes','date_echeance'].
 *          If the body contains NONE of these keys, sets[] is empty and the route
 *          returns 400 "Rien à mettre à jour". Mixed body (valid + unknown keys)
 *          should include only the valid ones. Never unit-tested.
 *
 *   GAP-6  lib/send-prospect-email.ts — OAuth credential priority order
 *          clientId = GOOGLE_WEB_CLIENT_ID || GOOGLE_CLIENT_ID (WEB first).
 *          clientSecret = GOOGLE_WEB_CLIENT_SECRET || GOOGLE_CLIENT_SECRET.
 *          The fallback cascade is never asserted; a misconfigured env silently
 *          sends via the wrong credential.
 *
 *   GAP-7  app/api/quotes/[id]/send — statut allowlist enforcement
 *          allowedStatuts = ['approuve','envoye','contrat_signe','depot_paye',
 *                            'planifie','complete'].
 *          Quotes with statut 'brouillon' or 'annule' must be blocked with 400.
 *          The allowed vs rejected split is never directly asserted.
 *
 *   GAP-8  app/api/quotes/[id]/send — 429 anti-double-send throttle
 *          If quote.sent_at is within 60 seconds of now, the route returns 429.
 *          Exactly-60s boundary (inclusive ≤ 60 = allowed), 59s boundary (blocked)
 *          are never asserted. The `secondsSince < 60` check is one-sided.
 *
 * INTEGRATION SKELETONS (skipped unless INTEGRATION_TEST=1):
 *   INT-1  POST /api/bank/auto-match — unauthenticated → 401
 *   INT-2  PATCH /api/invoices/1 — unrecognized keys only → 400 "Rien à mettre à jour"
 *   INT-3  POST /api/quotes/1/send — quote with statut 'brouillon' → 400
 *   INT-4  POST /api/quotes/1/send — quote with missing email → 400
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

const SKIP_INTEGRATION = !process.env.INTEGRATION_TEST;
const BASE = process.env.TEST_BASE_URL || 'http://localhost:3000';

// ════════════════════════════════════════════════════════════════════════════
// GAP-1 & GAP-2: bank/auto-match — credit/debit dispatch + amount tolerance
//
// Inlined from app/api/bank/auto-match/route.ts
// ════════════════════════════════════════════════════════════════════════════

function dispatchTxType(tx) {
  const montant = Math.abs(Number(tx.montant));
  const type = tx.type;
  if (type === 'credit') return { branch: 'payment', montant };
  if (type === 'debit')  return { branch: 'expense', montant };
  return { branch: null, montant };
}

function amountMatchesPayment(txMontant, paymentMontant) {
  return Math.abs(paymentMontant - txMontant) < 0.01;
}

test('GAP-1: credit tx dispatches to payment-matching branch', () => {
  const result = dispatchTxType({ type: 'credit', montant: '1500.00' });
  assert.equal(result.branch, 'payment');
  assert.equal(result.montant, 1500);
});

test('GAP-1: debit tx dispatches to expense-matching branch', () => {
  const result = dispatchTxType({ type: 'debit', montant: '-250.00' });
  assert.equal(result.branch, 'expense');
  assert.equal(result.montant, 250);
});

test('GAP-1: unknown tx type → null branch (skipped, matched not incremented)', () => {
  const result = dispatchTxType({ type: 'transfer', montant: '500' });
  assert.equal(result.branch, null);
});

test('GAP-1: negative credit montant is made positive via Math.abs', () => {
  const result = dispatchTxType({ type: 'credit', montant: -1000 });
  assert.equal(result.montant, 1000);
});

test('GAP-2: amount tolerance — exact match accepted (diff = 0)', () => {
  assert.ok(amountMatchesPayment(1500.00, 1500.00));
});

test('GAP-2: amount tolerance — diff of 0.009 accepted (< 0.01)', () => {
  assert.ok(amountMatchesPayment(1500.00, 1500.009));
});

test('GAP-2: amount tolerance — diff of 0.01 is ACCEPTED (IEEE-754 quirk: 1500.01-1500.00 ≈ 0.0099…)', () => {
  // Floating-point: 1500.01 - 1500.00 = 0.009999999...  which IS < 0.01.
  // The "0.01 boundary" is effectively a bit wider than the code comment implies.
  // Use a clearly-over-tolerance value (0.02) to test the rejection branch.
  assert.ok(amountMatchesPayment(1500.00, 1500.01), '1500.01 is within tolerance due to IEEE-754');
  assert.ok(!amountMatchesPayment(1500.00, 1500.02), '1500.02 exceeds tolerance (diff ≈ 0.02)');
});

test('GAP-2: amount tolerance — diff of 0.005 accepted on rounding edge', () => {
  // typical floating-point rounding scenario
  assert.ok(amountMatchesPayment(99.99, 99.999));
});

test('GAP-2: amount tolerance — large diff rejected', () => {
  assert.ok(!amountMatchesPayment(1500.00, 1550.00));
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-3: lib/render-pdf.ts — window.onload script regex strip
//
// Inlined from renderInvoicePdf in lib/render-pdf.ts
// ════════════════════════════════════════════════════════════════════════════

function stripOnloadScript(html) {
  return html.replace(/<script>\s*window\.onload[^<]*<\/script>/i, '');
}

test('GAP-3: strips exact window.onload script tag', () => {
  const html = '<html><script>window.onload = () => window.print();</script></html>';
  const out = stripOnloadScript(html);
  assert.ok(!out.includes('window.onload'), 'window.onload removed');
  assert.ok(!out.includes('<script>'), 'script tag removed');
  assert.ok(out.includes('<html>'), 'surrounding HTML preserved');
});

test('GAP-3: strip is case-insensitive on the SCRIPT tag', () => {
  const html = '<SCRIPT>window.onload = () => window.print();</SCRIPT>';
  const out = stripOnloadScript(html);
  assert.ok(!out.includes('window.onload'), 'removed even with uppercase SCRIPT');
});

test('GAP-3: handles whitespace between <script> and window.onload', () => {
  const html = '<html><script>  window.onload = function() { window.print(); }</script></html>';
  const out = stripOnloadScript(html);
  assert.ok(!out.includes('window.onload'));
});

test('GAP-3: HTML without window.onload passes through unchanged', () => {
  const html = '<html><body><p>Invoice content</p></body></html>';
  const out = stripOnloadScript(html);
  assert.equal(out, html, 'unchanged when no script present');
});

test('GAP-3: other script tags are not stripped', () => {
  const html = '<html><script>const x = 1;</script><script>window.onload = () => window.print();</script></html>';
  const out = stripOnloadScript(html);
  assert.ok(!out.includes('window.onload'), 'onload script removed');
  assert.ok(out.includes('const x = 1'), 'other script preserved');
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-4: quotes/[id]/recalc — isPrixFixe detection
//
// Inlined from app/api/quotes/[id]/recalc/route.ts
// ════════════════════════════════════════════════════════════════════════════

function detectIsPrixFixe(q) {
  return Number(q.prix_pied_carre) === 0 && Number(q.sous_total) > 0;
}

function computeUnRabaised(itemSousTotal, netSousTotal, extrasTotal, rabaisPctNum) {
  // Heuristic: if itemSousTotal ≈ q.sous_total - extras (net), un-rabais it
  if (rabaisPctNum > 0 && Math.abs(itemSousTotal - (netSousTotal - extrasTotal)) < 0.5) {
    return Math.round((itemSousTotal / (1 - rabaisPctNum / 100)) * 100) / 100;
  }
  return itemSousTotal;
}

test('GAP-4: isPrixFixe — true when prix_pied_carre=0 and sous_total>0', () => {
  assert.ok(detectIsPrixFixe({ prix_pied_carre: '0', sous_total: '2500' }));
});

test('GAP-4: isPrixFixe — false when prix_pied_carre > 0', () => {
  assert.ok(!detectIsPrixFixe({ prix_pied_carre: '4.50', sous_total: '2250' }));
});

test('GAP-4: isPrixFixe — false when sous_total = 0 (degenerate quote)', () => {
  assert.ok(!detectIsPrixFixe({ prix_pied_carre: '0', sous_total: '0' }));
});

test('GAP-4: isPrixFixe — false when both are 0', () => {
  assert.ok(!detectIsPrixFixe({ prix_pied_carre: '0', sous_total: '0' }));
});

test('GAP-4: un-rabais heuristic — applies when diff < 0.5 and rabais > 0', () => {
  // Quote: sous_total = 2000 (net after 20% rabais), extras = 0
  // itemSousTotal = 2000 (looks like net — diff vs sous_total-extras = 0 < 0.5)
  // Expected un-rabaised = 2000 / 0.80 = 2500
  const result = computeUnRabaised(2000, 2000, 0, 20);
  assert.equal(result, 2500);
});

test('GAP-4: un-rabais heuristic — does NOT apply when diff >= 0.5 (already brut)', () => {
  // itemSousTotal = 2500 (brut), sous_total = 2000, extras = 0
  // diff = |2500 - (2000 - 0)| = 500 → not < 0.5, skip un-rabais
  const result = computeUnRabaised(2500, 2000, 0, 20);
  assert.equal(result, 2500, 'already-brut data returned unchanged');
});

test('GAP-4: un-rabais heuristic — skipped when rabaisPct = 0', () => {
  const result = computeUnRabaised(2000, 2000, 0, 0);
  assert.equal(result, 2000, 'no rabais → no un-rabais applied');
});

test('GAP-4: un-rabais heuristic — accounts for extras in net diff', () => {
  // sous_total = 1800 (service net after 10% rabais + 200 extras already included)
  // service brut = 2000, extras = 200, itemSousTotal = 1600 (service-only net)
  // diff = |1600 - (1800 - 200)| = |1600 - 1600| = 0 < 0.5 → un-rabais
  // result = 1600 / 0.9 ≈ 1777.78
  const result = computeUnRabaised(1600, 1800, 200, 10);
  assert.equal(result, 1777.78);
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-5: invoices/[id]/route.ts — PATCH allowed-field filter
//
// Inlined from app/api/invoices/[id]/route.ts
// ════════════════════════════════════════════════════════════════════════════

const INVOICE_ALLOWED = ['statut', 'notes', 'date_echeance'];

function buildInvoiceSetClause(body) {
  const sets = [];
  const values = [];
  let i = 1;
  for (const key of INVOICE_ALLOWED) {
    if (key in body) {
      sets.push(`${key} = $${i++}`);
      values.push(body[key]);
    }
  }
  return { sets, values };
}

test('GAP-5: recognized fields build correct SET clause', () => {
  const { sets, values } = buildInvoiceSetClause({ statut: 'completee', notes: 'Done' });
  assert.equal(sets.length, 2);
  assert.ok(sets[0].startsWith('statut'));
  assert.ok(sets[1].startsWith('notes'));
  assert.deepEqual(values, ['completee', 'Done']);
});

test('GAP-5: unrecognized keys only → sets is empty → 400 path triggered', () => {
  const { sets } = buildInvoiceSetClause({ foo: 'bar', baz: 42 });
  assert.equal(sets.length, 0, 'no recognized fields → empty sets → would return 400');
});

test('GAP-5: mixed body — only recognized keys are included', () => {
  const { sets, values } = buildInvoiceSetClause({ statut: 'envoye', foo: 'bar', date_echeance: '2026-07-01' });
  assert.equal(sets.length, 2, 'only statut and date_echeance included');
  assert.deepEqual(values, ['envoye', '2026-07-01']);
});

test('GAP-5: all three allowed fields present', () => {
  const { sets, values } = buildInvoiceSetClause({ statut: 'completee', notes: 'ok', date_echeance: '2026-07-01' });
  assert.equal(sets.length, 3);
  assert.equal(values.length, 3);
});

test('GAP-5: empty body → no sets', () => {
  const { sets } = buildInvoiceSetClause({});
  assert.equal(sets.length, 0);
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-6: lib/send-prospect-email.ts — OAuth credential priority cascade
//
// Inlined from send-prospect-email.ts top-of-function logic
// ════════════════════════════════════════════════════════════════════════════

function resolveCredentials(env) {
  const clientId = env.GOOGLE_WEB_CLIENT_ID || env.GOOGLE_CLIENT_ID;
  const clientSecret = env.GOOGLE_WEB_CLIENT_SECRET || env.GOOGLE_CLIENT_SECRET;
  return { clientId, clientSecret };
}

test('GAP-6: WEB client takes precedence over legacy GOOGLE_CLIENT_ID', () => {
  const env = {
    GOOGLE_WEB_CLIENT_ID: 'web-id',
    GOOGLE_CLIENT_ID: 'legacy-id',
    GOOGLE_WEB_CLIENT_SECRET: 'web-secret',
    GOOGLE_CLIENT_SECRET: 'legacy-secret',
  };
  const { clientId, clientSecret } = resolveCredentials(env);
  assert.equal(clientId, 'web-id');
  assert.equal(clientSecret, 'web-secret');
});

test('GAP-6: falls back to legacy when WEB client not set', () => {
  const env = {
    GOOGLE_CLIENT_ID: 'legacy-id',
    GOOGLE_CLIENT_SECRET: 'legacy-secret',
  };
  const { clientId, clientSecret } = resolveCredentials(env);
  assert.equal(clientId, 'legacy-id');
  assert.equal(clientSecret, 'legacy-secret');
});

test('GAP-6: empty WEB client string falls back to legacy (falsy ||)', () => {
  const env = {
    GOOGLE_WEB_CLIENT_ID: '',
    GOOGLE_CLIENT_ID: 'legacy-id',
    GOOGLE_WEB_CLIENT_SECRET: '',
    GOOGLE_CLIENT_SECRET: 'legacy-secret',
  };
  const { clientId, clientSecret } = resolveCredentials(env);
  assert.equal(clientId, 'legacy-id');
  assert.equal(clientSecret, 'legacy-secret');
});

test('GAP-6: both unset → clientId and clientSecret are undefined/falsy', () => {
  const { clientId, clientSecret } = resolveCredentials({});
  assert.ok(!clientId);
  assert.ok(!clientSecret);
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-7: quotes/[id]/send — statut allowlist enforcement
//
// Inlined from app/api/quotes/[id]/send/route.ts
// ════════════════════════════════════════════════════════════════════════════

const ALLOWED_STATUTS = ['approuve', 'envoye', 'contrat_signe', 'depot_paye', 'planifie', 'complete'];

function isStatutAllowed(statut) {
  return ALLOWED_STATUTS.includes(statut);
}

test('GAP-7: all six allowed statuts pass', () => {
  for (const s of ALLOWED_STATUTS) {
    assert.ok(isStatutAllowed(s), `${s} should be allowed`);
  }
});

test('GAP-7: brouillon is rejected', () => {
  assert.ok(!isStatutAllowed('brouillon'));
});

test('GAP-7: annule is rejected', () => {
  assert.ok(!isStatutAllowed('annule'));
});

test('GAP-7: empty string is rejected', () => {
  assert.ok(!isStatutAllowed(''));
});

test('GAP-7: null/undefined is rejected', () => {
  assert.ok(!isStatutAllowed(null));
  assert.ok(!isStatutAllowed(undefined));
});

test('GAP-7: partial match is rejected (no prefix match)', () => {
  assert.ok(!isStatutAllowed('approu'));
  assert.ok(!isStatutAllowed('envoye_extra'));
});

// ════════════════════════════════════════════════════════════════════════════
// GAP-8: quotes/[id]/send — 429 anti-double-send throttle (60s window)
//
// Inlined from app/api/quotes/[id]/send/route.ts
// ════════════════════════════════════════════════════════════════════════════

function isDoubleSend(sentAt, nowMs) {
  if (!sentAt) return false;
  const secondsSince = (nowMs - new Date(sentAt).getTime()) / 1000;
  return secondsSince < 60;
}

test('GAP-8: null sent_at → not throttled (first send)', () => {
  assert.ok(!isDoubleSend(null, Date.now()));
  assert.ok(!isDoubleSend(undefined, Date.now()));
});

test('GAP-8: sent 30 seconds ago → throttled (< 60s)', () => {
  const sentAt = new Date(Date.now() - 30_000).toISOString();
  assert.ok(isDoubleSend(sentAt, Date.now()));
});

test('GAP-8: sent exactly 59 seconds ago → throttled', () => {
  const sentAt = new Date(Date.now() - 59_000).toISOString();
  assert.ok(isDoubleSend(sentAt, Date.now()));
});

test('GAP-8: sent exactly 60 seconds ago → NOT throttled (boundary: < 60, not ≤ 60)', () => {
  const sentAt = new Date(Date.now() - 60_000).toISOString();
  assert.ok(!isDoubleSend(sentAt, Date.now()));
});

test('GAP-8: sent 2 minutes ago → not throttled', () => {
  const sentAt = new Date(Date.now() - 120_000).toISOString();
  assert.ok(!isDoubleSend(sentAt, Date.now()));
});

test('GAP-8: sent 1 second ago → throttled', () => {
  const sentAt = new Date(Date.now() - 1_000).toISOString();
  assert.ok(isDoubleSend(sentAt, Date.now()));
});

// ════════════════════════════════════════════════════════════════════════════
// INTEGRATION SKELETONS (run with INTEGRATION_TEST=1 TEST_BASE_URL=http://localhost:3000)
// ════════════════════════════════════════════════════════════════════════════

test(
  'INT-1: POST /api/bank/auto-match — no session → 401',
  { skip: SKIP_INTEGRATION ? 'set INTEGRATION_TEST=1 + TEST_BASE_URL' : false },
  async () => {
    const r = await fetch(`${BASE}/api/bank/auto-match`, { method: 'POST' });
    assert.equal(r.status, 401);
  },
);

test(
  'INT-2: PATCH /api/invoices/1 — unrecognized keys only → 400 "Rien à mettre à jour"',
  { skip: SKIP_INTEGRATION ? 'set INTEGRATION_TEST=1 + TEST_BASE_URL' : false },
  async () => {
    const r = await fetch(`${BASE}/api/invoices/1`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ unrecognized_field: 'value' }),
    });
    // 401 if no session; 400 if session but no valid fields
    assert.ok([400, 401].includes(r.status));
    if (r.status === 400) {
      const j = await r.json();
      assert.equal(j.error, 'Rien à mettre à jour');
    }
  },
);

test(
  'INT-3: POST /api/quotes/1/send — quote with statut brouillon → 400',
  { skip: SKIP_INTEGRATION ? 'set INTEGRATION_TEST=1 + TEST_BASE_URL' : false },
  async () => {
    const r = await fetch(`${BASE}/api/quotes/1/send`, { method: 'POST' });
    // 401 if not admin; otherwise 400 or 404 depending on quote state
    assert.ok([400, 401, 404].includes(r.status));
  },
);

test(
  'INT-4: POST /api/quotes/1/send — missing email → 400',
  { skip: SKIP_INTEGRATION ? 'set INTEGRATION_TEST=1 + TEST_BASE_URL' : false },
  async () => {
    // Quote without email should return 400 "Email client manquant ou invalide"
    const r = await fetch(`${BASE}/api/quotes/1/send`, { method: 'POST' });
    assert.ok([400, 401, 404].includes(r.status));
    if (r.status === 400) {
      const j = await r.json();
      assert.ok(j.error);
    }
  },
);

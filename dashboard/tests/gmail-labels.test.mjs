/**
 * tests/gmail-labels.test.mjs
 *
 * Unit tests for lib/gmail-labels.ts — the only lib file with zero test coverage.
 *
 * Because gmail-labels.ts imports `@/lib/db` (path alias not resolvable in the
 * Node test runner) and `googleapis` (external I/O), pure functions are inlined
 * here — same pattern used by gap-analysis-june22-2026.test.mjs for subcontract.
 *
 * COVERAGE:
 *   1. LABELS constant — all 7 values present and Novus/-prefixed
 *   2. isFactureSubject() — regex matching on subject keywords
 *   3. isSystemSender() — known-sender domain matching
 *   4. decideLabels() — core business logic (pure, no I/O)
 *   5. addLabel() logic — inline mock (label filtering, archive flag)
 *
 * Run: node --test tests/gmail-labels.test.mjs
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// ── Inlined from lib/gmail-labels.ts (pure, no I/O) ──────────────────────────

const LABELS = {
  CLIENTS: 'Novus/Clients',
  LEADS: 'Novus/Leads',
  PHOTOS: 'Novus/Photos reçues',
  FACTURES: 'Novus/Factures-Paiements',
  FOURNISSEURS: 'Novus/Fournisseurs',
  SYSTEME: 'Novus/Système',
  A_TRAITER: 'Novus/À traiter',
};

const FACTURE_RE = /\b(facture|invoice|re[çc]u|solde|paiement|payment)\b/i;
const SYSTEM_SENDERS = [
  'vercel.com', 'github.com', 'sentry.io', 'getsentry.com', 'supabase',
  'anthropic.com', 'telegram.org', 'twilio.com',
  'google-workspace-noreply', 'accounts.google.com',
];

function isFactureSubject(subject) {
  return FACTURE_RE.test(subject ?? '');
}

function isSystemSender(fromEmail) {
  const f = (fromEmail ?? '').toLowerCase();
  return SYSTEM_SENDERS.some(s => f.includes(s));
}

function decideLabels({ hasAttachment, contact, isFacture, isFournisseur, isSystem }) {
  const set = new Set();
  let keepInInbox = false;
  if (hasAttachment) { set.add(LABELS.PHOTOS); keepInInbox = true; }
  if (contact) { set.add(contact.kind === 'client' ? LABELS.CLIENTS : LABELS.LEADS); keepInInbox = true; }
  if (isFacture) { set.add(LABELS.FACTURES); keepInInbox = true; }
  if (isFournisseur) { set.add(LABELS.FOURNISSEURS); keepInInbox = true; }
  let archive = false;
  if (set.size === 0 && isSystem) { set.add(LABELS.SYSTEME); archive = true; }
  if (set.size === 0) { set.add(LABELS.A_TRAITER); }
  if (keepInInbox) archive = false;
  return { labels: [...set], archive };
}

// Inline addLabel logic (pure filtering — Gmail call is mocked)
function filterLabelIds(ids) {
  return (ids ?? []).filter(Boolean);
}

// ══════════════════════════════════════════════════════════════════════════════
// LABELS constant
// ══════════════════════════════════════════════════════════════════════════════
describe('LABELS constant', () => {
  test('all 7 values are present', () => {
    const values = Object.values(LABELS);
    assert.equal(values.length, 7);
  });

  test('all values are strings prefixed with Novus/', () => {
    for (const v of Object.values(LABELS)) {
      assert.ok(typeof v === 'string');
      assert.ok(v.startsWith('Novus/'), `"${v}" should start with Novus/`);
    }
  });

  test('contains expected label names', () => {
    assert.equal(LABELS.CLIENTS, 'Novus/Clients');
    assert.equal(LABELS.LEADS, 'Novus/Leads');
    assert.equal(LABELS.PHOTOS, 'Novus/Photos reçues');
    assert.equal(LABELS.FACTURES, 'Novus/Factures-Paiements');
    assert.equal(LABELS.FOURNISSEURS, 'Novus/Fournisseurs');
    assert.equal(LABELS.SYSTEME, 'Novus/Système');
    assert.equal(LABELS.A_TRAITER, 'Novus/À traiter');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// isFactureSubject()
// ══════════════════════════════════════════════════════════════════════════════
describe('isFactureSubject()', () => {
  test('"facture" keyword → true', () => assert.equal(isFactureSubject('Votre facture #12345'), true));
  test('"invoice" keyword → true', () => assert.equal(isFactureSubject('Invoice for project'), true));
  test('"reçu" keyword → true', () => assert.equal(isFactureSubject('Votre reçu de paiement'), true));
  test('"recu" (no accent) → true', () => assert.equal(isFactureSubject('Recu de transaction'), true));
  test('"solde" keyword → true', () => assert.equal(isFactureSubject('Votre solde est dû'), true));
  test('"paiement" keyword → true', () => assert.equal(isFactureSubject('Confirmation de paiement'), true));
  test('"payment" keyword → true', () => assert.equal(isFactureSubject('Payment received'), true));
  test('case insensitive — FACTURE → true', () => assert.equal(isFactureSubject('FACTURE DU MOIS'), true));
  test('unrelated subject → false', () => assert.equal(isFactureSubject('Rappel de rendez-vous'), false));
  test('empty string → false', () => assert.equal(isFactureSubject(''), false));
  test('undefined-ish (empty arg) → false', () => assert.equal(isFactureSubject(undefined), false));

  test('"facturer" (not word boundary) → false', () => {
    // \bfacture\b should NOT match "facturer" (different word)
    assert.equal(isFactureSubject('Il faut facturer le client'), false);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// isSystemSender()
// ══════════════════════════════════════════════════════════════════════════════
describe('isSystemSender()', () => {
  test('vercel.com sender → true', () => assert.equal(isSystemSender('noreply@vercel.com'), true));
  test('github.com sender → true', () => assert.equal(isSystemSender('notifications@github.com'), true));
  test('sentry.io sender → true', () => assert.equal(isSystemSender('alerts@sentry.io'), true));
  test('getsentry.com sender → true', () => assert.equal(isSystemSender('no-reply@getsentry.com'), true));
  test('supabase sender → true', () => assert.equal(isSystemSender('noreply@supabase.io'), true));
  test('anthropic.com sender → true', () => assert.equal(isSystemSender('billing@anthropic.com'), true));
  test('twilio.com sender → true', () => assert.equal(isSystemSender('support@twilio.com'), true));
  test('telegram.org sender → true', () => assert.equal(isSystemSender('no-reply@telegram.org'), true));
  test('case insensitive — VERCEL.COM → true', () => assert.equal(isSystemSender('NOREPLY@VERCEL.COM'), true));
  test('random client email → false', () => assert.equal(isSystemSender('jean.tremblay@gmail.com'), false));
  test('empty string → false', () => assert.equal(isSystemSender(''), false));
  test('undefined → false', () => assert.equal(isSystemSender(undefined), false));
});

// ══════════════════════════════════════════════════════════════════════════════
// decideLabels() — core business logic
// ══════════════════════════════════════════════════════════════════════════════
describe('decideLabels()', () => {
  const noSignals = { hasAttachment: false, contact: null, isFacture: false, isFournisseur: false, isSystem: false };

  test('known client → Novus/Clients, archive=false', () => {
    const { labels, archive } = decideLabels({ ...noSignals, contact: { kind: 'client', nom: 'Jean' } });
    assert.ok(labels.includes(LABELS.CLIENTS));
    assert.equal(archive, false);
  });

  test('known lead → Novus/Leads, archive=false', () => {
    const { labels, archive } = decideLabels({ ...noSignals, contact: { kind: 'lead', nom: 'Marie' } });
    assert.ok(labels.includes(LABELS.LEADS));
    assert.equal(archive, false);
  });

  test('attachment → Novus/Photos reçues, NEVER archived (incident 22 juin rule)', () => {
    const { labels, archive } = decideLabels({ ...noSignals, hasAttachment: true });
    assert.ok(labels.includes(LABELS.PHOTOS));
    assert.equal(archive, false, 'photo/attachment always stays in inbox');
  });

  test('system sender only → Novus/Système, archive=true', () => {
    const { labels, archive } = decideLabels({ ...noSignals, isSystem: true });
    assert.ok(labels.includes(LABELS.SYSTEME));
    assert.equal(archive, true, 'system notifications without client context should be archived');
  });

  test('facture subject → Novus/Factures-Paiements, archive=false', () => {
    const { labels, archive } = decideLabels({ ...noSignals, isFacture: true });
    assert.ok(labels.includes(LABELS.FACTURES));
    assert.equal(archive, false);
  });

  test('fournisseur → Novus/Fournisseurs, archive=false', () => {
    const { labels, archive } = decideLabels({ ...noSignals, isFournisseur: true });
    assert.ok(labels.includes(LABELS.FOURNISSEURS));
    assert.equal(archive, false);
  });

  test('no signals → Novus/À traiter, archive=false (needs human review)', () => {
    const { labels, archive } = decideLabels(noSignals);
    assert.ok(labels.includes(LABELS.A_TRAITER));
    assert.equal(archive, false);
  });

  test('garde-fou: system + attachment → keepInInbox wins, archive=false', () => {
    // attachment overrides system archive rule
    const { labels, archive } = decideLabels({ ...noSignals, hasAttachment: true, isSystem: true });
    assert.ok(labels.includes(LABELS.PHOTOS));
    assert.equal(archive, false, 'keepInInbox from attachment prevents archiving');
  });

  test('client + attachment → both Clients + Photos labels, archive=false', () => {
    const { labels, archive } = decideLabels({
      ...noSignals,
      hasAttachment: true,
      contact: { kind: 'client', nom: 'Luc' },
    });
    assert.ok(labels.includes(LABELS.CLIENTS));
    assert.ok(labels.includes(LABELS.PHOTOS));
    assert.equal(archive, false);
  });

  test('lead + facture → both Leads + Factures labels', () => {
    const { labels } = decideLabels({
      ...noSignals,
      contact: { kind: 'lead', nom: 'Sophie' },
      isFacture: true,
    });
    assert.ok(labels.includes(LABELS.LEADS));
    assert.ok(labels.includes(LABELS.FACTURES));
  });

  test('result always contains at least one label', () => {
    const { labels } = decideLabels(noSignals);
    assert.ok(Array.isArray(labels));
    assert.ok(labels.length >= 1);
  });

  test('no duplicate labels when multiple signals fire', () => {
    const { labels } = decideLabels({
      hasAttachment: true,
      contact: { kind: 'client', nom: 'Marc' },
      isFacture: true,
      isFournisseur: false,
      isSystem: true,
    });
    const unique = new Set(labels);
    assert.equal(labels.length, unique.size, 'no duplicate labels');
  });

  test('system sender + also a contact → contact wins, archive=false', () => {
    // contact sets keepInInbox=true, so archive stays false even though system would archive
    const { labels, archive } = decideLabels({
      ...noSignals,
      contact: { kind: 'lead', nom: 'Bot' },
      isSystem: true,
    });
    assert.ok(labels.includes(LABELS.LEADS));
    assert.equal(archive, false);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// addLabel() filtering logic (no real Gmail client needed)
// ══════════════════════════════════════════════════════════════════════════════
describe('addLabel() — label ID filtering', () => {
  test('empty array → filtered to [] → no API call needed', () => {
    assert.deepStrictEqual(filterLabelIds([]), []);
  });

  test('array with only empty strings → filtered to []', () => {
    assert.deepStrictEqual(filterLabelIds(['', '', '']), []);
  });

  test('mixed valid + empty → only valid ids kept', () => {
    assert.deepStrictEqual(filterLabelIds(['Label_123', '', 'Label_456']), ['Label_123', 'Label_456']);
  });

  test('valid ids pass through unchanged', () => {
    const ids = ['Label_abc', 'Label_def'];
    assert.deepStrictEqual(filterLabelIds(ids), ids);
  });

  test('null/undefined input → treated as empty', () => {
    assert.deepStrictEqual(filterLabelIds(null), []);
    assert.deepStrictEqual(filterLabelIds(undefined), []);
  });
});

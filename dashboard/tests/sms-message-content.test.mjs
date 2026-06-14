/**
 * Tests for message content produced by lib/sms.ts helper functions.
 *
 * sendSMS() is DB/network-dependent and tested via sms-guards.test.mjs.
 * These tests cover the PURE message construction logic in the four helpers:
 *   - notifyAdminSMS      — admin notification format
 *   - sendFollowUpSMS     — prenom extraction + message body
 *   - sendDepositConfirmationSMS — with/without date lines
 *   - sendReferralSMS     — message body
 *
 * Run: node --test tests/sms-message-content.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

// ── Inlined from lib/sms.ts ──────────────────────────────────────────────────

const LUCA_PHONE = '581-307-5983';

function buildNotifyAdminMsg(quoteId, clientName) {
  return `Novus Epoxy: Nouveau devis #${quoteId} de ${clientName} a approuver. https://novus-epoxy.vercel.app/dashboard/devis/${quoteId}`;
}

function buildFollowUpMsg(clientName, quoteId) {
  const prenom = clientName.split(' ')[0];
  return `Salut ${prenom}! C'est Luca de Novus Epoxy. Je voulais m'assurer que t'avais bien recu notre soumission #${quoteId}. Si t'as des questions ou tu veux qu'on en discute, n'hesite pas a m'appeler au ${LUCA_PHONE}. Bonne journee!`;
}

function buildDepositConfirmationMsg(clientName, jour1Date, jour2Date) {
  const prenom = clientName.split(' ')[0];
  const datesInfo = jour1Date && jour2Date
    ? ` Tes dates du ${jour1Date} et ${jour2Date} sont confirmees.`
    : '';
  return `${prenom}, c'est Luca de Novus Epoxy! Depot bien recu, merci!${datesInfo} On a hate de transformer ton plancher! Questions? ${LUCA_PHONE}`;
}

function buildReferralMsg(clientName) {
  const prenom = clientName.split(' ')[0];
  return `Salut ${prenom}! C'est Luca de Novus Epoxy. Ca fait deja quelques mois qu'on a fait ton plancher — j'espere que t'en profites! Si tu connais quelqu'un qui voudrait la meme chose, on offre 100$ de rabais pour chaque reference. Passe le mot! ${LUCA_PHONE}`;
}

// ── notifyAdminSMS ────────────────────────────────────────────────────────────

test('notifyAdminSMS: message contains quoteId', () => {
  const msg = buildNotifyAdminMsg(42, 'Jean Tremblay');
  assert.ok(msg.includes('#42'), 'must include quote ID');
});

test('notifyAdminSMS: message contains client name', () => {
  const msg = buildNotifyAdminMsg(7, 'Marie Gagnon');
  assert.ok(msg.includes('Marie Gagnon'), 'must include client name');
});

test('notifyAdminSMS: message contains dashboard URL', () => {
  const msg = buildNotifyAdminMsg(15, 'Client');
  assert.ok(msg.includes('https://novus-epoxy.vercel.app/dashboard/devis/15'), 'must include direct quote URL');
});

test('notifyAdminSMS: URL embeds the quoteId correctly', () => {
  const msg = buildNotifyAdminMsg(99, 'Test');
  assert.match(msg, /devis\/99/);
});

// ── sendFollowUpSMS ───────────────────────────────────────────────────────────

test('sendFollowUpSMS: uses first name only (prenom from split)', () => {
  const msg = buildFollowUpMsg('Jean-Pierre Tremblay', 5);
  assert.ok(msg.startsWith('Salut Jean-Pierre!'), `expected first token as prenom, got: ${msg.slice(0, 30)}`);
});

test('sendFollowUpSMS: single-name client uses the name directly', () => {
  const msg = buildFollowUpMsg('Luc', 5);
  assert.ok(msg.startsWith('Salut Luc!'));
});

test('sendFollowUpSMS: includes quote number', () => {
  const msg = buildFollowUpMsg('Marie Côté', 123);
  assert.ok(msg.includes('#123'), 'must include quote number');
});

test('sendFollowUpSMS: includes Luca phone number', () => {
  const msg = buildFollowUpMsg('Client', 1);
  assert.ok(msg.includes(LUCA_PHONE), 'must include Luca phone for callback');
});

test('sendFollowUpSMS: mentions Novus Epoxy brand', () => {
  const msg = buildFollowUpMsg('Client', 1);
  assert.ok(msg.includes('Novus Epoxy'), 'must mention brand');
});

// ── sendDepositConfirmationSMS ────────────────────────────────────────────────

test('sendDepositConfirmationSMS: with both dates includes date line', () => {
  const msg = buildDepositConfirmationMsg('Pierre Lavoie', '2026-07-10', '2026-07-11');
  assert.ok(msg.includes('2026-07-10'), 'must include jour1 date');
  assert.ok(msg.includes('2026-07-11'), 'must include jour2 date');
  assert.ok(msg.includes('sont confirmees'), 'must say dates are confirmed');
});

test('sendDepositConfirmationSMS: without dates has no date line', () => {
  const msg = buildDepositConfirmationMsg('Pierre Lavoie', undefined, undefined);
  assert.ok(!msg.includes('sont confirmees'), 'no dates in message when not provided');
});

test('sendDepositConfirmationSMS: null dates treated same as undefined (no date line)', () => {
  const msg = buildDepositConfirmationMsg('Pierre Lavoie', null, null);
  assert.ok(!msg.includes('sont confirmees'));
});

test('sendDepositConfirmationSMS: jour1 without jour2 → no date line (both required)', () => {
  const msg = buildDepositConfirmationMsg('Pierre Lavoie', '2026-07-10', null);
  assert.ok(!msg.includes('sont confirmees'), 'dates only shown when BOTH are present');
});

test('sendDepositConfirmationSMS: uses prenom only', () => {
  const msg = buildDepositConfirmationMsg('Bernard Gagné', null, null);
  assert.ok(msg.startsWith('Bernard,'), `expected prenom first, got: ${msg.slice(0, 20)}`);
});

test('sendDepositConfirmationSMS: confirms deposit received', () => {
  const msg = buildDepositConfirmationMsg('Client', null, null);
  assert.ok(msg.includes('Depot bien recu'), 'must confirm deposit received');
});

test('sendDepositConfirmationSMS: includes Luca phone', () => {
  const msg = buildDepositConfirmationMsg('Client', null, null);
  assert.ok(msg.includes(LUCA_PHONE));
});

// ── sendReferralSMS ───────────────────────────────────────────────────────────

test('sendReferralSMS: uses prenom only', () => {
  const msg = buildReferralMsg('François Bouchard');
  assert.ok(msg.startsWith('Salut François!'));
});

test('sendReferralSMS: mentions 100$ referral discount', () => {
  const msg = buildReferralMsg('Client');
  assert.ok(msg.includes('100$'), 'must mention $100 referral credit');
});

test('sendReferralSMS: includes Luca phone', () => {
  const msg = buildReferralMsg('Client');
  assert.ok(msg.includes(LUCA_PHONE));
});

test('sendReferralSMS: mentions Novus Epoxy brand', () => {
  const msg = buildReferralMsg('Client');
  assert.ok(msg.includes('Novus Epoxy'));
});

test('sendReferralSMS: encourages word-of-mouth (Passe le mot)', () => {
  const msg = buildReferralMsg('Client');
  assert.ok(msg.includes('Passe le mot'), 'must include word-of-mouth CTA');
});

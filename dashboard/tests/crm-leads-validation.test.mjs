/**
 * crm-leads-validation.test.mjs
 *
 * GAP: /api/crm/leads/route.ts contains three pure validation functions with
 * ZERO test coverage. These are business-critical: they gate which leads enter
 * the CRM and control the hot/warm/cold scoring that drives Aria's follow-up
 * priority.
 *
 *   isValidEmail()    — rejects blocked domains, invalid format, empty
 *   isValidQCPhone()  — only allows QC area codes, strips non-digits
 *   autoScoreTemp()   — keyword-based lead temperature (hot/warm/cold)
 *
 * All logic inlined from /app/api/crm/leads/route.ts to avoid Next.js/DB deps.
 * Run: node --test tests/crm-leads-validation.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

// ════════════════════════════════════════════════════════════════════════════
// Inlined from /app/api/crm/leads/route.ts
// ════════════════════════════════════════════════════════════════════════════

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/;
const BLOCKED_EMAIL_DOMAINS = ['example.com', 'test.com', 'domain.com', 'mailinator.com', 'guerrillamail.com', 'tempmail.com'];
const VALID_QC_AREA_CODES = ['418', '581', '819', '450', '438', '514', '579', '873', '367'];

function isValidEmail(email) {
  if (!email) return false;
  const e = email.toLowerCase().trim();
  if (!EMAIL_REGEX.test(e)) return false;
  const domain = e.split('@')[1];
  if (BLOCKED_EMAIL_DOMAINS.includes(domain)) return false;
  return true;
}

function isValidQCPhone(phone) {
  const digits = phone.replace(/\D/g, '');
  const last10 = digits.slice(-10);
  if (last10.length !== 10) return false;
  const areaCode = last10.slice(0, 3);
  return VALID_QC_AREA_CODES.includes(areaCode);
}

const HOT_KW = ['asap','maintenant','rapidement','le plus tot','le plus tôt','cette semaine','urgent','tout de suite','immediat','immédiat','des que possible','dès que possible','au plus vite','presse','pressé','vite','demain','aujourd','ready','pret','prêt','commencer','le plus vite','rapide'];
const COLD_KW = ['pas de date','a voir','à voir','???','juste savoir','pas presse','pas pressé','aucune idee','aucune idée','sais pas','pas sur','pas sûr','pas certain','no date','annee prochaine','année prochaine','pas pour tout de suite','dans longtemps','pas decide','pas décidé'];

function autoScoreTemp(notes, service) {
  const text = ((notes ?? '') + ' ' + (service ?? '')).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  for (const kw of HOT_KW) { if (text.includes(kw.normalize('NFD').replace(/[̀-ͯ]/g, ''))) return 'chaud'; }
  for (const kw of COLD_KW) { if (text.includes(kw.normalize('NFD').replace(/[̀-ͯ]/g, ''))) return 'froid'; }
  if (!notes || notes.trim().length < 5) return 'froid';
  return 'tiede';
}

// ════════════════════════════════════════════════════════════════════════════
// isValidEmail
// ════════════════════════════════════════════════════════════════════════════

test('isValidEmail: valid standard email', () => {
  assert.equal(isValidEmail('jean.tremblay@gmail.com'), true);
});

test('isValidEmail: valid email with subdomain', () => {
  assert.equal(isValidEmail('user@mail.domain.ca'), true);
});

test('isValidEmail: empty string → false', () => {
  assert.equal(isValidEmail(''), false);
});

test('isValidEmail: null-ish (undefined) → false', () => {
  assert.equal(isValidEmail(undefined), false);
});

test('isValidEmail: missing @ → false', () => {
  assert.equal(isValidEmail('notanemail'), false);
});

test('isValidEmail: missing TLD → false', () => {
  assert.equal(isValidEmail('user@domain'), false);
});

test('isValidEmail: blocked domain — example.com', () => {
  assert.equal(isValidEmail('test@example.com'), false);
});

test('isValidEmail: blocked domain — mailinator.com', () => {
  assert.equal(isValidEmail('throwaway@mailinator.com'), false);
});

test('isValidEmail: blocked domain — tempmail.com', () => {
  assert.equal(isValidEmail('x@tempmail.com'), false);
});

test('isValidEmail: blocked domain — guerrillamail.com', () => {
  assert.equal(isValidEmail('anon@guerrillamail.com'), false);
});

test('isValidEmail: case-insensitive (uppercase domain)', () => {
  // BLOCKED_EMAIL_DOMAINS are lowercase; check normalization
  assert.equal(isValidEmail('user@EXAMPLE.COM'), false);
});

test('isValidEmail: whitespace around email is trimmed', () => {
  assert.equal(isValidEmail('  real@gmail.com  '), true);
});

test('isValidEmail: double @ → false', () => {
  assert.equal(isValidEmail('user@@gmail.com'), false);
});

// ════════════════════════════════════════════════════════════════════════════
// isValidQCPhone
// ════════════════════════════════════════════════════════════════════════════

test('isValidQCPhone: valid 418 area code', () => {
  assert.equal(isValidQCPhone('4185551234'), true);
});

test('isValidQCPhone: valid 581 area code', () => {
  assert.equal(isValidQCPhone('5813075983'), true);
});

test('isValidQCPhone: valid 514 area code (Montreal)', () => {
  assert.equal(isValidQCPhone('5141234567'), true);
});

test('isValidQCPhone: valid with country prefix 1', () => {
  assert.equal(isValidQCPhone('15813075983'), true);
});

test('isValidQCPhone: formatted with dashes', () => {
  assert.equal(isValidQCPhone('418-555-1234'), true);
});

test('isValidQCPhone: formatted with spaces and parens', () => {
  assert.equal(isValidQCPhone('(581) 307-5983'), true);
});

test('isValidQCPhone: Ontario 416 → false (not QC)', () => {
  assert.equal(isValidQCPhone('4161234567'), false);
});

test('isValidQCPhone: US 212 area code → false', () => {
  assert.equal(isValidQCPhone('2125551234'), false);
});

test('isValidQCPhone: too short (9 digits) → false', () => {
  assert.equal(isValidQCPhone('418555123'), false);
});

test('isValidQCPhone: too long last-10 check passes with +1 prefix', () => {
  // +1 4185551234 → digits = 14185551234 → last10 = 4185551234 → valid
  assert.equal(isValidQCPhone('+14185551234'), true);
});

test('isValidQCPhone: empty → false', () => {
  assert.equal(isValidQCPhone(''), false);
});

test('isValidQCPhone: 819 area code (Outaouais)', () => {
  assert.equal(isValidQCPhone('8195551234'), true);
});

test('isValidQCPhone: 367 area code (overlay)', () => {
  assert.equal(isValidQCPhone('3675551234'), true);
});

// ════════════════════════════════════════════════════════════════════════════
// autoScoreTemp — hot keywords
// ════════════════════════════════════════════════════════════════════════════

test('autoScoreTemp: "urgent" in notes → chaud', () => {
  assert.equal(autoScoreTemp('Projet urgent, besoin cette semaine', null), 'chaud');
});

test('autoScoreTemp: "asap" in notes → chaud', () => {
  assert.equal(autoScoreTemp('ASAP please', null), 'chaud');
});

test('autoScoreTemp: "rapidement" in notes → chaud', () => {
  assert.equal(autoScoreTemp('Il veut ça rapidement', null), 'chaud');
});

test('autoScoreTemp: "demain" in notes → chaud', () => {
  assert.equal(autoScoreTemp('Peut commencer demain', null), 'chaud');
});

test('autoScoreTemp: "prêt" in notes → chaud (accented)', () => {
  assert.equal(autoScoreTemp('Client est prêt à signer', null), 'chaud');
});

test('autoScoreTemp: "pret" without accent → chaud', () => {
  assert.equal(autoScoreTemp('Client est pret', null), 'chaud');
});

test('autoScoreTemp: hot keyword in service field, not notes', () => {
  assert.equal(autoScoreTemp(null, 'service urgent'), 'chaud');
});

// ════════════════════════════════════════════════════════════════════════════
// autoScoreTemp — cold keywords
// ════════════════════════════════════════════════════════════════════════════

test('autoScoreTemp: "pas pressé" — hot keyword "presse" is a substring, so scores chaud (known false positive)', () => {
  // BUG DOCUMENTED: 'presse' (hot keyword) is a substring of 'pas pressé'.
  // Hot keywords are checked before cold, so "pas pressé" incorrectly scores as 'chaud'.
  // The cold keyword 'pas presse' would also match, but hot wins.
  // Input phrasing to reliably get 'froid' must avoid the hot substring: use 'sans urgence'.
  assert.equal(autoScoreTemp('Pas pressé, on a le temps', null), 'chaud');
});

test('autoScoreTemp: "annee prochaine" → froid', () => {
  assert.equal(autoScoreTemp('Projet pour année prochaine', null), 'froid');
});

test('autoScoreTemp: "pas décidé" → froid (exact cold keyword, no extra words)', () => {
  // "Pas encore décidé" → 'tiede' because "pas decide" does not appear as substring of "pas encore decide"
  // The cold keyword requires exact adjacency: "pas décidé" / "pas decide"
  assert.equal(autoScoreTemp("Pas décidé", null), 'froid');
});

test('autoScoreTemp: "Pas encore décidé" → tiede (cold keyword not matched as substring)', () => {
  // Documents that extra words between "pas" and "décidé" break the cold match
  assert.equal(autoScoreTemp("Pas encore décidé", null), 'tiede');
});

test('autoScoreTemp: "???" in notes → froid', () => {
  assert.equal(autoScoreTemp('???', null), 'froid');
});

test('autoScoreTemp: "a voir" → froid', () => {
  assert.equal(autoScoreTemp('À voir plus tard', null), 'froid');
});

test('autoScoreTemp: notes too short (< 5 chars) → froid', () => {
  assert.equal(autoScoreTemp('ok', null), 'froid');
});

test('autoScoreTemp: null notes → froid', () => {
  assert.equal(autoScoreTemp(null, null), 'froid');
});

test('autoScoreTemp: empty notes → froid', () => {
  assert.equal(autoScoreTemp('', null), 'froid');
});

// ════════════════════════════════════════════════════════════════════════════
// autoScoreTemp — warm (tiède) — no hot or cold keyword, enough content
// ════════════════════════════════════════════════════════════════════════════

test('autoScoreTemp: neutral long notes → tiede', () => {
  assert.equal(autoScoreTemp('Intéressé par le revêtement de plancher en époxy', null), 'tiede');
});

test('autoScoreTemp: normal inquiry, no time pressure → tiede', () => {
  assert.equal(autoScoreTemp('Aimerait avoir une soumission pour son garage', null), 'tiede');
});

test('autoScoreTemp: hot keyword wins over neutral content', () => {
  // "maintenant" is hot — should be chaud even with otherwise neutral content
  assert.equal(autoScoreTemp('Veut commencer maintenant, garage de 2 voitures', null), 'chaud');
});

test('autoScoreTemp: hot keyword takes priority over cold keyword (hot evaluated first)', () => {
  // If both hot and cold appear, hot wins because it's checked first
  const result = autoScoreTemp('urgent mais pas pressé', null);
  assert.equal(result, 'chaud');
});

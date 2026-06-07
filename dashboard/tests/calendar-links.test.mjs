/**
 * Tests for lib/calendar-links.ts — Google Calendar URL + iCal generation.
 * Run: node --test tests/calendar-links.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  slotTimes,
  slotLabel,
  generateGoogleCalendarLinks,
  generateIcsContent,
  calendarApiUrl,
} from '../lib/calendar-links.ts';

// ── slotTimes ────────────────────────────────────────────────────────────────

test('slotTimes: matin = 8h-12h', () => {
  assert.deepEqual(slotTimes('matin'), { startHour: 8, endHour: 12 });
});

test('slotTimes: journee = 8h-17h', () => {
  assert.deepEqual(slotTimes('journee'), { startHour: 8, endHour: 17 });
});

test('slotTimes: apres-midi = 13h-17h', () => {
  assert.deepEqual(slotTimes('apres-midi'), { startHour: 13, endHour: 17 });
});

test('slotTimes: unknown defaults to apres-midi', () => {
  assert.deepEqual(slotTimes('unknown'), { startHour: 13, endHour: 17 });
});

test('slotTimes: endHour > startHour for all slots', () => {
  for (const slot of ['matin', 'journee', 'apres-midi']) {
    const { startHour, endHour } = slotTimes(slot);
    assert.ok(endHour > startHour, `${slot}: endHour must be > startHour`);
  }
});

// ── slotLabel ────────────────────────────────────────────────────────────────

test('slotLabel: matin = AM (8h-12h)', () => {
  assert.equal(slotLabel('matin'), 'AM (8h-12h)');
});

test('slotLabel: journee contains Journee', () => {
  assert.ok(slotLabel('journee').includes('Journee') || slotLabel('journee').toLowerCase().includes('journ'));
});

test('slotLabel: apres-midi = PM (13h-17h)', () => {
  assert.equal(slotLabel('apres-midi'), 'PM (13h-17h)');
});

// ── generateGoogleCalendarLinks ──────────────────────────────────────────────

test('generateGoogleCalendarLinks: returns jour1Url and jour2Url', () => {
  const { jour1Url, jour2Url } = generateGoogleCalendarLinks(
    '2026-06-10', 'matin',
    '2026-06-11', 'apres-midi',
    '123 Rue Principale, Québec'
  );
  assert.ok(jour1Url.startsWith('https://calendar.google.com/'), `jour1Url: ${jour1Url}`);
  assert.ok(jour2Url.startsWith('https://calendar.google.com/'), `jour2Url: ${jour2Url}`);
});

test('generateGoogleCalendarLinks: URLs contain correct dates', () => {
  const { jour1Url, jour2Url } = generateGoogleCalendarLinks(
    '2026-06-10', 'matin',
    '2026-06-11', 'apres-midi',
    '123 Rue des Pins'
  );
  // date encoded in the URL
  assert.ok(jour1Url.includes('20260610'), `jour1Url missing 20260610: ${jour1Url}`);
  assert.ok(jour2Url.includes('20260611'), `jour2Url missing 20260611: ${jour2Url}`);
});

test('generateGoogleCalendarLinks: matin starts at 08 in URL', () => {
  const { jour1Url } = generateGoogleCalendarLinks('2026-06-10', 'matin', '2026-06-11', 'matin', 'Addr');
  assert.ok(jour1Url.includes('T080000'), `Expected T080000 in ${jour1Url}`);
});

test('generateGoogleCalendarLinks: apres-midi starts at 13 in URL', () => {
  const { jour1Url } = generateGoogleCalendarLinks('2026-06-10', 'apres-midi', '2026-06-11', 'matin', 'Addr');
  assert.ok(jour1Url.includes('T130000'), `Expected T130000 in ${jour1Url}`);
});

test('generateGoogleCalendarLinks: two different slots produce different URLs', () => {
  const { jour1Url } = generateGoogleCalendarLinks('2026-06-10', 'matin', '2026-06-10', 'apres-midi', 'Addr');
  const { jour1Url: jour1Url2 } = generateGoogleCalendarLinks('2026-06-10', 'apres-midi', '2026-06-10', 'matin', 'Addr');
  assert.notEqual(jour1Url, jour1Url2, 'different slots must produce different URLs');
});

// ── generateIcsContent ───────────────────────────────────────────────────────

test('generateIcsContent: returns valid VCALENDAR structure', () => {
  const ics = generateIcsContent('2026-06-10', 'matin', '2026-06-11', 'apres-midi', '123 Addr');
  assert.ok(ics.includes('BEGIN:VCALENDAR'), 'missing BEGIN:VCALENDAR');
  assert.ok(ics.includes('END:VCALENDAR'), 'missing END:VCALENDAR');
});

test('generateIcsContent: contains two VEVENT blocks', () => {
  const ics = generateIcsContent('2026-06-10', 'matin', '2026-06-11', 'apres-midi', '123 Addr');
  const matches = ics.match(/BEGIN:VEVENT/g) ?? [];
  assert.equal(matches.length, 2, `expected 2 VEVENT blocks, got ${matches.length}`);
});

test('generateIcsContent: jour1 date in DTSTART', () => {
  const ics = generateIcsContent('2026-06-10', 'matin', '2026-06-11', 'apres-midi', '123 Addr');
  assert.ok(ics.includes('20260610T'), `missing jour1 date 20260610T`);
});

test('generateIcsContent: jour2 date in DTSTART', () => {
  const ics = generateIcsContent('2026-06-10', 'matin', '2026-06-11', 'apres-midi', '123 Addr');
  assert.ok(ics.includes('20260611T'), `missing jour2 date 20260611T`);
});

test('generateIcsContent: contains America/Toronto TZID', () => {
  const ics = generateIcsContent('2026-06-10', 'matin', '2026-06-11', 'matin', 'Addr');
  assert.ok(ics.includes('TZID:America/Toronto'), 'missing TZID');
});

test('generateIcsContent: contains VALARMs (reminders)', () => {
  const ics = generateIcsContent('2026-06-10', 'matin', '2026-06-11', 'matin', 'Addr');
  const alarms = ics.match(/BEGIN:VALARM/g) ?? [];
  assert.ok(alarms.length >= 2, `expected at least 2 VALARMs, got ${alarms.length}`);
});

test('generateIcsContent: uses CRLF line endings', () => {
  const ics = generateIcsContent('2026-06-10', 'matin', '2026-06-11', 'matin', 'Addr');
  assert.ok(ics.includes('\r\n'), 'iCal must use CRLF line endings (RFC 5545)');
});

// ── calendarApiUrl ───────────────────────────────────────────────────────────

test('calendarApiUrl: returns googleJour1, googleJour2, ics', () => {
  const urls = calendarApiUrl(42, 'https://dashboard.novusepoxy.ca');
  assert.ok(urls.googleJour1.includes('/api/quotes/42/calendar'));
  assert.ok(urls.googleJour2.includes('/api/quotes/42/calendar'));
  assert.ok(urls.ics.includes('/api/quotes/42/calendar'));
});

test('calendarApiUrl: ics type param present', () => {
  const { ics } = calendarApiUrl(42, 'https://x.vercel.app');
  assert.ok(ics.includes('type=ics'), `ics URL: ${ics}`);
});

test('calendarApiUrl: google day params are different', () => {
  const { googleJour1, googleJour2 } = calendarApiUrl(42, 'https://x.vercel.app');
  assert.notEqual(googleJour1, googleJour2, 'jour1 and jour2 google URLs must differ');
});

/**
 * Calendar link generation for booking confirmations.
 * Generates Google Calendar URLs and .ics file content for both booking days.
 */

export type Slot = 'matin' | 'apres-midi' | 'journee';

export interface CalendarEvent {
  title: string;
  description: string;
  location: string;
  startDate: string; // YYYY-MM-DD
  slot: Slot;
}

/** Format a date + time as an iCal DTSTART/DTEND value (Eastern time via UTC offset) */
function toIcsDatetime(dateStr: string, hours: number, minutes: number): string {
  // Build a date in America/Toronto (Eastern).
  // We'll output in UTC by computing the offset ourselves isn't reliable,
  // so instead we use the TZID approach in the .ics and just output local time.
  const [y, m, d] = dateStr.split('-');
  const hh = String(hours).padStart(2, '0');
  const mm = String(minutes).padStart(2, '0');
  return `${y}${m}${d}T${hh}${mm}00`;
}

/** Build a Google Calendar URL for a single event */
function googleCalendarUrl(event: CalendarEvent): string {
  const { startHour, endHour } = slotTimes(event.slot);

  // Google Calendar uses UTC dates in the format YYYYMMDDTHHmmssZ
  // But we want Eastern time — use the dates/ parameter format with TZID
  const start = toIcsDatetime(event.startDate, startHour, 0);
  const end = toIcsDatetime(event.startDate, endHour, 0);

  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: event.title,
    dates: `${start}/${end}`,
    details: event.description,
    location: event.location,
    ctz: 'America/Toronto',
  });

  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

export function slotTimes(slot: string): { startHour: number; endHour: number } {
  if (slot === 'matin') return { startHour: 8, endHour: 12 };
  if (slot === 'journee') return { startHour: 8, endHour: 17 };
  // default: apres-midi
  return { startHour: 13, endHour: 17 };
}

export function slotLabel(slot: string): string {
  if (slot === 'matin') return 'AM (8h-12h)';
  if (slot === 'journee') return 'Journee (8h-17h)';
  return 'PM (13h-17h)';
}

/** Generate Google Calendar links for both booking days */
export function generateGoogleCalendarLinks(
  jour1Date: string,
  jour1Slot: string,
  jour2Date: string,
  jour2Slot: string,
  address: string,
): { jour1Url: string; jour2Url: string } {
  const description = 'Installation de plancher epoxy par Novus Epoxy. Questions? Appelez-nous au 581-307-5983';

  const jour1Url = googleCalendarUrl({
    title: 'Novus Epoxy - Plancher epoxy',
    description: `Jour 1 (preparation) — ${slotLabel(jour1Slot)}\n${description}`,
    location: address,
    startDate: jour1Date,
    slot: jour1Slot as Slot,
  });

  const jour2Url = googleCalendarUrl({
    title: 'Novus Epoxy - Plancher epoxy',
    description: `Jour 2 (finition) — ${slotLabel(jour2Slot)}\n${description}`,
    location: address,
    startDate: jour2Date,
    slot: jour2Slot as Slot,
  });

  return { jour1Url, jour2Url };
}

/** Generate .ics file content with both events */
export function generateIcsContent(
  jour1Date: string,
  jour1Slot: string,
  jour2Date: string,
  jour2Slot: string,
  address: string,
): string {
  const description = 'Installation de plancher epoxy par Novus Epoxy. Questions? Appelez-nous au 581-307-5983';
  const now = new Date();
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');

  const { startHour: s1h, endHour: e1h } = slotTimes(jour1Slot);
  const { startHour: s2h, endHour: e2h } = slotTimes(jour2Slot);

  const uid1 = `jour1-${jour1Date}-${Date.now()}@novusepoxy.ca`;
  const uid2 = `jour2-${jour2Date}-${Date.now()}@novusepoxy.ca`;

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Novus Epoxy//Booking//FR',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    // Timezone definition
    'BEGIN:VTIMEZONE',
    'TZID:America/Toronto',
    'BEGIN:DAYLIGHT',
    'TZOFFSETFROM:-0500',
    'TZOFFSETTO:-0400',
    'TZNAME:EDT',
    'DTSTART:19700308T020000',
    'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU',
    'END:DAYLIGHT',
    'BEGIN:STANDARD',
    'TZOFFSETFROM:-0400',
    'TZOFFSETTO:-0500',
    'TZNAME:EST',
    'DTSTART:19701101T020000',
    'RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU',
    'END:STANDARD',
    'END:VTIMEZONE',
    // Event 1
    'BEGIN:VEVENT',
    `UID:${uid1}`,
    `DTSTAMP:${stamp}`,
    `DTSTART;TZID=America/Toronto:${toIcsDatetime(jour1Date, s1h, 0)}`,
    `DTEND;TZID=America/Toronto:${toIcsDatetime(jour1Date, e1h, 0)}`,
    `SUMMARY:Novus Epoxy - Plancher epoxy`,
    `DESCRIPTION:Jour 1 (preparation) — ${slotLabel(jour1Slot)}\\n${description}`,
    `LOCATION:${address}`,
    'STATUS:CONFIRMED',
    'BEGIN:VALARM',
    'TRIGGER:-P1D',
    'ACTION:DISPLAY',
    'DESCRIPTION:Novus Epoxy demain - Preparation du plancher',
    'END:VALARM',
    'END:VEVENT',
    // Event 2
    'BEGIN:VEVENT',
    `UID:${uid2}`,
    `DTSTAMP:${stamp}`,
    `DTSTART;TZID=America/Toronto:${toIcsDatetime(jour2Date, s2h, 0)}`,
    `DTEND;TZID=America/Toronto:${toIcsDatetime(jour2Date, e2h, 0)}`,
    `SUMMARY:Novus Epoxy - Plancher epoxy`,
    `DESCRIPTION:Jour 2 (finition) — ${slotLabel(jour2Slot)}\\n${description}`,
    `LOCATION:${address}`,
    'STATUS:CONFIRMED',
    'BEGIN:VALARM',
    'TRIGGER:-P1D',
    'ACTION:DISPLAY',
    'DESCRIPTION:Novus Epoxy demain - Finition du plancher',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ];

  return lines.join('\r\n');
}

/** Build the base URL for the calendar API endpoint */
export function calendarApiUrl(quoteId: number | string, baseUrl: string): {
  googleJour1: string;
  googleJour2: string;
  ics: string;
} {
  const base = `${baseUrl}/api/quotes/${quoteId}/calendar`;
  return {
    googleJour1: `${base}?type=google&day=1`,
    googleJour2: `${base}?type=google&day=2`,
    ics: `${base}?type=ics`,
  };
}

/** Generate HTML snippet for calendar links (for emails) */
export function calendarLinksHtml(quoteId: number | string, baseUrl: string): string {
  const urls = calendarApiUrl(quoteId, baseUrl);
  return `
<div style="background:#f0f9ff;border:1px solid #0ea5e9;border-radius:8px;padding:16px;margin:16px 0;text-align:center;">
<p style="margin:0 0 12px;color:#0369a1;font-weight:700;font-size:14px;">Ajouter au calendrier</p>
<div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap;">
<a href="${urls.googleJour1}" target="_blank" style="display:inline-block;background:#4285f4;color:#ffffff;padding:10px 16px;border-radius:6px;text-decoration:none;font-weight:600;font-size:13px;">Google - Jour 1</a>
<a href="${urls.googleJour2}" target="_blank" style="display:inline-block;background:#4285f4;color:#ffffff;padding:10px 16px;border-radius:6px;text-decoration:none;font-weight:600;font-size:13px;">Google - Jour 2</a>
<a href="${urls.ics}" style="display:inline-block;background:#0f172a;color:#ffffff;padding:10px 16px;border-radius:6px;text-decoration:none;font-weight:600;font-size:13px;">Apple / Outlook (.ics)</a>
</div>
</div>`;
}

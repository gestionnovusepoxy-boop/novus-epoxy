import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

// Public iCal feed — subscribe in Apple Calendar / Google Calendar
// URL: /api/calendar/feed?token=SECRET
// Users add this URL to their phone calendar and it auto-syncs
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token');
  const calToken = process.env.CALENDAR_TOKEN;

  if (!calToken || token !== calToken) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const bookings = await query(
    `SELECT b.id, b.jour1_date, b.jour1_slot, b.jour2_date, b.jour2_slot, b.statut,
            q.client_nom, q.client_adresse, q.client_tel, q.type_service, q.superficie, q.id AS quote_id
     FROM bookings b
     JOIN quotes q ON q.id = b.quote_id
     WHERE b.statut != 'annule'
     ORDER BY b.jour1_date ASC`,
    []
  );

  // Build iCal
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Novus Epoxy//Calendrier Travaux//FR',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:Novus Epoxy — Travaux',
    'X-WR-TIMEZONE:America/Toronto',
  ];

  for (const b of bookings) {
    const clientName = b.client_nom as string;
    const address = (b.client_adresse as string) || 'Adresse non specifiee';
    const tel = (b.client_tel as string) || '';
    const service = b.type_service as string;
    const sqft = b.superficie;
    const quoteId = b.quote_id;

    const j1 = (b.jour1_date as Date).toISOString().split('T')[0].replace(/-/g, '');
    const j2 = b.jour2_date ? (b.jour2_date as Date).toISOString().split('T')[0].replace(/-/g, '') : null;
    const j1Slot = b.jour1_slot as string;
    const j2Slot = b.jour2_slot as string;

    const slotTimes = (s: string): [string, string, string] =>
      s === 'journee' ? ['080000', '160000', '8h-16h (journee complete)']
      : s === 'matin' ? ['080000', '120000', '8h-12h (AM)']
      : ['120000', '160000', '12h-16h (PM)'];

    const [j1Start, j1End, j1Label] = slotTimes(j1Slot);

    // Jour 1
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:novus-j1-${b.id}@novusepoxy.ca`);
    lines.push(`DTSTART;TZID=America/Toronto:${j1}T${j1Start}`);
    lines.push(`DTEND;TZID=America/Toronto:${j1}T${j1End}`);
    lines.push(`SUMMARY:JOUR 1 — ${clientName} (${service}) ${j1Label}`);
    lines.push(`LOCATION:${address}`);
    lines.push(`DESCRIPTION:Client: ${clientName}\\nTel: ${tel}\\nService: ${service}\\nSuperficie: ${sqft} pi²\\nDevis #${quoteId}\\nHoraire: ${j1Label}\\n\\nPreparation et premiere couche`);
    lines.push('STATUS:CONFIRMED');
    lines.push('BEGIN:VALARM');
    lines.push('TRIGGER:-PT1H');
    lines.push('ACTION:DISPLAY');
    lines.push(`DESCRIPTION:Travaux chez ${clientName} dans 1h`);
    lines.push('END:VALARM');
    lines.push('END:VEVENT');

    // Jour 2 (optional)
    if (j2) {
      const [j2Start, j2End, j2Label] = slotTimes(j2Slot);
      lines.push('BEGIN:VEVENT');
      lines.push(`UID:novus-j2-${b.id}@novusepoxy.ca`);
      lines.push(`DTSTART;TZID=America/Toronto:${j2}T${j2Start}`);
      lines.push(`DTEND;TZID=America/Toronto:${j2}T${j2End}`);
      lines.push(`SUMMARY:JOUR 2 — ${clientName} (finition) ${j2Label}`);
      lines.push(`LOCATION:${address}`);
      lines.push(`DESCRIPTION:Client: ${clientName}\\nTel: ${tel}\\nService: ${service}\\nDevis #${quoteId}\\nHoraire: ${j2Label}\\n\\nFinition et deuxieme couche`);
      lines.push('STATUS:CONFIRMED');
      lines.push('BEGIN:VALARM');
      lines.push('TRIGGER:-PT1H');
      lines.push('ACTION:DISPLAY');
      lines.push(`DESCRIPTION:Finition chez ${clientName} dans 1h`);
      lines.push('END:VALARM');
      lines.push('END:VEVENT');
    }
  }

  lines.push('END:VCALENDAR');

  const ical = lines.join('\r\n');

  return new NextResponse(ical, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'inline; filename="novus-epoxy.ics"',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    },
  });
}

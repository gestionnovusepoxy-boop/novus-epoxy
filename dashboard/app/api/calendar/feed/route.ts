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
    const j2 = (b.jour2_date as Date).toISOString().split('T')[0].replace(/-/g, '');
    const j2Slot = b.jour2_slot as string;

    // Jour 1 — morning 8:00-12:00
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:novus-j1-${b.id}@novusepoxy.ca`);
    lines.push(`DTSTART;TZID=America/Toronto:${j1}T080000`);
    lines.push(`DTEND;TZID=America/Toronto:${j1}T120000`);
    lines.push(`SUMMARY:JOUR 1 — ${clientName} (${service})`);
    lines.push(`LOCATION:${address}`);
    lines.push(`DESCRIPTION:Client: ${clientName}\\nTel: ${tel}\\nService: ${service}\\nSuperficie: ${sqft} pi²\\nDevis #${quoteId}\\n\\nPreparation et premiere couche`);
    lines.push('STATUS:CONFIRMED');
    lines.push('BEGIN:VALARM');
    lines.push('TRIGGER:-PT1H');
    lines.push('ACTION:DISPLAY');
    lines.push(`DESCRIPTION:Travaux chez ${clientName} dans 1h`);
    lines.push('END:VALARM');
    lines.push('END:VEVENT');

    // Jour 2
    const j2Start = j2Slot === 'matin' ? '080000' : '120000';
    const j2End = j2Slot === 'matin' ? '120000' : '160000';

    lines.push('BEGIN:VEVENT');
    lines.push(`UID:novus-j2-${b.id}@novusepoxy.ca`);
    lines.push(`DTSTART;TZID=America/Toronto:${j2}T${j2Start}`);
    lines.push(`DTEND;TZID=America/Toronto:${j2}T${j2End}`);
    lines.push(`SUMMARY:JOUR 2 — ${clientName} (finition)`);
    lines.push(`LOCATION:${address}`);
    lines.push(`DESCRIPTION:Client: ${clientName}\\nTel: ${tel}\\nService: ${service}\\nDevis #${quoteId}\\n\\nFinition et deuxieme couche`);
    lines.push('STATUS:CONFIRMED');
    lines.push('BEGIN:VALARM');
    lines.push('TRIGGER:-PT1H');
    lines.push('ACTION:DISPLAY');
    lines.push(`DESCRIPTION:Finition chez ${clientName} dans 1h`);
    lines.push('END:VALARM');
    lines.push('END:VEVENT');
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

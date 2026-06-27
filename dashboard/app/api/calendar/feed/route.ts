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
    `SELECT b.id, b.jour1_date, b.jour1_slot, b.jour2_date, b.jour2_slot, b.extra_days, b.statut,
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
    'X-APPLE-CALENDAR-COLOR:#FFCC00', // JAUNE pour les jobs Novus
    'COLOR:yellow',
  ];

  for (const b of bookings) {
    // Échappement iCal RFC 5545 — les adresses québécoises contiennent des virgules qui corrompaient le feed.
    const esc = (s: unknown) => String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
    const clientName = esc(b.client_nom as string);
    const address = esc((b.client_adresse as string) || 'Adresse non specifiee');
    const tel = esc((b.client_tel as string) || '');
    const service = esc(b.type_service as string);
    const sqft = esc(b.superficie);
    const quoteId = b.quote_id;

    const slotTimes = (s: string): [string, string, string] =>
      s === 'journee' ? ['080000', '160000', '8h-16h (journee complete)']
      : s === 'matin' ? ['080000', '120000', '8h-12h (AM)']
      : ['120000', '160000', '12h-16h (PM)'];

    const extraDays = Array.isArray(b.extra_days)
      ? (b.extra_days as Array<{ date: string; slot: string }>)
      : [];

    // Build full list of days (jour1, jour2, then extras)
    const allDays: Array<{ idx: number; iCalDate: string; slot: string; isFinition: boolean }> = [];
    allDays.push({
      idx: 1,
      iCalDate: (b.jour1_date as Date).toISOString().split('T')[0].replace(/-/g, ''),
      slot: b.jour1_slot as string,
      isFinition: false,
    });
    if (b.jour2_date) {
      allDays.push({
        idx: 2,
        iCalDate: (b.jour2_date as Date).toISOString().split('T')[0].replace(/-/g, ''),
        slot: b.jour2_slot as string,
        isFinition: extraDays.length === 0,
      });
    }
    extraDays.forEach((ed, i) => {
      allDays.push({
        idx: 3 + i,
        iCalDate: ed.date.replace(/-/g, ''),
        slot: ed.slot,
        isFinition: i === extraDays.length - 1,
      });
    });

    const totalDays = allDays.length;
    for (const d of allDays) {
      const [start, end, label] = slotTimes(d.slot);
      const dayLabel = totalDays > 1 ? `JOUR ${d.idx}/${totalDays}` : `JOUR ${d.idx}`;
      const phase = d.idx === 1 ? 'Preparation et premiere couche' : d.isFinition ? 'Finition et derniere couche' : 'Application';
      lines.push('BEGIN:VEVENT');
      lines.push('COLOR:yellow');
      lines.push(`UID:novus-j${d.idx}-${b.id}@novusepoxy.ca`);
      lines.push(`DTSTART;TZID=America/Toronto:${d.iCalDate}T${start}`);
      lines.push(`DTEND;TZID=America/Toronto:${d.iCalDate}T${end}`);
      lines.push(`SUMMARY:${dayLabel} — ${clientName} (${service}) ${label}`);
      lines.push(`LOCATION:${address}`);
      lines.push(`DESCRIPTION:Client: ${clientName}\\nTel: ${tel}\\nService: ${service}\\nSuperficie: ${sqft} pi²\\nDevis #${quoteId}\\nHoraire: ${label}\\n\\n${phase}`);
      lines.push('STATUS:CONFIRMED');
      lines.push('BEGIN:VALARM');
      lines.push('TRIGGER:-PT1H');
      lines.push('ACTION:DISPLAY');
      lines.push(`DESCRIPTION:Travaux chez ${clientName} dans 1h`);
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

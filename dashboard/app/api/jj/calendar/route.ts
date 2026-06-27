import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

// Feed iCal public pour la Sous-traitance JJ — à ajouter dans le calendrier du cell
// (Apple/Google Calendar) pour que l'horaire JJ se synchronise comme l'agenda Novus.
// URL: /api/jj/calendar?token=CALENDAR_TOKEN
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token');
  const calToken = process.env.CALENDAR_TOKEN;
  if (!calToken || token !== calToken) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Filtre optionnel par équipe → permet un calendrier par couleur sur le cell:
  //   ?equipe=1 (vert) · ?equipe=2 (rouge) · sans filtre = les deux.
  const equipeFilter = req.nextUrl.searchParams.get('equipe');
  const eqNum = equipeFilter === '1' || equipeFilter === '2' ? Number(equipeFilter) : null;

  const rows = await query(
    `SELECT p.id, p.date, p.slot, p.heure_debut, p.heure_fin, p.equipe, p.jour_numero,
            c.client_nom, c.adresse, c.ville, c.couleur, c.service, c.client_tel, c.id AS chantier_id
     FROM jj_planning p
     JOIN jj_chantiers c ON c.id = p.chantier_id
     ${eqNum ? 'WHERE p.equipe = $1' : ''}
     ORDER BY p.date ASC`,
    eqNum ? [eqNum] : [],
  );

  const esc = (s: unknown) => String(s ?? '')
    .replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

  // hhmm de début/fin selon le slot (ou heures custom)
  const times = (slot: string, hd?: string | null, hf?: string | null): [string, string, string] => {
    const toHHMM = (t?: string | null) => (t ? t.replace(':', '') + '00' : null);
    if (slot === 'custom' && hd && hf) return [toHHMM(hd)!, toHHMM(hf)!, `${hd}–${hf}`];
    if (slot === 'journee') return ['080000', '160000', '8h-16h (journée)'];
    if (slot === 'pm') return ['120000', '160000', '12h-16h (PM)'];
    return ['080000', '120000', '8h-12h (AM)'];
  };

  const lines: string[] = [
    'BEGIN:VCALENDAR', 'VERSION:2.0',
    'PRODID:-//Novus Epoxy//Sous-traitance JJ//FR',
    'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    `X-WR-CALNAME:${eqNum ? `JJ Équipe ${eqNum}` : 'Sous-traitance JJ'}`,
    'X-WR-TIMEZONE:America/Toronto',
    // Couleur du calendrier: Équipe 1 = vert, Équipe 2 = rouge (si filtré).
    `X-APPLE-CALENDAR-COLOR:${eqNum === 2 ? '#FF3B30' : '#34C759'}`,
    `COLOR:${eqNum === 2 ? 'red' : 'green'}`,
  ];

  for (const p of rows) {
    const raw = p.date instanceof Date ? p.date.toISOString() : String(p.date);
    const dateStr = raw.slice(0, 10).replace(/-/g, '');
    const [start, end, label] = times(p.slot as string, p.heure_debut as string, p.heure_fin as string);
    const client = esc(p.client_nom);
    const addr = esc((p.adresse as string) || (p.ville as string) || 'Adresse à confirmer');
    const equipe = Number(p.equipe ?? 1);
    const couleur = esc(p.couleur || '');
    const service = esc(p.service || '');
    lines.push('BEGIN:VEVENT');
    // Couleur par équipe: Équipe 1 = vert, Équipe 2 = rouge.
    lines.push(`COLOR:${equipe === 2 ? 'red' : 'green'}`);
    lines.push(`UID:jj-${p.id}@novusepoxy.ca`);
    lines.push(`DTSTART;TZID=America/Toronto:${dateStr}T${start}`);
    lines.push(`DTEND;TZID=America/Toronto:${dateStr}T${end}`);
    lines.push(`SUMMARY:JJ Éq.${equipe} — ${client} (jour ${Number(p.jour_numero ?? 1)}) ${label}`);
    lines.push(`LOCATION:${addr}`);
    lines.push(`DESCRIPTION:Chantier JJ #${p.chantier_id}\\nClient: ${client}\\nÉquipe: ${equipe}\\nService: ${service}\\nCouleur: ${couleur}\\nTel: ${esc(p.client_tel || '')}\\nHoraire: ${label}`);
    lines.push('STATUS:CONFIRMED');
    lines.push('BEGIN:VALARM');
    lines.push('TRIGGER:-PT12H');
    lines.push('ACTION:DISPLAY');
    lines.push(`DESCRIPTION:Chantier JJ chez ${client} demain`);
    lines.push('END:VALARM');
    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');

  return new NextResponse(lines.join('\r\n'), {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'inline; filename="sous-traitance-jj.ics"',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    },
  });
}

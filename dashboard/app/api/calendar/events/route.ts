import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query } from '@/lib/db';

/** Convert a DB date (Date object or string) to YYYY-MM-DD safely */
function toDateStr(d: unknown): string {
  if (d instanceof Date) return d.toISOString().split('T')[0];
  const s = String(d);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  // Fallback: parse the string and convert
  try { return new Date(s).toISOString().split('T')[0]; } catch { return s.slice(0, 10); }
}

/** Convert a DB datetime to ISO string safely */
function toISOStr(d: unknown): string {
  if (d instanceof Date) return d.toISOString();
  const s = String(d);
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return s;
  try { return new Date(s).toISOString(); } catch { return s; }
}

// GET — fetch all events (bookings + manual events)
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const start = searchParams.get('start') || '';
  const end = searchParams.get('end') || '';

  // 1. Bookings as calendar events
  const bookings = await query(
    `SELECT b.id, b.jour1_date, b.jour1_slot, b.jour2_date, b.jour2_slot, b.extra_days, b.statut,
            q.client_nom, q.client_adresse, q.client_tel, q.type_service, q.superficie, q.total, q.id AS quote_id
     FROM bookings b
     JOIN quotes q ON q.id = b.quote_id
     WHERE b.statut != 'annule'
     ORDER BY b.jour1_date ASC`,
    []
  );

  const slotTimes = (s: string) =>
    s === 'journee' ? { start: '08:00', end: '16:00' }
    : s === 'matin' ? { start: '08:00', end: '12:00' }
    : { start: '12:00', end: '16:00' };
  const slotCls = (s: string) => s === 'journee' ? ['novus-day'] : s === 'matin' ? ['novus-am'] : ['novus-pm'];

  const bookingEvents = bookings.flatMap(b => {
    const nom = b.client_nom as string;
    const service = b.type_service as string;
    const adresse = b.client_adresse as string | null;
    const tel = b.client_tel as string | null;
    const superficie = Number(b.superficie);
    const total = Number(b.total);
    const quoteId = b.quote_id as number;
    const statut = b.statut as string;

    const isProvisoire = statut === 'en_attente';
    const isComplete = statut === 'complete' || statut === 'paye' || statut === 'facture';

    const colorActive = isComplete ? '#22c55e' : isProvisoire ? '#f59e0b' : '#3b82f6';
    const colorAlt = isComplete ? '#16a34a' : isProvisoire ? '#d97706' : '#2563eb';

    const j1 = toDateStr(b.jour1_date);
    const j2 = b.jour2_date ? toDateStr(b.jour2_date) : null;
    const extraDays = Array.isArray(b.extra_days)
      ? (b.extra_days as Array<{ date: string; slot: string }>)
      : [];

    const statusLabel = isComplete ? ' ✓' : isProvisoire ? ' ?' : '';
    const shortAddr = adresse ? (adresse.length > 35 ? adresse.slice(0, 35) + '...' : adresse) : '';
    const addrSuffix = shortAddr ? ` - ${shortAddr}` : '';

    // Build a list of all days for this booking (jour1, jour2, then extra_days)
    type DaySpec = { idx: number; date: string; slot: string };
    const days: DaySpec[] = [{ idx: 1, date: j1, slot: b.jour1_slot as string }];
    if (j2) days.push({ idx: 2, date: j2, slot: b.jour2_slot as string });
    extraDays.forEach((ed, i) => days.push({ idx: 3 + i, date: ed.date, slot: ed.slot }));

    const totalDays = days.length;
    const extra = {
      type: 'booking', bookingId: b.id, quoteId, nom, service, adresse, tel, superficie, total, statut,
      jour1_date: j1, jour1_slot: b.jour1_slot, jour2_date: j2, jour2_slot: b.jour2_slot,
      extra_days: extraDays,
    };

    return days.map(d => {
      const times = slotTimes(d.slot);
      const color = d.idx % 2 === 1 ? colorActive : colorAlt;
      const cls = slotCls(d.slot);
      const label = totalDays === 1 ? `J${d.idx}` : `J${d.idx}/${totalDays}`;
      return {
        id: `booking-${b.id}-j${d.idx}`,
        title: `${label}: ${nom}${addrSuffix}${statusLabel}`,
        start: `${d.date}T${times.start}:00`,
        end: `${d.date}T${times.end}:00`,
        backgroundColor: color,
        borderColor: color,
        classNames: cls,
        extendedProps: extra,
        editable: !isComplete,
      };
    });
  });

  // 2. Manual calendar events
  const manual = await query(
    `SELECT * FROM calendar_events ORDER BY start_date ASC`,
    []
  );

  const manualEvents = manual.map(e => ({
    id: `event-${e.id}`,
    title: e.title as string,
    start: toISOStr(e.start_date),
    end: e.end_date ? toISOStr(e.end_date) : undefined,
    allDay: e.all_day as boolean,
    backgroundColor: (e.color as string) || '#f59e0b',
    borderColor: (e.color as string) || '#f59e0b',
    extendedProps: {
      type: 'manual',
      eventId: e.id,
      description: e.description || '',
      event_type: e.event_type || 'manual',
    },
    editable: true,
  }));

  return NextResponse.json({ events: [...bookingEvents, ...manualEvents] });
}

// POST — create a manual calendar event
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const body = await req.json();
  const { title, description, start, end, allDay, color, event_type } = body;

  if (!title || !start) {
    return NextResponse.json({ error: 'Titre et date requis' }, { status: 400 });
  }

  const rows = await query(
    `INSERT INTO calendar_events (title, description, start_date, end_date, all_day, color, event_type, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [title, description || null, start, end || null, allDay ?? false, color || '#f59e0b', event_type || 'manual', session.user?.email || '']
  );

  return NextResponse.json({ event: rows[0] });
}

// PUT — update an event (move/resize or edit)
export async function PUT(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const body = await req.json();
  const { id, title, description, start, end, allDay, color } = body;

  if (!id) return NextResponse.json({ error: 'ID requis' }, { status: 400 });

  // Check if it's a booking event or manual event
  if (String(id).startsWith('booking-')) {
    // Parse booking ID and jour
    const match = String(id).match(/booking-(\d+)-(j[12])/);
    if (!match) return NextResponse.json({ error: 'ID invalide' }, { status: 400 });

    const bookingId = parseInt(match[1]);
    const jour = match[2]; // j1 or j2

    // Extract date and time directly from the ISO string to avoid timezone shifts
    const dateStr = String(start).slice(0, 10); // "2026-05-09"
    const timePart = String(start).slice(11, 13);
    const endTimePart = end ? String(end).slice(11, 13) : '';
    const startHour = timePart ? parseInt(timePart) : 8;
    const endHour = endTimePart ? parseInt(endTimePart) : startHour + 4;
    // If event spans full work day (8h to 16h), treat as journee
    const isFullDay = startHour <= 8 && endHour >= 16;
    const slot = isFullDay ? 'journee' : startHour < 12 ? 'matin' : 'apres-midi';

    if (jour === 'j1') {
      await query(`UPDATE bookings SET jour1_date = $1, jour1_slot = $2 WHERE id = $3`, [dateStr, slot, bookingId]);
    } else {
      await query(`UPDATE bookings SET jour2_date = $1, jour2_slot = $2 WHERE id = $3`, [dateStr, slot, bookingId]);
    }

    return NextResponse.json({ ok: true });
  }

  // Manual event
  const eventId = String(id).replace('event-', '');

  const fields: string[] = [];
  const params: unknown[] = [];
  let i = 1;

  if (title !== undefined) { fields.push(`title = $${i++}`); params.push(title); }
  if (description !== undefined) { fields.push(`description = $${i++}`); params.push(description); }
  if (start !== undefined) { fields.push(`start_date = $${i++}`); params.push(start); }
  if (end !== undefined) { fields.push(`end_date = $${i++}`); params.push(end); }
  if (allDay !== undefined) { fields.push(`all_day = $${i++}`); params.push(allDay); }
  if (color !== undefined) { fields.push(`color = $${i++}`); params.push(color); }

  fields.push(`updated_at = NOW()`);
  params.push(eventId);

  await query(`UPDATE calendar_events SET ${fields.join(', ')} WHERE id = $${i}`, params);
  return NextResponse.json({ ok: true });
}

// DELETE — remove a manual event
export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id') || '';

  if (!id || id.startsWith('booking-')) {
    return NextResponse.json({ error: 'Impossible de supprimer un booking ici' }, { status: 400 });
  }

  const eventId = id.replace('event-', '');
  await query(`DELETE FROM calendar_events WHERE id = $1`, [eventId]);
  return NextResponse.json({ ok: true });
}

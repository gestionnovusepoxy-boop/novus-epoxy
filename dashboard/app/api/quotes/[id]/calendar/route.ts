import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { generateGoogleCalendarLinks, generateIcsContent } from '@/lib/calendar-links';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const quoteId = parseInt(id);
  if (isNaN(quoteId)) {
    return NextResponse.json({ error: 'ID invalide' }, { status: 400 });
  }

  const url = new URL(req.url);
  const type = url.searchParams.get('type');
  const day = url.searchParams.get('day'); // '1' or '2', only for google

  if (!type || !['google', 'ics'].includes(type)) {
    return NextResponse.json({ error: 'Parametre type requis (google ou ics)' }, { status: 400 });
  }

  // Fetch quote and booking
  const quotes = await query(
    'SELECT id, adresse, booking_id, statut FROM quotes WHERE id = $1',
    [quoteId]
  );
  if (quotes.length === 0) {
    return NextResponse.json({ error: 'Devis introuvable' }, { status: 404 });
  }
  const quote = quotes[0];

  // Only allow for confirmed deposits
  const allowedStatuts = ['depot_paye', 'planifie', 'complete'];
  if (!allowedStatuts.includes(quote.statut as string)) {
    return NextResponse.json({ error: 'Calendrier non disponible' }, { status: 400 });
  }

  if (!quote.booking_id) {
    return NextResponse.json({ error: 'Aucune reservation' }, { status: 400 });
  }

  const bookings = await query(
    'SELECT jour1_date, jour1_slot, jour2_date, jour2_slot FROM bookings WHERE id = $1',
    [quote.booking_id]
  );
  if (bookings.length === 0) {
    return NextResponse.json({ error: 'Reservation introuvable' }, { status: 404 });
  }

  const booking = bookings[0];
  const j1Date = booking.jour1_date instanceof Date
    ? booking.jour1_date.toISOString().split('T')[0]
    : String(booking.jour1_date).split('T')[0];
  const j2Date = booking.jour2_date instanceof Date
    ? booking.jour2_date.toISOString().split('T')[0]
    : String(booking.jour2_date).split('T')[0];
  const j1Slot = (booking.jour1_slot as string) || 'matin';
  const j2Slot = (booking.jour2_slot as string) || 'apres-midi';
  const address = (quote.adresse as string) || '';

  if (type === 'google') {
    const links = generateGoogleCalendarLinks(j1Date, j1Slot, j2Date, j2Slot, address);
    if (day === '2') {
      return NextResponse.redirect(links.jour2Url);
    }
    // Default to jour 1
    return NextResponse.redirect(links.jour1Url);
  }

  // type === 'ics'
  const icsContent = generateIcsContent(j1Date, j1Slot, j2Date, j2Slot, address);
  return new NextResponse(icsContent, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="novus-epoxy-devis-${quoteId}.ics"`,
    },
  });
}

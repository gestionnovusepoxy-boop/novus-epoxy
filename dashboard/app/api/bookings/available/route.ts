import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

// Public endpoint — returns available morning slots for the next 30 days
export async function GET(req: NextRequest) {
  const quoteId = req.nextUrl.searchParams.get('quote_id');
  if (!quoteId) return NextResponse.json({ error: 'quote_id requis' }, { status: 400 });

  // Verify quote exists and is in a valid state for booking
  const quotes = await query(
    `SELECT id, statut, client_email FROM quotes WHERE id = $1`,
    [parseInt(quoteId)]
  );
  if (quotes.length === 0) return NextResponse.json({ error: 'Devis introuvable' }, { status: 404 });

  const q = quotes[0];
  if (!['envoye', 'contrat_signe', 'depot_paye'].includes(q.statut as string)) {
    return NextResponse.json({ error: 'Ce devis ne peut pas etre planifie' }, { status: 400 });
  }

  // Check if a booking already exists for this quote
  const forceNew = req.nextUrl.searchParams.get('force_new') === '1';
  const existingBooking = await query(
    `SELECT b.jour1_date, b.jour1_slot, b.jour2_date, b.jour2_slot, b.statut AS booking_statut
     FROM bookings b WHERE b.quote_id = $1 ORDER BY b.created_at DESC LIMIT 1`,
    [parseInt(quoteId)]
  );

  if (existingBooking.length > 0 && !forceNew) {
    const eb = existingBooking[0];
    return NextResponse.json({
      already_booked: true,
      booking: {
        jour1_date: (eb.jour1_date as Date).toISOString().split('T')[0],
        jour1_slot: eb.jour1_slot,
        jour2_date: (eb.jour2_date as Date).toISOString().split('T')[0],
        jour2_slot: eb.jour2_slot,
        statut: eb.booking_statut,
      },
      quote_statut: q.statut,
      client_email: q.client_email,
    });
  }

  // Get all CONFIRMED booked slots for next 60 days (en_attente bookings don't block)
  const bookedRows = await query(
    `SELECT jour1_date, jour1_slot, jour2_date, jour2_slot
     FROM bookings
     WHERE statut = 'confirme'
       AND (jour1_date >= CURRENT_DATE OR jour2_date >= CURRENT_DATE)`,
    []
  );

  // Build a set of booked date+slot combos
  const booked = new Set<string>();
  for (const b of bookedRows) {
    booked.add(`${(b.jour1_date as Date).toISOString().split('T')[0]}:${b.jour1_slot}`);
    booked.add(`${(b.jour2_date as Date).toISOString().split('T')[0]}:${b.jour2_slot}`);
  }

  // Generate available morning slots for next 30 days
  const available: { date: string; dayName: string; jour2_date: string; jour2_slot: string }[] = [];
  const now = new Date();
  // Start from tomorrow at minimum
  const start = new Date(now);
  start.setDate(start.getDate() + 2); // At least 2 days out

  for (let i = 0; i < 45; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    const dow = d.getDay(); // 0=Sun, 6=Sat

    // Skip Sunday
    if (dow === 0) continue;

    const dateStr = d.toISOString().split('T')[0];

    // Day 1 is always morning
    if (booked.has(`${dateStr}:matin`)) continue;

    // Calculate day 2
    const d2 = new Date(d);
    let jour2Slot: string;

    if (dow === 5) {
      // Friday -> Saturday morning
      d2.setDate(d2.getDate() + 1);
      jour2Slot = 'matin';
    } else if (dow === 6) {
      // Saturday -> Monday afternoon
      d2.setDate(d2.getDate() + 2);
      jour2Slot = 'apres-midi';
    } else {
      // Mon-Thu -> next day afternoon
      d2.setDate(d2.getDate() + 1);
      jour2Slot = 'apres-midi';
    }

    const d2Str = d2.toISOString().split('T')[0];

    // Check day 2 is available
    if (booked.has(`${d2Str}:${jour2Slot}`)) continue;

    const dayNames = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];

    available.push({
      date: dateStr,
      dayName: dayNames[dow],
      jour2_date: d2Str,
      jour2_slot: jour2Slot,
    });
  }

  return NextResponse.json({ available, client_email: q.client_email });
}

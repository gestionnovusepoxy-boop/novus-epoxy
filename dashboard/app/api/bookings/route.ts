import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { formatMoney } from '@/lib/pricing';
import { sendSMS } from '@/lib/sms';

// Public endpoint — client books their work dates
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body?.quote_id || !body?.jour1_date) {
    return NextResponse.json({ error: 'quote_id et jour1_date requis' }, { status: 400 });
  }

  const quoteId = parseInt(body.quote_id);
  const jour1Date = body.jour1_date;
  const jour2Date = body.jour2_date;
  const jour2Slot = body.jour2_slot || 'apres-midi';

  // Verify quote
  const quotes = await query(`SELECT * FROM quotes WHERE id = $1`, [quoteId]);
  if (quotes.length === 0) return NextResponse.json({ error: 'Devis introuvable' }, { status: 404 });

  const q = quotes[0];
  if (!['envoye', 'depot_paye'].includes(q.statut as string)) {
    return NextResponse.json({ error: 'Ce devis ne peut pas être planifié' }, { status: 400 });
  }

  // Check slots are still available
  const conflicts = await query(
    `SELECT id FROM bookings
     WHERE statut != 'annule'
     AND (
       (jour1_date = $1 AND jour1_slot = 'matin')
       OR (jour2_date = $2 AND jour2_slot = $3)
       OR (jour1_date = $2 AND jour1_slot = $3)
       OR (jour2_date = $1 AND jour2_slot = 'matin')
     )`,
    [jour1Date, jour2Date, jour2Slot]
  );

  if (conflicts.length > 0) {
    return NextResponse.json({ error: 'Ces dates ne sont plus disponibles' }, { status: 409 });
  }

  // Create booking
  const rows = await query(
    `INSERT INTO bookings (quote_id, jour1_date, jour1_slot, jour2_date, jour2_slot)
     VALUES ($1, $2, 'matin', $3, $4)
     RETURNING id`,
    [quoteId, jour1Date, jour2Date, jour2Slot]
  );

  const bookingId = rows[0].id as number;

  // Link booking to quote
  await query(
    `UPDATE quotes SET booking_id = $1, statut = 'planifie' WHERE id = $2`,
    [bookingId, quoteId]
  );

  // Notify admin via email
  const apiKey = process.env.RESEND_API_KEY;
  const adminEmail = process.env.ADMIN_EMAIL;
  const from = process.env.EMAIL_FROM ?? 'onboarding@resend.dev';

  if (apiKey && adminEmail) {
    const slotLabel = jour2Slot === 'matin' ? '8h-12h' : '12h-16h';
    try {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from,
          to: [adminEmail],
          subject: `Reservation confirmee — Devis #${quoteId} — ${q.client_nom}`,
          html: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;">
            <h2 style="color:#1e293b;">Nouvelle reservation!</h2>
            <p><strong>Client:</strong> ${q.client_nom} (${q.client_email})</p>
            <p><strong>Devis #${quoteId}</strong> — ${formatMoney(Number(q.total))}</p>
            <p><strong>Jour 1:</strong> ${jour1Date} — Matin (8h-12h)</p>
            <p><strong>Jour 2:</strong> ${jour2Date} — ${slotLabel}</p>
            <p style="margin-top:20px;">
              <a href="https://novus-epoxy.vercel.app/dashboard/devis/${quoteId}"
                 style="background:#f59e0b;color:#0f172a;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;">
                Voir le devis
              </a>
            </p>
          </div>`,
        }),
      });
    } catch (err) { console.error('Booking notification email failed:', err); }
  }

  // SMS to admin
  const adminPhone = process.env.ADMIN_PHONE;
  if (adminPhone) {
    await sendSMS(adminPhone, `Novus Epoxy: ${q.client_nom} a reserve ses travaux! Jour 1: ${jour1Date} matin, Jour 2: ${jour2Date} ${jour2Slot === 'matin' ? 'matin' : 'PM'}. Devis #${quoteId}`).catch(() => {});
  }

  return NextResponse.json({ ok: true, booking_id: bookingId });
}

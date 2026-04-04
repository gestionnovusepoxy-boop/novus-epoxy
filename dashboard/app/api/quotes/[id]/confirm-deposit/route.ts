import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query } from '@/lib/db';
import { formatMoney } from '@/lib/pricing';
import { escapeHtml } from '@/lib/utils';
import { sendSMS } from '@/lib/sms';
import { sendEmail } from '@/lib/send-email';
import { calendarLinksHtml } from '@/lib/calendar-links';

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Non autorise' }, { status: 401 });

  const { id } = await params;
  const quoteId = parseInt(id);

  // Fetch quote and its booking
  const quotes = await query('SELECT * FROM quotes WHERE id = $1', [quoteId]);
  if (quotes.length === 0) return NextResponse.json({ error: 'Devis introuvable' }, { status: 404 });
  const quote = quotes[0];

  if (!quote.booking_id) {
    return NextResponse.json({ error: 'Aucune reservation liee a ce devis' }, { status: 400 });
  }

  const bookings = await query('SELECT * FROM bookings WHERE id = $1', [quote.booking_id]);
  if (bookings.length === 0) return NextResponse.json({ error: 'Reservation introuvable' }, { status: 404 });
  const booking = bookings[0];

  // Check if dates are still available (no other CONFIRMED booking on those slots)
  const conflicts = await query(
    `SELECT id FROM bookings
     WHERE statut = 'confirme'
     AND id != $4
     AND (
       (jour1_date = $1 AND jour1_slot = 'matin')
       OR (jour2_date = $2 AND jour2_slot = $3)
       OR (jour1_date = $2 AND jour1_slot = $3)
       OR (jour2_date = $1 AND jour2_slot = 'matin')
     )`,
    [booking.jour1_date, booking.jour2_date, booking.jour2_slot, booking.id]
  );

  if (conflicts.length > 0) {
    // Find next available dates to offer alternatives
    const bookedRows = await query(
      `SELECT jour1_date, jour1_slot, jour2_date, jour2_slot
       FROM bookings
       WHERE statut = 'confirme'
         AND (jour1_date >= CURRENT_DATE OR jour2_date >= CURRENT_DATE)`,
      []
    );

    const booked = new Set<string>();
    for (const b of bookedRows) {
      booked.add(`${(b.jour1_date as Date).toISOString().split('T')[0]}:${b.jour1_slot}`);
      booked.add(`${(b.jour2_date as Date).toISOString().split('T')[0]}:${b.jour2_slot}`);
    }

    const available: { date: string; jour2_date: string; jour2_slot: string }[] = [];
    const start = new Date();
    start.setDate(start.getDate() + 2);

    for (let i = 0; i < 45 && available.length < 5; i++) {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      const dow = d.getDay();
      if (dow === 0) continue;

      const dateStr = d.toISOString().split('T')[0];
      if (booked.has(`${dateStr}:matin`)) continue;

      const d2 = new Date(d);
      let jour2Slot: string;
      if (dow === 5) { d2.setDate(d2.getDate() + 1); jour2Slot = 'matin'; }
      else if (dow === 6) { d2.setDate(d2.getDate() + 2); jour2Slot = 'apres-midi'; }
      else { d2.setDate(d2.getDate() + 1); jour2Slot = 'apres-midi'; }

      const d2Str = d2.toISOString().split('T')[0];
      if (booked.has(`${d2Str}:${jour2Slot}`)) continue;

      available.push({ date: dateStr, jour2_date: d2Str, jour2_slot: jour2Slot });
    }

    return NextResponse.json({
      success: false,
      conflict: true,
      message: 'Les dates choisies sont deja prises par une reservation confirmee.',
      available_dates: available,
    });
  }

  // Dates available — confirm the booking and update the quote
  await query(
    `UPDATE bookings SET statut = 'confirme' WHERE id = $1`,
    [booking.id]
  );

  await query(
    `UPDATE quotes SET statut = 'depot_paye', paid_at = NOW(), deposit_paid_at = NOW() WHERE id = $1`,
    [quoteId]
  );

  // Format dates for notifications
  const fmt = (d: unknown) => {
    const date = d instanceof Date ? d : new Date(String(d));
    return date.toLocaleDateString('fr-CA', { weekday: 'long', day: 'numeric', month: 'long' });
  };
  const j1Fmt = fmt(booking.jour1_date);
  const j2Fmt = fmt(booking.jour2_date);
  const slotLabel = booking.jour2_slot === 'matin' ? '8h-12h' : '12h-16h';

  // Send confirmation email to client
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://novus-epoxy.vercel.app';
  {
    const calendarHtml = calendarLinksHtml(quoteId, baseUrl);
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:0;background:#ffffff;">
<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;">
<div style="background:#0f172a;color:white;padding:20px 24px;border-radius:8px 8px 0 0;">
<h2 style="margin:0;font-size:20px;">Votre reservation est confirmee!</h2>
<p style="margin:4px 0 0;color:#f59e0b;font-size:14px;">Novus Epoxy — Devis #${quoteId}</p>
</div>
<div style="padding:20px 24px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px;">
<p>Bonjour ${escapeHtml(quote.client_nom as string)},</p>
<p>Merci pour votre depot! Vos dates de travaux sont maintenant <strong>confirmees</strong>.</p>
<div style="background:#f0fdf4;border:1px solid #22c55e;border-radius:8px;padding:16px;margin:16px 0;">
<p style="margin:0 0 8px;color:#166534;font-weight:700;font-size:16px;">Dates confirmees</p>
<p style="margin:4px 0;"><strong>Jour 1 (preparation):</strong> ${j1Fmt} — AM (8h-12h)</p>
<p style="margin:4px 0;"><strong>Jour 2 (finition):</strong> ${j2Fmt} — ${slotLabel}</p>
</div>
${calendarHtml}
<div style="background:#f8fafc;padding:16px;border-radius:8px;margin:16px 0;">
<p style="margin:0 0 4px;font-weight:700;">Rappels importants:</p>
<p style="margin:2px 0;color:#475569;font-size:13px;">- Liberer completement l'espace de travail avant notre arrivee</p>
<p style="margin:2px 0;color:#475569;font-size:13px;">- Ne pas utiliser le plancher pendant 72 heures apres les travaux</p>
</div>
<p style="color:#64748b;font-size:13px;">Des questions? Contactez-nous:<br/>
<strong>Luca:</strong> 581-307-5983<br/>
<strong>Jason:</strong> 581-307-2678</p>
</div>
</div></body></html>`;

    try {
      await sendEmail({
        to: quote.client_email as string,
        subject: `Reservation confirmee — Novus Epoxy #${quoteId}`,
        html,
      });
    } catch (err) { console.error('Deposit confirmation email failed:', err); }
  }

  // SMS confirmation au client — personnel avec numéro Luca
  const clientTel = quote.client_tel as string | null;
  if (clientTel) {
    const prenom = (quote.client_nom as string).split(' ')[0];
    await sendSMS(
      clientTel,
      `${prenom}, c'est Luca de Novus Epoxy! Depot bien recu, merci! Tes dates du ${j1Fmt} et ${j2Fmt} sont confirmees. On a hate de transformer ton plancher! Questions? 581-307-5983`
    ).catch(() => {});
  }

  // === IRIS: Auto-create invoice + payment + send to client ===
  try {
    const depotMontant = Number(quote.depot_requis) || Number(quote.total) * 0.3;

    // Find or create client
    let clientId: number | null = null;
    const clientEmail = quote.client_email as string;
    if (clientEmail) {
      const existingClient = await query(`SELECT id FROM clients WHERE LOWER(email) = LOWER($1) LIMIT 1`, [clientEmail]);
      if (existingClient.length > 0) {
        clientId = existingClient[0].id as number;
      } else {
        const newClient = await query(
          `INSERT INTO clients (nom, email, telephone, adresse) VALUES ($1,$2,$3,$4) RETURNING id`,
          [quote.client_nom, clientEmail, quote.client_tel, quote.client_adresse]
        );
        clientId = newClient[0].id as number;
      }
    }

    // Find or create invoice
    let invoiceId: number | null = null;
    const existingInv = await query(`SELECT id FROM invoices WHERE quote_id = $1 LIMIT 1`, [quoteId]);
    if (existingInv.length > 0) {
      invoiceId = existingInv[0].id as number;
    } else {
      const yearStr = new Date().getFullYear().toString();
      const lastInv = await query(`SELECT numero FROM invoices WHERE numero LIKE $1 ORDER BY numero DESC LIMIT 1`, [`NE-${yearStr}-%`]);
      const nextNum = lastInv.length > 0 ? parseInt((lastInv[0].numero as string).split('-')[2]) + 1 : 1;
      const numero = `NE-${yearStr}-${String(nextNum).padStart(3, '0')}`;

      const invRows = await query(
        `INSERT INTO invoices (numero, quote_id, client_id, type_service, superficie, prix_pied_carre, rabais_pct, rabais_montant, sous_total, tps, tvq, total, depot_montant, final_montant, statut, date_emission)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'depot_recu',CURRENT_DATE) RETURNING id, numero`,
        [numero, quoteId, clientId, quote.type_service, quote.superficie, quote.prix_pied_carre, quote.rabais_pct ?? 0, quote.rabais_montant ?? 0, quote.sous_total, quote.tps, quote.tvq, quote.total, depotMontant, Number(quote.total) - depotMontant]
      );
      invoiceId = invRows[0].id as number;

      // Auto-send invoice to client
      if (clientEmail) {
        const base = process.env.NEXTAUTH_URL ?? 'https://novus-epoxy.vercel.app';
        try {
          await fetch(`${base}/api/invoices/${invoiceId}/send`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ADMIN_API_KEY ?? '' },
          });
        } catch { /* invoice send is best-effort */ }
      }
    }

    // Create payment record if not exists
    const existingPay = await query(`SELECT id FROM payments WHERE invoice_id = $1 AND type = 'depot' LIMIT 1`, [invoiceId]);
    if (existingPay.length === 0) {
      await query(
        `INSERT INTO payments (invoice_id, type, montant, methode, paid_at) VALUES ($1, 'depot', $2, 'virement', NOW())`,
        [invoiceId, depotMontant]
      );
    }

    // Update invoice deposit status
    await query(`UPDATE invoices SET depot_paye = true, depot_paye_at = NOW(), statut = 'depot_recu' WHERE id = $1`, [invoiceId]);
  } catch (err) {
    console.error('[Iris] Auto-invoice/payment creation failed:', err);
  }

  return NextResponse.json({ success: true, confirmed: true });
}

import { NextRequest, NextResponse } from 'next/server';
import { getAdminChatIds } from '@/lib/telegram-utils';
import { query } from '@/lib/db';
import { formatMoney } from '@/lib/pricing';
import { sendSMS } from '@/lib/sms';
import { escapeHtml } from '@/lib/utils';
import { sendEmail } from '@/lib/send-email';
import { isQuietHours } from '@/lib/telegram-utils';

const VALID_SLOTS = ['matin', 'apres-midi', 'journee'] as const;
type Slot = typeof VALID_SLOTS[number];

function normalizeSlot(s: unknown, fallback: Slot = 'matin'): Slot {
  return VALID_SLOTS.includes(s as Slot) ? (s as Slot) : fallback;
}

/**
 * Check if a proposed (date, slot) conflicts with an existing confirmed booking.
 * - journee blocks both matin and apres-midi on that date.
 * - matin/apres-midi each only block their own slot — unless the existing booking is journee.
 * Returns the conflicting booking id if any, otherwise null. Optionally excludes a booking id.
 */
async function findSlotConflict(date: string, slot: Slot, excludeBookingId?: number): Promise<number | null> {
  const params: unknown[] = [date];
  let exclude = '';
  if (excludeBookingId) {
    params.push(excludeBookingId);
    exclude = ' AND id != $2';
  }

  // Pull all confirmed bookings on that date (either jour1 or jour2)
  const rows = await query(
    `SELECT id, jour1_date, jour1_slot, jour2_date, jour2_slot
     FROM bookings
     WHERE statut = 'confirme'
       AND (jour1_date = $1 OR jour2_date = $1)${exclude}`,
    params
  );

  for (const r of rows) {
    const existingSlot = (r.jour1_date as Date).toISOString().split('T')[0] === date
      ? (r.jour1_slot as Slot)
      : (r.jour2_slot as Slot);

    // journee on either side blocks anything
    if (slot === 'journee' || existingSlot === 'journee') return r.id as number;
    // same half-day collision
    if (slot === existingSlot) return r.id as number;
  }
  return null;
}

async function notifyTelegramBooking(quoteId: number, clientName: string, jour1: string, jour2: string | null) {
  if (isQuietHours()) return;
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const groupId = process.env.TELEGRAM_GROUP_CHAT_ID;
  const chatIds = groupId
    ? [groupId]
    : getAdminChatIds();
  if (!botToken || chatIds.length === 0) return;

  const msg = [
    `📅 <b>Nouvelle réservation!</b>`,
    ``,
    `<b>Client:</b> ${clientName}`,
    `<b>Jour 1:</b> ${jour1}`,
    jour2 ? `<b>Jour 2:</b> ${jour2}` : '',
    `<b>Devis:</b> #${quoteId}`,
  ].filter(Boolean).join('\n');

  const keyboard = {
    inline_keyboard: [[
      { text: '📋 Voir le devis', url: `https://novus-epoxy.vercel.app/dashboard/devis` },
    ]]
  };

  await Promise.all(chatIds.map(chatId =>
    fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId.trim(), text: msg, parse_mode: 'HTML', reply_markup: keyboard }),
    }).catch(() => {})
  ));
}

// Admin — get booking by quote_id
export async function GET(req: NextRequest) {
  const { auth } = await import('@/lib/auth');
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Non autorise' }, { status: 401 });

  const quoteId = req.nextUrl.searchParams.get('quote_id');
  if (!quoteId) return NextResponse.json({ error: 'quote_id requis' }, { status: 400 });

  const rows = await query(
    `SELECT id, jour1_date, jour1_slot, jour2_date, jour2_slot, statut FROM bookings WHERE quote_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [parseInt(quoteId)]
  );

  if (rows.length === 0) return NextResponse.json({ booking: null });

  const b = rows[0];
  return NextResponse.json({
    booking: {
      id: b.id,
      jour1_date: (b.jour1_date as Date).toISOString().split('T')[0],
      jour1_slot: b.jour1_slot,
      jour2_date: (b.jour2_date as Date).toISOString().split('T')[0],
      jour2_slot: b.jour2_slot,
      statut: b.statut,
    },
  });
}

// Admin — update booking dates (supports both id and quote_id)
export async function PATCH(req: NextRequest) {
  const { auth } = await import('@/lib/auth');
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Non autorise' }, { status: 401 });

  const body = await req.json();
  const { id, quote_id, jour1_date, jour1_slot, jour2_date, jour2_slot } = body;

  const j1Slot = normalizeSlot(jour1_slot, 'matin');
  const j2Slot = normalizeSlot(jour2_slot, 'apres-midi');

  // Update by booking id directly (from calendar edit modal)
  if (id) {
    if (!jour1_date) return NextResponse.json({ error: 'jour1_date requis' }, { status: 400 });

    // Conflict check against other confirmed bookings (exclude this one)
    const c1 = await findSlotConflict(jour1_date, j1Slot, Number(id));
    if (c1) return NextResponse.json({ error: `Conflit : un autre chantier confirme occupe deja ce slot le ${jour1_date}` }, { status: 409 });
    if (jour2_date) {
      const c2 = await findSlotConflict(jour2_date, j2Slot, Number(id));
      if (c2) return NextResponse.json({ error: `Conflit : un autre chantier confirme occupe deja ce slot le ${jour2_date}` }, { status: 409 });
    }

    const result = await query(
      `UPDATE bookings SET jour1_date = COALESCE($2, jour1_date), jour1_slot = $3, jour2_date = $4, jour2_slot = $5, updated_at = NOW() WHERE id = $1 RETURNING *`,
      [id, jour1_date, j1Slot, jour2_date || null, jour2_date ? j2Slot : null]
    );
    if (result.length === 0) return NextResponse.json({ error: 'Booking introuvable' }, { status: 404 });
    return NextResponse.json({ ok: true, booking: result[0] });
  }

  // Legacy: update by quote_id
  if (!quote_id || !jour1_date) {
    return NextResponse.json({ error: 'id ou quote_id requis, avec jour1_date' }, { status: 400 });
  }

  const existing = await query(`SELECT id FROM bookings WHERE quote_id = $1`, [quote_id]);
  const excludeId = existing.length > 0 ? (existing[0].id as number) : undefined;

  const c1 = await findSlotConflict(jour1_date, j1Slot, excludeId);
  if (c1) return NextResponse.json({ error: `Conflit : un autre chantier confirme occupe deja ce slot le ${jour1_date}` }, { status: 409 });
  if (jour2_date) {
    const c2 = await findSlotConflict(jour2_date, j2Slot, excludeId);
    if (c2) return NextResponse.json({ error: `Conflit : un autre chantier confirme occupe deja ce slot le ${jour2_date}` }, { status: 409 });
  }

  if (existing.length === 0) {
    // Create new booking
    await query(
      `INSERT INTO bookings (quote_id, jour1_date, jour1_slot, jour2_date, jour2_slot, statut) VALUES ($1, $2, $3, $4, $5, 'confirme')`,
      [quote_id, jour1_date, j1Slot, jour2_date || null, jour2_date ? j2Slot : 'apres-midi']
    );
    // Link booking to quote and advance status to planifie if depot_paye
    const booking = await query(`SELECT id FROM bookings WHERE quote_id = $1 ORDER BY id DESC LIMIT 1`, [quote_id]);
    if (booking.length > 0) {
      await query(
        `UPDATE quotes SET booking_id = $1, statut = CASE WHEN statut = 'depot_paye' THEN 'planifie' ELSE statut END WHERE id = $2`,
        [booking[0].id, quote_id]
      );
    }
  } else {
    await query(
      `UPDATE bookings SET jour1_date = $1, jour1_slot = $2, jour2_date = $3, jour2_slot = $4, statut = 'confirme', updated_at = NOW() WHERE quote_id = $5`,
      [jour1_date, j1Slot, jour2_date || null, jour2_date ? j2Slot : 'apres-midi', quote_id]
    );
    // Advance status to planifie if depot_paye
    await query(
      `UPDATE quotes SET statut = CASE WHEN statut = 'depot_paye' THEN 'planifie' ELSE statut END WHERE id = $1`,
      [quote_id]
    );
  }

  return NextResponse.json({ ok: true });
}

// DELETE — remove a booking by id (admin only)
export async function DELETE(req: NextRequest) {
  const { auth } = await import('@/lib/auth');
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Non autorise' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id requis' }, { status: 400 });

  const result = await query(`DELETE FROM bookings WHERE id = $1 RETURNING id, quote_id`, [parseInt(id)]);
  if (result.length === 0) return NextResponse.json({ error: 'Booking introuvable' }, { status: 404 });

  return NextResponse.json({ ok: true, deleted: result[0] });
}

// Public endpoint — client books their work dates
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body?.quote_id || !body?.jour1_date) {
    return NextResponse.json({ error: 'quote_id et jour1_date requis' }, { status: 400 });
  }

  const quoteId = parseInt(body.quote_id);
  const jour1Date = body.jour1_date;
  const jour2Date = body.jour2_date;
  const jour1Slot = normalizeSlot(body.jour1_slot, 'matin');
  const jour2Slot = normalizeSlot(body.jour2_slot, 'apres-midi');

  // Verify quote
  const quotes = await query(`SELECT * FROM quotes WHERE id = $1`, [quoteId]);
  if (quotes.length === 0) return NextResponse.json({ error: 'Devis introuvable' }, { status: 404 });

  const q = quotes[0];

  // Verify the requester matches the quote's client email
  const clientEmail = (body.client_email as string | undefined)?.toLowerCase().trim() ?? '';
  const quoteEmail  = (q.client_email as string | undefined)?.toLowerCase().trim() ?? '';
  if (!clientEmail || !quoteEmail || clientEmail !== quoteEmail) {
    return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
  }

  if (!['envoye', 'contrat_signe', 'depot_paye'].includes(q.statut as string)) {
    return NextResponse.json({ error: 'Ce devis ne peut pas être planifié.' }, { status: 400 });
  }

  // Check slots are still available — only confirmed bookings block dates.
  // journee blocks both halves; matin/apres-midi each block their own half.
  const c1 = await findSlotConflict(jour1Date, jour1Slot);
  if (c1) return NextResponse.json({ error: 'Ces dates ne sont plus disponibles' }, { status: 409 });
  if (jour2Date) {
    const c2 = await findSlotConflict(jour2Date, jour2Slot);
    if (c2) return NextResponse.json({ error: 'Ces dates ne sont plus disponibles' }, { status: 409 });
  }

  // Create booking — provisional (en_attente) until deposit is paid
  const rows = await query(
    `INSERT INTO bookings (quote_id, jour1_date, jour1_slot, jour2_date, jour2_slot, statut)
     VALUES ($1, $2, $3, $4, $5, 'en_attente')
     RETURNING id`,
    [quoteId, jour1Date, jour1Slot, jour2Date, jour2Slot]
  );

  const bookingId = rows[0].id as number;

  // Link booking to quote (don't change statut — dates are provisional until deposit)
  await query(
    `UPDATE quotes SET booking_id = $1 WHERE id = $2`,
    [bookingId, quoteId]
  );

  const slotLabelOf = (s: Slot) => s === 'journee' ? '8h-16h (journee complete)' : s === 'matin' ? '8h-12h' : '12h-16h';
  const slotShortOf = (s: Slot) => s === 'journee' ? 'JOURNEE' : s === 'matin' ? 'AM' : 'PM';

  // Notify admin via email
  const adminEmail = process.env.ADMIN_EMAIL;
  if (adminEmail) {
    const slotLabel = slotLabelOf(jour2Slot);
    const slot1Label = slotLabelOf(jour1Slot);
    try {
      const j1 = new Date(jour1Date + 'T12:00:00');
      const j2 = new Date(jour2Date + 'T12:00:00');
      const fmt = (d: Date) => d.toLocaleDateString('fr-CA', { weekday: 'long', day: 'numeric', month: 'long' });

      await sendEmail({
        to: adminEmail,
        subject: `Nouvelle reservation — ${q.client_nom} — ${fmt(j1)}`,
        html: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;background:#fefce8;border-radius:12px;">
            <h2 style="color:#1e293b;margin-bottom:4px;">Nouvelle reservation!</h2>
            <p style="color:#64748b;margin-top:0;">Un client vient de confirmer ses dates de travaux.</p>
            <div style="background:white;padding:16px;border-radius:8px;border-left:4px solid #f59e0b;margin:16px 0;">
              <p style="margin:4px 0;"><strong>Client:</strong> ${escapeHtml(q.client_nom as string)}</p>
              <p style="margin:4px 0;"><strong>Tel:</strong> ${escapeHtml((q.client_tel || 'N/A') as string)}</p>
              <p style="margin:4px 0;"><strong>Email:</strong> ${escapeHtml((q.client_email || 'N/A') as string)}</p>
              <p style="margin:4px 0;"><strong>Service:</strong> ${escapeHtml(q.type_service as string)} — ${q.superficie} pi²</p>
              <p style="margin:4px 0;"><strong>Total:</strong> ${formatMoney(Number(q.total))}</p>
              <p style="margin:4px 0;"><strong>Adresse:</strong> ${escapeHtml((q.client_adresse || 'N/A') as string)}</p>
            </div>
            <div style="background:white;padding:16px;border-radius:8px;margin:16px 0;">
              <p style="margin:4px 0;font-size:16px;"><strong>Jour 1 (prep):</strong> ${fmt(j1)} — ${slot1Label}</p>
              <p style="margin:4px 0;font-size:16px;"><strong>Jour 2 (finition):</strong> ${fmt(j2)} — ${slotLabel}</p>
            </div>
            <a href="https://novus-epoxy.vercel.app/dashboard/calendrier" style="background:#f59e0b;color:#0f172a;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block;margin-right:8px;">Voir le calendrier</a>
            <a href="https://novus-epoxy.vercel.app/dashboard/devis/${quoteId}" style="background:#1e293b;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block;">Voir le devis</a>
          </div>`,
      });
    } catch (err) { console.error('Booking notification email failed:', err); }
  }

  // Email client — next step: sign contract
  if (q.client_email) {
    const secretToken = q.secret_token as string;
    const j1 = new Date(jour1Date + 'T12:00:00');
    const j2 = new Date(jour2Date + 'T12:00:00');
    const fmtDate = (d: Date) => d.toLocaleDateString('fr-CA', { weekday: 'long', day: 'numeric', month: 'long' });
    const slotText = slotLabelOf(jour2Slot);
    const slot1Text = slotLabelOf(jour1Slot);

    try {
      await sendEmail({
        to: q.client_email as string,
        subject: `Dates confirmees — Prochaine etape: signer le contrat — Novus Epoxy #${quoteId}`,
        html: `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:0;background:#ffffff;">
<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:16px;background:#ffffff;">
<table width="100%" cellpadding="0" cellspacing="0" style="border-bottom:2px solid #e2e8f0;margin-bottom:16px;"><tr>
<td style="padding:12px 0;text-align:center;">
<img src="https://novus-epoxy.vercel.app/logo-email.jpg" alt="Novus Epoxy" width="100" height="100" style="border-radius:8px;" />
</td></tr></table>
<h2 style="color:#1e293b;margin:0 0 12px;font-size:20px;">Vos dates sont reservees!</h2>
<p style="margin:0 0 12px;">Bonjour ${escapeHtml(q.client_nom as string)},</p>
<div style="background:#f0fdf4;border:1px solid #22c55e;border-radius:8px;padding:16px;margin:0 0 16px;">
<p style="margin:0 0 6px;font-weight:700;color:#166534;">Dates provisoires :</p>
<p style="margin:0 0 4px;color:#1e293b;">📆 <strong>Jour 1 (preparation):</strong> ${fmtDate(j1)} — ${slot1Text}</p>
<p style="margin:0;color:#1e293b;">📆 <strong>Jour 2 (finition):</strong> ${fmtDate(j2)} — ${slotText}</p>
</div>
<div style="background:#f1f5f9;border-radius:8px;padding:16px;margin:0 0 16px;">
<p style="margin:0 0 4px;color:#1e293b;font-weight:700;">Prochaine etape :</p>
<p style="margin:0;color:#475569;font-size:13px;">Signez le contrat pour officialiser votre reservation. Vos dates seront confirmees des la reception du depot.</p>
</div>
<div style="text-align:center;margin:0 0 16px;">
<a href="https://novus-epoxy.vercel.app/contrat/${quoteId}?token=${encodeURIComponent(secretToken)}"
   style="display:inline-block;background:#0f172a;color:#ffffff;padding:16px 40px;border-radius:8px;text-decoration:none;font-weight:700;font-size:17px;">
  Signer le contrat
</a>
</div>
<div style="background:#f1f5f9;border-radius:6px;padding:10px;margin:0 0 12px;font-size:12px;color:#475569;">
<strong>Facturation / Soumission :</strong> Luca — <a href="tel:5813075983" style="color:#2563eb;">581-307-5983</a><br/>
<strong>Chantier / Soumission :</strong> Jason — <a href="tel:5813072678" style="color:#2563eb;">581-307-2678</a>
</div>
</div></body></html>`,
      });
    } catch (err) { console.error('Client booking email failed:', err); }
  }

  // SMS to admins (both Luca + Jason) with dashboard link
  const adminPhones = [process.env.ADMIN_PHONE, process.env.JASON_PHONE].filter(Boolean) as string[];
  const smsText = `Novus Epoxy: ${q.client_nom} a reserve ses travaux! Jour 1: ${jour1Date} ${slotShortOf(jour1Slot)}, Jour 2: ${jour2Date} ${slotShortOf(jour2Slot)}. Devis #${quoteId}\n${process.env.NEXTAUTH_URL ?? 'https://novus-epoxy.vercel.app'}/dashboard/devis`;
  await Promise.all(adminPhones.map(phone => sendSMS(phone, smsText).catch(() => {})));

  // Telegram to admins
  await notifyTelegramBooking(quoteId, q.client_nom as string, jour1Date, jour2Date).catch(() => {});

  return NextResponse.json({ ok: true, booking_id: bookingId });
}

import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { formatMoney } from '@/lib/pricing';
import { sendSMS } from '@/lib/sms';
import { escapeHtml } from '@/lib/utils';

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

  // Verify the requester matches the quote's client email
  const clientEmail = (body.client_email as string | undefined)?.toLowerCase().trim() ?? '';
  const quoteEmail  = (q.client_email as string | undefined)?.toLowerCase().trim() ?? '';
  if (!clientEmail || !quoteEmail || clientEmail !== quoteEmail) {
    return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
  }

  if (!['envoye', 'contrat_signe', 'depot_paye'].includes(q.statut as string)) {
    return NextResponse.json({ error: 'Ce devis ne peut pas être planifié.' }, { status: 400 });
  }

  // Check slots are still available — only confirmed bookings block dates
  const conflicts = await query(
    `SELECT id FROM bookings
     WHERE statut = 'confirme'
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

  // Create booking — provisional (en_attente) until deposit is paid
  const rows = await query(
    `INSERT INTO bookings (quote_id, jour1_date, jour1_slot, jour2_date, jour2_slot, statut)
     VALUES ($1, $2, 'matin', $3, $4, 'en_attente')
     RETURNING id`,
    [quoteId, jour1Date, jour2Date, jour2Slot]
  );

  const bookingId = rows[0].id as number;

  // Link booking to quote (don't change statut — dates are provisional until deposit)
  await query(
    `UPDATE quotes SET booking_id = $1 WHERE id = $2`,
    [bookingId, quoteId]
  );

  // Notify admin via email
  const apiKey = process.env.RESEND_API_KEY;
  const adminEmail = process.env.ADMIN_EMAIL;
  const from = process.env.EMAIL_FROM ?? 'onboarding@resend.dev';

  if (apiKey && adminEmail) {
    const slotLabel = jour2Slot === 'matin' ? '8h-12h' : '12h-16h';
    try {
      const j1 = new Date(jour1Date + 'T12:00:00');
      const j2 = new Date(jour2Date + 'T12:00:00');
      const fmt = (d: Date) => d.toLocaleDateString('fr-CA', { weekday: 'long', day: 'numeric', month: 'long' });

      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from,
          to: [adminEmail],
          subject: `📅 Nouvelle reservation — ${q.client_nom} — ${fmt(j1)}`,
          html: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;background:#fefce8;border-radius:12px;">
            <h2 style="color:#1e293b;margin-bottom:4px;">📅 Nouvelle reservation!</h2>
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
              <p style="margin:4px 0;font-size:16px;"><strong>Jour 1 (prep):</strong> ${fmt(j1)} — 8h à 12h</p>
              <p style="margin:4px 0;font-size:16px;"><strong>Jour 2 (finition):</strong> ${fmt(j2)} — ${slotLabel}</p>
            </div>
            <div style="margin-top:20px;display:flex;gap:12px;">
              <a href="https://novus-epoxy.vercel.app/dashboard/calendrier"
                 style="background:#f59e0b;color:#0f172a;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;">
                Voir le calendrier
              </a>
              <a href="https://novus-epoxy.vercel.app/dashboard/devis/${quoteId}"
                 style="background:#1e293b;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;">
                Voir le devis
              </a>
            </div>
          </div>`,
        }),
      });
    } catch (err) { console.error('Booking notification email failed:', err); }
  }

  // SMS to admins (both Luca + Jason) with dashboard link
  const adminPhones = [process.env.ADMIN_PHONE, process.env.JASON_PHONE].filter(Boolean) as string[];
  const smsText = `Novus Epoxy: ${q.client_nom} a reserve ses travaux! Jour 1: ${jour1Date} AM, Jour 2: ${jour2Date} ${jour2Slot === 'matin' ? 'AM' : 'PM'}. Devis #${quoteId}\nhttps://novus-epoxy.vercel.app/dashboard/devis`;
  await Promise.all(adminPhones.map(phone => sendSMS(phone, smsText).catch(() => {})));

  // Telegram to admins with "Confirmer depot recu" button
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatIds = (process.env.TELEGRAM_ADMIN_CHAT_IDS ?? '').split(',').filter(Boolean);
  if (botToken) {
    const j1 = new Date(jour1Date + 'T12:00:00');
    const j2 = new Date(jour2Date + 'T12:00:00');
    const fmtD = (d: Date) => d.toLocaleDateString('fr-CA', { weekday: 'long', day: 'numeric', month: 'long' });
    const slotLbl = jour2Slot === 'matin' ? 'AM' : 'PM';

    const tgMsg = `📅 <b>Nouvelle reservation!</b>\n\n👤 ${escapeHtml(q.client_nom as string)}\n📞 ${escapeHtml((q.client_tel || 'N/A') as string)}\n💰 Total: ${formatMoney(Number(q.total))} | Depot: ${formatMoney(Number(q.depot_requis))}\n\n📆 Jour 1: ${fmtD(j1)} — AM\n📆 Jour 2: ${fmtD(j2)} — ${slotLbl}\n\n⏳ En attente du depot (30%)`;

    const buttons = {
      inline_keyboard: [
        [
          { text: '✅ Depot recu — Confirmer', callback_data: `confirm_deposit_${quoteId}` },
        ],
        [
          { text: '📋 Voir le devis', url: `https://novus-epoxy.vercel.app/dashboard/devis` },
        ],
      ],
    };

    await Promise.all(chatIds.map(chatId =>
      fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId.trim(), text: tgMsg, parse_mode: 'HTML', reply_markup: buttons }),
      }).catch(err => console.error('Telegram booking notif error:', err))
    ));
  }

  return NextResponse.json({ ok: true, booking_id: bookingId });
}

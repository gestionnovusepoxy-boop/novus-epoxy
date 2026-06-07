import { NextRequest, NextResponse } from 'next/server';
import { getAdminChatIds } from '@/lib/telegram-utils';
import { query } from '@/lib/db';
import { sendSMS } from '@/lib/sms';
import { sendEmail } from '@/lib/send-email';
import { formatMoney } from '@/lib/pricing';

const GOOGLE_REVIEW_URL = process.env.GOOGLE_REVIEW_URL ?? '';
const BASE_URL = process.env.NEXTAUTH_URL ?? 'https://novus-epoxy.vercel.app';

export const maxDuration = 60;

async function notifyTelegram(text: string, buttons?: Record<string, unknown>) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatIds = getAdminChatIds();
  if (!botToken || !chatIds.length) return;
  await Promise.all(chatIds.map(id =>
    fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: id.trim(), text, parse_mode: 'HTML', ...(buttons ? { reply_markup: buttons } : {}) }),
    }).catch(() => {})
  ));
}

// Vercel Cron — runs daily at 3PM UTC
// 1. Auto-marks bookings complete when jour2 has passed
// 2. Sends final payment reminder to client + Telegram alert to admins
// 3. Sends Google review request 3 days after completion
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')?.replace('Bearer ', '') ?? '';
  const cronSecret = process.env.CRON_SECRET ?? '';
  const adminKey = process.env.ADMIN_API_KEY ?? '';
  if (!authHeader || (authHeader !== cronSecret && authHeader !== adminKey)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // 1. Auto-mark bookings complete — use jour2_date directly (no +1 day offset)
  const newlyCompleted = await query(
    `UPDATE bookings SET statut = 'complete', completed_at = jour2_date
     WHERE statut = 'confirme'
       AND jour2_date < CURRENT_DATE
     RETURNING id AS booking_id, quote_id`,
    []
  );

  // Also update linked quote status to 'complete'
  if (newlyCompleted.length > 0) {
    const quoteIds = (newlyCompleted as Array<{ quote_id: number }>).map(b => b.quote_id).filter(Boolean);
    if (quoteIds.length > 0) {
      await query(
        `UPDATE quotes SET statut = 'complete', updated_at = NOW()
         WHERE id = ANY($1::int[]) AND statut != 'complete'`,
        [quoteIds]
      );
    }
  }

  // 2. For each newly completed booking — alert admins + send client final payment reminder
  for (const b of newlyCompleted as Array<{ booking_id: number; quote_id: number }>) {
    try {
      const details = await query(
        `SELECT q.client_nom, q.client_email, q.client_tel, q.total, q.depot_requis, q.id AS qid, q.secret_token
         FROM quotes q WHERE q.id = $1`,
        [b.quote_id]
      );
      if (!details.length) continue;
      const d = details[0];
      // Balance RÉELLE depuis les paiements (pas total - depot_requis qui assume un dépôt exact).
      const paidRows = await query(
        `SELECT COALESCE(SUM(p.montant),0) AS paid FROM payments p JOIN invoices i ON i.id = p.invoice_id WHERE i.quote_id = $1`,
        [b.quote_id]
      ).catch(() => [{ paid: 0 }]);
      const totalPaid = Number((paidRows[0] as Record<string, unknown>)?.paid ?? 0);
      const balance = Number(d.total ?? 0) - totalPaid;
      const prenom = (d.client_nom as string).split(' ')[0];

      // Telegram alert to admins — job done, balance pending
      await notifyTelegram(
        [
          `✅ <b>Travaux terminés!</b>`,
          ``,
          `👤 ${d.client_nom}`,
          balance > 0 ? `💰 Balance en attente: <b>${formatMoney(balance)}</b>` : `✅ Payé en entier`,
          `📋 Devis #${b.quote_id}`,
        ].join('\n'),
        {
          inline_keyboard: [[
            { text: '💳 Voir soumission', url: `${BASE_URL}/paiement/${b.quote_id}?token=${encodeURIComponent(String(d.secret_token ?? ''))}` },
            { text: '📋 Dashboard', url: `${BASE_URL}/dashboard/devis` },
          ]],
        }
      );

      // Final payment reminder to client by SMS
      if (d.client_tel && balance > 0) {
        await sendSMS(
          d.client_tel as string,
          `Salut ${prenom}! C'est Luca de Novus Epoxy. Vos travaux sont termines! La balance de ${formatMoney(balance)} est maintenant due. Virement Interac a gestionnovusepoxy@gmail.com ou paiement en ligne: ${BASE_URL}/paiement/${b.quote_id}?token=${encodeURIComponent(String(d.secret_token ?? ''))} Questions: 581-307-5983`
        ).catch(() => {});
      }

      // Final payment reminder to client by email
      if (d.client_email && balance > 0) {
        const payUrl = `${BASE_URL}/paiement/${b.quote_id}?token=${encodeURIComponent(String(d.secret_token ?? ''))}`;
        const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:0;background:#f8fafc;">
<div style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;max-width:600px;margin:0 auto;background:#ffffff;">
<div style="background:#0f172a;padding:24px;text-align:center;border-radius:8px 8px 0 0;">
  <img src="https://novus-epoxy.vercel.app/logo-email.jpg" alt="Novus Epoxy" width="80" height="80" style="border-radius:12px;" />
  <h1 style="color:#f59e0b;margin:12px 0 0;font-size:22px;font-weight:700;">Novus Epoxy</h1>
  <p style="color:#94a3b8;margin:4px 0 0;font-size:13px;">Planchers époxy haut de gamme — Québec</p>
</div>
<div style="padding:28px 24px;">
  <h2 style="color:#1e293b;margin:0 0 16px;">Vos travaux sont terminés! 🎉</h2>
  <p>Bonjour ${prenom},</p>
  <p style="color:#475569;line-height:1.7;">Merci de nous avoir fait confiance! Votre nouveau plancher époxy est maintenant prêt.</p>
  <div style="background:#f1f5f9;border-radius:8px;padding:16px;margin:20px 0;">
    <p style="margin:0 0 8px;color:#64748b;font-size:13px;">Balance due:</p>
    <p style="margin:0;font-size:24px;font-weight:700;color:#0f172a;">${formatMoney(balance)}</p>
  </div>
  <p style="color:#475569;">Vous pouvez payer par <strong>virement Interac</strong> à <strong>gestionnovusepoxy@gmail.com</strong> ou en ligne:</p>
  <div style="text-align:center;margin:24px 0;">
    <a href="${payUrl}" style="display:inline-block;background:#f59e0b;color:#0f172a;padding:14px 36px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px;">Payer maintenant →</a>
  </div>
  <div style="border-top:1px solid #e2e8f0;padding-top:20px;margin-top:8px;">
    <p style="color:#1e293b;font-weight:700;font-size:13px;margin:0 0 8px;">Questions? On est disponibles:</p>
    <p style="color:#475569;font-size:13px;margin:0 0 4px;"><strong>Luca</strong> — Facturation — <a href="tel:5813075983" style="color:#2563eb;">581-307-5983</a></p>
    <p style="color:#475569;font-size:13px;margin:0;"><strong>Jason</strong> — Chantier — <a href="tel:5813072678" style="color:#2563eb;">581-307-2678</a></p>
  </div>
</div>
<div style="background:#f1f5f9;padding:12px 24px;text-align:center;border-radius:0 0 8px 8px;">
  <p style="color:#94a3b8;font-size:11px;margin:0;">Novus Epoxy — 44 rue de la Polyvalente, Québec, G2N 1G8</p>
</div>
</div></body></html>`;
        await sendEmail({ to: d.client_email as string, subject: `Vos travaux Novus Epoxy sont terminés — balance de ${formatMoney(balance)}`, html }).catch(() => {});
      }
    } catch (err) {
      console.error('avis: newly completed booking error:', err);
    }
  }

  // 3. Send Google review requests (3 days after completion)
  if (!GOOGLE_REVIEW_URL) {
    return NextResponse.json({
      ok: false,
      error: 'GOOGLE_REVIEW_URL non configuré',
      newly_completed: newlyCompleted.length,
    });
  }

  const rows = await query(
    `SELECT b.id AS booking_id, b.completed_at, q.client_nom, q.client_tel, q.client_email, q.type_service
     FROM bookings b
     JOIN quotes q ON q.id = b.quote_id
     WHERE b.statut = 'complete'
       AND b.avis_sms_sent = FALSE
       AND b.completed_at <= NOW() - INTERVAL '3 days'
       AND (q.client_tel IS NOT NULL OR q.client_email IS NOT NULL)`,
    []
  );

  let sent = 0;

  for (const r of rows) {
    const prenom = (r.client_nom as string).split(' ')[0];
    let attempted = false;

    // SMS avis Google
    if (r.client_tel) {
      await sendSMS(
        r.client_tel as string,
        `Salut ${prenom}! C'est Luca de Novus Epoxy. J'espère que ton plancher est encore aussi beau! Si t'as 30 secondes, un petit avis Google nous aiderait vraiment: ${GOOGLE_REVIEW_URL} Merci! 581-307-5983`
      ).catch(() => {});
      attempted = true;
    }

    // Email avis Google — full branded template with accents
    if (r.client_email) {
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:0;background:#f8fafc;">
<div style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;max-width:600px;margin:0 auto;background:#ffffff;">
<div style="background:#0f172a;padding:24px;text-align:center;border-radius:8px 8px 0 0;">
  <img src="https://novus-epoxy.vercel.app/logo-email.jpg" alt="Novus Epoxy" width="80" height="80" style="border-radius:12px;" />
  <h1 style="color:#f59e0b;margin:12px 0 0;font-size:22px;font-weight:700;">Novus Epoxy</h1>
  <p style="color:#94a3b8;margin:4px 0 0;font-size:13px;">Planchers époxy haut de gamme — Québec</p>
</div>
<div style="padding:28px 24px;">
  <h2 style="color:#1e293b;margin:0 0 16px;">Comment trouvez-vous votre nouveau plancher? ⭐</h2>
  <p>Bonjour ${prenom},</p>
  <p style="color:#475569;line-height:1.7;">On espère que vous profitez de votre nouveau plancher époxy! Votre satisfaction est notre priorité.</p>
  <p style="color:#475569;line-height:1.7;">Si vous êtes satisfait de notre travail, ça nous aiderait énormément si vous pouviez nous laisser un avis Google. Ça prend 30 secondes et ça fait une grande différence pour nous!</p>
  <div style="text-align:center;margin:28px 0;">
    <a href="${GOOGLE_REVIEW_URL}" style="display:inline-block;background:#f59e0b;color:#0f172a;padding:14px 36px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px;">Laisser un avis ⭐</a>
  </div>
  <p style="color:#475569;">Merci encore pour votre confiance!</p>
  <p style="color:#475569;"><strong>L'équipe Novus Epoxy</strong></p>
  <div style="border-top:1px solid #e2e8f0;padding-top:16px;margin-top:16px;">
    <p style="color:#475569;font-size:13px;margin:0 0 2px;"><strong>Luca</strong> — <a href="tel:5813075983" style="color:#2563eb;">581-307-5983</a></p>
    <p style="color:#475569;font-size:13px;margin:0;"><strong>Jason</strong> — <a href="tel:5813072678" style="color:#2563eb;">581-307-2678</a></p>
  </div>
</div>
<div style="background:#f1f5f9;padding:12px 24px;text-align:center;border-radius:0 0 8px 8px;">
  <p style="color:#94a3b8;font-size:11px;margin:0;">Novus Epoxy — 44 rue de la Polyvalente, Québec, G2N 1G8 | novusepoxy.ca</p>
</div>
</div></body></html>`;
      await sendEmail({ to: r.client_email as string, subject: `Comment trouvez-vous votre nouveau plancher? — Novus Epoxy`, html }).catch(() => {});
      attempted = true;
    }

    // Mark as sent regardless of SMS/email success to prevent duplicates
    if (attempted) {
      await query(`UPDATE bookings SET avis_sms_sent = TRUE WHERE id = $1`, [r.booking_id]);
      sent++;
    }
  }

  // Telegram summary if review requests sent
  if (sent > 0) {
    await notifyTelegram(`⭐ <b>Demandes d'avis Google</b>\n\n${sent} demande(s) envoyée(s) aujourd'hui.`);
  }

  return NextResponse.json({
    ok: true,
    newly_completed: newlyCompleted.length,
    review_requests_sent: sent,
    review_requests_found: rows.length,
  });
}

import { NextRequest, NextResponse } from 'next/server';
import { getAdminChatIds } from '@/lib/telegram-utils';
import { query } from '@/lib/db';
import { formatMoney } from '@/lib/pricing';
import { sendFollowUpSMS } from '@/lib/sms';
import { escapeHtml } from '@/lib/utils';
import { sendEmail } from '@/lib/send-email';
import { getQuebecHour } from '@/lib/timezone';

export const maxDuration = 60;

// Vercel Cron — runs every 6 hours to send follow-ups on unanswered quotes
// Relance 1: 48h after sent
// Relance 2: 5 days after sent (SMS + email)
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')?.replace('Bearer ', '') ?? '';
  const cronSecret = process.env.CRON_SECRET ?? '';
  const adminKey = process.env.ADMIN_API_KEY ?? '';
  if (!authHeader || (authHeader !== cronSecret && authHeader !== adminKey)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Only run during business hours (8h–20h Quebec) — no SMS/emails at night
  const h = getQuebecHour();
  if (h < 8 || h >= 20) return NextResponse.json({ skipped: 'outside business hours' });

  // Find quotes sent but not responded to, with no relance or relance due
  // Relance 1: sent >= 48h ago, no relance_1_at
  const relance1 = await query(
    `SELECT id, client_nom, client_email, client_tel, total, depot_requis, sent_at, secret_token
     FROM quotes
     WHERE statut = 'envoye'
       AND sent_at <= NOW() - INTERVAL '48 hours'
       AND relance_1_at IS NULL`,
    []
  );

  // Relance 2: sent >= 5 days ago, relance_1 done, no relance_2_at
  const relance2 = await query(
    `SELECT id, client_nom, client_email, client_tel, total, depot_requis, sent_at, secret_token
     FROM quotes
     WHERE statut = 'envoye'
       AND sent_at <= NOW() - INTERVAL '5 days'
       AND relance_1_at IS NOT NULL
       AND relance_2_at IS NULL`,
    []
  );

  let sent1 = 0;
  let sent2 = 0;

  const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'https://novus-epoxy.vercel.app';

  // Send relance 1 — branded email with quote link
  for (const q of relance1) {
    const prenom = (q.client_nom as string).split(' ')[0];
    const quoteUrl = `${BASE_URL}/paiement/${q.id}?token=${encodeURIComponent(q.secret_token as string)}`;
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:0;background:#f8fafc;">
<div style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;max-width:600px;margin:0 auto;background:#ffffff;">
<div style="background:#0f172a;padding:24px;text-align:center;border-radius:8px 8px 0 0;">
  <img src="https://novus-epoxy.vercel.app/logo-email.jpg" alt="Novus Epoxy" width="80" height="80" style="border-radius:12px;" />
  <h1 style="color:#f59e0b;margin:12px 0 0;font-size:22px;font-weight:700;">Novus Epoxy</h1>
  <p style="color:#94a3b8;margin:4px 0 0;font-size:13px;">Planchers époxy haut de gamme — Québec</p>
</div>
<div style="padding:28px 24px;">
  <p style="font-size:16px;color:#1e293b;">Bonjour ${escapeHtml(prenom)},</p>
  <p style="color:#475569;line-height:1.7;">Votre soumission <strong>#${q.id}</strong> de <strong>${formatMoney(Number(q.total))}</strong> est prête et vous attend. On voulait simplement s'assurer que vous l'avez bien reçue!</p>
  <p style="color:#475569;line-height:1.7;">Si vous avez des questions ou souhaitez ajuster quoi que ce soit, répondez directement à ce courriel — on s'en occupe rapidement.</p>
  <div style="text-align:center;margin:28px 0;">
    <a href="${quoteUrl}" style="display:inline-block;background:#f59e0b;color:#0f172a;padding:14px 36px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px;">Voir ma soumission →</a>
  </div>
  <div style="border-top:1px solid #e2e8f0;padding-top:20px;margin-top:8px;">
    <p style="color:#1e293b;font-weight:700;font-size:13px;margin:0 0 8px;">Une question? On est disponibles:</p>
    <p style="color:#475569;font-size:13px;margin:0 0 4px;"><strong>Luca</strong> — Soumissions &amp; facturation — <a href="tel:5813075983" style="color:#2563eb;">581-307-5983</a></p>
    <p style="color:#475569;font-size:13px;margin:0;"><strong>Jason</strong> — Chantier &amp; soumissions — <a href="tel:5813072678" style="color:#2563eb;">581-307-2678</a></p>
  </div>
  <p style="color:#475569;margin-top:20px;">Bonne journée!<br/><strong>L'équipe Novus Epoxy</strong></p>
</div>
<div style="background:#f1f5f9;padding:12px 24px;text-align:center;border-radius:0 0 8px 8px;">
  <p style="color:#94a3b8;font-size:11px;margin:0;">Novus Epoxy — 44 rue de la Polyvalente, Québec, G2N 1G8 | novusepoxy.ca</p>
</div>
</div></body></html>`;

    if (!q.client_email) continue;
    try {
      await sendEmail({ to: q.client_email as string, subject: `${prenom}, votre soumission Novus Epoxy vous attend`, html });
      await query(`UPDATE quotes SET relance_1_at = NOW() WHERE id = $1`, [q.id]);
      sent1++;
    } catch (err) {
      console.error('Relance 1 error:', err);
    }
  }

  // Send relance 2 — urgency email + SMS
  for (const q of relance2) {
    const prenom = (q.client_nom as string).split(' ')[0];
    const quoteUrl = `${BASE_URL}/paiement/${q.id}?token=${encodeURIComponent(q.secret_token as string)}`;
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:0;background:#f8fafc;">
<div style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;max-width:600px;margin:0 auto;background:#ffffff;">
<div style="background:#0f172a;padding:24px;text-align:center;border-radius:8px 8px 0 0;">
  <img src="https://novus-epoxy.vercel.app/logo-email.jpg" alt="Novus Epoxy" width="80" height="80" style="border-radius:12px;" />
  <h1 style="color:#f59e0b;margin:12px 0 0;font-size:22px;font-weight:700;">Novus Epoxy</h1>
  <p style="color:#94a3b8;margin:4px 0 0;font-size:13px;">Planchers époxy haut de gamme — Québec</p>
</div>
<div style="padding:28px 24px;">
  <p style="font-size:16px;color:#1e293b;">Bonjour ${escapeHtml(prenom)},</p>
  <p style="color:#475569;line-height:1.7;">Notre calendrier se remplit rapidement pour les prochaines semaines. Votre soumission <strong>#${q.id}</strong> de <strong>${formatMoney(Number(q.total))}</strong> est toujours disponible — mais les créneaux partent vite!</p>
  <p style="color:#475569;line-height:1.7;">Si vous avez des hésitations ou des questions, appelez-nous directement — on règle ça en 5 minutes.</p>
  <div style="text-align:center;margin:28px 0;">
    <a href="${quoteUrl}" style="display:inline-block;background:#f59e0b;color:#0f172a;padding:14px 36px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px;">Confirmer mon projet →</a>
  </div>
  <div style="border-top:1px solid #e2e8f0;padding-top:20px;margin-top:8px;">
    <p style="color:#1e293b;font-weight:700;font-size:13px;margin:0 0 8px;">Contactez-nous directement:</p>
    <p style="color:#475569;font-size:13px;margin:0 0 4px;"><strong>Luca</strong> — <a href="tel:5813075983" style="color:#2563eb;">581-307-5983</a></p>
    <p style="color:#475569;font-size:13px;margin:0;"><strong>Jason</strong> — <a href="tel:5813072678" style="color:#2563eb;">581-307-2678</a></p>
  </div>
  <p style="color:#475569;margin-top:20px;">Au plaisir de travailler avec vous,<br/><strong>L'équipe Novus Epoxy</strong></p>
</div>
<div style="background:#f1f5f9;padding:12px 24px;text-align:center;border-radius:0 0 8px 8px;">
  <p style="color:#94a3b8;font-size:11px;margin:0;">Novus Epoxy — 44 rue de la Polyvalente, Québec, G2N 1G8 | novusepoxy.ca</p>
</div>
</div></body></html>`;

    if (!q.client_email) continue;
    try {
      await sendEmail({ to: q.client_email as string, subject: `Dernière chance — votre projet époxy, ${prenom}`, html });
      await query(`UPDATE quotes SET relance_2_at = NOW() WHERE id = $1`, [q.id]);
      sent2++;

      // SMS relance — urgence
      if (q.client_tel) {
        await sendFollowUpSMS(q.client_tel as string, q.client_nom as string, q.id as number)
          .catch(err => console.error('Relance 2 SMS failed:', err));
      }
    } catch (err) {
      console.error('Relance 2 error:', err);
    }
  }

  // Telegram summary if anything sent
  if (sent1 > 0 || sent2 > 0) {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const chatIds = getAdminChatIds();
    if (botToken && chatIds.length) {
      const msg = [`📬 <b>Relances soumissions</b>`, ``, `✅ Relance 1: ${sent1} envoyée(s)`, `🔔 Relance 2: ${sent2} envoyée(s) (avec SMS)`].join('\n');
      await Promise.all(chatIds.map(id =>
        fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: id.trim(), text: msg, parse_mode: 'HTML' }),
        }).catch(() => {})
      ));
    }
  }

  return NextResponse.json({
    ok: true,
    relance_1: { found: relance1.length, sent: sent1 },
    relance_2: { found: relance2.length, sent: sent2 },
  });
}

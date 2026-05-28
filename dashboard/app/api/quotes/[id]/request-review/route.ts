import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { query } from '@/lib/db';
import { sendSMS } from '@/lib/sms';
import { sendEmail } from '@/lib/send-email';

export const maxDuration = 30;

const GOOGLE_REVIEW_URL =
  process.env.GOOGLE_REVIEW_URL ?? 'https://g.page/r/CeAd5U7pHvj_EBM/review';

/**
 * Manually trigger a Google review request for a completed job.
 * Sends SMS + email to the client (same template as cron/avis) and
 * marks quotes.review_requested_at = NOW() so the cron skips it.
 *
 * Auth: requireAdmin (session OR ADMIN_API_KEY via x-api-key).
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const { id } = await params;
  const quoteId = parseInt(id);
  if (!Number.isFinite(quoteId)) {
    return NextResponse.json({ error: 'Invalid quote id' }, { status: 400 });
  }

  const rows = await query(
    `SELECT id, client_nom, client_email, client_tel, statut, review_requested_at
     FROM quotes WHERE id = $1`,
    [quoteId]
  );
  if (!rows[0]) return NextResponse.json({ error: 'Devis introuvable' }, { status: 404 });
  const q = rows[0];

  if (q.statut !== 'complete') {
    return NextResponse.json(
      { error: 'Le projet doit etre marque complete avant de demander un avis' },
      { status: 409 }
    );
  }
  if (q.review_requested_at) {
    return NextResponse.json(
      { error: 'Avis deja demande', already_sent_at: q.review_requested_at },
      { status: 409 }
    );
  }

  const clientNom = (q.client_nom as string) ?? '';
  const prenom = clientNom.split(' ')[0] || clientNom;
  const clientEmail = (q.client_email as string | null) ?? null;
  const clientTel = (q.client_tel as string | null) ?? null;

  let smsSent = false;
  let emailSent = false;

  // SMS — same wording as cron/avis
  if (clientTel) {
    smsSent = await sendSMS(
      clientTel,
      `Salut ${prenom}! C'est Luca de Novus Epoxy. J'espere que ton plancher est encore aussi beau! Si t'as 30 secondes, un petit avis Google nous aiderait vraiment: ${GOOGLE_REVIEW_URL} Merci! 581-307-5983`
    ).catch(() => false);
  }

  // Email — branded template matching cron/avis
  if (clientEmail) {
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:0;background:#f8fafc;">
<div style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;max-width:600px;margin:0 auto;background:#ffffff;">
<div style="background:#0f172a;padding:24px;text-align:center;border-radius:8px 8px 0 0;">
  <img src="https://novus-epoxy.vercel.app/logo-email.jpg" alt="Novus Epoxy" width="80" height="80" style="border-radius:12px;" />
  <h1 style="color:#f59e0b;margin:12px 0 0;font-size:22px;font-weight:700;">Novus Epoxy</h1>
  <p style="color:#94a3b8;margin:4px 0 0;font-size:13px;">Planchers epoxy haut de gamme — Quebec</p>
</div>
<div style="padding:28px 24px;">
  <h2 style="color:#1e293b;margin:0 0 16px;">Comment trouvez-vous votre nouveau plancher? &#11088;</h2>
  <p>Bonjour ${prenom},</p>
  <p style="color:#475569;line-height:1.7;">On espere que vous profitez de votre nouveau plancher epoxy! Votre satisfaction est notre priorite.</p>
  <p style="color:#475569;line-height:1.7;">Si vous etes satisfait de notre travail, ca nous aiderait enormement si vous pouviez nous laisser un avis Google. Ca prend 30 secondes et ca fait une grande difference pour nous!</p>
  <div style="text-align:center;margin:28px 0;">
    <a href="${GOOGLE_REVIEW_URL}" style="display:inline-block;background:#f59e0b;color:#0f172a;padding:14px 36px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px;">Laisser un avis &#11088;</a>
  </div>
  <p style="color:#475569;">Merci encore pour votre confiance!</p>
  <p style="color:#475569;"><strong>L'equipe Novus Epoxy</strong></p>
  <div style="border-top:1px solid #e2e8f0;padding-top:16px;margin-top:16px;">
    <p style="color:#475569;font-size:13px;margin:0 0 2px;"><strong>Luca</strong> — <a href="tel:5813075983" style="color:#2563eb;">581-307-5983</a></p>
    <p style="color:#475569;font-size:13px;margin:0;"><strong>Jason</strong> — <a href="tel:5813072678" style="color:#2563eb;">581-307-2678</a></p>
  </div>
</div>
<div style="background:#f1f5f9;padding:12px 24px;text-align:center;border-radius:0 0 8px 8px;">
  <p style="color:#94a3b8;font-size:11px;margin:0;">Novus Epoxy — 44 rue de la Polyvalente, Quebec, G2N 1G8 | novusepoxy.ca</p>
</div>
</div></body></html>`;
    try {
      await sendEmail({
        to: clientEmail,
        subject: 'Comment trouvez-vous votre nouveau plancher? — Novus Epoxy',
        html,
      });
      emailSent = true;
    } catch (err) {
      console.error('[request-review] email failed:', err);
    }
  }

  if (!smsSent && !emailSent) {
    return NextResponse.json(
      { error: 'Aucun canal disponible — client sans email ni telephone' },
      { status: 422 }
    );
  }

  await query(
    `UPDATE quotes SET review_requested_at = NOW() WHERE id = $1`,
    [quoteId]
  ).catch(() => { /* column may not exist on old DBs */ });

  return NextResponse.json({ ok: true, sms_sent: smsSent, email_sent: emailSent });
}

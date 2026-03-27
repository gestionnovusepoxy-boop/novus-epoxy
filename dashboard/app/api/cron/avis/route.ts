import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { sendSMS } from '@/lib/sms';
import { sendEmail } from '@/lib/send-email';

// TODO: Replace with real Google review link once Google Business Profile is verified
const GOOGLE_REVIEW_URL = process.env.GOOGLE_REVIEW_URL ?? 'https://novusepoxy.ca';

// Vercel Cron — runs daily to send Google review requests
// Sends SMS 3 days after work is completed
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')?.replace('Bearer ', '') ?? '';
  const cronSecret = process.env.CRON_SECRET ?? '';
  if (!cronSecret || !authHeader || cronSecret !== authHeader) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Find completed bookings where jour2 was 3+ days ago and no review SMS sent yet
  // Auto-mark as complete if jour2 has passed
  await query(
    `UPDATE bookings SET statut = 'complete', completed_at = (jour2_date + INTERVAL '1 day')
     WHERE statut = 'confirme'
       AND jour2_date < CURRENT_DATE`,
    []
  );

  // Also update quote status to 'complete'
  await query(
    `UPDATE quotes SET statut = 'complete'
     WHERE id IN (
       SELECT quote_id FROM bookings WHERE statut = 'complete'
     ) AND statut != 'complete'`,
    []
  );

  // Find bookings completed 3+ days ago, review SMS not yet sent
  const rows = await query(
    `SELECT b.id AS booking_id, b.completed_at, q.client_nom, q.client_tel, q.client_email, q.type_service
     FROM bookings b
     JOIN quotes q ON q.id = b.quote_id
     WHERE b.statut = 'complete'
       AND b.avis_sms_sent = FALSE
       AND b.completed_at <= NOW() - INTERVAL '3 days'
       AND q.client_tel IS NOT NULL`,
    []
  );

  let sent = 0;

  for (const r of rows) {
    const prenom = (r.client_nom as string).split(' ')[0];

    // Pas de SMS pour avis Google — email seulement, on évite le spam
    const smsOk = true; // Skip SMS, mark as sent

    // Send email
    if (r.client_email) {
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:0;">
<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;">
<h2 style="color:#1e293b;margin:0 0 16px;">Comment trouvez-vous votre nouveau plancher?</h2>
<p>Bonjour ${prenom},</p>
<p>On espere que vous profitez de votre nouveau plancher epoxy! Votre satisfaction est notre priorite.</p>
<p>Si vous etes satisfait de notre travail, ca nous aiderait enormement si vous pouviez nous laisser un avis Google. Ca prend 30 secondes et ca fait une grande difference pour nous!</p>
<p style="margin:24px 0;text-align:center;">
  <a href="${GOOGLE_REVIEW_URL}" style="background:#f59e0b;color:#0f172a;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:700;font-size:16px;display:inline-block;">
    Laisser un avis ⭐
  </a>
</p>
<p>Merci encore pour votre confiance!</p>
<p><strong>L'equipe Novus Epoxy</strong></p>
<hr style="border:none;border-top:1px solid #e2e8f0;margin:20px 0;" />
<p style="color:#94a3b8;font-size:12px;">Novus Epoxy — Planchers epoxy haut de gamme<br/>novusepoxy.ca</p>
</div></body></html>`;

      try {
        await sendEmail({ to: r.client_email as string, subject: `Comment trouvez-vous votre nouveau plancher? — Novus Epoxy`, html });
      } catch (err) { console.error('Review email failed:', err); }
    }

    if (smsOk) {
      await query(`UPDATE bookings SET avis_sms_sent = TRUE WHERE id = $1`, [r.booking_id]);
      sent++;
    }
  }

  return NextResponse.json({
    ok: true,
    completed_bookings_updated: true,
    review_requests_sent: sent,
    review_requests_found: rows.length,
  });
}

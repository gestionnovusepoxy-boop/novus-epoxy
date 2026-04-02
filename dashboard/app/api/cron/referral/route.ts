import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { sendReferralSMS } from '@/lib/sms';

export const maxDuration = 60;

// Vercel Cron — runs weekly to send referral SMS 6 months after completed work
// 1 single SMS per client, never repeated
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')?.replace('Bearer ', '') ?? '';
  const cronSecret = process.env.CRON_SECRET ?? '';
  const adminKey = process.env.ADMIN_API_KEY ?? '';
  if (!authHeader || (authHeader !== cronSecret && authHeader !== adminKey)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Find completed bookings where work was done ~6 months ago and no referral SMS sent
  const rows = await query(
    `SELECT b.id AS booking_id, q.client_nom, q.client_tel
     FROM bookings b
     JOIN quotes q ON q.id = b.quote_id
     WHERE b.statut = 'complete'
       AND b.completed_at <= NOW() - INTERVAL '180 days'
       AND b.completed_at > NOW() - INTERVAL '190 days'
       AND COALESCE(b.referral_sms_sent, FALSE) = FALSE
       AND q.client_tel IS NOT NULL`,
    []
  );

  let sent = 0;

  for (const r of rows) {
    const ok = await sendReferralSMS(
      r.client_tel as string,
      r.client_nom as string
    ).catch(() => false);

    if (ok) {
      await query(`UPDATE bookings SET referral_sms_sent = TRUE WHERE id = $1`, [r.booking_id]);
      sent++;
    }
  }

  return NextResponse.json({
    ok: true,
    referrals_found: rows.length,
    referrals_sent: sent,
  });
}

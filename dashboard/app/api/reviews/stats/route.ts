import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')?.replace('Bearer ', '') ?? '';
  const adminKey = process.env.ADMIN_API_KEY ?? '';
  const cronSecret = process.env.CRON_SECRET ?? '';
  if (adminKey && authHeader !== adminKey && authHeader !== cronSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Total review SMS requests sent
  const totalRows = await query(
    `SELECT COUNT(*)::int AS count FROM bookings WHERE avis_sms_sent = TRUE`,
    []
  );
  const totalSent = (totalRows[0]?.count as number) ?? 0;

  // Review email requests (emails with review-related subjects)
  const emailRows = await query(
    `SELECT COUNT(*)::int AS count FROM email_logs WHERE (LOWER(sujet) LIKE '%avis%' OR LOWER(sujet) LIKE '%review%' OR LOWER(sujet) LIKE '%plancher%nouveau%')`,
    []
  );
  const emailsSent = (emailRows[0]?.count as number) ?? 0;

  // Last review request date
  const lastRow = await query(
    `SELECT MAX(completed_at) AS last_date FROM bookings WHERE avis_sms_sent = TRUE`,
    []
  );
  const lastDate = lastRow[0]?.last_date
    ? new Date(lastRow[0].last_date as string).toISOString()
    : null;

  return NextResponse.json({
    total_sms_sent: totalSent,
    total_emails_sent: emailsSent,
    last_request_date: lastDate,
    google_review_url: process.env.GOOGLE_REVIEW_URL ?? 'https://g.page/r/CeAd5U7pHvj_EBM/review',
  });
}

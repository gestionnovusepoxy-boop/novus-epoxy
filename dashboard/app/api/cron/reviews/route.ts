import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

const GOOGLE_REVIEW_URL = process.env.GOOGLE_REVIEW_URL ?? 'https://g.page/r/CeAd5U7pHvj_EBM/review';
const GOOGLE_BUSINESS_URL = 'https://business.google.com/dashboard';

async function sendTelegram(chatId: string, text: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
  }).catch(err => console.error('Telegram error:', err));
}

// Weekly Monday 10am — Google Reviews reminder for admins
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')?.replace('Bearer ', '') ?? '';
  const cronSecret = process.env.CRON_SECRET ?? '';
  if (!cronSecret || !authHeader || cronSecret !== authHeader) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Count review requests sent (from avis cron) in the last 7 days
  const weekRows = await query(
    `SELECT COUNT(*)::int AS count FROM bookings WHERE avis_sms_sent = TRUE AND completed_at > NOW() - INTERVAL '7 days'`,
    []
  );
  const weekCount = (weekRows[0]?.count as number) ?? 0;

  // Total review requests ever sent
  const totalRows = await query(
    `SELECT COUNT(*)::int AS count FROM bookings WHERE avis_sms_sent = TRUE`,
    []
  );
  const totalCount = (totalRows[0]?.count as number) ?? 0;

  // Count email review requests (emails with 'avis' or 'review' in subject)
  const emailRows = await query(
    `SELECT COUNT(*)::int AS count FROM email_logs WHERE (LOWER(sujet) LIKE '%avis%' OR LOWER(sujet) LIKE '%review%' OR LOWER(sujet) LIKE '%plancher%')`,
    []
  );
  const emailCount = (emailRows[0]?.count as number) ?? 0;

  // Last review request date
  const lastRow = await query(
    `SELECT MAX(completed_at) AS last_date FROM bookings WHERE avis_sms_sent = TRUE`,
    []
  );
  const lastDate = lastRow[0]?.last_date
    ? new Date(lastRow[0].last_date as string).toLocaleDateString('fr-CA')
    : 'Aucune';

  const msg = [
    '<b>Rappel hebdomadaire — Avis Google</b>',
    '',
    `Demandes d'avis envoyees cette semaine: <b>${weekCount}</b>`,
    `Demandes d'avis par email (total): <b>${emailCount}</b>`,
    `Total demandes SMS envoyees: <b>${totalCount}</b>`,
    `Derniere demande: ${lastDate}`,
    '',
    `Pensez a verifier et repondre aux nouveaux avis Google!`,
    '',
    `Voir les avis: ${GOOGLE_REVIEW_URL}`,
    `Google Business: ${GOOGLE_BUSINESS_URL}`,
  ].join('\n');

  // Send to all admin chat IDs
  const chatIds = (process.env.TELEGRAM_ADMIN_CHAT_IDS ?? '').split(',').filter(Boolean);
  for (const chatId of chatIds) {
    await sendTelegram(chatId.trim(), msg);
  }

  return NextResponse.json({
    ok: true,
    week_review_requests: weekCount,
    total_review_requests: totalCount,
    email_review_requests: emailCount,
    last_request_date: lastDate,
    notified_admins: chatIds.length,
  });
}

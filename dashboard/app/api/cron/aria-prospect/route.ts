import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const maxDuration = 60;

// Aria prospect cron — sends pending prospect emails in batches of 8
// Runs via external cron (cron-job.org) every 10 minutes during business hours
// Echo monitors systems. Aria handles leads.

async function sendTelegram(text: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_GROUP_CHAT_ID ?? process.env.TELEGRAM_ADMIN_CHAT_IDS?.split(',')[0];
  if (!token || !chatId) return;
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
  }).catch(() => {});
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization') ?? '';
  const token = authHeader.replace('Bearer ', '');
  const adminKey = process.env.ADMIN_API_KEY ?? '';
  const cronSecret = process.env.CRON_SECRET ?? '';
  if (adminKey && token !== adminKey && token !== cronSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Business hours only: 8h-20h Quebec (EDT = UTC-4)
  const now = new Date();
  const quebecHour = (now.getUTCHours() - 4 + 24) % 24;
  if (quebecHour < 8 || quebecHour >= 20) {
    return NextResponse.json({ ok: true, message: `Hors heures (${quebecHour}h). Prochain envoi a 8h.` });
  }

  // Get pending leads (email or phone)
  const pending = await query(
    `SELECT id FROM crm_leads WHERE statut = 'nouveau' AND prospect_sent_at IS NULL AND (
      (email IS NOT NULL AND email != '') OR (telephone IS NOT NULL AND telephone != '')
    ) ORDER BY id LIMIT 15`
  );

  if (pending.length === 0) {
    return NextResponse.json({ ok: true, message: 'Aucun lead en attente', emails: 0, sms: 0 });
  }

  const ids = pending.map(r => (r as { id: number }).id);
  const baseUrl = process.env.NEXTAUTH_URL ?? 'https://novus-epoxy.vercel.app';

  const res = await fetch(`${baseUrl}/api/leads/jason/prospect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': adminKey },
    body: JSON.stringify({ leadIds: ids }),
  });

  const result = await res.json().catch(() => ({})) as Record<string, unknown>;
  const emailsSent = Number(result.emails ?? 0);
  const smsSent = Number(result.sms ?? 0);

  // Check how many are still pending
  const remaining = await query(
    `SELECT COUNT(*)::int as c FROM crm_leads WHERE statut = 'nouveau' AND prospect_sent_at IS NULL AND (
      (email IS NOT NULL AND email != '') OR (telephone IS NOT NULL AND telephone != '')
    )`
  );
  const remainingCount = (remaining[0]?.c as number) || 0;

  // Notify group only if something was sent
  if (emailsSent > 0 || smsSent > 0) {
    await sendTelegram(
      `🤖 <b>Aria — Envoi prospect</b>\n\n` +
      `📧 ${emailsSent} emails envoyes\n` +
      (smsSent > 0 ? `📱 ${smsSent} SMS envoyes\n` : '') +
      `📊 ${remainingCount} leads en attente\n\n` +
      (remainingCount > 0 ? `<i>Prochain envoi dans 10 min.</i>` : `<i>Tous les leads ont ete contactes!</i>`)
    );
  }

  return NextResponse.json({ ok: true, emails: emailsSent, sms: smsSent, remaining: remainingCount });
}

export async function POST(req: NextRequest) {
  return GET(req);
}

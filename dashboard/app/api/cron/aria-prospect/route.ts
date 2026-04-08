import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const maxDuration = 60;

// Aria prospect cron — sends pending prospect emails in batches of 8
// Runs via external cron (cron-job.org) every 10 minutes during business hours
// Echo monitors systems. Aria handles leads.

async function sendTelegram(text: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_GROUP_CHAT_ID ?? process.env.TELEGRAM_ADMIN_CHAT_IDS?.split(',').find(id => id.trim().startsWith('-')) ?? process.env.TELEGRAM_ADMIN_CHAT_IDS?.split(',')[0];
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
  const cronSecret = process.env.CRON_SECRET ?? '';
  const adminKey = process.env.ADMIN_API_KEY ?? '';
  if (!token || (token !== cronSecret && token !== adminKey)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Business hours only: 8h-21h Quebec (auto DST)
  const now = new Date();
  const quebecHour = parseInt(now.toLocaleString('en-US', { timeZone: 'America/Toronto', hour: 'numeric', hour12: false }));
  if (quebecHour < 8 || quebecHour >= 20) {
    return NextResponse.json({ ok: true, message: `Hors heures (${quebecHour}h). Prochain envoi a 8h.` });
  }

  // Get pending leads (email or phone)
  const pending = await query(
    `SELECT id FROM crm_leads WHERE statut = 'nouveau' AND prospect_sent_at IS NULL AND (
      (email IS NOT NULL AND email != '') OR (telephone IS NOT NULL AND telephone != '')
    ) ORDER BY id LIMIT 10`
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

  // Get deliverability stats for today
  const todayStats = await query(`
    SELECT
      COUNT(*)::int as total,
      COUNT(CASE WHEN statut = 'delivered' THEN 1 END)::int as delivered,
      COUNT(CASE WHEN statut = 'opened' THEN 1 END)::int as opened,
      COUNT(CASE WHEN statut = 'clicked' THEN 1 END)::int as clicked,
      COUNT(CASE WHEN statut = 'bounced' THEN 1 END)::int as bounced,
      COUNT(CASE WHEN statut = 'complained' THEN 1 END)::int as complained
    FROM email_logs WHERE created_at >= CURRENT_DATE
  `).catch(() => [{ total: 0, delivered: 0, opened: 0, clicked: 0, bounced: 0, complained: 0 }]);
  const st = todayStats[0];
  const delivRate = Number(st.total) > 0 ? Math.round(Number(st.delivered) / Number(st.total) * 100) : 0;
  const openRate = Number(st.total) > 0 ? Math.round(Number(st.opened) / Number(st.total) * 100) : 0;

  // Total leads stats
  const totalLeads = await query(`SELECT COUNT(*)::int as c FROM crm_leads`).catch(() => [{ c: 0 }]);
  const totalContacted = await query(`SELECT COUNT(*)::int as c FROM crm_leads WHERE prospect_sent_at IS NOT NULL`).catch(() => [{ c: 0 }]);

  // Notify group ONLY when all leads are done (single summary, not every batch)
  if ((emailsSent > 0 || smsSent > 0) && remainingCount === 0) {
    const progressBar = remainingCount > 0
      ? `${'█'.repeat(Math.round((Number(totalContacted[0].c) / Number(totalLeads[0].c)) * 20))}${'░'.repeat(20 - Math.round((Number(totalContacted[0].c) / Number(totalLeads[0].c)) * 20))}`
      : '████████████████████';
    const progressPct = Number(totalLeads[0].c) > 0 ? Math.round(Number(totalContacted[0].c) / Number(totalLeads[0].c) * 100) : 100;

    await sendTelegram(
      `🤖 <b>Aria — Rapport d'envoi</b>\n\n` +
      `<b>Ce batch:</b>\n` +
      `📧 ${emailsSent} emails envoyes\n` +
      (smsSent > 0 ? `📱 ${smsSent} SMS envoyes\n` : '') +
      `\n<b>Aujourd'hui:</b>\n` +
      `📨 ${st.total} emails envoyes au total\n` +
      `✅ ${st.delivered} livres (${delivRate}%)\n` +
      `👀 ${st.opened} ouverts (${openRate}%)\n` +
      `🖱 ${st.clicked} cliques\n` +
      (Number(st.bounced) > 0 ? `❌ ${st.bounced} bounces\n` : '') +
      (Number(st.complained) > 0 ? `⚠️ ${st.complained} spam\n` : '') +
      `\n<b>Progression:</b>\n` +
      `${progressBar} ${progressPct}%\n` +
      `👥 ${totalContacted[0].c}/${totalLeads[0].c} leads contactes\n` +
      `📊 ${remainingCount} en attente\n\n` +
      (remainingCount > 0 ? `<i>⏭ Prochain envoi dans 10 min.</i>` : `🎉 <b>Tous les leads ont ete contactes!</b>`)
    );
  }

  return NextResponse.json({ ok: true, emails: emailsSent, sms: smsSent, remaining: remainingCount });
}

export async function POST(req: NextRequest) {
  return GET(req);
}

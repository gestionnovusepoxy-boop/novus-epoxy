/**
 * Cron quotidien — lead-hygiene
 *
 * Audit + reporting:
 *   1. Mark crm_leads en 'mauvais_contact' si l'email a bounce (kv_store has
 *      lead_block_email_<email>). Les emails sont déjà bloqués au niveau
 *      blocklist; ce cron synchronise crm_leads.statut au cas où.
 *   2. Compter les nouveaux blocages depuis 24h (par raison) et envoyer un
 *      Telegram digest au groupe.
 *   3. Détecter les leads avec ≥2 bounces consécutifs sans engagement → mark
 *      mauvais_contact + block.
 *
 * Pas de hard-delete par défaut. Soft mark uniquement (Luca purge manuellement
 * via le dashboard si besoin).
 */
import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { blockLead } from '@/lib/lead-blocklist';

export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')?.replace('Bearer ', '') ?? '';
  const cronSecret = process.env.CRON_SECRET ?? '';
  const adminKey = process.env.ADMIN_API_KEY ?? '';
  if (!authHeader || (authHeader !== cronSecret && authHeader !== adminKey)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let leads_double_bounced = 0;
  let leads_synced_from_blocklist = 0;

  // 1. Leads avec ≥2 bounces consécutifs en 7 jours → block + mauvais_contact
  try {
    const bounced = await query(
      `SELECT LOWER(destinataire) AS email, COUNT(*)::int AS n
       FROM email_logs
       WHERE statut = 'bounced' AND created_at > NOW() - INTERVAL '7 days'
       GROUP BY LOWER(destinataire)
       HAVING COUNT(*) >= 2`
    ) as Array<{ email: string; n: number }>;
    for (const b of bounced) {
      const r = await blockLead({ email: b.email, reason: 'bounce', detail: `${b.n} bounces en 7j` });
      if (r.blocked) leads_double_bounced++;
    }
  } catch { /* ignore */ }

  // 2. Sync crm_leads avec blocklist: tout email présent dans lead_block_email_*
  //    et dont le lead n'est pas encore en mauvais_contact → mark
  try {
    const blockedEmails = await query(
      `SELECT replace(key, 'lead_block_email_', '') AS email
       FROM kv_store WHERE key LIKE 'lead_block_email_%'`
    ) as Array<{ email: string }>;
    if (blockedEmails.length > 0) {
      const lowered = blockedEmails.map(b => b.email);
      const updated = await query(
        `UPDATE crm_leads
         SET statut = 'mauvais_contact', updated_at = NOW()
         WHERE LOWER(email) = ANY($1::text[]) AND statut != 'mauvais_contact'
         RETURNING id`,
        [lowered]
      ) as Array<{ id: number }>;
      leads_synced_from_blocklist = updated.length;
    }
  } catch { /* ignore */ }

  // 3. Telegram digest — compter les nouveaux blocages (par raison) en 24h
  const stats: Record<string, number> = { bounce: 0, complaint: 0, unsubscribed: 0, spam_report: 0, manual: 0 };
  try {
    const recentBlocks = await query(
      `SELECT value FROM kv_store WHERE key LIKE 'lead_block_email_%' OR key LIKE 'lead_block_phone_%'
       AND value::text > '{}'`
    ) as Array<{ value: unknown }>;
    for (const row of recentBlocks) {
      try {
        const v = typeof row.value === 'string' ? JSON.parse(row.value) : row.value;
        const at = v?.at ? new Date(v.at) : null;
        if (at && Date.now() - at.getTime() < 24 * 3600 * 1000) {
          const reason = String(v?.reason ?? 'manual');
          stats[reason] = (stats[reason] ?? 0) + 1;
        }
      } catch { /* skip malformed */ }
    }
  } catch { /* ignore */ }

  const totalToday = Object.values(stats).reduce((a, b) => a + b, 0);
  if (totalToday > 0) {
    const tok = process.env.TELEGRAM_BOT_TOKEN;
    const chat = (process.env.TELEGRAM_GROUP_CHAT_ID ?? '').trim();
    if (tok && chat) {
      const lines = [
        `🧹 <b>Lead hygiene — bilan 24h</b>`,
        ``,
        `Total leads bloqués: <b>${totalToday}</b>`,
        ...Object.entries(stats)
          .filter(([, n]) => n > 0)
          .map(([reason, n]) => {
            const label = reason === 'bounce' ? '📭 Bounces (mauvaise adresse)'
              : reason === 'complaint' ? '😡 Plaintes (harcèlement, stop)'
              : reason === 'unsubscribed' ? '🚫 Désabonnés (STOP)'
              : reason === 'spam_report' ? '⚠️ Marqués spam'
              : '✋ Bloqués manuellement';
            return `  ${label}: ${n}`;
          }),
        '',
        `🔧 Auto-synced ${leads_synced_from_blocklist} leads CRM → mauvais_contact`,
        leads_double_bounced > 0 ? `🔧 Auto-bloqué ${leads_double_bounced} email(s) avec ≥2 bounces en 7j` : '',
      ].filter(Boolean).join('\n');
      await fetch(`https://api.telegram.org/bot${tok}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chat, text: lines, parse_mode: 'HTML' }),
      }).catch(() => {});
    }
  }

  return NextResponse.json({
    ok: true,
    leads_double_bounced,
    leads_synced_from_blocklist,
    stats_24h: stats,
    total_blocked_24h: totalToday,
  });
}

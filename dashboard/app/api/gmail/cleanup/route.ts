import { NextRequest, NextResponse } from 'next/server';
import { getAdminChatIds } from '@/lib/telegram-utils';
import { google } from 'googleapis';
import { query } from '@/lib/db';

export const maxDuration = 120;

async function getGmailClient() {
  let clientId = (process.env.GOOGLE_WEB_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || '');
  let clientSecret = (process.env.GOOGLE_WEB_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET || '');
  let refreshToken = process.env.GOOGLE_REFRESH_TOKEN ?? '';
  try {
    const rows = await query(`SELECT key, value FROM kv_store WHERE key IN ('google_client_id','google_client_secret','google_refresh_token')`);
    for (const row of (rows ?? [])) {
      if (row.key === 'google_client_id' && row.value) clientId = row.value as string;
      if (row.key === 'google_client_secret' && row.value) clientSecret = row.value as string;
      if (row.key === 'google_refresh_token' && row.value) refreshToken = row.value as string;
    }
  } catch { /* ignore */ }
  if (!clientId || !clientSecret || !refreshToken) return null;
  const oauth2 = new google.auth.OAuth2(clientId, clientSecret);
  oauth2.setCredentials({ refresh_token: refreshToken });
  return google.gmail({ version: 'v1', auth: oauth2 });
}

async function batchTrash(gmail: ReturnType<typeof google.gmail>, q: string, maxItems = 200): Promise<number> {
  let total = 0;
  let pageToken: string | undefined;
  do {
    const res = await gmail.users.messages.list({ userId: 'me', q, maxResults: 200, pageToken });
    const msgs = res.data.messages ?? [];
    for (const m of msgs) {
      if (total >= maxItems) break;
      try { await gmail.users.messages.trash({ userId: 'me', id: m.id! }); total++; } catch { /* skip */ }
    }
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken && total < maxItems);
  return total;
}

async function batchArchive(gmail: ReturnType<typeof google.gmail>, q: string, maxItems = 200): Promise<number> {
  let total = 0;
  const res = await gmail.users.messages.list({ userId: 'me', q, maxResults: maxItems });
  const msgs = res.data.messages ?? [];
  for (const m of msgs) {
    try {
      await gmail.users.messages.modify({ userId: 'me', id: m.id!, requestBody: { removeLabelIds: ['INBOX', 'UNREAD'] } });
      total++;
    } catch { /* skip */ }
  }
  return total;
}

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization') ?? '';
  const token = authHeader.replace('Bearer ', '');
  const adminKey = process.env.ADMIN_API_KEY ?? '';
  const cronSecret = process.env.CRON_SECRET ?? '';
  if (!token || (token !== adminKey && token !== cronSecret)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const gmail = await getGmailClient();
  if (!gmail) return NextResponse.json({ error: 'Gmail not configured' }, { status: 500 });

  const results: Record<string, number> = {};
  let total = 0;

  // ─────────────────────────────────────────────────────────────────────────
  // RÈGLE D'OR (réécriture sécuritaire — Luca 22 juin): on NE SUPPRIME que du
  // junk 100% identifiable par EXPÉDITEUR ou CATÉGORIE système. On ne supprime
  // JAMAIS par âge ni par sujet dans la boîte principale, et JAMAIS un email
  // avec une PIÈCE JOINTE (les clients envoient des photos!). Le doute = on garde.
  // GUARD est ajouté à CHAQUE requête: protège pièces jointes + paiements + clients.
  // ─────────────────────────────────────────────────────────────────────────
  const GUARD = '-has:attachment -from:stripe.com -from:interac -from:desjardins -from:td.com -from:rbc.com -from:bmo.com -from:paypal -from:revenuquebec -from:cra-arc.gc.ca -from:gmail.com -from:hotmail.com -from:outlook.com -from:yahoo -from:videotron -from:cgocable -from:sympatico';

  // 1. BOUNCES & échecs de remise (pas des clients)
  const bounces = await batchTrash(gmail, `(from:mailer-daemon OR from:postmaster OR subject:"Address not found" OR subject:"Undeliverable" OR subject:"Mail delivery failed" OR subject:"Delivery Status Notification" OR subject:"échec de la remise") ${GUARD}`, 500);
  if (bounces > 0) { results['bounces'] = bounces; total += bounces; }

  // 2. NOTIFICATIONS SYSTÈME/DEV (expéditeurs connus, jamais des clients)
  const system = await batchTrash(gmail, `(from:sentry.io OR from:notifications@github.com OR from:noreply@github.com OR from:no-reply@vercel.com OR from:notifications@vercel.com OR from:supabase.io OR from:anthropic.com OR from:google-workspace-noreply@google.com OR from:no-reply@accounts.google.com) older_than:7d ${GUARD}`, 1000);
  if (system > 0) { results['system_notifs'] = system; total += system; }

  // 3. RÉSEAUX SOCIAUX (notifications, pas des clients)
  const fb = await batchTrash(gmail, `(from:facebookmail.com OR from:instagram.com) ${GUARD}`, 500);
  if (fb > 0) { results['social_notifs'] = fb; total += fb; }

  // 4. CATÉGORIES GMAIL Promotions/Social/Updates (jamais la Primary, jamais pièces jointes)
  const promos = await batchTrash(gmail, `category:promotions ${GUARD}`, 1000);
  if (promos > 0) { results['promotions'] = promos; total += promos; }
  const social = await batchTrash(gmail, `category:social ${GUARD}`, 500);
  if (social > 0) { results['social'] = social; total += social; }
  const updates = await batchTrash(gmail, `category:updates ${GUARD}`, 1000);
  if (updates > 0) { results['updates'] = updates; total += updates; }

  // 5. DMARC reports + mailinblack (bots, jamais des clients)
  const dmarc = await batchTrash(gmail, `(from:dmarcreport OR subject:"Report Domain:" OR from:mailinblack.com OR from:invitations.mailinblack.com) ${GUARD}`, 500);
  if (dmarc > 0) { results['dmarc_bots'] = dmarc; total += dmarc; }

  // 6. NOS PROPRES copies BCC de devis > 1 jour (envoyées par nous-mêmes pour vérif)
  const devisCopies = await batchTrash(gmail, 'from:gestionnovusepoxy@gmail.com older_than:1d (subject:"Soumission Novus Epoxy" OR subject:"Solde à payer") -has:attachment', 200);
  if (devisCopies > 0) { results['devis_copies'] = devisCopies; total += devisCopies; }

  // 7. ARCHIVER (PAS supprimer) nos propres copies sortantes — restent dans Tous les messages
  const systemCopies = await batchArchive(gmail, '(from:gestionnovusepoxy@gmail.com OR from:info@novusepoxy.shop) in:inbox', 500);
  if (systemCopies > 0) { results['system_copies_archived'] = systemCopies; total += systemCopies; }

  // RETIRÉ (trop dangereux — supprimait de vrais clients/photos):
  // - suppression par âge (>90j, >7j), par sujet "Planchers"/"époxy"/"question rapide",
  //   noreply/unsubscribe dans la boîte, domaines étrangers, welcome/onboarding, tickets.
  //   Ces règles ramassaient des clients sur domaines d'entreprise + emails avec photos.

  // Notify admins
  if (total > 0) {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const chatIds = getAdminChatIds();
    if (botToken) {
      const lines = [`🧹 <b>Ménage Gmail terminé!</b>\n`, `✅ <b>${total}</b> emails nettoyés:\n`];
      for (const [key, count] of Object.entries(results)) {
        lines.push(`• ${key}: ${count}`);
      }
      const text = lines.join('\n');
      for (const chatId of chatIds) {
        await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId.trim(), text, parse_mode: 'HTML' }),
        }).catch(() => {});
      }
    }
  }

  return NextResponse.json({ ok: true, total, details: results });
}

// Vercel cron sends GET — alias to POST handler so the schedule can fire.
export const GET = POST;

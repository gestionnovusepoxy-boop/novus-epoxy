import { NextRequest, NextResponse } from 'next/server';
import { google } from 'googleapis';

export const maxDuration = 120;

function getGmailClient() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
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

  const gmail = getGmailClient();
  if (!gmail) return NextResponse.json({ error: 'Gmail not configured' }, { status: 500 });

  const results: Record<string, number> = {};
  let total = 0;

  // SAFE EXCLUSIONS — never trash these
  const safe = '-from:stripe.com -from:interac -from:desjardins -from:td.com -from:rbc.com -from:bmo.com -from:paypal -from:revenuquebec -from:cra-arc.gc.ca';

  // 1. BOUNCES & DELIVERY FAILURES
  const bounces = await batchTrash(gmail, 'subject:("Address not found" OR "Message not delivered" OR "Undeliverable" OR "Mail delivery failed" OR "Delivery Status Notification" OR "échec de la remise" OR "Returned mail")', 500);
  if (bounces > 0) { results['bounces'] = bounces; total += bounces; }

  const mailer = await batchTrash(gmail, 'from:mailer-daemon OR from:postmaster', 500);
  if (mailer > 0) { results['mailer_daemon'] = mailer; total += mailer; }

  // 2. DEV/SYSTEM NOTIFICATIONS
  const sentry = await batchTrash(gmail, 'from:sentry.io', 500);
  if (sentry > 0) { results['sentry'] = sentry; total += sentry; }

  const github = await batchTrash(gmail, 'from:notifications@github.com OR from:noreply@github.com', 500);
  if (github > 0) { results['github'] = github; total += github; }

  const vercel = await batchTrash(gmail, 'from:no-reply@vercel.com OR from:notifications@vercel.com', 500);
  if (vercel > 0) { results['vercel'] = vercel; total += vercel; }

  const anthropic = await batchTrash(gmail, 'from:anthropic.com', 200);
  if (anthropic > 0) { results['anthropic'] = anthropic; total += anthropic; }

  // 3. SOCIAL MEDIA
  const fb = await batchTrash(gmail, 'from:facebookmail.com OR from:notification@facebookmail.com OR from:instagram.com', 500);
  if (fb > 0) { results['facebook_instagram'] = fb; total += fb; }

  // 4. GMAIL CATEGORIES — all tabs except Primary banks
  const promos = await batchTrash(gmail, `category:promotions ${safe}`, 1000);
  if (promos > 0) { results['promotions'] = promos; total += promos; }

  const social = await batchTrash(gmail, 'category:social', 500);
  if (social > 0) { results['social'] = social; total += social; }

  const updates = await batchTrash(gmail, `category:updates ${safe}`, 500);
  if (updates > 0) { results['updates'] = updates; total += updates; }

  // 5. GOOGLE SYSTEM EMAILS
  const gws = await batchTrash(gmail, 'from:google-workspace-noreply@google.com', 200);
  if (gws > 0) { results['google_workspace'] = gws; total += gws; }

  const gsec = await batchTrash(gmail, 'from:no-reply@accounts.google.com', 200);
  if (gsec > 0) { results['google_security'] = gsec; total += gsec; }

  // 6. NEWSLETTERS & MARKETING (emails with unsubscribe links in Primary)
  const unsub = await batchTrash(gmail, `in:inbox unsubscribe ${safe}`, 500);
  if (unsub > 0) { results['newsletters_unsub'] = unsub; total += unsub; }

  // 7. NOREPLY IN INBOX (not banks/payments)
  const noreply = await batchTrash(gmail, `in:inbox (from:noreply OR from:no-reply OR from:donotreply) ${safe}`, 500);
  if (noreply > 0) { results['noreply'] = noreply; total += noreply; }

  // 8. OLD INBOX EMAILS > 90 DAYS (keep last 90 days for safety)
  const old90 = await batchTrash(gmail, `in:inbox older_than:90d ${safe} -from:gestionnovusepoxy`, 500);
  if (old90 > 0) { results['old_90d'] = old90; total += old90; }

  // 9. SPAM BYPASS
  const mailinblac = await batchTrash(gmail, 'subject:"Protect de Mailinblac" OR subject:"Se desabonner" OR subject:"Desabonnement"', 100);
  if (mailinblac > 0) { results['spam_bypass'] = mailinblac; total += mailinblac; }

  // 10. AUTO-REPLIES & USELESS CLIENT ACKNOWLEDGMENTS
  const autoreplies = await batchTrash(gmail, 'in:inbox (subject:"Réponse automatique" OR subject:"Reponse automatique" OR subject:"Automatic reply" OR subject:"Out of office" OR subject:"Absent du bureau" OR subject:"j\'ai bien recu" OR subject:"bien recu votre" OR subject:"bien reçu" OR subject:"accusé de réception" OR subject:"accuse de reception")', 500);
  if (autoreplies > 0) { results['auto_replies'] = autoreplies; total += autoreplies; }

  // 11. DMARC/SPF REPORTS
  const dmarc = await batchTrash(gmail, 'in:inbox (from:dmarcreport OR subject:"DMARC" OR subject:"dmarc" OR subject:"Report Domain:")', 200);
  if (dmarc > 0) { results['dmarc_reports'] = dmarc; total += dmarc; }

  // 12. ARCHIVE: our own outbound system email copies (gestionnovusepoxy AND info@novusepoxy.shop)
  const systemCopies = await batchArchive(gmail, '(from:gestionnovusepoxy@gmail.com OR from:info@novusepoxy.shop) in:inbox', 500);
  if (systemCopies > 0) { results['system_copies_archived'] = systemCopies; total += systemCopies; }

  // Notify admins
  if (total > 0) {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const chatIds = (process.env.TELEGRAM_ADMIN_CHAT_IDS ?? '').split(',').filter(Boolean);
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

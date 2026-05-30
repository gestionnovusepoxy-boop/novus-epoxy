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

  const github = await batchTrash(gmail, '(from:notifications@github.com OR from:noreply@github.com) older_than:7d', 500);
  if (github > 0) { results['github'] = github; total += github; }

  const supabase = await batchTrash(gmail, '(from:noreply@supabase.io OR from:no-reply@supabase.io OR from:support@supabase.io) older_than:7d', 200);
  if (supabase > 0) { results['supabase'] = supabase; total += supabase; }

  const vercel = await batchTrash(gmail, '(from:no-reply@vercel.com OR from:notifications@vercel.com) older_than:7d', 500);
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

  const updates = await batchTrash(gmail, `category:updates ${safe}`, 1000);
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

  // 10. AUTO-REPLIES & USELESS ACKNOWLEDGMENTS
  const autoreplies = await batchTrash(gmail, 'in:inbox (subject:"Réponse automatique" OR subject:"Reponse automatique" OR subject:"Automatic reply" OR subject:"Out of office" OR subject:"Absent du bureau" OR subject:"bien reçu" OR subject:"bien recu" OR subject:"accusé de réception" OR subject:"accuse de reception")', 500);
  if (autoreplies > 0) { results['auto_replies'] = autoreplies; total += autoreplies; }

  // 11. DMARC/SPF + SURVEY BOTS + FOREIGN SPAM
  const dmarc = await batchTrash(gmail, 'in:inbox (from:dmarcreport OR subject:"DMARC" OR subject:"Report Domain:" OR from:registre@servicesquebec.gouv.qc.ca OR from:lkpp.go.id OR from:sleepapnea.org)', 500);
  if (dmarc > 0) { results['junk_misc'] = dmarc; total += dmarc; }

  // 12B. PROSPECTING CAMPAIGN REPLIES — all replies to "Planchers époxy haut de gamme" template
  // Keep only personal emails (@gmail.com, @hotmail, @outlook) — those are real prospects
  const prospReplies = await batchTrash(gmail, 'in:inbox subject:"Planchers" -from:@gmail.com -from:@hotmail.com -from:@outlook.com -from:@videotron -from:@cgocable -from:@sympatico', 1000);
  if (prospReplies > 0) { results['prospect_replies'] = prospReplies; total += prospReplies; }

  // SPAM-flagged replies
  const spamReplies = await batchTrash(gmail, 'in:inbox subject:"***SPAM***"', 500);
  if (spamReplies > 0) { results['spam_replies'] = spamReplies; total += spamReplies; }

  // 12C. TICKET SYSTEM AUTO-REPLIES (Zendesk, Freshdesk, etc.)
  const tickets = await batchTrash(gmail, 'in:inbox (subject:"Request received" OR subject:"Votre Billet" OR subject:"We received your request" OR subject:"We\'ve received your request" OR subject:"How would you rate" OR subject:"Service Expérience Client" OR subject:"Thank you for contacting" OR subject:"received your message" OR from:zendesk OR from:freshdesk OR from:helpscout)', 1000);
  if (tickets > 0) { results['ticket_autoreplies'] = tickets; total += tickets; }

  // 12D. PROSPECTING REPLIES — business auto-replies not from personal email
  const prospAuto = await batchTrash(gmail, 'in:inbox (subject:"question rapide" OR subject:"Santos," OR subject:"Industrial,") -from:@gmail.com -from:@hotmail -from:@outlook -from:@yahoo -from:@videotron -from:@cgocable', 500);
  if (prospAuto > 0) { results['prosp_auto_replies'] = prospAuto; total += prospAuto; }

  // 12E. FOREIGN/IRRELEVANT COMPANIES that replied to our prospecting
  const irrelevant = await batchTrash(gmail, 'in:inbox (from:ticketmaster OR from:discord.com OR from:@.au OR from:@.co.za OR from:@.co.uk OR from:@.de OR from:@.fr -from:desjardins)', 500);
  if (irrelevant > 0) { results['foreign_irrelevant'] = irrelevant; total += irrelevant; }

  // 12F. WELCOME / ONBOARDING emails (not useful)
  const welcomes = await batchTrash(gmail, 'in:inbox (subject:"Welcome to" OR subject:"Bienvenue sur" OR subject:"verify your email" OR subject:"Confirm your" OR subject:"Discord welcome" OR subject:"Get started")', 300);
  if (welcomes > 0) { results['welcome_onboarding'] = welcomes; total += welcomes; }

  // 12G. MAILINBLACK AUTO-REPLIES — cold email system auto-replies (never real clients)
  const mailinblackReplies = await batchTrash(gmail, 'in:inbox from:mailinblack.com OR from:invitations.mailinblack.com', 500);
  if (mailinblackReplies > 0) { results['mailinblack'] = mailinblackReplies; total += mailinblackReplies; }

  // 12H. OLD INBOX EMAILS > 7 DAYS — already handled by previous scans, safe to archive
  const old7d = await batchArchive(gmail, `in:inbox older_than:7d ${safe} -from:@gmail.com -from:@hotmail -from:@outlook -from:@yahoo`, 500);
  if (old7d > 0) { results['old_7d_archived'] = old7d; total += old7d; }

  // 12I. OLD PERSONAL EMAIL THREADS > 90 DAYS — Gmail/Hotmail conversations older than 3 months
  // Keep up to 90 days — clients sometimes come back after 1 month
  const old90dPersonal = await batchArchive(gmail, `in:inbox older_than:90d (from:@gmail.com OR from:@hotmail.com OR from:@outlook.com OR from:@yahoo) ${safe}`, 500);
  if (old90dPersonal > 0) { results['old_90d_personal'] = old90dPersonal; total += old90dPersonal; }

  // 12J. PROSPECTING REPLIES from non-ISP corporate emails > 3 DAYS (Aria already handled)
  const oldProspReplies = await batchArchive(gmail, `in:inbox older_than:3d subject:"époxy" -from:@gmail.com -from:@hotmail -from:@outlook -from:@yahoo -from:@videotron -from:@cgocable -from:@sympatico ${safe}`, 300);
  if (oldProspReplies > 0) { results['old_prosp_archived'] = oldProspReplies; total += oldProspReplies; }

  // 12K. DEVIS BCC COPIES > 1 DAY — copies envoyées à nous-mêmes pour vérification, supprimées après 1 jour
  const devisCopies = await batchTrash(gmail, 'in:inbox from:gestionnovusepoxy@gmail.com older_than:1d (subject:"Soumission Novus Epoxy" OR subject:"Solde à payer")', 200);
  if (devisCopies > 0) { results['devis_copies_trashed'] = devisCopies; total += devisCopies; }

  // 12. ARCHIVE: our own outbound system email copies (gestionnovusepoxy AND info@novusepoxy.shop)
  const systemCopies = await batchArchive(gmail, '(from:gestionnovusepoxy@gmail.com OR from:info@novusepoxy.shop) in:inbox', 500);
  if (systemCopies > 0) { results['system_copies_archived'] = systemCopies; total += systemCopies; }

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

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

  // 1. BOUNCES — delivery failures
  const bounces = await batchTrash(gmail, 'subject:("Address not found" OR "Message not delivered" OR "Undeliverable" OR "Mail delivery failed" OR "Delivery Status Notification")');
  if (bounces > 0) { results['bounces'] = bounces; total += bounces; }

  const mailer = await batchTrash(gmail, 'from:mailer-daemon');
  if (mailer > 0) { results['mailer_daemon'] = mailer; total += mailer; }

  // 2. DEV/SYSTEM NOTIFICATIONS (not useful for business)
  const sentry = await batchTrash(gmail, 'from:sentry.io');
  if (sentry > 0) { results['sentry'] = sentry; total += sentry; }

  const github = await batchTrash(gmail, 'from:notifications@github.com OR from:noreply@github.com');
  if (github > 0) { results['github'] = github; total += github; }

  // 3. SOCIAL MEDIA NOTIFICATIONS
  const fb = await batchTrash(gmail, 'from:facebookmail.com OR from:notification@facebookmail.com');
  if (fb > 0) { results['facebook_instagram'] = fb; total += fb; }

  // 4. PROMOTIONS TAB — all of it
  const promos = await batchTrash(gmail, 'category:promotions', 500);
  if (promos > 0) { results['promotions'] = promos; total += promos; }

  // 5. SOCIAL TAB — all of it
  const social = await batchTrash(gmail, 'category:social', 500);
  if (social > 0) { results['social'] = social; total += social; }

  // 6. UPDATES TAB (except Stripe/Interac/banks)
  const updates = await batchTrash(gmail, 'category:updates -from:stripe -from:interac -from:desjardins -from:td.com -from:rbc.com -from:bmo.com');
  if (updates > 0) { results['updates'] = updates; total += updates; }

  // 7. GOOGLE WORKSPACE promos
  const gws = await batchTrash(gmail, 'from:google-workspace-noreply@google.com');
  if (gws > 0) { results['google_workspace'] = gws; total += gws; }

  // 8. GOOGLE SECURITY ALERTS (noise)
  const gsec = await batchTrash(gmail, 'from:no-reply@accounts.google.com');
  if (gsec > 0) { results['google_security'] = gsec; total += gsec; }

  // 9. SPAM FILTER bypasses
  const mailinblac = await batchTrash(gmail, 'subject:"Protect de Mailinblac"');
  if (mailinblac > 0) { results['mailinblac'] = mailinblac; total += mailinblac; }

  // 10. ANTHROPIC/CLAUDE newsletters
  const anthropic = await batchTrash(gmail, 'from:team@anthropic.com OR from:anthropic.com');
  if (anthropic > 0) { results['anthropic'] = anthropic; total += anthropic; }

  // 11. ARCHIVE: copies of our own system emails
  const systemCopies = await batchArchive(gmail, 'from:gestionnovusepoxy@gmail.com subject:("Depot recu" OR "Contrat signe" OR "Dates confirmees" OR "Nouvelle reservation" OR "Prochaine etape" OR "signer le contrat" OR "Soumission Novus Epoxy")');
  if (systemCopies > 0) { results['system_copies_archived'] = systemCopies; total += systemCopies; }

  // 12. VERCEL deploy notifications
  const vercel = await batchTrash(gmail, 'from:no-reply@vercel.com OR from:notifications@vercel.com');
  if (vercel > 0) { results['vercel'] = vercel; total += vercel; }

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

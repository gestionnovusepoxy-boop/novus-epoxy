import { NextRequest, NextResponse } from 'next/server';
import { google } from 'googleapis';
import { query } from '@/lib/db';

const CRON_SECRET = () => process.env.CRON_SECRET ?? '';
const ANTHROPIC_KEY = () => process.env.ANTHROPIC_API_KEY ?? '';
const BOT_TOKEN = () => process.env.TELEGRAM_BOT_TOKEN ?? '';
const ADMIN_CHAT_IDS = () =>
  (process.env.TELEGRAM_ADMIN_CHAT_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean);

// Categories for auto-classification
const CATEGORIES = [
  'materiaux', 'equipement', 'vehicule', 'essence', 'assurance',
  'publicite', 'sous-traitance', 'bureau', 'telecommunication',
  'formation', 'repas', 'entretien', 'loyer', 'autre',
];

async function sendTelegram(chatId: string, text: string) {
  const token = BOT_TOKEN();
  if (!token) return;
  const chunks = text.match(/[\s\S]{1,4000}/g) ?? [text];
  for (const chunk of chunks) {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: chunk, parse_mode: 'HTML' }),
    });
  }
}

function getGmailClient() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) return null;

  const oauth2 = new google.auth.OAuth2(clientId, clientSecret);
  oauth2.setCredentials({ refresh_token: refreshToken });
  return google.gmail({ version: 'v1', auth: oauth2 });
}

async function analyzeWithClaude(
  content: string,
  attachmentData?: { mimeType: string; base64: string },
): Promise<{
  type: 'facture' | 'client' | 'spam' | 'important' | 'autre';
  fournisseur?: string;
  montant_ttc?: number;
  montant_ht?: number;
  tps?: number;
  tvq?: number;
  description?: string;
  categorie?: string;
  date_depense?: string;
  summary: string;
  needs_attention: boolean;
  reply_suggestion?: string;
}> {
  const messages: Array<{ role: string; content: unknown }> = [];

  const imageContent: unknown[] = [];
  if (attachmentData) {
    imageContent.push({
      type: 'image',
      source: { type: 'base64', media_type: attachmentData.mimeType, data: attachmentData.base64 },
    });
  }
  imageContent.push({
    type: 'text',
    text: `Analyse cet email recu par Novus Epoxy (entreprise de planchers epoxy au Quebec).

Email:
${content}

Reponds en JSON strict:
{
  "type": "facture" | "client" | "spam" | "important" | "autre",
  "fournisseur": "nom du fournisseur si facture",
  "montant_ttc": nombre si facture (total TTC),
  "montant_ht": nombre si facture (avant taxes),
  "tps": nombre (5% TPS federal),
  "tvq": nombre (9.975% TVQ Quebec),
  "description": "description courte de la facture/depense",
  "categorie": "${CATEGORIES.join(' | ')}",
  "date_depense": "YYYY-MM-DD",
  "summary": "resume en 1-2 phrases de l'email",
  "needs_attention": true/false (true si besoin action humaine),
  "reply_suggestion": "suggestion de reponse si c'est un client ou message important, null sinon"
}

- type "facture" = c'est une facture/invoice/receipt qu'on a recue (depense)
- type "client" = un client potentiel ou existant qui ecrit (demande de soumission, questions sur les services, reponse a une offre de service)
- type "important" = message important (gouvernement, banque, urgent, etc.)
- type "spam" = pub, newsletter, spam
- type "autre" = autre chose
- Pour les taxes Quebec: TPS = 5%, TVQ = 9.975%
- Si c'est une image de facture, extrais les montants de l'image
- Categorie seulement si type = facture

IMPORTANT pour les clients:
- Novus Epoxy offre: planchers epoxy metallique, flake/flocon, couleur unie, commercial, quartz, revetement balcons/escaliers, reparation beton
- Zone: Grand Quebec, Levis, Rive-Sud, Rive-Nord
- Garantie 10 ans, 15 ans d'experience, RBQ 5861-8471-01
- La reply_suggestion doit etre chaleureuse, professionnelle, en francais
- NE JAMAIS DONNER DE PRIX. Aucun montant, estimé ou prix au pied carre. Les prix sont donnes uniquement par devis officiel.
- Si le client pose des questions sur les services (types d'epoxy, processus, delais, garantie, etc.): reponds clairement et avec confiance.
- Si le client demande une soumission ou des infos pour un projet: demande les infos manquantes en UNE SEULE question (la plus importante: type de service OU superficie OU adresse). Redirige vers https://novusepoxy.ca/#contact pour la soumission officielle.
- Si la question est trop complexe ou hors de ta portee: fournis le numero 581-307-2678 et dis que l'equipe va les rappeler.
- Ne pose jamais plus d'une question a la fois pour eviter les boucles de courriel.
- TOUJOURS mentionner qu'ils peuvent appeler au 581-307-2678.
- TOUJOURS signer "L'equipe Novus Epoxy"`,
  });

  messages.push({ role: 'user', content: imageContent });

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_KEY(),
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      messages,
    }),
  });

  if (!res.ok) throw new Error(`Claude API error: ${res.status}`);
  const data = await res.json();
  const text = data.content?.[0]?.text ?? '{}';

  // Extract JSON from response (handle markdown code blocks)
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  return JSON.parse(jsonMatch?.[0] ?? '{}');
}

async function processAutoReply(
  fromEmail: string,
  subject: string,
  replyText: string,
) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM ?? 'info@novusepoxy.ca';
  if (!apiKey || !replyText) return;

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from,
      to: [fromEmail],
      subject: subject ? `Re: ${subject}` : 'Novus Epoxy — Reponse',
      html: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;">
        <p>${replyText.replace(/\n/g, '<br/>')}</p>
        <hr style="border:none;border-top:1px solid #e2e8f0;margin:30px 0;" />
        <p style="color:#64748b;font-size:12px;">Novus Epoxy — Planchers epoxy haut de gamme<br/>
        581-307-5983 | novusepoxy.ca</p>
      </div>`,
    }),
  });

  // Log it
  await query(
    `INSERT INTO email_logs (resend_id, destinataire, sujet, statut) VALUES ($1, $2, $3, $4)`,
    ['auto-reply', fromEmail, subject ? `Re: ${subject}` : 'Auto-reply', 'sent'],
  );
}

// POST handler — allows external triggers (e.g., cron-job.org, Gmail push)
export async function POST(req: NextRequest) {
  return GET(req);
}

async function alertAdmins(text: string) {
  for (const chatId of ADMIN_CHAT_IDS()) {
    await sendTelegram(chatId, text).catch(() => {});
  }
}

async function renewGmailWatchIfNeeded() {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://novus-epoxy.vercel.app';
  const adminKey = process.env.ADMIN_API_KEY ?? '';
  try {
    const res = await fetch(`${baseUrl}/api/gmail/watch`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminKey}` },
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error ?? 'watch failed');
    console.log('[Email Scan] Gmail watch renewed:', data.expiration);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await alertAdmins(`🚨 <b>Gmail Watch — renouvellement echoue</b>\n\n${msg}\n\nVerifie les credentials Google.`);
  }
}

export async function GET(req: NextRequest) {
  // Auth — accept CRON_SECRET or ADMIN_API_KEY
  const authHeader = req.headers.get('authorization') ?? '';
  const token = authHeader.replace('Bearer ', '');
  const secret = CRON_SECRET();
  const adminKey = process.env.ADMIN_API_KEY ?? '';
  if (secret && token !== secret && token !== adminKey) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const gmail = getGmailClient();
  if (!gmail) {
    await alertAdmins('🚨 <b>Email Scan — Gmail non configure</b>\n\nVariables manquantes: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET ou GOOGLE_REFRESH_TOKEN\n\nVerifie les env vars sur Vercel.');
    return NextResponse.json({ error: 'Gmail non configure' }, { status: 500 });
  }

  // Auto-renew Gmail watch every ~5 days (expires after 7 days)
  const lastWatchRows = await query(`SELECT value FROM kv_store WHERE key = 'last_gmail_watch'`).catch(() => []);
  const lastWatch = lastWatchRows?.[0]?.value as string | undefined;
  const daysSinceWatch = lastWatch
    ? (Date.now() - new Date(lastWatch).getTime()) / (1000 * 60 * 60 * 24)
    : 999;
  if (daysSinceWatch >= 5) {
    await renewGmailWatchIfNeeded();
    await query(
      `INSERT INTO kv_store (key, value) VALUES ('last_gmail_watch', $1) ON CONFLICT (key) DO UPDATE SET value = $1`,
      [new Date().toISOString()],
    ).catch(() => {});
  }

  try {
  // Get last scan timestamp from DB
  const lastScanRows = await query(
    `SELECT value FROM kv_store WHERE key = 'last_email_scan'`,
  );
  const lastScan = lastScanRows?.[0]?.value as string | undefined;
  // Default: scan last 24h
  const afterDate = lastScan ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const afterEpoch = Math.floor(new Date(afterDate).getTime() / 1000);

  // Fetch unread emails
  const listRes = await gmail.users.messages.list({
    userId: 'me',
    q: `is:unread after:${afterEpoch}`,
    maxResults: 20,
  });

  const messageIds = listRes.data.messages ?? [];
  if (messageIds.length === 0) {
    // Update timestamp
    await query(
      `INSERT INTO kv_store (key, value) VALUES ('last_email_scan', $1)
       ON CONFLICT (key) DO UPDATE SET value = $1`,
      [new Date().toISOString()],
    );
    return NextResponse.json({ processed: 0, message: 'Aucun nouveau email' });
  }

  let invoicesCreated = 0;
  let repliesSent = 0;
  let alertsSent = 0;

  for (const msg of messageIds) {
    if (!msg.id) continue;

    const fullMsg = await gmail.users.messages.get({
      userId: 'me',
      id: msg.id,
      format: 'full',
    });

    const headers = fullMsg.data.payload?.headers ?? [];
    const fromHeader = headers.find(h => h.name?.toLowerCase() === 'from')?.value ?? '';
    const subject = headers.find(h => h.name?.toLowerCase() === 'subject')?.value ?? '';
    const fromEmail = fromHeader.match(/<([^>]+)>/)?.[1] ?? fromHeader.split(' ')[0] ?? '';

    // Mark as read immediately to prevent re-processing by parallel cron/webhook runs
    try {
      await gmail.users.messages.modify({
        userId: 'me',
        id: msg.id,
        requestBody: { removeLabelIds: ['UNREAD'] },
      });
    } catch { /* ignore */ }

    // Skip our own emails
    if (fromEmail.includes('novusepoxy')) continue;

    // Skip auto-replies (noreply, mailer-daemon, auto-responders)
    const autoSubmitted = headers.find(h => h.name?.toLowerCase() === 'auto-submitted')?.value ?? '';
    const precedence = headers.find(h => h.name?.toLowerCase() === 'precedence')?.value ?? '';
    const isAutoReply =
      autoSubmitted.includes('auto-replied') ||
      autoSubmitted.includes('auto-generated') ||
      precedence === 'bulk' ||
      precedence === 'auto_reply' ||
      /noreply|no-reply|mailer-daemon|postmaster/i.test(fromEmail) ||
      /\b(auto.?r[eé]ponse|auto.?reply|out of office|absence|r[eé]ception de votre message)\b/i.test(subject);
    if (isAutoReply) {
      console.log(`[Email Scan] Skipping auto-reply from ${fromEmail}: ${subject}`);
      try {
        await gmail.users.messages.modify({ userId: 'me', id: msg.id, requestBody: { removeLabelIds: ['UNREAD'] } });
      } catch { /* ignore */ }
      continue;
    }

    // Get body text
    let bodyText = '';
    const parts = fullMsg.data.payload?.parts ?? [];
    const textPart = parts.find(p => p.mimeType === 'text/plain');
    if (textPart?.body?.data) {
      bodyText = Buffer.from(textPart.body.data, 'base64url').toString('utf-8');
    } else if (fullMsg.data.payload?.body?.data) {
      bodyText = Buffer.from(fullMsg.data.payload.body.data, 'base64url').toString('utf-8');
    }

    // Get first image/pdf attachment if exists
    let attachmentData: { mimeType: string; base64: string } | undefined;
    for (const part of parts) {
      if (
        part.body?.attachmentId &&
        (part.mimeType?.startsWith('image/') || part.mimeType === 'application/pdf')
      ) {
        try {
          const att = await gmail.users.messages.attachments.get({
            userId: 'me',
            messageId: msg.id,
            id: part.body.attachmentId,
          });
          if (att.data.data) {
            attachmentData = {
              mimeType: part.mimeType ?? 'image/jpeg',
              base64: att.data.data.replace(/-/g, '+').replace(/_/g, '/'),
            };
          }
        } catch { /* skip attachment errors */ }
        break; // Only process first attachment
      }
    }

    // Analyze with Claude
    const emailContent = `De: ${fromHeader}\nSujet: ${subject}\n\n${bodyText.slice(0, 3000)}`;

    let analysis;
    try {
      analysis = await analyzeWithClaude(emailContent, attachmentData);
    } catch (err) {
      console.error(`Failed to analyze email ${msg.id}:`, err);
      continue;
    }

    // === FACTURE: Auto-create expense ===
    if (analysis.type === 'facture' && analysis.montant_ttc && analysis.montant_ttc > 0) {
      // Check duplicate
      const existing = await query(
        `SELECT id FROM expenses WHERE fournisseur = $1 AND montant_ttc = $2 AND date_depense = $3`,
        [analysis.fournisseur ?? 'Inconnu', analysis.montant_ttc, analysis.date_depense ?? new Date().toISOString().slice(0, 10)],
      );

      if (existing.length === 0) {
        await query(
          `INSERT INTO expenses (fournisseur, description, montant_ht, tps, tvq, montant_ttc, categorie, date_depense, methode, source)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            analysis.fournisseur ?? 'Inconnu',
            analysis.description ?? subject,
            analysis.montant_ht ?? 0,
            analysis.tps ?? 0,
            analysis.tvq ?? 0,
            analysis.montant_ttc,
            analysis.categorie ?? 'autre',
            analysis.date_depense ?? new Date().toISOString().slice(0, 10),
            'autre',
            'email-scan',
          ],
        );
        invoicesCreated++;

        // Notify admin
        for (const chatId of ADMIN_CHAT_IDS()) {
          await sendTelegram(chatId,
            `📧 <b>Facture detectee par email</b>\n\n` +
            `🏪 ${analysis.fournisseur ?? 'Inconnu'}\n` +
            `💰 ${analysis.montant_ttc?.toFixed(2)}$ TTC\n` +
            `📂 ${analysis.categorie ?? 'autre'}\n` +
            `📝 ${analysis.description ?? subject}\n\n` +
            `✅ Ajoutee automatiquement aux depenses`,
          );
        }
      }
    }

    // === CLIENT: Auto-reply + notify admins on Telegram ===
    if (analysis.type === 'client' && analysis.reply_suggestion) {
      // Check if already replied to this email (dedup by Gmail message ID)
      const alreadyReplied = await query(
        `SELECT id FROM email_logs WHERE resend_id = $1`,
        [`gmail-${msg.id}`],
      );
      if (alreadyReplied.length === 0) {
        // Mark as processed immediately to prevent duplicate from parallel runs
        await query(
          `INSERT INTO email_logs (resend_id, destinataire, sujet, statut) VALUES ($1, $2, $3, $4)`,
          [`gmail-${msg.id}`, fromEmail, subject ? `Re: ${subject}` : 'Auto-reply', 'processing'],
        );
        try {
          await processAutoReply(fromEmail, subject, analysis.reply_suggestion);
          await query(`UPDATE email_logs SET statut = 'sent' WHERE resend_id = $1`, [`gmail-${msg.id}`]);
          repliesSent++;
        } catch { /* ignore reply errors */ }

        for (const chatId of ADMIN_CHAT_IDS()) {
          await sendTelegram(chatId,
            `👤 <b>Email client recu</b>\n\n` +
            `De: ${fromHeader}\n` +
            `Sujet: ${subject}\n\n` +
            `📋 ${analysis.summary}\n` +
            `\n✅ Reponse auto envoyee:\n<i>${(analysis.reply_suggestion ?? '').slice(0, 500)}</i>` +
            `\n\nhttps://novus-epoxy.vercel.app/dashboard/devis`,
          );
        }
        alertsSent++;
      }
    }

    // === IMPORTANT / NEEDS ATTENTION: Alert admin ===
    if (analysis.needs_attention && analysis.type !== 'spam') {
      for (const chatId of ADMIN_CHAT_IDS()) {
        await sendTelegram(chatId,
          `📬 <b>Email necessite ton attention</b>\n\n` +
          `De: ${fromHeader}\n` +
          `Sujet: ${subject}\n\n` +
          `📋 ${analysis.summary}\n\n` +
          (analysis.reply_suggestion ? `💡 Suggestion: ${analysis.reply_suggestion}` : ''),
        );
      }
      alertsSent++;
    }

    // Mark as read
    try {
      await gmail.users.messages.modify({
        userId: 'me',
        id: msg.id,
        requestBody: { removeLabelIds: ['UNREAD'] },
      });
    } catch { /* ignore */ }
  }

  // Update last scan timestamp
  await query(
    `INSERT INTO kv_store (key, value) VALUES ('last_email_scan', $1)
     ON CONFLICT (key) DO UPDATE SET value = $1`,
    [new Date().toISOString()],
  );

  const summary = `Email scan: ${messageIds.length} traites, ${invoicesCreated} factures, ${repliesSent} reponses, ${alertsSent} alertes`;
  return NextResponse.json({ processed: messageIds.length, invoicesCreated, repliesSent, alertsSent, summary });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[Email Scan] Fatal error:', msg);
    await alertAdmins(
      `🚨 <b>Email Scan — ERREUR CRITIQUE</b>\n\n` +
      `${msg}\n\n` +
      `Le scan des emails est en panne. Verifiez les logs Vercel.\n` +
      `https://vercel.com/gestionnovusepoxy-boops-projects/novus-epoxy/logs`,
    ).catch(() => {});
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

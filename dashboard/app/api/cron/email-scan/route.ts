import { NextRequest, NextResponse } from 'next/server';
import { google } from 'googleapis';
import { query } from '@/lib/db';
import { SERVICES, type ServiceType, calculateQuote, formatMoney } from '@/lib/pricing';

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

async function handleLeadFollowUp(
  msgId: string,
  fromEmail: string,
  subject: string,
  bodyText: string,
  leadId: number,
  leadNom: string,
): Promise<void> {
  const histKey = `lead_email_${fromEmail.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;

  const alreadyHandled = await query(`SELECT id FROM email_logs WHERE resend_id = $1`, [`lead-${msgId}`]);
  if (alreadyHandled.length > 0) return;

  await query(
    `INSERT INTO email_logs (resend_id, destinataire, sujet, statut) VALUES ($1,$2,$3,'processing')`,
    [`lead-${msgId}`, fromEmail, subject]
  );

  const histRow = await query(`SELECT value FROM kv_store WHERE key = $1`, [histKey]);
  const history: { step: string; collected: Record<string, string> } = histRow.length > 0
    ? JSON.parse(histRow[0].value as string)
    : { step: 'initial', collected: {} };

  const apiKey = ANTHROPIC_KEY();
  const alreadyCollected = Object.entries(history.collected).map(([k, v]) => `${k}: ${v}`).join(', ') || 'rien';

  const promptRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 800,
      messages: [{ role: 'user', content: `Tu geres le suivi par email pour Novus Epoxy (planchers epoxy, Quebec).
Un prospect (${leadNom}) a repondu a notre email de prospection initial envoye par Jason.

Infos deja collectees: ${alreadyCollected}

Message du prospect:
---
${bodyText.slice(0, 2000)}
---

Instructions:
1. Extrait TOUTES les infos du message (service, superficie, adresse/ville)
2. Si statut = "initial" (premier contact): envoie UNE reponse avec la LISTE COMPLETE des infos dont tu as besoin (service, superficie, adresse) — ne pas les poser une par une sur plusieurs emails
3. Si le client a deja fourni des infos: extrait ce qu'il a donne, et si il manque encore des elements, demande uniquement ce qui manque
4. Si tu as service + superficie + adresse → statut = "complet"
5. TOUJOURS proposer EN PREMIER le formulaire (le meilleur choix — le client peut choisir ses couleurs et options): https://novusepoxy.ca/#contact
6. Ensuite offrir les alternatives: appeler Luca (581-307-5983) ou Jason (581-307-2678), OU repondre par email avec les infos
7. Chaleureux, professionnel, francais. MAX 150 mots. NE JAMAIS donner de prix.
8. Signe "L'equipe Novus Epoxy"

Structure de la reponse:
- Remercie le client d'avoir repondu
- Recommande le formulaire en premier (rapide, peut choisir couleurs/options)
- Donne les alternatives (appel ou email)
- Si le client a deja fourni des infos: reconnais-le et indique que le formulaire permet de preciser les details

Infos necessaires (si le client veut repondre par email):
- Type de service (metallique, flake/flocon, commercial, quartz, couleur unie)
- Superficie approximative
- Adresse ou ville

JSON strict:
{"service":"flake|metallique|commercial|quartz|couleur_unie|null","superficie":"nombre pi2 ou null","adresse":"adresse ou ville ou null","statut":"en_cours|complet","reponse":"texte email"}` }],
    }),
  });

  if (!promptRes.ok) {
    await query(`UPDATE email_logs SET statut = 'error' WHERE resend_id = $1`, [`lead-${msgId}`]);
    return;
  }

  const promptData = await promptRes.json();
  let parsed: { service?: string; superficie?: string; adresse?: string; statut: string; reponse: string };
  try {
    parsed = JSON.parse((promptData.content?.[0]?.text ?? '').replace(/```json\n?/g, '').replace(/```\n?/g, '').trim());
  } catch {
    await query(`UPDATE email_logs SET statut = 'error' WHERE resend_id = $1`, [`lead-${msgId}`]);
    return;
  }

  const newCollected = { ...history.collected };
  if (parsed.service && parsed.service !== 'null') newCollected.service = parsed.service;
  if (parsed.superficie && parsed.superficie !== 'null') newCollected.superficie = parsed.superficie;
  if (parsed.adresse && parsed.adresse !== 'null') newCollected.adresse = parsed.adresse;

  await query(
    `INSERT INTO kv_store (key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value = $2`,
    [histKey, JSON.stringify({ step: parsed.statut, collected: newCollected })]
  );

  await query(`UPDATE crm_leads SET statut = 'contacte', updated_at = NOW() WHERE id = $1`, [leadId]);

  const resendKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM ?? 'info@novusepoxy.ca';
  if (resendKey && parsed.reponse) {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from,
        to: [fromEmail],
        subject: subject.startsWith('Re:') ? subject : `Re: ${subject}`,
        html: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;">
          <p>${parsed.reponse.replace(/\n/g, '<br/>')}</p>
          <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0;" />
          <p style="color:#64748b;font-size:12px;">Novus Epoxy — Planchers epoxy haut de gamme<br/>
          581-307-5983 | novusepoxy.ca</p>
        </div>`,
      }),
    }).catch(() => {});
  }

  await query(`UPDATE email_logs SET statut = 'sent' WHERE resend_id = $1`, [`lead-${msgId}`]);

  if (parsed.statut === 'complet' && newCollected.service && newCollected.superficie) {
    const surf = parseFloat((newCollected.superficie).replace(/[^\d.]/g, ''));
    const validServices: ServiceType[] = ['flake', 'metallique', 'commercial', 'quartz', 'couleur_unie'];
    const serviceKey: ServiceType = validServices.includes(newCollected.service as ServiceType)
      ? (newCollected.service as ServiceType) : 'flake';

    if (!isNaN(surf) && surf > 0) {
      try {
        const calc = calculateQuote(serviceKey, surf);
        const quoteRows = await query(
          `INSERT INTO quotes (client_nom, client_email, client_adresse, type_service, superficie,
           prix_pied_carre, sous_total, tps, tvq, total, depot_requis, statut, notes)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'brouillon',$12) RETURNING id`,
          [leadNom, fromEmail, newCollected.adresse || '', serviceKey, surf,
           calc.prix_pied_carre, calc.sous_total, calc.tps, calc.tvq, calc.total, calc.depot_requis,
           `Lead CRM #${leadId} — collecte via email`]
        );
        const quoteId = (quoteRows[0] as { id: number }).id;
        await query(`UPDATE crm_leads SET statut = 'devis_envoye', updated_at = NOW() WHERE id = $1`, [leadId]);

        for (const chatId of ADMIN_CHAT_IDS()) {
          await sendTelegram(chatId, [
            `📧 Lead CRM a repondu — Devis pret!`,
            ``,
            `👤 ${leadNom} (${fromEmail})`,
            `🔧 ${SERVICES[serviceKey]?.label || serviceKey} — ${surf} pi²`,
            newCollected.adresse ? `📍 ${newCollected.adresse}` : '',
            `💰 Total: ${formatMoney(calc.total)}`,
            ``,
            `Devis #${quoteId} en brouillon — approuver:`,
            `https://novus-epoxy.vercel.app/dashboard/devis`,
          ].filter(Boolean).join('\n'));
        }
      } catch { /* quote creation failed */ }
    }
  } else {
    for (const chatId of ADMIN_CHAT_IDS()) {
      await sendTelegram(chatId, [
        `📧 Lead CRM a repondu: ${leadNom}`,
        Object.entries(newCollected).map(([k, v]) => `${k}: ${v}`).join(' | '),
        `En cours — collecte d'infos`,
      ].filter(Boolean).join('\n'));
    }
  }
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

    // Check if sender is a CRM lead replying to Jason's outreach
    const crmLeadRows = await query(
      `SELECT id, nom FROM crm_leads WHERE LOWER(email) = LOWER($1) LIMIT 1`,
      [fromEmail]
    );
    if (crmLeadRows.length > 0) {
      const lead = crmLeadRows[0] as { id: number; nom: string };
      await handleLeadFollowUp(msg.id, fromEmail, subject, bodyText, lead.id, lead.nom);
      continue;
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

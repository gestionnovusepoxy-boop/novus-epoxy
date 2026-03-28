import { NextRequest, NextResponse } from 'next/server';
import { google } from 'googleapis';
import { query } from '@/lib/db';
import { SERVICES, type ServiceType, calculateQuote, formatMoney } from '@/lib/pricing';
import { sendEmail } from '@/lib/send-email';

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
    try {
      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: chunk, parse_mode: 'HTML' }),
      });
    } catch { /* Telegram down — don't crash the scan */ }
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

function brandedEmailHtml(bodyHtml: string, showQuoteButton = true): string {
  return `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:0;">
    <div style="background:#0f172a;padding:16px 24px;border-radius:8px 8px 0 0;">
      <img src="https://novus-epoxy.vercel.app/logo.jpg" alt="Novus Epoxy" style="height:40px;" />
    </div>
    <div style="padding:24px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px;">
      <div style="color:#1e293b;line-height:1.7;">${bodyHtml}</div>
      ${showQuoteButton ? `<div style="text-align:center;margin:28px 0;">
        <a href="https://novusepoxy.ca/#contact" style="background:#f59e0b;color:#0f172a;padding:14px 32px;border-radius:6px;text-decoration:none;font-weight:bold;display:inline-block;font-size:15px;">Demander ma soumission gratuite</a>
      </div>` : ''}
      <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0;" />
      <p style="color:#64748b;font-size:12px;margin:0;line-height:1.6;">
        <b>Novus Epoxy</b> — Planchers epoxy haut de gamme<br/>
        RBQ 5861-8471-01 | Garantie 10 ans | 15 ans d'experience<br/><br/>
        📞 <b>Luca</b> (facturation / soumission) : <a href="tel:5813075983" style="color:#f59e0b;">581-307-5983</a><br/>
        📞 <b>Jason</b> (chantier / soumission) : <a href="tel:5813072678" style="color:#f59e0b;">581-307-2678</a><br/>
        🌐 <a href="https://novusepoxy.ca" style="color:#f59e0b;">novusepoxy.ca</a>
      </p>
    </div>
  </div>`;
}

async function handleLeadFollowUp(
  msgId: string,
  fromEmail: string,
  subject: string,
  bodyText: string,
  leadId: number,
  leadNom: string,
): Promise<void> {
  // 1. Dedup check
  const alreadyHandled = await query(`SELECT id FROM email_logs WHERE resend_id = $1`, [`lead-${msgId}`]);
  if (alreadyHandled.length > 0) return;

  // 2. Mark as processing
  await query(
    `INSERT INTO email_logs (resend_id, destinataire, sujet, statut) VALUES ($1,$2,$3,'processing')`,
    [`lead-${msgId}`, fromEmail, subject]
  );

  // 3. Load conversation history from kv_store
  const sanitizedEmail = fromEmail.toLowerCase().replace(/[^a-z0-9]/g, '_');
  const convKey = `lead_conv_${sanitizedEmail}`;
  const convRow = await query(`SELECT value FROM kv_store WHERE key = $1`, [convKey]);
  const conv: { exchanges: Array<{ role: 'lead' | 'novus'; content: string }>; type: string } =
    convRow.length > 0
      ? JSON.parse(convRow[0].value as string)
      : { exchanges: [], type: '' };

  const historyText = conv.exchanges.length > 0
    ? conv.exchanges.map(e => `[${e.role === 'lead' ? 'CLIENT' : 'NOVUS EPOXY'}]: ${e.content}`).join('\n\n')
    : 'Aucun historique — premier contact.';

  // 4. Call Claude Sonnet 4.6 as closer agent
  const apiKey = ANTHROPIC_KEY();
  const closerRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 1200,
      system: `Tu es l'agent commercial senior de Novus Epoxy (planchers epoxy premium, Quebec). Tu reponds au nom de l'equipe Novus Epoxy.

MISSION: Analyser l'email, identifier l'intention, generer une reponse qui maximise la conversion. Tu es un CLOSER — pas un robot.

TYPES DE LEADS:
- CLIENT_RESIDENTIEL: garage, sous-sol, balcon, escalier, condo
- CLIENT_COMMERCIAL: restaurant, entrepot, commerce, bureau, industriel
- SOUS_TRAITANT: entrepreneur, renovateur, peintre qui veut travailler avec nous
- QUESTION_GENERALE: curieux, veut en savoir plus sur les services
- CONCURRENT: competitor fishing pour info
- NON_INTERESSE: se desabonne ou mauvais destinataire
- SPAM

STRATEGIE:
CLIENT (residentiel ou commercial):
- Reconnais le projet specifiquement
- Montre l'expertise (types epoxy, durabilite, processus 2 jours)
- Si demande prix: donne les fourchettes ci-dessous, ancre sur valeur (garantie 10 ans, RBQ, 15 ans experience)
- Urgence naturelle: "on commence a avoir les agendas charges pour le printemps"
- Push: formulaire https://novusepoxy.ca/#contact (choisissent leurs couleurs)
- Alternative: appeler Luca 581-307-5983 ou Jason 581-307-2678

SOUS_TRAITANT:
- Professionnel et ouvert
- Demande specialite, region, capacite
- "Jason vous contactera sous peu"

QUESTION_GENERALE: reponds avec expertise, transforme en opportunite de quote

CONCURRENT / NON_INTERESSE: reponse courte polie, rien de plus

PRIX (donner si demandes, pas d'hesitation):
- Flake/flocon (garage, sous-sol): a partir de 8.50$/pi²
- Metallique (premium): a partir de 12.75$/pi²
- Quartz (balcons, ext): a partir de 11$/pi²
- Commercial/industriel: a partir de 15$/pi²
- Prix final selon superficie, preparation beton, complexite — soumission gratuite
- TOUJOURS mentionner: ces tarifs sont personnalisables selon le volume, le type de projet (donneur d'ouvrage, promoteur immobilier, entrepreneur general, serie de condos/logements). Les grands projets ou contrats recurrents peuvent avoir des tarifs negocies. Inviter a en parler directement avec Jason (581-307-2678).

REGLES:
- Francais quebecois professionnel et chaleureux, MAX 180 mots
- NE JAMAIS citer un prix exact ou faire une promesse ferme
- Signe: "L'equipe Novus Epoxy"
- RBQ: 5861-8471-01 | Garantie 10 ans | 15 ans d'experience`,
      messages: [{
        role: 'user',
        content: `Nom du lead: ${leadNom}
Email: ${fromEmail}

Historique de la conversation:
${historyText}

Nouveau message recu:
---
${bodyText.slice(0, 2000)}
---

Reponds en JSON strict (sans markdown):
{
  "type": "CLIENT_RESIDENTIEL|CLIENT_COMMERCIAL|SOUS_TRAITANT|QUESTION_GENERALE|CONCURRENT|NON_INTERESSE|SPAM",
  "intent": "1 phrase resume",
  "priority": "haute|normale|basse",
  "reponse": "texte complet de la reponse email",
  "service_detecte": "flake|metallique|commercial|quartz|couleur_unie|null",
  "superficie_detectee": "nombre string ou null",
  "adresse_detectee": "adresse/ville ou null",
  "info_complete": true/false
}`,
      }],
    }),
  });

  if (!closerRes.ok) {
    await query(`UPDATE email_logs SET statut = 'error' WHERE resend_id = $1`, [`lead-${msgId}`]);
    return;
  }

  const closerData = await closerRes.json();
  const rawText = (closerData.content?.[0]?.text ?? '').replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  let parsed: {
    type: string;
    intent: string;
    priority: string;
    reponse: string;
    service_detecte: string | null;
    superficie_detectee: string | null;
    adresse_detectee: string | null;
    info_complete: boolean;
  };
  try {
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(jsonMatch?.[0] ?? '{}');
  } catch {
    await query(`UPDATE email_logs SET statut = 'error' WHERE resend_id = $1`, [`lead-${msgId}`]);
    return;
  }

  // 5. If spam/concurrent/non-interesse: close lead
  if (['SPAM', 'CONCURRENT', 'NON_INTERESSE'].includes(parsed.type)) {
    await query(`UPDATE crm_leads SET statut = 'ferme', updated_at = NOW() WHERE id = $1`, [leadId]);
    await query(`UPDATE email_logs SET statut = 'skipped' WHERE resend_id = $1`, [`lead-${msgId}`]);
    return;
  }

  // 6. Send reply email via Gmail with branding + notify admins
  const reponseText = parsed.reponse ?? '';
  if (reponseText) {
    const replyHtml = brandedEmailHtml(`<p>${reponseText.replace(/\n/g, '<br/>')}</p>`);

    let emailSent = false;
    try {
      await sendEmail({
        to: fromEmail,
        subject: subject.startsWith('Re:') ? subject : `Re: ${subject}`,
        html: replyHtml,
      });
      emailSent = true;
    } catch { /* email send failed */ }

    // Notify admins on Telegram
    for (const chatId of ADMIN_CHAT_IDS()) {
      await sendTelegram(chatId, [
        `🤖 <b>Closer — ${emailSent ? 'reponse envoyee' : 'reponse ECHOUEE'}</b>`,
        ``,
        `👤 ${leadNom} (${fromEmail})`,
        `🏷 ${parsed.type ?? 'inconnu'} — ${parsed.intent ?? ''}`,
        parsed.service_detecte && parsed.service_detecte !== 'null' ? `🔧 ${parsed.service_detecte}` : '',
        parsed.superficie_detectee && parsed.superficie_detectee !== 'null' ? `📐 ${parsed.superficie_detectee} pi²` : '',
        ``,
        `💬 <i>${reponseText.slice(0, 400)}</i>`,
        ``,
        `https://novus-epoxy.vercel.app/dashboard/crm`,
      ].filter(Boolean).join('\n'));
    }
  }

  // 7. Save conversation history to kv_store (keep last 10 exchanges)
  const newExchanges = [
    ...conv.exchanges,
    { role: 'lead' as const, content: bodyText.slice(0, 1000) },
    { role: 'novus' as const, content: parsed.reponse },
  ].slice(-10);
  await query(
    `INSERT INTO kv_store (key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value = $2`,
    [convKey, JSON.stringify({ exchanges: newExchanges, type: parsed.type })]
  );

  // 8. Update crm_leads statut + temperature + last_agent_reply_at
  const temperature = parsed.priority === 'haute' ? 'chaud' : parsed.priority === 'basse' ? 'froid' : 'tiede';
  await query(
    `UPDATE crm_leads SET statut = 'interesse', temperature = $1, last_agent_reply_at = NOW(), updated_at = NOW() WHERE id = $2`,
    [temperature, leadId]
  );

  // 8b. Get lead phone for Telegram alert
  const leadPhoneRows = await query(`SELECT telephone, source FROM crm_leads WHERE id = $1`, [leadId]);
  const leadPhone = (leadPhoneRows[0]?.telephone as string) ?? null;
  const leadSource = (leadPhoneRows[0]?.source as string) ?? '';

  // HOT LEAD ALERT — if priority haute, send special Telegram with phone to call
  if (parsed.priority === 'haute' && leadPhone) {
    for (const chatId of ADMIN_CHAT_IDS()) {
      await sendTelegram(chatId, [
        `🔥🔥🔥 <b>LEAD CHAUD — APPELLE MAINTENANT</b>`,
        ``,
        `👤 <b>${leadNom}</b>`,
        `📞 <a href="tel:${leadPhone.replace(/\D/g, '')}">${leadPhone}</a>`,
        `📧 ${fromEmail}`,
        leadSource ? `📌 Source: ${leadSource}` : '',
        ``,
        `💬 "${parsed.intent}"`,
        parsed.service_detecte && parsed.service_detecte !== 'null' ? `🔧 ${parsed.service_detecte}` : '',
        parsed.superficie_detectee && parsed.superficie_detectee !== 'null' ? `📐 ${parsed.superficie_detectee} pi²` : '',
        ``,
        `Aria a deja repondu automatiquement.`,
        `Appelle pour closer!`,
      ].filter(Boolean).join('\n'));
    }
  }

  // 9. Mark email_logs as sent (only if reply was actually sent)
  await query(`UPDATE email_logs SET statut = $1 WHERE resend_id = $2`, [reponseText ? 'sent' : 'skipped', `lead-${msgId}`]).catch(() => {});

  // 10. If info_complete + service + superficie: create draft quote, notify admins with details
  if (
    parsed.info_complete &&
    parsed.service_detecte &&
    parsed.service_detecte !== 'null' &&
    parsed.superficie_detectee &&
    parsed.superficie_detectee !== 'null'
  ) {
    const surf = parseFloat(String(parsed.superficie_detectee).replace(/[^\d.]/g, ''));
    const validServices: ServiceType[] = ['flake', 'metallique', 'commercial', 'quartz', 'couleur_unie'];
    const serviceKey: ServiceType = validServices.includes(parsed.service_detecte as ServiceType)
      ? (parsed.service_detecte as ServiceType)
      : 'flake';

    if (!isNaN(surf) && surf > 0) {
      try {
        const calc = calculateQuote(serviceKey, surf);
        const quoteRows = await query(
          `INSERT INTO quotes (client_nom, client_email, client_adresse, type_service, superficie,
           prix_pied_carre, sous_total, tps, tvq, total, depot_requis, statut, notes)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'brouillon',$12) RETURNING id`,
          [
            leadNom, fromEmail, parsed.adresse_detectee || '', serviceKey, surf,
            calc.prix_pied_carre, calc.sous_total, calc.tps, calc.tvq, calc.total, calc.depot_requis,
            `Lead CRM #${leadId} — agent closer`,
          ]
        );
        const quoteId = (quoteRows[0] as { id: number })?.id;
        if (!quoteId) throw new Error('Quote insert returned no ID');
        await query(
          `UPDATE crm_leads SET statut = 'devis_envoye', updated_at = NOW() WHERE id = $1`,
          [leadId]
        );

        for (const chatId of ADMIN_CHAT_IDS()) {
          await sendTelegram(chatId, [
            `🔥 <b>Lead pret pour devis!</b>`,
            ``,
            `👤 ${leadNom} (${fromEmail})`,
            `🏷 ${parsed.type} — ${parsed.intent}`,
            `🔧 ${SERVICES[serviceKey]?.label || serviceKey} — ${surf} pi²`,
            parsed.adresse_detectee ? `📍 ${parsed.adresse_detectee}` : '',
            `💰 Total estimé: ${formatMoney(calc.total)}`,
            ``,
            `Devis #${quoteId} en brouillon — approuver:`,
            `https://novus-epoxy.vercel.app/dashboard/devis`,
          ].filter(Boolean).join('\n'));
        }
      } catch { /* quote creation failed — still notify */ }
    }
  } else {
    // 11. Notify admins with priority + summary
    const emoji = parsed.priority === 'haute' ? '🔥' : parsed.priority === 'basse' ? '🔵' : '🟡';
    for (const chatId of ADMIN_CHAT_IDS()) {
      await sendTelegram(chatId, [
        `${emoji} <b>Email lead CRM</b>`,
        ``,
        `👤 ${leadNom} (${fromEmail})`,
        `🏷 ${parsed.type}`,
        `💬 ${parsed.intent}`,
        parsed.service_detecte && parsed.service_detecte !== 'null' ? `🔧 Service: ${parsed.service_detecte}` : '',
        parsed.superficie_detectee && parsed.superficie_detectee !== 'null' ? `📐 Superficie: ${parsed.superficie_detectee} pi²` : '',
        ``,
        `https://novus-epoxy.vercel.app/dashboard/crm`,
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
  // Support ?hours=X to force scan over a longer period
  const hoursParam = parseInt(req.nextUrl.searchParams.get('hours') ?? '0', 10);
  const afterDate = hoursParam > 0
    ? new Date(Date.now() - hoursParam * 60 * 60 * 1000).toISOString()
    : lastScan ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const afterEpoch = Math.floor(new Date(afterDate).getTime() / 1000);

  // Fetch emails — support ?all=true to include read emails
  const includeRead = req.nextUrl.searchParams.get('all') === 'true';
  const listRes = await gmail.users.messages.list({
    userId: 'me',
    q: includeRead ? `after:${afterEpoch}` : `is:unread after:${afterEpoch}`,
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

    // Skip our own emails — BUT allow jason@novusepoxy.shop (lead imports)
    const isJasonShop = fromEmail.toLowerCase().includes('jason@novusepoxy') || fromHeader.toLowerCase().includes('jason@novusepoxy');
    console.log(`[Email Scan] Processing: from=${fromEmail} isJasonShop=${isJasonShop} subject=${subject.slice(0, 50)}`);
    if (!isJasonShop && (fromEmail.includes('novusepoxy') || fromEmail.includes('gestionnovusepoxy'))) continue;

    // === JASON LEAD IMPORT VIA EMAIL ===
    // When Jason sends a list of leads by email, auto-import into CRM + prospect
    // Detect by sender (jason@novusepoxy.shop) OR by subject containing "ARIA" + "LEAD"
    const isLeadEmail = isJasonShop || (subject.toUpperCase().includes('ARIA') && subject.toUpperCase().includes('LEAD'));
    if (isLeadEmail) {
      // Get body text
      let jasonBody = '';
      const jParts = fullMsg.data.payload?.parts ?? [];
      const jTextPart = jParts.find((p) => p.mimeType === 'text/plain');
      if (jTextPart?.body?.data) {
        jasonBody = Buffer.from(jTextPart.body.data, 'base64url').toString('utf-8');
      } else if (fullMsg.data.payload?.body?.data) {
        jasonBody = Buffer.from(fullMsg.data.payload.body.data, 'base64url').toString('utf-8');
      }

      // Check for CSV/TXT attachment
      let attachedText = '';
      for (const part of jParts) {
        if (
          part.body?.attachmentId &&
          (part.mimeType === 'text/csv' || part.mimeType === 'text/plain' ||
           part.filename?.endsWith('.csv') || part.filename?.endsWith('.txt'))
        ) {
          try {
            const att = await gmail.users.messages.attachments.get({
              userId: 'me',
              messageId: msg.id,
              id: part.body.attachmentId,
            });
            if (att.data.data) {
              attachedText = Buffer.from(att.data.data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8');
            }
          } catch { /* skip */ }
          break;
        }
      }

      const leadsText = attachedText || jasonBody;

      // Check if it looks like a lead list (has phone numbers or multiple lines with names)
      const lines = leadsText.split('\n').filter((l: string) => l.trim().length > 3);
      const hasPhones = (leadsText.match(/\d{3}[\s.-]?\d{3}[\s.-]?\d{4}/g) || []).length >= 2;
      const hasMultipleLines = lines.length >= 3;

      if (hasPhones || hasMultipleLines) {
        // Parse with Claude
        const apiKey = ANTHROPIC_KEY();
        if (apiKey) {
          try {
            const parseRes = await fetch('https://api.anthropic.com/v1/messages', {
              method: 'POST',
              headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
              body: JSON.stringify({
                model: 'claude-haiku-4-5-20251001',
                max_tokens: 4000,
                messages: [{ role: 'user', content: `Parse cette liste de leads pour une entreprise de planchers epoxy au Quebec. Extrait chaque personne.\n\nLISTE:\n${leadsText.slice(0, 8000)}\n\nReponds UNIQUEMENT avec un JSON array:\n[{"nom":"Prenom Nom","telephone":"10 chiffres ou vide","email":"email ou vide","service":"flake|metallique|commercial|quartz ou vide","superficie":"nombre ou vide","ville":"ville ou vide","notes":"autres infos ou vide"}]` }],
              }),
            });

            if (parseRes.ok) {
              const data = await parseRes.json();
              const raw = (data.content?.[0]?.text ?? '').replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
              type ParsedLead = { nom: string; telephone: string; email: string; service: string; superficie: string; ville: string; notes: string };
              let leads: ParsedLead[] = [];
              try { const arr = JSON.parse(raw); leads = Array.isArray(arr) ? arr : []; } catch { /* */ }

              if (leads.length > 0) {
                // Score temperature
                function scoreTemp(lead: ParsedLead): 'chaud' | 'tiede' | 'froid' {
                  let score = 0;
                  if (lead.email) score += 2;
                  if (lead.telephone) score += 2;
                  if (lead.service) score += 1;
                  if (lead.superficie) score += 1;
                  if (lead.ville) score += 1;
                  const text = `${lead.notes} ${lead.service}`.toLowerCase();
                  if (text.includes('urgent') || text.includes('bientot') || text.includes('soumission')) score += 3;
                  if (score >= 6) return 'chaud';
                  if (score >= 3) return 'tiede';
                  return 'froid';
                }

                // Anti-doublon: check existing leads by phone or email
                const existingPhones = new Set<string>();
                const existingEmails = new Set<string>();
                const phonesToCheck = leads.map(l => (l.telephone || '').replace(/\D/g, '').slice(-10)).filter(p => p.length === 10);
                const emailsToCheck = leads.map(l => (l.email || '').toLowerCase().trim()).filter(e => e.includes('@'));

                if (phonesToCheck.length > 0) {
                  const phPlaceholders = phonesToCheck.map((_, i) => `$${i + 1}`).join(',');
                  const phRows = await query(`SELECT telephone FROM crm_leads WHERE telephone IN (${phPlaceholders})`, phonesToCheck);
                  phRows.forEach((r: Record<string, unknown>) => existingPhones.add(r.telephone as string));
                }
                if (emailsToCheck.length > 0) {
                  const emPlaceholders = emailsToCheck.map((_, i) => `$${i + 1}`).join(',');
                  const emRows = await query(`SELECT LOWER(email) as email FROM crm_leads WHERE LOWER(email) IN (${emPlaceholders})`, emailsToCheck);
                  emRows.forEach((r: Record<string, unknown>) => existingEmails.add(r.email as string));
                }

                // Batch insert (skip duplicates)
                let imported = 0;
                let skipped = 0;
                const insertedIds: number[] = [];
                const batchSize = 50;

                for (let i = 0; i < leads.length; i += batchSize) {
                  const batch = leads.slice(i, i + batchSize);
                  const values: string[] = [];
                  const params: (string | null)[] = [];
                  let paramIdx = 1;

                  for (const lead of batch) {
                    if (!lead.nom || lead.nom.trim().length < 2) continue;
                    const phone = (lead.telephone || '').replace(/\D/g, '').slice(-10);
                    const email = (lead.email || '').toLowerCase().trim();
                    // Skip if phone or email already exists
                    if (phone.length === 10 && existingPhones.has(phone)) { skipped++; continue; }
                    if (email.includes('@') && existingEmails.has(email)) { skipped++; continue; }
                    const temp = scoreTemp(lead);
                    values.push(`($${paramIdx},$${paramIdx+1},$${paramIdx+2},$${paramIdx+3},$${paramIdx+4},$${paramIdx+5},$${paramIdx+6},$${paramIdx+7},'nouveau',$${paramIdx+8})`);
                    params.push(
                      lead.nom.trim().slice(0, 120),
                      phone || null,
                      (lead.email || '').slice(0, 255) || null,
                      lead.service || null,
                      lead.superficie || null,
                      (lead.ville || '').slice(0, 120) || null,
                      lead.notes || null,
                      'jason',
                      temp,
                    );
                    paramIdx += 9;
                  }

                  if (values.length > 0) {
                    const insertedRows = await query(
                      `INSERT INTO crm_leads (nom, telephone, email, service, superficie, ville, notes, source, statut, temperature) VALUES ${values.join(',')} RETURNING id`,
                      params,
                    );
                    imported += values.length;
                    insertedIds.push(...insertedRows.map((r: Record<string, unknown>) => (r as { id: number }).id));
                  }
                }

                // Auto-prospect
                let prospectResult = null;
                if (insertedIds.length > 0) {
                  try {
                    const base = process.env.NEXTAUTH_URL ?? 'https://novus-epoxy.vercel.app';
                    const res = await fetch(`${base}/api/leads/jason/prospect`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ADMIN_API_KEY ?? '' },
                      body: JSON.stringify({ leadIds: insertedIds }),
                    });
                    if (res.ok) prospectResult = await res.json();
                  } catch { /* */ }
                }

                // Notify Telegram
                for (const chatId of ADMIN_CHAT_IDS()) {
                  await sendTelegram(chatId,
                    `📥 <b>Leads importes par email (Jason)</b>\n\n` +
                    `📊 ${imported} leads importes dans le CRM\n` +
                    (skipped > 0 ? `⏭️ ${skipped} doublons ignores\n` : '') +
                    `📧 Source: ${fromEmail}\n` +
                    (prospectResult ? `🚀 Auto-prospect: ${(prospectResult as Record<string, unknown>).sent ?? 0} emails envoyes\n` : '') +
                    `\n🔗 <a href="https://novus-epoxy.vercel.app/dashboard/crm">Voir dans le CRM</a>`,
                  );
                }
              }
            }
          } catch (err) {
            console.error('[Email Scan] Jason lead import error:', err);
          }
        }
        continue; // Done processing this email
      }
      // If not a lead list, fall through to normal processing
    }

    // Detect system/monitoring emails that should NOT be skipped (Sentry, Vercel, Stripe, etc.)
    const isSystemAlert = /sentry|vercel|stripe|twilio|neon\.tech|cloudflare|github/i.test(fromEmail + ' ' + fromHeader)
      && /error|alert|issue|incident|fail|warn|limit|spike|degrad/i.test(subject);

    // Skip auto-replies, newsletters, notifications, bulk senders — BUT NOT system alerts
    const autoSubmitted = headers.find(h => h.name?.toLowerCase() === 'auto-submitted')?.value ?? '';
    const precedence = headers.find(h => h.name?.toLowerCase() === 'precedence')?.value ?? '';
    const listUnsubscribe = headers.find(h => h.name?.toLowerCase() === 'list-unsubscribe')?.value ?? '';
    const isAutoReply = !isSystemAlert && (
      autoSubmitted.includes('auto-replied') ||
      autoSubmitted.includes('auto-generated') ||
      precedence === 'bulk' ||
      precedence === 'list' ||
      precedence === 'auto_reply' ||
      listUnsubscribe.length > 0 ||
      /noreply|no-reply|no_reply|mailer-daemon|postmaster|notifications?@|newsletter|updates?@|support@|billing@|info@.*\.(com|ca|net|org)|marketing@|promo|digest/i.test(fromEmail) ||
      /\b(auto.?r[eé]ponse|auto.?reply|out of office|absence|r[eé]ception de votre message|unsubscribe|d[eé]sabonne|newsletter)\b/i.test(subject)
    );

    // System alert: send straight to Telegram without Claude analysis
    if (isSystemAlert) {
      // Get body text for summary
      let alertBody = '';
      const parts = fullMsg.data.payload?.parts ?? [];
      const textPart = parts.find(p => p.mimeType === 'text/plain');
      if (textPart?.body?.data) {
        alertBody = Buffer.from(textPart.body.data, 'base64url').toString('utf-8');
      } else if (fullMsg.data.payload?.body?.data) {
        alertBody = Buffer.from(fullMsg.data.payload.body.data, 'base64url').toString('utf-8');
      }
      // Extract key info (first 500 chars, strip HTML)
      const cleanBody = alertBody.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, 500);
      const source = fromEmail.includes('sentry') ? 'Sentry' : fromEmail.includes('vercel') ? 'Vercel' : fromEmail.includes('stripe') ? 'Stripe' : 'Systeme';

      for (const chatId of ADMIN_CHAT_IDS()) {
        await sendTelegram(chatId, [
          `⚠️ <b>${source} — Alerte</b>`,
          ``,
          `📧 ${subject}`,
          ``,
          `${cleanBody}`,
          ``,
          `De: ${fromHeader}`,
        ].join('\n'));
      }
      alertsSent++;
      // Mark as read
      try { await gmail.users.messages.modify({ userId: 'me', id: msg.id, requestBody: { removeLabelIds: ['UNREAD'] } }); } catch { /* ignore */ }
      continue;
    }

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
      // Validate categorie against allowed values (DB CHECK constraint)
      const VALID_CATEGORIES = ['materiaux', 'equipement', 'vehicule', 'essence', 'assurance', 'publicite', 'sous-traitance', 'bureau', 'telecommunication', 'formation', 'repas', 'entretien', 'loyer', 'autre'];
      const safeCategorie = VALID_CATEGORIES.includes(analysis.categorie ?? '') ? analysis.categorie : 'autre';

      // Check duplicate
      const existing = await query(
        `SELECT id FROM expenses WHERE fournisseur = $1 AND montant_ttc = $2 AND date_depense = $3`,
        [analysis.fournisseur ?? 'Inconnu', analysis.montant_ttc, analysis.date_depense ?? new Date().toISOString().slice(0, 10)],
      );

      if (existing.length === 0) {
        try {
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
            safeCategorie,
            analysis.date_depense ?? new Date().toISOString().slice(0, 10),
            'autre',
            'email-scan',
          ],
        );
        invoicesCreated++;
        } catch (insertErr) {
          console.error(`[Email Scan] Expense insert failed for ${fromEmail}:`, insertErr);
          // Don't crash the whole scan — just skip this expense
        }

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

    // === CLIENT: Auto-reply + notify admins ===
    const replySuggestion = analysis.reply_suggestion ?? '';
    if (analysis.type === 'client' && replySuggestion) {
      const alreadyReplied = await query(
        `SELECT id FROM email_logs WHERE resend_id = $1`,
        [`gmail-${msg.id}`],
      );
      if (alreadyReplied.length === 0) {
        await query(
          `INSERT INTO email_logs (resend_id, destinataire, sujet, statut) VALUES ($1, $2, $3, $4)`,
          [`gmail-${msg.id}`, fromEmail, subject ? `Re: ${subject}` : 'Auto-reply', 'processing'],
        ).catch(() => {});
        try {
          // Send branded reply with CTA to quote form
          await sendEmail({
            to: fromEmail,
            subject: subject ? `Re: ${subject}` : 'Novus Epoxy — Reponse',
            html: brandedEmailHtml(`<p>${replySuggestion.replace(/\n/g, '<br/>')}</p>`),
          });
          await query(`UPDATE email_logs SET statut = 'sent' WHERE resend_id = $1`, [`gmail-${msg.id}`]);
          repliesSent++;
        } catch { /* ignore reply errors */ }

        for (const chatId of ADMIN_CHAT_IDS()) {
          await sendTelegram(chatId,
            `🤖 <b>Email client — reponse envoyee</b>\n\n` +
            `De: ${fromHeader}\n` +
            `Sujet: ${subject}\n\n` +
            `📋 ${analysis.summary}\n` +
            `\n💬 <i>${(analysis.reply_suggestion ?? '').slice(0, 400)}</i>` +
            `\n\nhttps://novus-epoxy.vercel.app/dashboard/crm`,
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

    // Only send Telegram alert if we haven't sent one in the last 30 minutes (prevent spam)
    const lastAlertRows = await query(`SELECT value FROM kv_store WHERE key = 'last_email_scan_error'`).catch(() => []);
    const lastAlert = lastAlertRows?.[0]?.value as string | undefined;
    const shouldAlert = !lastAlert || (Date.now() - new Date(lastAlert).getTime() > 30 * 60 * 1000);

    if (shouldAlert) {
      await query(
        `INSERT INTO kv_store (key, value) VALUES ('last_email_scan_error', $1) ON CONFLICT (key) DO UPDATE SET value = $1`,
        [new Date().toISOString()],
      ).catch(() => {});
      await alertAdmins(
        `🚨 <b>Email Scan — ERREUR CRITIQUE</b>\n\n` +
        `${msg}\n\n` +
        `Le scan des emails est en panne. Verifiez les logs Vercel.\n` +
        `https://vercel.com/gestionnovusepoxy-boops-projects/novus-epoxy/logs`,
      ).catch(() => {});
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

import { getAdminChatIds } from '@/lib/telegram-utils';
import { NextRequest, NextResponse } from 'next/server';
import { google } from 'googleapis';
import { query } from '@/lib/db';
import { SERVICES, type ServiceType, calculateQuote, formatMoney } from '@/lib/pricing';
import { sendEmail, handleGmailAuthError } from '@/lib/send-email';
import { callLLM } from '@/lib/llm';

export const maxDuration = 60; // Allow up to 60s for large CSV imports

const CRON_SECRET = () => process.env.CRON_SECRET ?? '';
const BOT_TOKEN = () => process.env.TELEGRAM_BOT_TOKEN ?? '';
const ADMIN_CHAT_IDS = () => {
  const groupId = (process.env.TELEGRAM_GROUP_CHAT_ID ?? '').trim();
  const adminIds = getAdminChatIds();
  return groupId ? [groupId] : adminIds;
};

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

async function getGmailClient() {
  // All 3 values can be overridden by kv_store (shared DB = single source of truth across Vercel + VPS)
  let clientId = (process.env.GOOGLE_WEB_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || '');
  let clientSecret = (process.env.GOOGLE_WEB_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET || '');
  let refreshToken = process.env.GOOGLE_REFRESH_TOKEN ?? '';

  try {
    const rows = await query(
      `SELECT key, value FROM kv_store WHERE key IN ('google_client_id','google_client_secret','google_refresh_token')`
    );
    for (const row of (rows ?? [])) {
      if (row.key === 'google_client_id' && row.value) clientId = row.value as string;
      if (row.key === 'google_client_secret' && row.value) clientSecret = row.value as string;
      if (row.key === 'google_refresh_token' && row.value) refreshToken = row.value as string;
    }
  } catch { /* ignore — use env vars */ }

  if (!clientId || !clientSecret || !refreshToken) return null;

  const oauth2 = new google.auth.OAuth2(clientId, clientSecret);
  oauth2.setCredentials({ refresh_token: refreshToken });
  return google.gmail({ version: 'v1', auth: oauth2 });
}

async function analyzeWithClaude(
  content: string,
  attachmentData?: { mimeType: string; base64: string },
): Promise<{
  type: 'facture' | 'client' | 'spam' | 'important' | 'rdv' | 'paiement' | 'autre';
  fournisseur?: string;
  montant_ttc?: number;
  montant_ht?: number;
  tps?: number;
  tvq?: number;
  description?: string;
  categorie?: string;
  date_depense?: string;
  date_limite?: string;
  summary: string;
  needs_attention: boolean;
  reply_suggestion?: string;
}> {
  type TextPart = { type: 'text'; text: string };
  type ImagePart = { type: 'image_url'; image_url: { url: string } };
  const imageContent: Array<TextPart | ImagePart> = [];
  if (attachmentData) {
    imageContent.push({
      type: 'image_url',
      image_url: { url: `data:${attachmentData.mimeType};base64,${attachmentData.base64}` },
    });
  }
  imageContent.push({
    type: 'text',
    text: `Analyse cet email recu par Novus Epoxy (entreprise de planchers epoxy au Quebec).

Email:
${content}

Reponds en JSON strict:
{
  "type": "facture" | "client" | "spam" | "important" | "rdv" | "paiement" | "autre",
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

- type "facture" = c'est une facture/invoice/receipt d'un FOURNISSEUR EXTERNE qu'on doit payer (depense d'achat de materiaux, equipement, services, etc.)
- IMPORTANT: Les factures/soumissions que NOVUS EPOXY envoie a SES clients ne sont PAS des depenses. Si l'email est une copie/confirmation d'une facture envoyee PAR Novus Epoxy a un client, mets type "autre" et NON "facture".
- Exemples de factures VALIDES (depenses): Les Idees Epoxy, Groupe Novus, Home Depot, quincailleries, fournisseurs de materiaux, sous-traitants, Torginol, assurances, etc.
- Exemples a NE PAS classer comme facture: confirmation d'envoi de soumission, copie de facture envoyee au client, notifications Stripe de paiement recu
- type "client" = un client potentiel ou existant qui ecrit (demande de soumission, questions sur les services, reponse a une offre de service)
- type "rdv" = quelqu'un qui demande un rendez-vous, veut visiter, veut nous rencontrer, demande a parler a quelqu'un, veut un appel, "quand etes-vous disponible", "peut-on se voir", "je voudrais vous rencontrer"
- type "paiement" = facture a payer, rappel de paiement, compte en souffrance, date limite, paiement du, relance de paiement, Hydro-Quebec, Bell, assurance, loyer, abonnement, renouvellement
- type "important" = message important (gouvernement, banque, urgent, etc.)
- type "spam" = pub, newsletter, spam, marketing, promotion
- type "autre" = autre chose
- Pour les taxes Quebec: TPS = 5%, TVQ = 9.975%
- Si c'est une image de facture/PDF, extrais les montants de l'image
- Categorie seulement si type = facture
- "date_limite": "YYYY-MM-DD" si type = paiement et qu'il y a une date limite/echeance mentionnee

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

  const text = await callLLM({
    tier: 'smart', // x-ai/grok-4.20 supports vision via OpenRouter
    agent: 'email-scan',
    maxTokens: 1024,
    messages: [{ role: 'user', content: imageContent }],
  });

  // Extract JSON from response (handle markdown code blocks)
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  try {
    return JSON.parse(jsonMatch?.[0] ?? '{}');
  } catch {
    console.error('[email-scan] LLM returned invalid JSON:', text.slice(0, 200));
    return { type: 'autre', summary: 'Analyse échouée', needs_attention: false };
  }
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
  // 1. Atomic dedup: claim this email — if another run already claimed it, stop immediately
  const claimed = await query(
    `INSERT INTO email_logs (resend_id, destinataire, sujet, statut) VALUES ($1,$2,$3,'processing')
     ON CONFLICT (resend_id) DO NOTHING RETURNING id`,
    [`lead-${msgId}`, fromEmail, subject]
  );
  if (!claimed || claimed.length === 0) return; // already being handled by another run

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

  // 4. Call closer agent via OpenRouter
  let rawText: string;
  try {
    rawText = await callLLM({
      system: `Tu es l'agent commercial senior de Novus Epoxy (planchers epoxy premium, Quebec). Tu reponds au nom de l'equipe Novus Epoxy.

MISSION: Analyser l'email, identifier l'intention, generer une reponse qui maximise la conversion. Tu es un CLOSER — pas un robot.

TYPES DE LEADS:
- CLIENT_RESIDENTIEL: garage, sous-sol, balcon, escalier, condo
- CLIENT_COMMERCIAL: restaurant, entrepot, commerce, bureau, industriel
- SOUS_TRAITANT: entrepreneur, renovateur, peintre, contracteur general qui veut travailler avec nous OU nous engager pour un projet
- QUESTION_GENERALE: curieux, veut en savoir plus sur les services
- CONCURRENT: UNIQUEMENT une entreprise d'epoxy qui pose des planchers epoxy elle-meme et espionne nos prix. ATTENTION: les entreprises de construction, renovation, general contractor sont des CLIENTS POTENTIELS, PAS des concurrents! Un plombier, electricien, constructeur, entrepreneur general = CLIENT ou SOUS_TRAITANT
- NON_INTERESSE: se desabonne ou mauvais destinataire
- SPAM

STRATEGIE:
CLIENT (residentiel ou commercial):
- Reconnais le projet specifiquement
- Montre l'expertise (types epoxy, durabilite, processus 2 jours)
- JAMAIS donner de prix par email. A la place, recolter les infos pour la soumission OU envoyer le lien du formulaire.
- Si on a PAS encore toutes les infos, demander gentiment: nom complet, telephone, email, adresse AVEC code postal, nombre de pieds carres, quel service (flocon, metallique, quartz, commercial, etc.)
- Si on a DEJA les infos ou si le client veut pas les donner par email, envoyer le formulaire: https://novusepoxy.ca/#contact
- Urgence naturelle (sans promo specifique): "nos agendas se remplissent vite, mieux vaut reserver tot"
- Alternative: appeler Luca 581-307-5983 ou Jason 581-307-2678

REGLES TECHNIQUES (ne JAMAIS violer, meme si le client insiste):
- Polyaspartique = TOUJOURS 1 seule couche, JAMAIS 2 couches
- Stripe / carte de credit = JAMAIS utilise. Paiement en Interac, cheque ou comptant uniquement.

SOUS_TRAITANT:
- Professionnel et ouvert
- Demande specialite, region, capacite
- "Jason vous contactera sous peu"

QUESTION_GENERALE: reponds avec expertise, transforme en opportunite de soumission gratuite

CONCURRENT / NON_INTERESSE: reponse courte polie, rien de plus

PRIX:
- JAMAIS donner de prix, fourchette de prix, estimation, ou "a partir de" par email
- Si le client demande un prix: "Chaque projet est unique, on prepare des soumissions personnalisees gratuites. Pour la preparer rapidement, j'aurais besoin de quelques infos..." puis demander les infos
- OU envoyer vers le formulaire: https://novusepoxy.ca/#contact

INFOS A RECOLTER POUR LA SOUMISSION:
1. Nom complet
2. Telephone
3. Email
4. Adresse complete avec code postal
5. Superficie en pieds carres
6. Type de service souhaite (flocon, metallique, quartz, couleur unie, commercial)
7. Type de surface actuelle (beton, bois, peinture existante)

REGLES:
- Francais quebecois professionnel et chaleureux, MAX 180 mots
- NE JAMAIS donner de prix, estimation, fourchette ou "a partir de" — JAMAIS
- Toujours orienter vers la soumission gratuite personnalisee
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
      maxTokens: 1200,
      tier: 'smart',
    });
  } catch {
    await query(`UPDATE email_logs SET statut = 'error' WHERE resend_id = $1`, [`lead-${msgId}`]);
    return;
  }

  rawText = rawText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
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

  // 5. Spam only: skip silently. NEVER auto-close leads — only humans can close.
  // Even "non-interesse" leads get marked contacté so Luca/Jason can follow up with rabais etc.
  if (parsed.type === 'SPAM') {
    await query(`UPDATE email_logs SET statut = 'skipped' WHERE resend_id = $1`, [`lead-${msgId}`]);
    return;
  }
  if (parsed.type === 'CONCURRENT') {
    await query(`UPDATE crm_leads SET statut = 'contacte', notes = COALESCE(notes, '') || E'\n[Concurrent detecte]', updated_at = NOW() WHERE id = $1`, [leadId]);
    await query(`UPDATE email_logs SET statut = 'skipped' WHERE resend_id = $1`, [`lead-${msgId}`]);
    // Always notify admins even for concurrent detection
    for (const chatId of ADMIN_CHAT_IDS()) {
      await sendTelegram(chatId,
        `⚠️ <b>Concurrent detecte: ${leadNom}</b>\n\n📧 ${fromEmail}\n📝 ${subject}\n💬 "${parsed.intent}"\n\n<i>Aria n'a pas repondu. Verifie si c'est vraiment un concurrent.</i>`
      );
    }
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

    // Notify admins on Telegram only if reply FAILED (so Luca can intervene)
    if (!emailSent) {
      for (const chatId of ADMIN_CHAT_IDS()) {
        await sendTelegram(chatId,
          `⚠️ <b>Aria — reponse ECHOUEE</b>\n\n👤 ${leadNom} (${fromEmail})\n📝 ${subject}\n\n<i>Repondre manuellement!</i>`
        );
      }
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

  // Detect complaints/frustration — alert admins immediately
  const frustrationWords = ['rembourse', 'avocat', 'plainte', 'inacceptable', 'jamais revenu', 'arnaque', 'scam', 'poursuivre', 'bbb', 'opc', 'pas content', 'decu', 'horrible', 'worst', 'refund'];
  const msgLower = bodyText.toLowerCase();
  const isComplaint = frustrationWords.some(w => msgLower.includes(w));
  if (isComplaint) {
    for (const chatId of ADMIN_CHAT_IDS()) {
      await sendTelegram(chatId,
        `\u{1F6A8}\u{1F6A8}\u{1F6A8} <b>PLAINTE CLIENT DETECTEE</b>\n\n` +
        `\u{1F464} ${leadNom} (${fromEmail})\n` +
        `\u{1F4DD} ${subject}\n\n` +
        `\u{1F4AC} ${bodyText.slice(0, 500)}\n\n` +
        `\u{26A0}\u{FE0F} <b>REPONDRE IMMEDIATEMENT — ne pas laisser Aria gerer!</b>`
      );
    }
  }

  await query(
    `UPDATE crm_leads SET statut = CASE WHEN $1 = 'NON_INTERESSE' THEN 'contacte' ELSE 'interesse' END, temperature = $2, last_agent_reply_at = NOW(), updated_at = NOW() WHERE id = $3`,
    [parsed.type, temperature, leadId]
  );

  // CASL/LCAP: un classement NON_INTERESSE ou une réponse "DESABONNEMENT" doit bloquer
  // IMMÉDIATEMENT tout envoi commercial futur (honoré bien avant le délai légal de 10 jours).
  const wantsUnsub = parsed.type === 'NON_INTERESSE'
    || /d[eé]sabonn|unsubscribe|ne plus.*(courriel|email|message)|retir.*liste/i.test(`${subject} ${bodyText}`);
  if (wantsUnsub) {
    try {
      const { blockLead } = await import('@/lib/lead-blocklist');
      await blockLead({ email: fromEmail, reason: 'unsubscribed', detail: `Email desabo: ${subject}`.slice(0, 200) });
    } catch { /* ne bloque pas le scan */ }
  }

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
  }
  // Closer notification above is sufficient — no duplicate "Email lead CRM" message
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
  const cronSecret = CRON_SECRET();
  const adminKey = process.env.ADMIN_API_KEY ?? '';
  if (!token || (token !== cronSecret && token !== adminKey)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Short-circuit when OAuth is known-broken — avoid wasting a cron run / log spam.
  const oauthBrokenRows = await query(`SELECT value FROM kv_store WHERE key = 'gmail_oauth_broken'`).catch(() => []);
  if (oauthBrokenRows?.[0]?.value === 'true') {
    return NextResponse.json({ skipped: 'gmail_oauth_broken' });
  }

  const gmail = await getGmailClient();
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
  const searchSubject = req.nextUrl.searchParams.get('subject') ?? '';
  const baseQuery = searchSubject
    ? `subject:${searchSubject}`
    : includeRead ? `after:${afterEpoch}` : `is:unread after:${afterEpoch}`;
  const listRes = await gmail.users.messages.list({
    userId: 'me',
    q: baseQuery,
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

    // Skip ALL our own outbound emails (prospect offers, system emails, copies)
    const isJasonShop = fromEmail.toLowerCase().includes('jason@novusepoxy') || fromHeader.toLowerCase().includes('jason@novusepoxy');
    const isAdmin = fromEmail.toLowerCase().includes('gestionnovusepoxy');

    // Archive our own outbound email copies immediately — they clutter the inbox
    if (isAdmin) {
      try { await gmail.users.messages.modify({ userId: 'me', id: msg.id, requestBody: { removeLabelIds: ['INBOX', 'UNREAD'] } }); } catch { /* ignore */ }
      continue;
    }
    if (isJasonShop) {
      try { await gmail.users.messages.modify({ userId: 'me', id: msg.id, requestBody: { removeLabelIds: ['INBOX', 'UNREAD'] } }); } catch { /* ignore */ }
      continue;
    }
    // Skip other internal novusepoxy emails
    if (fromEmail.includes('novusepoxy')) {
      try { await gmail.users.messages.modify({ userId: 'me', id: msg.id, requestBody: { removeLabelIds: ['INBOX', 'UNREAD'] } }); } catch { /* ignore */ }
      continue;
    }

    // Detect system/monitoring emails that should NOT be skipped (Sentry, Vercel, Stripe, etc.)
    const isSystemAlert = /sentry|vercel|stripe|twilio|neon\.tech|cloudflare|github|resend|google|mailer-daemon/i.test(fromEmail + ' ' + fromHeader)
      && /error|alert|issue|incident|fail|warn|limit|spike|degrad|quota|block|bounce|reject|suspend|delivery/i.test(subject + ' ' + fromEmail);

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
      console.log(`[Email Scan] Trashing auto-reply/newsletter from ${fromEmail}: ${subject}`);
      try {
        await gmail.users.messages.trash({ userId: 'me', id: msg.id });
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

      // Check if this email is on the no-auto-reply list (notify only, no response)
      const noReplyRows = await query(`SELECT value FROM kv_store WHERE key = 'aria_no_reply_emails'`).catch(() => []);
      const noReplyList: string[] = noReplyRows.length > 0 ? JSON.parse(noReplyRows[0].value as string) : [];
      if (noReplyList.some(e => e.toLowerCase() === fromEmail.toLowerCase())) {
        // Just notify admins on Telegram — do NOT auto-reply
        for (const chatId of ADMIN_CHAT_IDS()) {
          await sendTelegram(chatId,
            `📬 <b>${lead.nom} a ecrit!</b>\n\n` +
            `📧 ${fromEmail}\n` +
            `📝 ${subject}\n\n` +
            `💬 ${bodyText.slice(0, 500)}\n\n` +
            `⚠️ <i>Pas de reponse auto — a toi de repondre!</i>`
          );
        }
        continue;
      }

      // Save inbound client reply to DB so Luca can read conversation history
      await query(
        `INSERT INTO email_logs (resend_id, destinataire, sujet, statut, direction, reply_body)
         VALUES ($1, $2, $3, 'received', 'inbound', $4)
         ON CONFLICT (resend_id) DO NOTHING`,
        [`inbound-${msg.id}`, fromEmail, subject ?? '', bodyText.slice(0, 5000)]
      ).catch(() => {});

      await handleLeadFollowUp(msg.id, fromEmail, subject, bodyText, lead.id, lead.nom);

      // Try to auto-create quote from email reply (keyword-based, complements Claude closer)
      try {
        const { tryCreateQuoteFromReply } = await import('@/lib/auto-quote');
        await tryCreateQuoteFromReply(lead.id, bodyText);
      } catch { /* auto-quote failed — non-blocking */ }

      // Archive email after handling — keep inbox clean
      try { await gmail.users.messages.modify({ userId: 'me', id: msg.id, requestBody: { removeLabelIds: ['INBOX'] } }); } catch { /* ignore */ }

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

    // === FACTURE: Auto-create expense with receipt + project assignment ===
    if (analysis.type === 'facture' && analysis.montant_ttc && analysis.montant_ttc > 0) {
      // Validate categorie against allowed values (DB CHECK constraint)
      const VALID_CATEGORIES = ['materiaux', 'equipement', 'vehicule', 'essence', 'assurance', 'publicite', 'sous-traitance', 'bureau', 'telecommunication', 'formation', 'repas', 'entretien', 'loyer', 'autre'];
      const safeCategorie = VALID_CATEGORIES.includes(analysis.categorie ?? '') ? analysis.categorie : 'autre';

      // Check duplicate by gmail_msg_id or by fournisseur+montant+date
      const existingByMsg = msg.id ? await query(`SELECT id FROM expenses WHERE gmail_msg_id = $1`, [msg.id]) : [];
      const existingByData = existingByMsg.length > 0 ? existingByMsg : await query(
        `SELECT id FROM expenses WHERE fournisseur = $1 AND montant_ttc = $2 AND date_depense = $3`,
        [analysis.fournisseur ?? 'Inconnu', analysis.montant_ttc, analysis.date_depense ?? new Date().toISOString().slice(0, 10)],
      );

      if (existingByMsg.length === 0 && existingByData.length === 0) {
        try {
          // Upload PDF/image attachment to Vercel Blob as receipt
          let receiptUrl: string | null = null;
          let receiptFilename: string | null = null;

          for (const part of parts) {
            if (
              part.body?.attachmentId &&
              (part.mimeType?.startsWith('image/') || part.mimeType === 'application/pdf')
            ) {
              try {
                const att = await gmail.users.messages.attachments.get({
                  userId: 'me',
                  messageId: msg.id!,
                  id: part.body.attachmentId,
                });
                if (att.data.data) {
                  const b64 = att.data.data.replace(/-/g, '+').replace(/_/g, '/');
                  const buffer = Buffer.from(b64, 'base64');
                  receiptFilename = part.filename ?? `receipt-${Date.now()}.${part.mimeType === 'application/pdf' ? 'pdf' : 'jpg'}`;
                  const contentType = part.mimeType ?? 'application/pdf';

                  // Upload to Vercel Blob
                  const { put } = await import('@vercel/blob');
                  const blob = await put(`receipts/${receiptFilename}`, buffer, {
                    access: 'public',
                    contentType,
                  });
                  receiptUrl = blob.url;
                  break;
                }
              } catch (blobErr) {
                console.error('[Email Scan] Receipt upload failed:', blobErr);
              }
            }
          }

          const expenseRows = await query(
            `INSERT INTO expenses (fournisseur, description, montant_ht, tps, tvq, montant_ttc, categorie, date_depense, methode, source, gmail_msg_id, receipt_url, receipt_filename, pending_project)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'email-scan', $10, $11, $12, TRUE) RETURNING id`,
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
              msg.id ?? null,
              receiptUrl,
              receiptFilename,
            ],
          );
          const expenseId = (expenseRows[0] as { id: number })?.id;
          invoicesCreated++;

          // Get recent active invoices for project assignment buttons
          const activeInvoices = await query(
            `SELECT inv.id, inv.numero, c.nom AS client_nom
             FROM invoices inv JOIN clients c ON c.id = inv.client_id
             WHERE inv.statut NOT IN ('annulee', 'completee')
             ORDER BY inv.created_at DESC LIMIT 5`
          );

          // Build inline keyboard for Telegram — assign to project
          const keyboard: Array<Array<{ text: string; callback_data: string }>> = [];
          for (const inv of activeInvoices) {
            keyboard.push([{
              text: `${inv.numero} — ${(inv.client_nom as string).slice(0, 25)}`,
              callback_data: `assign_expense_${expenseId}_inv_${inv.id}`,
            }]);
          }
          keyboard.push([{ text: 'Aucun projet (general)', callback_data: `assign_expense_${expenseId}_none` }]);

          // Notify admin with project assignment buttons
          for (const chatId of ADMIN_CHAT_IDS()) {
            const token = BOT_TOKEN();
            if (!token) continue;
            await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: chatId,
                text: [
                  `📧 <b>Facture detectee</b>`,
                  ``,
                  `🏪 ${analysis.fournisseur ?? 'Inconnu'}`,
                  `💰 ${analysis.montant_ttc?.toFixed(2)}$ TTC`,
                  `📂 ${analysis.categorie ?? 'autre'}`,
                  `📝 ${analysis.description ?? subject}`,
                  receiptFilename ? `📎 ${receiptFilename}` : '',
                  ``,
                  `👇 <b>C'est pour quel projet?</b>`,
                ].filter(Boolean).join('\n'),
                parse_mode: 'HTML',
                reply_markup: { inline_keyboard: keyboard },
              }),
            }).catch(() => {});
          }
        } catch (insertErr) {
          console.error(`[Email Scan] Expense insert failed for ${fromEmail}:`, insertErr);
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

        // Archive email after replying — keep inbox clean
        try { await gmail.users.messages.modify({ userId: 'me', id: msg.id, requestBody: { removeLabelIds: ['INBOX'] } }); } catch { /* ignore */ }
        alertsSent++;
      }
    }

    // === SPAM: Move to trash automatically ===
    if (analysis.type === 'spam') {
      try {
        await gmail.users.messages.trash({ userId: 'me', id: msg.id });
      } catch { /* ignore */ }
      continue;
    }

    // === RDV: Someone wants to meet/call/visit — URGENT alert to Luca ===
    if (analysis.type === 'rdv') {
      for (const chatId of ADMIN_CHAT_IDS()) {
        await sendTelegram(chatId, [
          `📅📅📅 <b>DEMANDE DE RDV / APPEL</b>`,
          ``,
          `👤 De: ${fromHeader}`,
          `📝 ${subject}`,
          ``,
          `📋 ${analysis.summary}`,
          ``,
          `💬 "${bodyText.slice(0, 300)}"`,
          ``,
          analysis.reply_suggestion ? `💡 Suggestion: ${analysis.reply_suggestion}` : '',
          ``,
          `⚡ <b>Reponds ou appelle MAINTENANT!</b>`,
        ].filter(Boolean).join('\n'));
      }
      alertsSent++;
    }

    // === PAIEMENT: Bill/payment due — alert with deadline ===
    if (analysis.type === 'paiement') {
      const deadline = analysis.date_limite ? `\n📅 <b>Date limite: ${analysis.date_limite}</b>` : '';
      const montant = analysis.montant_ttc ? `\n💰 Montant: ${analysis.montant_ttc.toFixed(2)}$` : '';
      for (const chatId of ADMIN_CHAT_IDS()) {
        await sendTelegram(chatId, [
          `💳 <b>FACTURE À PAYER</b>`,
          ``,
          `🏪 ${analysis.fournisseur ?? fromHeader}`,
          `📝 ${subject}`,
          montant,
          deadline,
          ``,
          `📋 ${analysis.summary}`,
          ``,
          `⚠️ <i>Pense a payer avant la date limite!</i>`,
        ].filter(Boolean).join('\n'));
      }
      alertsSent++;
    }

    // === "AUTRE" TYPE: Not useful — archive it (remove from inbox, keep in All Mail) ===
    if (analysis.type === 'autre' && !analysis.needs_attention) {
      try {
        await gmail.users.messages.modify({ userId: 'me', id: msg.id, requestBody: { removeLabelIds: ['INBOX', 'UNREAD'] } });
      } catch { /* ignore */ }
      continue; // Don't notify — it's junk that's not spam
    }

    // === NOTIFY ADMIN FOR REMAINING IMPORTANT EMAILS ===
    // Spam trashed, autre archived, auto-replies trashed. Only useful stuff gets here.
    {
      const emoji = analysis.needs_attention ? '🔴' : analysis.type === 'important' ? '🟠' : '📬';
      const label = analysis.needs_attention ? 'ACTION REQUISE' : `Email ${analysis.type}`;
      // Skip notification for types that already have their own notifications above
      if (analysis.type !== 'facture' && analysis.type !== 'client' && analysis.type !== 'rdv' && analysis.type !== 'paiement') {
        for (const chatId of ADMIN_CHAT_IDS()) {
          await sendTelegram(chatId,
            `${emoji} <b>${label || 'Nouveau email'}</b>\n\n` +
            `De: ${fromHeader}\n` +
            `Sujet: ${subject}\n\n` +
            `📋 ${analysis.summary}\n\n` +
            (analysis.reply_suggestion ? `💡 Suggestion: ${analysis.reply_suggestion}` : ''),
          );
        }
        alertsSent++;
      }
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

  // Success — reset consecutive failure counter
  await query(
    `INSERT INTO kv_store (key, value) VALUES ('email_scan_fail_count', $1) ON CONFLICT (key) DO UPDATE SET value = $1`,
    ['0'],
  ).catch(() => {});

  const summary = `Email scan: ${messageIds.length} traites, ${invoicesCreated} factures, ${repliesSent} reponses, ${alertsSent} alertes`;
  return NextResponse.json({ processed: messageIds.length, invoicesCreated, repliesSent, alertsSent, summary });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[Email Scan] Fatal error:', msg);

    // Detect invalid_grant explicitly — persist flag + alert once/day, then short-circuit future runs.
    void handleGmailAuthError(err);

    // Track consecutive failures
    const failCountRows = await query(`SELECT value FROM kv_store WHERE key = 'email_scan_fail_count'`).catch(() => []);
    const failCount = parseInt(String(failCountRows?.[0]?.value ?? '0')) + 1;
    await query(
      `INSERT INTO kv_store (key, value) VALUES ('email_scan_fail_count', $1) ON CONFLICT (key) DO UPDATE SET value = $1`,
      [String(failCount)],
    ).catch(() => {});

    // Alert on 1st fail, then every 3 fails (not every 15 min — not every 6h either)
    const shouldAlert = failCount === 1 || failCount % 3 === 0;

    if (shouldAlert) {
      const isGmailError = msg.toLowerCase().includes('auth') || msg.toLowerCase().includes('token') || msg.toLowerCase().includes('oauth') || msg.toLowerCase().includes('401');
      const isTimeout = msg.toLowerCase().includes('timeout') || msg.toLowerCase().includes('time');

      // Auto-repair: try to renew Gmail watch on auth errors
      if (isGmailError) {
        await renewGmailWatchIfNeeded().catch(() => {});
      }

      const urgency = failCount >= 6 ? '🔴 URGENT' : failCount >= 3 ? '🟠' : '🟡';
      await alertAdmins(
        `${urgency} <b>Email Scan — ECHEC #${failCount}</b>\n\n` +
        `<b>Erreur:</b> ${msg.slice(0, 300)}\n\n` +
        (isGmailError ? `⚙️ <i>Auto-repair: renouvellement Gmail watch tenté</i>\n\n` : '') +
        (isTimeout ? `⏱ <i>Cause probable: timeout 60s — trop d'emails en attente</i>\n\n` : '') +
        `Cron relance auto dans 15 min.\n` +
        `Logs: https://vercel.com/gestionnovusepoxy-boops-projects/novus-epoxy/logs`,
      ).catch(() => {});
    }
    return NextResponse.json({ error: msg, fail_count: failCount }, { status: 500 });
  }
}

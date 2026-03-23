import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { SERVICES, type ServiceType, calculateQuote, formatMoney } from '@/lib/pricing';
import { sendSMS, notifyAdminSMS } from '@/lib/sms';
import { timingSafeEqual } from 'crypto';
import { google } from 'googleapis';

function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

const BOT_TOKEN = () => process.env.TELEGRAM_BOT_TOKEN ?? '';
const ADMIN_CHAT_IDS = () => (process.env.TELEGRAM_ADMIN_CHAT_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean);

async function sendTelegram(chatId: string, text: string) {
  const token = BOT_TOKEN();
  if (!token) return;
  // Telegram max message length is 4096
  const chunks = text.match(/[\s\S]{1,4000}/g) ?? [text];
  for (const chunk of chunks) {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: chunk, parse_mode: 'HTML' }),
    });
  }
}

// Tools available to the AI agent
const TOOLS = [
  {
    name: 'creer_devis_sms',
    description: 'Cree un devis dans la base de donnees et envoie un SMS au client avec les details. Utilise cette fonction quand un admin demande d\'envoyer un devis/soumission a un client.',
    input_schema: {
      type: 'object',
      properties: {
        client_nom: { type: 'string', description: 'Nom complet du client' },
        client_tel: { type: 'string', description: 'Numero de telephone du client (10 chiffres)' },
        client_email: { type: 'string', description: 'Email du client (optionnel)', default: '' },
        client_adresse: { type: 'string', description: 'Adresse du client (optionnel)', default: '' },
        type_service: { type: 'string', enum: ['flake', 'metallique', 'commercial'], description: 'Type de service epoxy' },
        superficie: { type: 'number', description: 'Superficie en pieds carres' },
        couleur_flake: { type: 'string', description: 'Couleur du flake Torginol (optionnel)', default: '' },
        notes: { type: 'string', description: 'Notes additionnelles (optionnel)', default: '' },
      },
      required: ['client_nom', 'client_tel', 'type_service', 'superficie'],
    },
  },
  {
    name: 'stats_business',
    description: 'Recupere les statistiques du business: devis du jour, devis en attente, revenus, leads, etc.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'liste_devis',
    description: 'Liste les devis recents avec leur statut. Peut filtrer par statut.',
    input_schema: {
      type: 'object',
      properties: {
        statut: { type: 'string', description: 'Filtrer par statut (brouillon, en_attente, approuve, envoye, contrat_signe, depot_paye, planifie, complete, refuse)', default: '' },
        limit: { type: 'number', description: 'Nombre de devis a retourner', default: 5 },
      },
      required: [],
    },
  },
  {
    name: 'detail_devis',
    description: 'Recupere le detail complet d\'un devis par son ID.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'ID du devis' },
      },
      required: ['id'],
    },
  },
  {
    name: 'envoyer_sms',
    description: 'Envoie un SMS libre a un numero de telephone.',
    input_schema: {
      type: 'object',
      properties: {
        telephone: { type: 'string', description: 'Numero de telephone du destinataire' },
        message: { type: 'string', description: 'Contenu du SMS' },
      },
      required: ['telephone', 'message'],
    },
  },
  {
    name: 'approuver_devis',
    description: 'Change le statut d\'un devis a approuve.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'ID du devis a approuver' },
      },
      required: ['id'],
    },
  },
  {
    name: 'liste_reservations',
    description: 'Liste les reservations/bookings a venir.',
    input_schema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Nombre de reservations', default: 5 },
      },
      required: [],
    },
  },
  {
    name: 'calculer_prix',
    description: 'Calcule le prix d\'un devis sans le creer. Utile pour donner un estimé rapide.',
    input_schema: {
      type: 'object',
      properties: {
        type_service: { type: 'string', enum: ['flake', 'metallique', 'commercial'] },
        superficie: { type: 'number', description: 'Superficie en pieds carres' },
      },
      required: ['type_service', 'superficie'],
    },
  },
  {
    name: 'resume_emails',
    description: 'Lit les derniers emails recus sur gestionnovusepoxy@gmail.com et retourne un resume. Utile quand on demande "les emails", "resume emails", "nouveaux messages".',
    input_schema: {
      type: 'object',
      properties: {
        nombre: { type: 'number', description: 'Nombre d\'emails a lire (max 10)', default: 5 },
        non_lus_seulement: { type: 'boolean', description: 'Seulement les emails non lus', default: false },
      },
      required: [],
    },
  },
];

// Execute tool calls
async function executeTool(name: string, input: Record<string, unknown>): Promise<string> {
  switch (name) {
    case 'creer_devis_sms': {
      const serviceKey = input.type_service as ServiceType;
      const superficie = Number(input.superficie);
      const calc = calculateQuote(serviceKey, superficie);
      const service = SERVICES[serviceKey];
      const clientNom = input.client_nom as string;
      const clientTel = input.client_tel as string;
      const couleur = (input.couleur_flake as string) || '';
      const adresse = (input.client_adresse as string) || '';

      const rows = await query(
        `INSERT INTO quotes (
          client_nom, client_email, client_tel, client_adresse,
          type_service, superficie, couleur_flake, notes,
          prix_pied_carre, sous_total, tps, tvq, total, depot_requis,
          statut, approved_at, sent_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'envoye',NOW(),NOW())
        RETURNING id`,
        [
          clientNom, (input.client_email as string) || '', clientTel, adresse,
          serviceKey, superficie, couleur || null, (input.notes as string) || null,
          calc.prix_pied_carre, calc.sous_total, calc.tps, calc.tvq, calc.total, calc.depot_requis,
        ]
      );

      const quoteId = rows[0].id as number;
      const solde70 = formatMoney(calc.total - calc.depot_requis);

      const smsMsg = [
        `Bonjour ${clientNom}!`,
        `Voici votre soumission Novus Epoxy #${quoteId} :`,
        ``,
        `${service.label}${couleur ? ` - ${couleur}` : ''}`,
        `${superficie} pi² x ${formatMoney(calc.prix_pied_carre)}/pi²`,
        `Sous-total: ${formatMoney(calc.sous_total)}`,
        `TPS: ${formatMoney(calc.tps)}`,
        `TVQ: ${formatMoney(calc.tvq)}`,
        `Total: ${formatMoney(calc.total)}`,
        ``,
        `Depot (30%): ${formatMoney(calc.depot_requis)}`,
        `Solde: ${solde70}`,
        ``,
        ...(adresse ? [`Adresse: ${adresse}`, ``] : []),
        `Pour planifier vos travaux:`,
        `https://novus-epoxy.vercel.app/reservation/${quoteId}`,
        ``,
        `Questions? 581-307-2678`,
      ].join('\n');

      const smsSent = await sendSMS(clientTel, smsMsg);
      await notifyAdminSMS(quoteId, clientNom);

      return JSON.stringify({
        devis_id: quoteId,
        client: clientNom,
        telephone: clientTel,
        service: service.label,
        couleur: couleur || 'aucune',
        superficie: `${superficie} pi²`,
        sous_total: formatMoney(calc.sous_total),
        tps: formatMoney(calc.tps),
        tvq: formatMoney(calc.tvq),
        total: formatMoney(calc.total),
        depot: formatMoney(calc.depot_requis),
        sms_envoye: smsSent,
        lien_dashboard: `https://novus-epoxy.vercel.app/dashboard/devis/${quoteId}`,
      });
    }

    case 'stats_business': {
      const stats = await query(`
        SELECT
          (SELECT COUNT(*) FROM quotes WHERE created_at::date = CURRENT_DATE) as devis_today,
          (SELECT COUNT(*) FROM quotes) as devis_total,
          (SELECT COUNT(*) FROM quotes WHERE statut = 'brouillon') as brouillons,
          (SELECT COUNT(*) FROM quotes WHERE statut = 'en_attente') as en_attente,
          (SELECT COUNT(*) FROM quotes WHERE statut = 'approuve') as approuves,
          (SELECT COUNT(*) FROM quotes WHERE statut = 'envoye') as envoyes,
          (SELECT COUNT(*) FROM quotes WHERE statut = 'depot_paye') as depot_payes,
          (SELECT COUNT(*) FROM quotes WHERE statut = 'complete') as completes,
          (SELECT COUNT(*) FROM submissions WHERE created_at::date = CURRENT_DATE) as leads_today,
          (SELECT COUNT(*) FROM submissions) as leads_total,
          (SELECT COALESCE(SUM(total), 0) FROM quotes WHERE statut IN ('contrat_signe','depot_paye','planifie','complete')) as revenus_confirmes,
          (SELECT COALESCE(SUM(total), 0) FROM quotes WHERE statut = 'envoye') as revenus_en_attente,
          (SELECT COUNT(*) FROM bookings WHERE jour1_date >= CURRENT_DATE) as reservations_a_venir
      `);
      return JSON.stringify(stats[0]);
    }

    case 'liste_devis': {
      const statut = input.statut as string;
      const limit = Math.min(Number(input.limit) || 5, 20);
      const validStatuts = ['brouillon','en_attente','approuve','envoye','contrat_signe','depot_paye','planifie','complete','refuse'];
      const safeStatut = statut && validStatuts.includes(statut) ? statut : '';
      const rows = safeStatut
        ? await query(
            `SELECT id, client_nom, client_tel, type_service, superficie, total, statut, created_at
             FROM quotes WHERE statut = $1 ORDER BY id DESC LIMIT $2`,
            [safeStatut, limit]
          )
        : await query(
            `SELECT id, client_nom, client_tel, type_service, superficie, total, statut, created_at
             FROM quotes ORDER BY id DESC LIMIT $1`,
            [limit]
          );
      return JSON.stringify(rows);
    }

    case 'detail_devis': {
      const rows = await query('SELECT * FROM quotes WHERE id = $1', [Number(input.id)]);
      if (!rows[0]) return JSON.stringify({ error: 'Devis introuvable' });
      return JSON.stringify(rows[0]);
    }

    case 'envoyer_sms': {
      const sent = await sendSMS(input.telephone as string, input.message as string);
      return JSON.stringify({ envoye: sent, telephone: input.telephone });
    }

    case 'approuver_devis': {
      await query(`UPDATE quotes SET statut = 'approuve', approved_at = NOW() WHERE id = $1`, [Number(input.id)]);
      return JSON.stringify({ devis_id: input.id, statut: 'approuve' });
    }

    case 'liste_reservations': {
      const limit = Math.min(Number(input.limit) || 5, 20);
      const rows = await query(
        `SELECT b.id, b.quote_id, b.jour1_date, b.jour1_slot, b.jour2_date, b.jour2_slot, b.statut,
                q.client_nom, q.client_tel, q.client_adresse, q.type_service, q.superficie
         FROM bookings b JOIN quotes q ON b.quote_id = q.id
         WHERE b.jour1_date >= CURRENT_DATE
         ORDER BY b.jour1_date ASC LIMIT $1`,
        [limit]
      );
      return JSON.stringify(rows);
    }

    case 'calculer_prix': {
      const calc = calculateQuote(input.type_service as ServiceType, Number(input.superficie));
      const service = SERVICES[input.type_service as ServiceType];
      return JSON.stringify({
        service: service.label,
        superficie: `${input.superficie} pi²`,
        prix_pied_carre: formatMoney(calc.prix_pied_carre),
        sous_total: formatMoney(calc.sous_total),
        tps: formatMoney(calc.tps),
        tvq: formatMoney(calc.tvq),
        total: formatMoney(calc.total),
        depot: formatMoney(calc.depot_requis),
      });
    }

    case 'resume_emails': {
      const clientId = process.env.GOOGLE_CLIENT_ID;
      const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
      const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
      if (!clientId || !clientSecret || !refreshToken) {
        return JSON.stringify({ error: 'Gmail API non configure (GOOGLE_CLIENT_ID/SECRET/REFRESH_TOKEN manquant)' });
      }
      const oauth2 = new google.auth.OAuth2(clientId, clientSecret);
      oauth2.setCredentials({ refresh_token: refreshToken });
      const gmail = google.gmail({ version: 'v1', auth: oauth2 });

      const nombre = Math.min(Number(input.nombre) || 5, 10);
      const nonLus = input.non_lus_seulement as boolean;
      const q = nonLus ? 'is:unread' : '';

      const listRes = await gmail.users.messages.list({
        userId: 'me',
        maxResults: nombre,
        q,
      });
      const messageIds = listRes.data.messages ?? [];
      if (messageIds.length === 0) {
        return JSON.stringify({ message: nonLus ? 'Aucun email non lu' : 'Aucun email recent' });
      }

      const emails = [];
      for (const msg of messageIds.slice(0, nombre)) {
        const detail = await gmail.users.messages.get({ userId: 'me', id: msg.id!, format: 'metadata', metadataHeaders: ['From', 'Subject', 'Date'] });
        const headers = detail.data.payload?.headers ?? [];
        const from = headers.find(h => h.name === 'From')?.value ?? 'inconnu';
        const subject = headers.find(h => h.name === 'Subject')?.value ?? '(sans objet)';
        const date = headers.find(h => h.name === 'Date')?.value ?? '';
        const snippet = detail.data.snippet ?? '';
        const isUnread = detail.data.labelIds?.includes('UNREAD') ?? false;
        emails.push({ from, subject, date, snippet: snippet.slice(0, 200), non_lu: isUnread });
      }
      return JSON.stringify(emails);
    }

    default:
      return JSON.stringify({ error: `Outil inconnu: ${name}` });
  }
}

const ADMIN_SYSTEM_PROMPT = `Tu es l'assistant admin de Novus Epoxy, une entreprise de planchers epoxy haut de gamme au Quebec.

Tu parles a Luca ou Jason, les proprietaires. Reponds en francais, de facon concise et directe. Tu es leur bras droit virtuel.

TU PEUX:
- Creer des devis et les envoyer par SMS aux clients
- Consulter les stats du business (devis, revenus, leads)
- Lister et voir les details des devis
- Envoyer des SMS libres a des clients
- Approuver des devis
- Voir les reservations a venir
- Calculer des prix rapidement
- Lire et resumer les emails recus (Gmail)
- Ajouter des photos au portfolio (envoie une photo avec caption "portfolio")
- Scanner des recus/factures (envoie une photo du recu)

PRIX:
- Flake (Flocon): 8.50$/pi2
- Metallique: 12.75$/pi2
- Commercial: 15.00$/pi2
- Taxes: TPS 5% + TVQ 9.975%
- Depot: 30% du total

SERVICES OFFERTS:
- Planchers epoxy metallique (residentiel et commercial)
- Planchers epoxy flake/flocon (garages, sous-sols, commerces)
- Planchers epoxy commercial (cuisines, entrepots)
- Planchers epoxy couleur unie
- Revetement balcons et escaliers exterieurs (flake antiderapant)
- Reparation beton / Auto-nivelant

INFOS BUSINESS:
- RBQ: 5861-8471-01
- Membre APCHQ
- Garantie 10 ans
- 15 ans d'experience
- Zone: Grand Quebec, Levis, Rive-Sud, Rive-Nord
- Tel: 581-307-2678 (Jason), 581-307-5983 (Luca)

IMPORTANT:
- Quand on te demande d'envoyer un devis, utilise l'outil creer_devis_sms
- Quand on te demande les stats, utilise stats_business
- Quand on te demande les emails/courriels/messages recus, utilise resume_emails
- Sois bref dans tes reponses — c'est un chat Telegram
- Formate les numeros de telephone a 10 chiffres (ex: 4186092084)
- Si des infos manquent pour un devis, demande-les
- N'utilise PAS de HTML dans tes reponses, Telegram gere mal certaines balises complexes
- Sois proactif: si un email semble urgent, dis-le. Si un devis est en attente depuis longtemps, mentionne-le.`;

// POST — Telegram webhook for admin bot
export async function POST(req: NextRequest) {
  // Verify Telegram webhook secret token — mandatory
  const telegramSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!telegramSecret) {
    return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 500 });
  }
  const headerSecret = req.headers.get('x-telegram-bot-api-secret-token') ?? '';
  if (!safeCompare(telegramSecret, headerSecret)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ ok: true });

  const message = body.message;
  if (!message) return NextResponse.json({ ok: true });

  const chatId = String(message.chat.id);
  const adminIds = ADMIN_CHAT_IDS();

  // Check if sender is an admin
  if (adminIds.length > 0 && !adminIds.includes(chatId)) {
    await sendTelegram(chatId, "Acces refuse. Ce bot est reserve aux admins Novus Epoxy.");
    return NextResponse.json({ ok: true });
  }

  // Handle photo messages — portfolio or receipt scanning
  if (message.photo && message.photo.length > 0) {
    // Get the largest photo (last in array)
    const photo = message.photo[message.photo.length - 1];
    const fileId = photo.file_id;

    // Get file path from Telegram
    const fileRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN()}/getFile?file_id=${fileId}`);
    const fileData = await fileRes.json();
    const filePath = fileData.result?.file_path;

    if (!filePath) {
      await sendTelegram(chatId, 'Erreur: impossible de telecharger la photo.');
      return NextResponse.json({ ok: true });
    }

    // Download the file
    const downloadRes = await fetch(`https://api.telegram.org/file/bot${BOT_TOKEN()}/${filePath}`);
    const imageBuffer = Buffer.from(await downloadRes.arrayBuffer());

    const caption = (message.caption ?? '').trim();
    const captionLower = caption.toLowerCase();

    // --- PORTFOLIO MODE: caption starts with "portfolio" ---
    const portfolioKeywords = ['portfolio', 'galerie', 'projet', 'realisation', 'réalisation'];
    const isPortfolio = portfolioKeywords.some(k => captionLower.startsWith(k));

    if (isPortfolio) {
      try {
        const { put } = await import('@vercel/blob');
        const slug = `portfolio-${Date.now()}.jpg`;
        const blob = await put(slug, imageBuffer, { access: 'public', contentType: 'image/jpeg' });

        // Parse caption for metadata: "portfolio [type] [titre] [ville] [superficie]"
        const apiKey = process.env.ANTHROPIC_API_KEY;
        let titre = caption.replace(/^(portfolio|galerie|projet|realisation|réalisation)\s*/i, '').trim() || 'Nouveau projet';
        let typeService = 'metallique';
        let ville = '';
        let superficie = 0;
        let description = '';

        if (apiKey) {
          const base64 = imageBuffer.toString('base64');
          const mediaType = filePath.endsWith('.png') ? 'image/png' : 'image/jpeg';
          const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
              'x-api-key': apiKey,
              'anthropic-version': '2023-06-01',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: 'claude-sonnet-4-6',
              max_tokens: 512,
              messages: [{
                role: 'user',
                content: [
                  { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
                  { type: 'text', text: `Analyse cette photo de plancher epoxy. Contexte du photographe: "${caption}"

Reponds en JSON strict (pas de markdown):
{
  "titre": "titre descriptif court en francais",
  "description": "description 1-2 phrases",
  "type_service": "flake" ou "metallique" ou "couleur_unie" ou "commercial" ou "quartz",
  "ville": "ville si mentionnee ou null",
  "superficie": nombre en pi2 si mentionne ou 0
}` },
                ],
              }],
            }),
          });
          if (claudeRes.ok) {
            const data = await claudeRes.json();
            const text = data.content?.[0]?.text ?? '';
            const parsed = JSON.parse(text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim());
            titre = parsed.titre || titre;
            description = parsed.description || '';
            typeService = parsed.type_service || typeService;
            ville = parsed.ville || '';
            superficie = parsed.superficie || 0;
          }
        }

        const rows = await query(
          `INSERT INTO portfolio (titre, description, type_service, superficie, ville, photos, featured)
           VALUES ($1, $2, $3, $4, $5, $6, false) RETURNING id`,
          [titre, description, typeService, superficie || null, ville || null, [blob.url]]
        );

        const id = rows[0].id;
        await sendTelegram(chatId, [
          `Portfolio #${id} ajoute!`,
          ``,
          `${titre}`,
          description ? description : '',
          `Type: ${typeService}`,
          ville ? `Ville: ${ville}` : '',
          superficie ? `Surface: ${superficie} pi²` : '',
          ``,
          `Photo: ${blob.url}`,
        ].filter(Boolean).join('\n'));

      } catch (err) {
        console.error('Portfolio save error:', err);
        await sendTelegram(chatId, `Erreur portfolio: ${err instanceof Error ? err.message : 'erreur inconnue'}`);
      }
      return NextResponse.json({ ok: true });
    }

    // --- RECEIPT MODE (default) ---
    const base64 = imageBuffer.toString('base64');
    const mediaType = filePath.endsWith('.png') ? 'image/png' : 'image/jpeg';

    await sendTelegram(chatId, 'Analyse du recu en cours...');

    // Determine payment method from caption
    let methode = 'carte';
    if (captionLower === 'comptant' || captionLower === 'cash') methode = 'comptant';
    else if (captionLower === 'cheque' || captionLower === 'chèque') methode = 'cheque';
    else if (captionLower === 'virement' || captionLower === 'transfert') methode = 'virement';
    else if (captionLower === 'debit' || captionLower === 'débit' || captionLower === 'interac') methode = 'debit';

    // Send to Claude for OCR
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      await sendTelegram(chatId, 'ANTHROPIC_API_KEY non configure.');
      return NextResponse.json({ ok: true });
    }

    try {
      const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 1024,
          messages: [{
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
              { type: 'text', text: `Analyse cette photo de facture/recu et extrais les informations en JSON strict (pas de markdown):
{
  "fournisseur": "nom du commerce",
  "date_depense": "YYYY-MM-DD",
  "description": "description courte",
  "montant_ht": nombre,
  "tps": nombre,
  "tvq": nombre,
  "montant_ttc": nombre,
  "categorie": "une parmi: materiaux, sous_traitance, transport, equipement, marketing, loyer, assurance, admin, autre",
  "reference": "numero de facture ou null"
}
Si le HT n'est pas visible, calcule-le du TTC. Si taxes non detaillees, mets tps/tvq a 0 et HT=TTC.
Pour la categorie, devine selon le fournisseur (quincaillerie=materiaux, essence=transport, etc).
JSON uniquement.` },
            ],
          }],
        }),
      });

      if (!claudeRes.ok) throw new Error('Erreur Claude API');

      const claudeData = await claudeRes.json();
      const ocrText = claudeData.content?.[0]?.text ?? '';
      const jsonStr = ocrText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const parsed = JSON.parse(jsonStr);

      // Check for duplicates
      const existingExpenses = await query(
        `SELECT fournisseur, date_depense, montant_ttc, reference FROM expenses`
      );

      const isDuplicate = existingExpenses.some((exp: Record<string, unknown>) => {
        if (parsed.reference && exp.reference && parsed.reference === String(exp.reference)) return true;
        const sameSupplier = String(exp.fournisseur ?? '').toLowerCase().trim() === (parsed.fournisseur ?? '').toLowerCase().trim();
        const sameDate = String(exp.date_depense ?? '').slice(0, 10) === parsed.date_depense;
        const sameAmount = Math.abs(Number(exp.montant_ttc ?? 0) - Number(parsed.montant_ttc ?? 0)) < 0.02;
        return sameSupplier && sameDate && sameAmount;
      });

      if (isDuplicate) {
        await sendTelegram(chatId, `Doublon detecte!\n${parsed.fournisseur} — ${parsed.date_depense}\nTotal: ${Number(parsed.montant_ttc).toFixed(2)}$\n\nCette depense existe deja. Non enregistree.`);
        return NextResponse.json({ ok: true });
      }

      // Validate category
      const validCategories = ['materiaux', 'sous_traitance', 'transport', 'equipement', 'marketing', 'loyer', 'assurance', 'admin', 'autre'];
      const categorie = validCategories.includes(parsed.categorie) ? parsed.categorie : 'autre';

      // Save to database
      const ht = Number(parsed.montant_ht ?? 0);
      const tps = Number(parsed.tps ?? 0);
      const tvq = Number(parsed.tvq ?? 0);
      const ttc = Number(parsed.montant_ttc ?? 0) || Math.round((ht + tps + tvq) * 100) / 100;

      const rows = await query(
        `INSERT INTO expenses (date_depense, fournisseur, description, categorie, montant_ht, tps, tvq, montant_ttc, methode, reference)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
        [
          parsed.date_depense || new Date().toISOString().slice(0, 10),
          (parsed.fournisseur || 'Inconnu').slice(0, 120),
          parsed.description || null,
          categorie,
          ht, tps, tvq, ttc,
          methode,
          parsed.reference || null,
        ]
      );

      const CAT_LABEL: Record<string, string> = {
        materiaux: 'Materiaux', sous_traitance: 'Sous-traitance', transport: 'Transport',
        equipement: 'Equipement', marketing: 'Marketing', loyer: 'Loyer',
        assurance: 'Assurance', admin: 'Administration', autre: 'Autre',
      };

      const expId = rows[0].id;
      await sendTelegram(chatId, [
        `Depense #${expId} enregistree!`,
        ``,
        `${parsed.fournisseur}`,
        `Date: ${parsed.date_depense}`,
        `${parsed.description || ''}`,
        ``,
        `HT: ${ht.toFixed(2)}$`,
        tps > 0 ? `TPS: ${tps.toFixed(2)}$` : '',
        tvq > 0 ? `TVQ: ${tvq.toFixed(2)}$` : '',
        `Total: ${ttc.toFixed(2)}$`,
        ``,
        `Categorie: ${CAT_LABEL[categorie] || categorie}`,
        `Methode: ${methode}`,
        parsed.reference ? `Ref: ${parsed.reference}` : '',
      ].filter(Boolean).join('\n'));

    } catch (err) {
      console.error('Telegram receipt scan error:', err);
      await sendTelegram(chatId, `Erreur lors de l'analyse du recu: ${err instanceof Error ? err.message : 'erreur inconnue'}`);
    }

    return NextResponse.json({ ok: true });
  }

  // Non-text, non-photo messages — ignore
  if (!message.text) return NextResponse.json({ ok: true });
  const text = (message.text as string).trim();

  // /start command — quick help
  if (text === '/start') {
    await sendTelegram(chatId, [
      'Bot Admin Novus Epoxy',
      '',
      'Parle-moi comme tu parlerais a un assistant. Exemples:',
      '',
      '• "Envoie un devis a Kevan Legare 4186092084 750pi flake night fall 252 berrouard quebec"',
      '• "C\'est quoi les stats?"',
      '• "Liste les devis envoyes"',
      '• "Calcule le prix pour 500pi metallique"',
      '• "Envoie un texto a 4181234567 pour dire qu\'on arrive demain"',
      '',
      'Ton chat ID: ' + chatId,
    ].join('\n'));
    return NextResponse.json({ ok: true });
  }

  // AI-powered response
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    // Fallback to command parsing if no AI
    return handleFallbackCommand(chatId, text);
  }

  try {
    // Call Claude with tools
    type ContentBlock = { type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> };
    type ClaudeMessage = { role: 'user' | 'assistant'; content: string | ContentBlock[] };
    const messages: ClaudeMessage[] = [{ role: 'user', content: text }];

    let finalResponse = '';
    let iterations = 0;

    while (iterations < 5) {
      iterations++;

      const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 1024,
          system: ADMIN_SYSTEM_PROMPT,
          tools: TOOLS,
          messages,
        }),
      });

      if (!claudeRes.ok) {
        const err = await claudeRes.text();
        console.error('Claude API error:', err);
        await sendTelegram(chatId, 'Erreur API Claude. Reessaie.');
        return NextResponse.json({ ok: true });
      }

      const data = await claudeRes.json();
      const content = data.content as ContentBlock[];

      // Check for tool use
      const toolUses = content.filter((b: ContentBlock) => b.type === 'tool_use');
      const textBlocks = content.filter((b: ContentBlock) => b.type === 'text');

      if (toolUses.length === 0) {
        // No tool calls — return text response
        finalResponse = textBlocks.map((b: ContentBlock) => b.text ?? '').join('\n');
        break;
      }

      // Execute tools and continue conversation
      messages.push({ role: 'assistant', content });

      const toolResults: ContentBlock[] = [];
      for (const tool of toolUses) {
        const result = await executeTool(tool.name!, tool.input!);
        toolResults.push({
          type: 'tool_result',
          id: tool.id!,
          text: result,
        } as unknown as ContentBlock);
      }

      messages.push({ role: 'user', content: toolResults });

      // If stop_reason is 'end_turn' after tool results, we need another iteration
      if (data.stop_reason === 'end_turn' && toolUses.length > 0) {
        continue;
      }
    }

    if (finalResponse) {
      await sendTelegram(chatId, finalResponse);
    }
  } catch (err) {
    console.error('Telegram admin bot error:', err);
    await sendTelegram(chatId, `Erreur: ${err instanceof Error ? err.message : String(err)}`);
  }

  return NextResponse.json({ ok: true });
}

// Fallback for when ANTHROPIC_API_KEY is not set
async function handleFallbackCommand(chatId: string, text: string) {
  if (text.startsWith('/devis') && text !== '/devis_list') {
    const args = text.replace(/^\/devis\s*/, '');
    if (!args) {
      await sendTelegram(chatId, 'Usage: /devis [nom] [tel] [superficie]pi [service] [couleur] [adresse]\n\nExemple:\n/devis Kevan Legare 4186092084 750pi flake Night Fall 252 Berrouard Quebec');
      return NextResponse.json({ ok: true });
    }

    const parsed = parseDevisCommand(args);
    if (!parsed.client_nom || !parsed.client_tel || !parsed.superficie) {
      await sendTelegram(chatId, `Infos manquantes. Nom: ${parsed.client_nom || '?'}, Tel: ${parsed.client_tel || '?'}, Superficie: ${parsed.superficie || '?'}`);
      return NextResponse.json({ ok: true });
    }

    const result = await executeTool('creer_devis_sms', {
      client_nom: parsed.client_nom,
      client_tel: parsed.client_tel,
      type_service: parsed.type_service,
      superficie: parsed.superficie,
      couleur_flake: parsed.couleur,
      client_adresse: parsed.adresse ?? '',
    });
    const data = JSON.parse(result);
    await sendTelegram(chatId, `Devis #${data.devis_id} cree!\nTotal: ${data.total}\nDepot: ${data.depot}\nSMS: ${data.sms_envoye ? 'Envoye' : 'Echec'}\n${data.lien_dashboard}`);
    return NextResponse.json({ ok: true });
  }

  if (text === '/stats') {
    const result = await executeTool('stats_business', {});
    const s = JSON.parse(result);
    await sendTelegram(chatId, `Stats:\nDevis aujourd'hui: ${s.devis_today}\nEnvoyes: ${s.envoyes}\nPayes: ${s.depot_payes}\nRevenus: ${formatMoney(Number(s.revenus_confirmes))}`);
    return NextResponse.json({ ok: true });
  }

  if (text === '/devis_list') {
    const result = await executeTool('liste_devis', { limit: 5 });
    const rows = JSON.parse(result);
    const lines = rows.map((q: Record<string, unknown>) => `#${q.id} ${q.client_nom} — ${formatMoney(Number(q.total))} [${q.statut}]`);
    await sendTelegram(chatId, `Derniers devis:\n${lines.join('\n')}`);
    return NextResponse.json({ ok: true });
  }

  await sendTelegram(chatId, 'ANTHROPIC_API_KEY non configure. Utilise /devis, /stats, ou /devis_list.');
  return NextResponse.json({ ok: true });
}

function parseDevisCommand(text: string) {
  const phoneMatch = text.match(/(\d{10})/);
  const client_tel = phoneMatch ? phoneMatch[1] : '';
  const supMatch = text.match(/(\d+)\s*(?:pi²?|pieds?|sqft|sf)/i);
  const superficie = supMatch ? parseInt(supMatch[1]) : 0;

  let type_service = 'flake';
  if (/m[ée]tallique/i.test(text)) type_service = 'metallique';
  else if (/commercial/i.test(text)) type_service = 'commercial';

  let remaining = text
    .replace(phoneMatch?.[0] ?? '', '')
    .replace(supMatch?.[0] ?? '', '')
    .replace(/\b(flake|flocon|m[ée]tallique|commercial)\b/gi, '')
    .trim();

  const colorPatterns = [
    'Night Fall', 'Midnight', 'Yukon', 'Outback', 'Domino', 'Tobacco Road',
    'Orbit', 'Autumn', 'Shoreline', 'Driftwood', 'Gravel', 'Mica',
    'Copper Glaze', 'Canyon', 'Deep Sea', 'Graphite', 'Onyx',
  ];

  let couleur = '';
  for (const color of colorPatterns) {
    if (new RegExp(color, 'i').test(remaining)) {
      couleur = color;
      remaining = remaining.replace(new RegExp(color, 'i'), '').trim();
      break;
    }
  }

  const parts = remaining.split(/\s+/);
  const nameWords: string[] = [];
  const adresseWords: string[] = [];
  let foundNumber = false;

  for (const part of parts) {
    if (!foundNumber && /^\d+$/.test(part) && nameWords.length >= 1) {
      foundNumber = true;
      adresseWords.push(part);
    } else if (foundNumber) {
      adresseWords.push(part);
    } else {
      nameWords.push(part);
    }
  }

  return {
    client_nom: nameWords.join(' ').replace(/\s+/g, ' ').trim(),
    client_tel,
    type_service,
    superficie,
    couleur,
    adresse: adresseWords.join(' ').replace(/\s+/g, ' ').trim() || null,
  };
}

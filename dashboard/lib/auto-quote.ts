import { query } from '@/lib/db';
import { getAdminChatIds } from '@/lib/telegram-utils';
import { SERVICES, type ServiceType, calculateQuote, formatMoney } from '@/lib/pricing';
import { escapeHtml } from '@/lib/utils';
import { sendSMS } from '@/lib/sms';

// ── Blacklists ──────────────────────────────────────────────────────────
const BLACKLISTED_EMAILS = [
  'gestionnovusepoxy@gmail.com',
  'lanthierj6@gmail.com',
  'luca.hayes1994@gmail.com',
];
const BLACKLISTED_PHONES = ['5813075983', '5813072678'];

// ── Types ───────────────────────────────────────────────────────────────
export interface ParsedProject {
  type_espace: string | null;
  type_service: string | null; // must match pricing.ts keys
  superficie: number | null;
  adresse: string | null;
  etat_plancher: string | null;
  couleur: string | null;
  email: string | null;
  confidence: number; // 0-100
}

// ── Keyword maps ────────────────────────────────────────────────────────
const ESPACE_KEYWORDS: Record<string, string> = {
  garage: 'Garage',
  'sous-sol': 'Sous-sol',
  'sous sol': 'Sous-sol',
  basement: 'Sous-sol',
  balcon: 'Balcon',
  commercial: 'Commercial',
  industriel: 'Industriel',
  entrepot: 'Entrepôt',
  entrepôt: 'Entrepôt',
};

const SERVICE_KEYWORDS: Record<string, ServiceType> = {
  flocon: 'flake',
  flake: 'flake',
  metallique: 'metallique',
  métallique: 'metallique',
  metallic: 'metallique',
  quartz: 'quartz',
  'couleur unie': 'couleur_unie',
  uni: 'couleur_unie',
  antiderapant: 'antiderapant',
  antidérapant: 'antiderapant',
  commercial: 'commercial',
  meulage: 'meulage',
};

const ETAT_KEYWORDS: Record<string, string> = {
  'beton brut': 'Béton brut',
  'béton brut': 'Béton brut',
  peinture: 'Peinture existante',
  'epoxy a refaire': 'Époxy à refaire',
  'époxy à refaire': 'Époxy à refaire',
  'epoxy à refaire': 'Époxy à refaire',
  bois: 'Bois',
};

const COULEUR_KEYWORDS = [
  'gris', 'noir', 'beige', 'blanc', 'bleu', 'brun', 'charcoal', 'graphite',
];

const CITY_NAMES = [
  'quebec', 'québec', 'levis', 'lévis', 'beauport', 'charlesbourg',
  'sainte-foy', 'cap-rouge', 'loretteville', 'val-belair',
  'saint-augustin', 'ancienne-lorette', 'shannon', 'stoneham',
  'lac-beauport', 'boischatel', 'ile-d\'orleans', 'saint-nicolas',
  'saint-romuald', 'saint-jean-chrysostome', 'bernières',
  'pintendre', 'breakeyville', 'charny', 'lauzon',
  'montmagny', 'thetford', 'drummondville', 'trois-rivieres',
  'sherbrooke', 'gatineau', 'montreal', 'montréal', 'laval',
  'longueuil', 'repentigny', 'terrebonne', 'blainville',
];

// ── Parse free-text for project info ────────────────────────────────────
export function parseProjectInfo(text: string): ParsedProject | null {
  const lower = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const lowerRaw = text.toLowerCase();

  // Type d'espace
  let type_espace: string | null = null;
  for (const [kw, label] of Object.entries(ESPACE_KEYWORDS)) {
    if (lowerRaw.includes(kw)) {
      type_espace = label;
      break;
    }
  }

  // Type de service
  let type_service: string | null = null;
  // Check multi-word first
  for (const [kw, svc] of Object.entries(SERVICE_KEYWORDS)) {
    if (kw.includes(' ')) {
      if (lowerRaw.includes(kw)) {
        type_service = svc;
        break;
      }
    }
  }
  if (!type_service) {
    for (const [kw, svc] of Object.entries(SERVICE_KEYWORDS)) {
      if (!kw.includes(' ') && lowerRaw.includes(kw)) {
        type_service = svc;
        break;
      }
    }
  }

  // Default service based on espace type if no explicit service mentioned
  if (!type_service) {
    if (type_espace === 'Commercial' || type_espace === 'Industriel' || type_espace === 'Entrepôt') {
      type_service = 'commercial';
    } else if (type_espace === 'Garage' || type_espace === 'Sous-sol' || type_espace === 'Balcon') {
      type_service = 'flake'; // Most common residential service
    }
  }

  // Superficie (pieds carrés)
  let superficie: number | null = null;
  const sqftPatterns = [
    /(\d[\d\s.,]*)\s*(?:pi2|pi²|pieds?\s*carr[eé]s?|sqft|sf|p2|pc|pi\b)/i,
    /(?:pi2|pi²|pieds?\s*carr[eé]s?|sqft|sf|p2|pc)\s*[:\-]?\s*(\d[\d\s.,]*)/i,
  ];
  for (const pat of sqftPatterns) {
    const m = text.match(pat);
    if (m) {
      const raw = (m[1] || m[2] || '').replace(/[\s,]/g, '').replace(/\.+$/, '');
      const n = parseFloat(raw);
      if (!isNaN(n) && n > 0 && n < 100000) {
        superficie = n;
        break;
      }
    }
  }
  // Fallback: standalone large number if we have type_espace or type_service
  if (superficie === null && (type_espace || type_service)) {
    const m = text.match(/\b(\d{2,5})\b/);
    if (m) {
      const n = parseFloat(m[1]);
      if (n >= 50 && n <= 50000) superficie = n;
    }
  }

  // Adresse — look for street patterns or postal codes
  let adresse: string | null = null;
  const streetMatch = text.match(
    /(\d{1,5}\s+(?:rue|av\.?|avenue|boul\.?|boulevard|chemin|ch\.?|rang|route|place|cote|côte)\s+[A-ZÀ-Üa-zà-ü\-'.]+(?:\s+[A-ZÀ-Üa-zà-ü\-'.]+){0,3})/i
  );
  if (streetMatch) {
    adresse = streetMatch[1].trim();
    // Try to append city if found nearby
    for (const city of CITY_NAMES) {
      const cityRegex = new RegExp(`\\b${city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      if (cityRegex.test(text)) {
        if (!adresse.toLowerCase().includes(city)) {
          adresse += ', ' + city.charAt(0).toUpperCase() + city.slice(1);
        }
        break;
      }
    }
  }
  // Try postal code
  const postalMatch = text.match(/[ABCEGHJKLMNPRSTVXY]\d[A-Z]\s?\d[A-Z]\d/i);
  if (postalMatch) {
    adresse = adresse ? `${adresse} ${postalMatch[0].toUpperCase()}` : postalMatch[0].toUpperCase();
  }

  // État du plancher
  let etat_plancher: string | null = null;
  for (const [kw, label] of Object.entries(ETAT_KEYWORDS)) {
    if (lowerRaw.includes(kw)) {
      etat_plancher = label;
      break;
    }
  }

  // Couleur
  let couleur: string | null = null;
  for (const c of COULEUR_KEYWORDS) {
    if (lowerRaw.includes(c)) {
      couleur = c.charAt(0).toUpperCase() + c.slice(1);
      break;
    }
  }

  // Extract email if present
  let email: string | null = null;
  const emailMatch = text.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/);
  if (emailMatch) email = emailMatch[0].toLowerCase();

  // Confidence scoring
  let confidence = 0;
  if (type_espace) confidence += 15;
  if (type_service) confidence += 25;
  if (superficie) confidence += 25;
  if (adresse) confidence += 15;
  if (etat_plancher) confidence += 10;
  if (couleur) confidence += 10;
  if (email) confidence += 5;

  if (confidence < 30) return null;

  return { type_espace, type_service, superficie, adresse, etat_plancher, couleur, email, confidence };
}

// ── Try to auto-create a quote from a client reply ──────────────────────
export async function tryCreateQuoteFromReply(
  leadId: number,
  text: string,
): Promise<{ quoteId: number; total: number } | null> {
  const parsed = parseProjectInfo(text);
  if (!parsed) return null;

  // Load lead info
  const leadRows = await query(
    `SELECT nom, email, telephone FROM crm_leads WHERE id = $1`,
    [leadId],
  );
  if (leadRows.length === 0) return null;

  const lead = leadRows[0] as { nom: string; email: string; telephone: string };

  // Use email from SMS if lead has none
  if (parsed.email && !lead.email) {
    lead.email = parsed.email;
    await query(`UPDATE crm_leads SET email = $1, updated_at = NOW() WHERE id = $2`, [parsed.email, leadId]).catch(() => {});
  }

  // Check blacklists
  if (lead.email && BLACKLISTED_EMAILS.includes(lead.email.toLowerCase())) return null;
  const cleanPhone = (lead.telephone || '').replace(/\D/g, '').slice(-10);
  if (BLACKLISTED_PHONES.includes(cleanPhone)) return null;

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatIds = getAdminChatIds();

  // ── AUTO-CREATE QUOTE — need at least a service + superficie ──────────
  if (parsed.confidence >= 40 && parsed.type_service && parsed.superficie) {
    // ANTI-DOUBLON: ne PAS créer un 2e devis si ce client en a déjà un actif récent
    // (même email OU tél, < 7 jours, pas refusé). Évite "deux devis pour la même affaire".
    const cleanTel = (lead.telephone || '').replace(/\D/g, '').slice(-10);
    const dupe = await query(
      `SELECT id FROM quotes
       WHERE statut <> 'refuse'
         AND created_at >= NOW() - INTERVAL '7 days'
         AND ( ($1 <> '' AND LOWER(client_email) = $1)
            OR ($2 <> '' AND RIGHT(REGEXP_REPLACE(COALESCE(client_tel,''), '\\D', '', 'g'), 10) = $2) )
       ORDER BY created_at DESC LIMIT 1`,
      [(lead.email || '').toLowerCase().trim(), cleanTel],
    ).catch(() => []);
    if (dupe.length > 0) {
      console.log(`[auto-quote] SKIP — devis récent #${dupe[0].id} existe déjà pour ce client (anti-doublon)`);
      return null;
    }

    // Check active promotions
    let rabaisPct = 0;
    try {
      const promoRows = await query(
        `SELECT rabais_pct, services FROM promotions
         WHERE actif = true AND date_debut <= CURRENT_DATE AND date_fin >= CURRENT_DATE
         ORDER BY rabais_pct DESC LIMIT 1`,
      );
      if (promoRows.length > 0) {
        const promo = promoRows[0];
        const services = promo.services as string[] | null;
        if (!services || services.length === 0 || services.includes(parsed.type_service)) {
          rabaisPct = Number(promo.rabais_pct);
        }
      }
    } catch { /* promo check failed — continue without discount */ }

    const calc = calculateQuote(parsed.type_service as ServiceType, parsed.superficie, rabaisPct);

    // INSERT into quotes
    const quoteRows = await query(
      `INSERT INTO quotes (
        client_nom, client_email, client_tel, client_adresse,
        type_service, superficie, etat_plancher, couleur_flake,
        prix_pied_carre, rabais_pct, rabais_montant,
        sous_total, tps, tvq, total, depot_requis,
        statut, notes
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'brouillon',$17)
      RETURNING id`,
      [
        lead.nom, lead.email || null, lead.telephone || null, parsed.adresse,
        parsed.type_service, parsed.superficie, parsed.etat_plancher, parsed.couleur,
        calc.prix_pied_carre, calc.rabais_pct, calc.rabais_montant,
        calc.sous_total, calc.tps, calc.tvq, calc.total, calc.depot_requis,
        `Auto-devis — Lead CRM #${leadId} — réponse client`,
      ],
    );
    const quoteId = quoteRows[0].id as number;

    // INSERT into submissions for backwards compat
    const serviceLabel = SERVICES[parsed.type_service as ServiceType]?.label ?? parsed.type_service;
    await query(
      `INSERT INTO submissions (nom, email, telephone, service, message, statut)
       VALUES ($1, $2, $3, $4, $5, 'en_traitement')`,
      [
        lead.nom,
        lead.email || null,
        lead.telephone || null,
        serviceLabel,
        `Auto-devis depuis réponse client — ${parsed.superficie} pi² — Lead #${leadId}`,
      ],
    ).catch(() => {});

    // Update lead status
    await query(
      `UPDATE crm_leads SET statut = 'devis_envoye', updated_at = NOW() WHERE id = $1`,
      [leadId],
    ).catch(() => {});

    // Telegram notification with approve/reject buttons
    if (botToken && chatIds.length > 0) {
      const tgLines = [
        `📋 <b>Nouveau devis #${quoteId} (auto-réponse client)</b>`,
        ``,
        `👤 ${escapeHtml(lead.nom)}`,
        lead.email ? `📧 ${escapeHtml(lead.email)}` : '',
        lead.telephone ? `📞 ${escapeHtml(lead.telephone)}` : '',
        parsed.adresse ? `🏠 ${escapeHtml(parsed.adresse)}` : '',
        parsed.type_espace ? `🏗 ${escapeHtml(parsed.type_espace)}` : '',
        `🔧 ${escapeHtml(serviceLabel)} — ${parsed.superficie} pi²`,
        parsed.etat_plancher ? `🧱 ${escapeHtml(parsed.etat_plancher)}` : '',
        parsed.couleur ? `🎨 ${escapeHtml(parsed.couleur)}` : '',
        rabaisPct > 0 ? `🏷 Rabais ${rabaisPct}%` : '',
        ``,
        `💰 Total: ${formatMoney(calc.total)}`,
        `💳 Dépôt: ${formatMoney(calc.depot_requis)}`,
        ``,
        `<i>Confiance: ${parsed.confidence}%</i>`,
      ].filter(Boolean).join('\n');

      const buttons = {
        inline_keyboard: [
          [
            { text: '✅ Approuver et envoyer', callback_data: `approve_quote_${quoteId}` },
            { text: '❌ Rejeter', callback_data: `reject_quote_${quoteId}` },
          ],
          [
            { text: '📋 Voir dashboard', url: 'https://novus-epoxy.vercel.app/dashboard/devis' },
          ],
        ],
      };

      await Promise.all(chatIds.map(chatId =>
        fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, text: tgLines, parse_mode: 'HTML', reply_markup: buttons }),
        }).catch(() => {}),
      ));
    }

    // SMS to admins
    const adminPhone = process.env.ADMIN_PHONE;
    const jasonPhone = process.env.JASON_PHONE;
    const phones = [adminPhone, jasonPhone].filter(Boolean) as string[];
    if (phones.length > 0) {
      const smsMsg = `📋 Nouveau devis #${quoteId} — ${lead.nom} — ${serviceLabel} ${parsed.superficie}pi² — $${calc.total}. Approuvez sur Telegram!`;
      await Promise.all(phones.map(p => sendSMS(p, smsMsg).catch(() => {}))).catch(() => {});
    }

    return { quoteId, total: calc.total };
  }

  // ── PARTIAL CONFIDENCE (30-49): notify admins with parsed info ────────
  if (parsed.confidence >= 30 && parsed.confidence < 50) {
    if (botToken && chatIds.length > 0) {
      const summary: string[] = [];
      if (parsed.type_espace) summary.push(`Espace: ${parsed.type_espace}`);
      if (parsed.type_service) summary.push(`Service: ${SERVICES[parsed.type_service as ServiceType]?.label ?? parsed.type_service}`);
      if (parsed.superficie) summary.push(`Surface: ${parsed.superficie} pi²`);
      if (parsed.adresse) summary.push(`Adresse: ${parsed.adresse}`);
      if (parsed.etat_plancher) summary.push(`État: ${parsed.etat_plancher}`);
      if (parsed.couleur) summary.push(`Couleur: ${parsed.couleur}`);

      const missing: string[] = [];
      if (!parsed.type_service) missing.push('type de service');
      if (!parsed.superficie) missing.push('superficie');
      if (!parsed.adresse) missing.push('adresse');

      const tgMsg = [
        `📝 <b>${escapeHtml(lead.nom)} a répondu avec des infos partielles</b>`,
        ``,
        summary.map(s => `• ${escapeHtml(s)}`).join('\n'),
        ``,
        missing.length > 0 ? `⚠️ <b>Infos manquantes:</b> ${missing.join(', ')}` : '',
        ``,
        `<i>Créez le devis manuellement.</i>`,
        `<i>Confiance: ${parsed.confidence}%</i>`,
        ``,
        `https://novus-epoxy.vercel.app/dashboard/crm`,
      ].filter(Boolean).join('\n');

      await Promise.all(chatIds.map(chatId =>
        fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, text: tgMsg, parse_mode: 'HTML' }),
        }).catch(() => {}),
      ));
    }
    return null;
  }

  return null;
}

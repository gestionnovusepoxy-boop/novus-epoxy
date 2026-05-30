import { getAdminChatIds } from '@/lib/telegram-utils';
import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { SERVICES, type ServiceType, calculateQuote, calculateQuoteCustomPrice, formatMoney, getServiceDescriptionHtml } from '@/lib/pricing';
import { sendSMS, notifyAdminSMS } from '@/lib/sms';
import { timingSafeEqual } from 'crypto';
import { google } from 'googleapis';
import { sendEmail } from '@/lib/send-email';
import { sendProspectEmail } from '@/lib/send-prospect-email';
import { autoHeal } from '@/lib/auto-heal';
import { callLLM } from '@/lib/llm';

export const maxDuration = 60; // Allow up to 60s for CSV imports + AI processing

function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { field += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      fields.push(field.trim());
      field = "";
    } else {
      field += ch;
    }
  }
  fields.push(field.trim());
  return fields;
}

function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

const BOT_TOKEN = () => process.env.TELEGRAM_BOT_TOKEN ?? '';
const ADMIN_CHAT_IDS = () => getAdminChatIds();

async function sendTelegram(chatId: string, text: string, options?: { parse_mode?: string; reply_markup?: unknown }) {
  const token = BOT_TOKEN();
  if (!token) return;
  // Telegram max message length is 4096
  const chunks = text.match(/[\s\S]{1,4000}/g) ?? [text];
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    // Only attach reply_markup to the last chunk
    const isLast = i === chunks.length - 1;
    const payload: Record<string, unknown> = {
      chat_id: chatId,
      text: chunk,
      parse_mode: options?.parse_mode ?? 'HTML',
    };
    if (isLast && options?.reply_markup) payload.reply_markup = options.reply_markup;
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
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
        type_service: { type: 'string', enum: ['flake', 'metallique', 'couleur_unie', 'quartz', 'antiderapant', 'commercial', 'meulage'], description: 'ATTENTION: "couleur unie" ou "uni" = couleur_unie (PAS flake). "flocon" ou "flake" = flake. "metallique" = metallique. Bien distinguer couleur_unie vs flake.' },
        superficie: { type: 'number', description: 'Superficie en pieds carres' },
        couleur_flake: { type: 'string', description: 'Couleur du flocon Torginol — seulement si type_service=flake (optionnel)', default: '' },
        notes: { type: 'string', description: 'Notes additionnelles (optionnel)', default: '' },
      },
      required: ['client_nom', 'client_tel', 'type_service', 'superficie'],
    },
  },
  {
    name: 'creer_devis_prix_fixe',
    description: 'Cree un devis a PRIX FIXE (forfaitaire) et l\'envoie au client. Utilise quand l\'admin donne un montant total directement au lieu d\'un prix au pied carre — typiquement apres avoir vu une photo (balcon, escalier, reparation). Ex: "fais un devis de 2300 pour Laurie", "minimum call pour le balcon de X", "1800 pour Marc avec note ...". Si l\'admin dit "minimum" ou "minimum call", utilise prix=1500.',
    input_schema: {
      type: 'object',
      properties: {
        client_nom: { type: 'string', description: 'Nom (ou prenom) du client. Sert a retrouver le lead si le tel n\'est pas donne.' },
        client_tel: { type: 'string', description: 'Tel du client (10 chiffres). Optionnel — sera retrouve depuis le CRM via le nom si absent.', default: '' },
        prix: { type: 'number', description: 'Montant FORFAITAIRE avant taxes (le sous-total). Si l\'admin dit "minimum"/"minimum call" = 1500.' },
        service_label: { type: 'string', description: 'Libelle du service a afficher (ex: "Balcon antiderapant", "Reparation beton"). Defaut: "Travaux sur mesure".', default: 'Travaux sur mesure' },
        description: { type: 'string', description: 'Description des travaux / notes a inclure dans le devis (optionnel). L\'admin peut l\'ecrire en langage naturel.', default: '' },
      },
      required: ['client_nom', 'prix'],
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
        type_service: { type: 'string', enum: ['flake', 'metallique', 'couleur_unie', 'quartz', 'antiderapant', 'commercial', 'meulage'] },
        superficie: { type: 'number', description: 'Superficie en pieds carres' },
      },
      required: ['type_service', 'superficie'],
    },
  },
  {
    name: 'confirmer_paiement',
    description: 'Confirme manuellement un paiement depot ou solde pour un devis (Interac ou autre).',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'ID du devis' },
        type: { type: 'string', enum: ['depot', 'solde'], description: 'Type de paiement' },
      },
      required: ['id', 'type'],
    },
  },
  {
    name: 'modifier_statut_devis',
    description: 'Change le statut d\'un devis (ex: envoye, planifie, complete, refuse).',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'ID du devis' },
        statut: { type: 'string', description: 'Nouveau statut' },
      },
      required: ['id', 'statut'],
    },
  },
  {
    name: 'liste_clients',
    description: 'Liste les clients avec leur historique de devis.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'relancer_client',
    description: 'Envoie un SMS de relance a un client pour un devis en attente.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'ID du devis' },
        message: { type: 'string', description: 'Message personnalise (optionnel)' },
      },
      required: ['id'],
    },
  },
  {
    name: 'voir_conversations',
    description: 'Voir les conversations recentes du chatbot Nova avec les clients.',
    input_schema: { type: 'object', properties: {}, required: [] },
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
  {
    name: 'analyser_leads',
    description: 'Recupere les soumissions/leads recents du formulaire de contact pour analyse et classification. Inclut nom, telephone, service, surface, ville. Utilise quand on demande "mes leads", "les soumissions", "nouveaux leads", "classer les leads".',
    input_schema: {
      type: 'object',
      properties: {
        jours: { type: 'number', description: 'Leads des X derniers jours (defaut: 14)', default: 14 },
        statut: { type: 'string', description: 'Filtrer par statut: nouveau, lu, en_traitement, ferme (defaut: tous sauf ferme)', default: '' },
      },
      required: [],
    },
  },
  {
    name: 'importer_leads_liste',
    description: 'Importe une liste de leads en bulk dans la banque CRM. Chaque ligne = 1 lead. Accepte du texte brut, CSV, ou format libre. Utilise quand Jason envoie une liste de plusieurs contacts/leads a la fois.',
    input_schema: {
      type: 'object',
      properties: {
        liste: { type: 'string', description: 'Liste brute des leads (une personne par ligne, format libre: nom, tel, email, service, ville)' },
        source: { type: 'string', description: 'Source des leads (ex: champlain, google_ads, referencement, jason)', default: 'jason' },
      },
      required: ['liste'],
    },
  },
  {
    name: 'enregistrer_heures',
    description: 'Enregistre les heures travaillees pour un ou plusieurs employes sur un projet. Utilise quand Luca/Jason dit "3h chaque sur projet #17", "j\'ai fait 5h chez Bernadette", "jour 1 jason 10h luca 10h", "jour 2 luca et jason 10h". IMPORTANT: nom_employe doit etre uniquement le PRENOM de la personne (Luca, Jason, Stephane) — jamais "Jour 1", "Jour 2", "Projet", etc. Si le message dit "jour 1 jason 10h luca 10h", cree 2 entrees: {nom_employe:"Jason",heures:10} et {nom_employe:"Luca",heures:10}. Si plusieurs jours mentionnes, appelle l\'outil une fois par jour avec la date correspondante.',
    input_schema: {
      type: 'object',
      properties: {
        quote_id: { type: 'number', description: 'ID du projet (devis)' },
        entrees: {
          type: 'array',
          description: 'Liste des entrees de temps — chaque entree = 1 employe. nom_employe = prenom seulement (Luca, Jason, Stephane). JAMAIS "Jour 1", "Jour 2", "Projet", "Employe" comme nom.',
          items: {
            type: 'object',
            properties: {
              nom_employe: { type: 'string', description: 'Prenom de l\'employe SEULEMENT: "Luca", "Jason", "Stephane". Jamais "Jour 1", "Projet", etc.' },
              heures: { type: 'number', description: 'Nombre d\'heures travaillees' },
              type: { type: 'string', description: 'Type: travail, deplacement, preparation, nettoyage', default: 'travail' },
              notes: { type: 'string', description: 'Notes optionnelles', default: '' },
            },
            required: ['nom_employe', 'heures'],
          },
        },
        date: { type: 'string', description: 'Date au format YYYY-MM-DD. Si "jour 1" = premiere journee du projet, "jour 2" = deuxieme journee. Utilise la date reelle si connue.' },
      },
      required: ['quote_id', 'entrees'],
    },
  },
  {
    name: 'voir_projet',
    description: 'Affiche le resume complet d\'un projet: client, heures, depenses, photos, profit. Utilise quand on demande "montre-moi le projet #17" ou "combien on a fait sur tel projet".',
    input_schema: {
      type: 'object',
      properties: {
        quote_id: { type: 'number', description: 'ID du projet (devis)' },
      },
      required: ['quote_id'],
    },
  },
  {
    name: 'liste_projets',
    description: 'Liste les projets actifs (devis avec statut planifie, depot_paye, contrat_signe, complete). Montre le client, service, et statut.',
    input_schema: {
      type: 'object',
      properties: {
        statut: { type: 'string', description: 'Filtrer par statut (optionnel)', default: '' },
      },
      required: [],
    },
  },
  {
    name: 'creer_rappel',
    description: 'Cree un rappel/rendez-vous dans le calendrier du dashboard. Utilise quand Luca/Jason dit "rappel payer Bell le 12", "rdv estimation chez X le 15 avril", "rappel appeler client tel date". Supporte les rappels recurrents mensuels.',
    input_schema: {
      type: 'object',
      properties: {
        titre: { type: 'string', description: 'Titre du rappel (ex: Payer Bell, Appeler M. Tremblay)' },
        date: { type: 'string', description: 'Date au format YYYY-MM-DD' },
        heure: { type: 'string', description: 'Heure au format HH:MM (optionnel, defaut 09:00)', default: '09:00' },
        description: { type: 'string', description: 'Details/notes (optionnel)', default: '' },
        recurrent_mensuel: { type: 'boolean', description: 'Si true, cree le rappel pour les 12 prochains mois au meme jour du mois', default: false },
        couleur: { type: 'string', description: 'Couleur: jaune (#f59e0b), bleu (#3b82f6), vert (#22c55e), rouge (#ef4444), violet (#8b5cf6), cyan (#06b6d4)', default: '#06b6d4' },
      },
      required: ['titre', 'date'],
    },
  },
  {
    name: 'scraper_leads',
    description: 'Scrape des leads a partir d\'une URL ou d\'un mot-cle. Si un mot-cle est fourni (ex: "epoxy quebec pages jaunes"), construit automatiquement une URL Pages Jaunes. Retourne les entreprises/contacts trouves. Utilise quand Luca dit "scrape les leads", "trouve des clients sur pages jaunes", "scrape ce site".',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'URL a scraper OU mot-cle de recherche (ex: "epoxy quebec pages jaunes", "https://www.pagesjaunes.ca/...")' },
        max_results: { type: 'number', description: 'Nombre maximum de resultats (defaut: 20)', default: 20 },
      },
      required: ['query'],
    },
  },
  {
    name: 'scraper_competitors',
    description: 'Analyse un ou plusieurs sites web de competiteurs. Retourne les informations cles: services, prix, zone de service, avis, forces/faiblesses. Utilise quand Luca dit "analyse ce competiteur", "regarde ce site", "compare avec eux".',
    input_schema: {
      type: 'object',
      properties: {
        urls: { type: 'string', description: 'URL(s) des competiteurs a analyser (separees par virgule si plusieurs)' },
      },
      required: ['urls'],
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

    case 'creer_devis_prix_fixe': {
      const clientNom = String(input.client_nom || '').trim();
      let clientTel = String(input.client_tel || '').replace(/\D/g, '').slice(-10);
      let clientEmail = '';
      let adresse = '';
      // Resolve tel/email/adresse from CRM by name if not given.
      if (!clientTel && clientNom) {
        const lead = await query(
          `SELECT telephone, email, adresse FROM crm_leads WHERE nom ILIKE $1 ORDER BY created_at DESC LIMIT 1`,
          [`%${clientNom}%`]
        );
        if (lead[0]) {
          clientTel = String(lead[0].telephone || '').replace(/\D/g, '').slice(-10);
          clientEmail = (lead[0].email as string) || '';
          adresse = (lead[0].adresse as string) || '';
        }
      }
      if (!clientTel) {
        return JSON.stringify({ error: `Pas de telephone pour "${clientNom}". Donne-moi son numero.` });
      }
      const prix = Number(input.prix);
      if (!Number.isFinite(prix) || prix <= 0) {
        return JSON.stringify({ error: 'Prix invalide. Donne un montant (ex: 2300) ou dis "minimum call" (1500).' });
      }
      const calc = calculateQuoteCustomPrice(prix);
      const serviceLabel = String(input.service_label || 'Travaux sur mesure').slice(0, 120);
      const description = String(input.description || '').slice(0, 2000) || null;

      const rows = await query(
        `INSERT INTO quotes (
          client_nom, client_email, client_tel, client_adresse,
          type_service, superficie, notes, description_travaux,
          prix_pied_carre, sous_total, tps, tvq, total, depot_requis,
          statut, approved_at, sent_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'envoye',NOW(),NOW())
        RETURNING id`,
        [
          clientNom, clientEmail, clientTel, adresse,
          'commercial', 0, serviceLabel, description,
          0, calc.sous_total, calc.tps, calc.tvq, calc.total, calc.depot_requis,
        ]
      );
      const quoteId = rows[0].id as number;
      const solde = formatMoney(calc.total - calc.depot_requis);

      const smsMsg = [
        `Bonjour ${clientNom}!`,
        `Voici votre soumission Novus Epoxy #${quoteId} :`,
        ``,
        serviceLabel,
        `Total: ${formatMoney(calc.total)} (taxes incluses)`,
        `Depot (30%): ${formatMoney(calc.depot_requis)}`,
        `Solde: ${solde}`,
        ``,
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
        service: serviceLabel,
        prix_forfaitaire: formatMoney(calc.sous_total),
        total: formatMoney(calc.total),
        depot: formatMoney(calc.depot_requis),
        description: description ? 'incluse' : 'aucune',
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
      let clientId = (process.env.GOOGLE_WEB_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || '');
      let clientSecret = (process.env.GOOGLE_WEB_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET || '');
      let refreshToken = process.env.GOOGLE_REFRESH_TOKEN ?? '';
      try {
        const kvRows = await query(`SELECT key, value FROM kv_store WHERE key IN ('google_client_id','google_client_secret','google_refresh_token')`);
        for (const row of (kvRows ?? [])) {
          if (row.key === 'google_client_id' && row.value) clientId = row.value as string;
          if (row.key === 'google_client_secret' && row.value) clientSecret = row.value as string;
          if (row.key === 'google_refresh_token' && row.value) refreshToken = row.value as string;
        }
      } catch { /* ignore */ }
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

    case 'confirmer_paiement': {
      const id = Number(input.id);
      const type = input.type as string; // 'depot' ou 'solde'
      const col = type === 'solde' ? 'balance_paid_at' : 'deposit_paid_at';
      const newStatut = type === 'solde' ? 'complete' : 'depot_paye';
      await query(`UPDATE quotes SET ${col} = NOW(), statut = $1 WHERE id = $2`, [newStatut, id]);
      return JSON.stringify({ ok: true, devis_id: id, paiement: type, nouveau_statut: newStatut });
    }

    case 'modifier_statut_devis': {
      const id = Number(input.id);
      const statut = input.statut as string;
      const validStatuts = ['brouillon','en_attente','approuve','envoye','contrat_signe','depot_paye','planifie','complete','refuse'];
      if (!validStatuts.includes(statut)) return JSON.stringify({ error: 'Statut invalide' });
      await query(`UPDATE quotes SET statut = $1 WHERE id = $2`, [statut, id]);
      return JSON.stringify({ ok: true, devis_id: id, nouveau_statut: statut });
    }

    case 'liste_clients': {
      const rows = await query(
        `SELECT DISTINCT client_nom, client_tel, client_email, MAX(created_at) as dernier_devis, COUNT(*) as nb_devis
         FROM quotes GROUP BY client_nom, client_tel, client_email ORDER BY dernier_devis DESC LIMIT 15`
      );
      return JSON.stringify(rows);
    }

    case 'relancer_client': {
      const id = Number(input.id);
      const q = await query(`SELECT client_nom, client_tel, statut FROM quotes WHERE id = $1`, [id]);
      if (!q.length) return JSON.stringify({ error: 'Devis introuvable' });
      const { client_nom, client_tel, statut } = q[0] as { client_nom: string; client_tel: string; statut: string };
      const msg = input.message as string || `Bonjour ${client_nom}! Avez-vous eu la chance de regarder votre soumission Novus Epoxy #${id}? On est disponibles pour repondre a vos questions. 581-307-2678`;
      await sendSMS(client_tel as string, msg);
      return JSON.stringify({ ok: true, client: client_nom, statut, sms_envoye: true });
    }

    case 'voir_conversations': {
      const rows = await query(
        `SELECT c.id, c.statut, c.created_at,
           (SELECT m.content FROM messages m WHERE m.conversation_id = c.id AND m.role = 'user' ORDER BY m.created_at DESC LIMIT 1) as dernier_message
         FROM conversations c ORDER BY c.updated_at DESC LIMIT 10`
      );
      return JSON.stringify(rows);
    }

    case 'importer_leads_liste': {
      const liste = (input.liste as string).trim();
      const source = (input.source as string) || 'jason';

      if (!liste) return JSON.stringify({ error: 'Liste vide' });

      const apiKeyBulk = process.env.ANTHROPIC_API_KEY;
      if (!apiKeyBulk) return JSON.stringify({ error: 'ANTHROPIC_API_KEY manquant' });

      // Split into chunks of ~6000 chars to handle large lists (200-500+ contacts)
      const allLines = liste.split('\n').filter(l => l.trim());
      const chunks: string[] = [];
      let currentChunk = '';
      for (const line of allLines) {
        if (currentChunk.length + line.length > 6000) {
          chunks.push(currentChunk);
          currentChunk = '';
        }
        currentChunk += line + '\n';
      }
      if (currentChunk.trim()) chunks.push(currentChunk);

      // Parse each chunk with Claude in parallel (max 3 concurrent)
      type ParsedLead = { nom: string; telephone: string; email: string; service: string; superficie: string; ville: string; notes: string };
      const allLeads: ParsedLead[] = [];

      const parseChunk = async (chunk: string): Promise<ParsedLead[]> => {
        try {
          const raw = (await callLLM({
            messages: [{ role: 'user', content: `Parse cette liste de leads pour une entreprise de planchers epoxy au Quebec. Extrait chaque personne.\n\nLISTE:\n${chunk}\n\nReponds UNIQUEMENT avec un JSON array (pas de texte avant ou apres):\n[{"nom":"Prenom Nom","telephone":"10 chiffres ou vide","email":"email ou vide","service":"flake|metallique|commercial|quartz|couleur_unie ou vide","superficie":"nombre ou vide","ville":"ville ou vide","notes":"autres infos ou vide"}]` }],
            maxTokens: 4000,
            tier: 'fast',
          })).replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
          const arr = JSON.parse(raw); return Array.isArray(arr) ? arr : [];
        } catch { return []; }
      };

      // Process chunks in batches of 3
      for (let i = 0; i < chunks.length; i += 3) {
        const batch = chunks.slice(i, i + 3);
        const results = await Promise.all(batch.map(parseChunk));
        for (const r of results) allLeads.push(...r);
      }

      if (allLeads.length === 0) {
        return JSON.stringify({ error: 'Aucun lead detecte dans la liste' });
      }

      // Auto-score temperature
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
      const phonesToCheck = allLeads.map(l => (l.telephone || '').replace(/\D/g, '').slice(-10)).filter(p => p.length === 10);
      const emailsToCheck = allLeads.map(l => (l.email || '').toLowerCase().trim()).filter(e => e.includes('@'));

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

      // Batch INSERT — 50 at a time, skip duplicates
      let imported = 0;
      let skipped = 0;
      const insertedIds: number[] = [];
      const batchSize = 50;

      for (let i = 0; i < allLeads.length; i += batchSize) {
        const batch = allLeads.slice(i, i + batchSize);
        const values: string[] = [];
        const params: (string | null)[] = [];
        let paramIdx = 1;

        for (const lead of batch) {
          if (!lead.nom || lead.nom.trim().length < 2) { skipped++; continue; }
          const phone = (lead.telephone || '').replace(/\D/g, '').slice(-10);
          const email = (lead.email || '').toLowerCase().trim();
          // Skip if phone or email already exists in CRM
          if (phone.length === 10 && existingPhones.has(phone)) { skipped++; continue; }
          if (email.includes('@') && existingEmails.has(email)) { skipped++; continue; }
          const temp = scoreTemp(lead);
          values.push(`($${paramIdx},$${paramIdx + 1},$${paramIdx + 2},$${paramIdx + 3},$${paramIdx + 4},$${paramIdx + 5},$${paramIdx + 6},$${paramIdx + 7},'nouveau',$${paramIdx + 8})`);
          params.push(
            lead.nom.trim().slice(0, 120),
            (lead.telephone || '').replace(/\D/g, '').slice(-10) || null,
            (lead.email || '').slice(0, 255) || null,
            lead.service || null,
            lead.superficie || null,
            (lead.ville || '').slice(0, 120) || null,
            lead.notes || null,
            source,
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
          insertedIds.push(...insertedRows.map(r => (r as { id: number }).id));
        }
      }

      // Auto-prospect: send emails + SMS to all imported leads
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
        } catch (err) { console.error('[Telegram Import] Auto-prospect failed:', err); }
      }

      return JSON.stringify({
        ok: true,
        importes: imported,
        ignores: skipped,
        total_detectes: allLeads.length,
        source,
        prospect: prospectResult,
        dashboard: 'https://novus-epoxy.vercel.app/dashboard/crm',
      });
    }

    case 'analyser_leads': {
      const days = Math.min(Number(input.jours) || 14, 90);
      const statut = input.statut as string;
      const validStatuts = ['nouveau', 'lu', 'en_traitement', 'ferme'];
      const safeStatut = statut && validStatuts.includes(statut) ? statut : '';
      const rows = safeStatut
        ? await query(
            `SELECT id, nom, email, telephone, service, surface_estimee, ville, type_projet, statut, created_at
             FROM submissions WHERE created_at >= NOW() - ($1 || ' days')::INTERVAL AND statut = $2
             ORDER BY created_at DESC LIMIT 20`,
            [days, safeStatut]
          )
        : await query(
            `SELECT id, nom, email, telephone, service, surface_estimee, ville, type_projet, statut, created_at
             FROM submissions WHERE created_at >= NOW() - ($1 || ' days')::INTERVAL AND statut != 'ferme'
             ORDER BY created_at DESC LIMIT 20`,
            [days]
          );
      return JSON.stringify({ leads: rows, periode: `${days} derniers jours`, total: rows.length });
    }


    case 'enregistrer_heures': {
      const quoteId = Number(input.quote_id);
      const entrees = input.entrees as { nom_employe: string; heures: number; type?: string; notes?: string }[];
      const dateTravail = (input.date as string) || new Date().toISOString().slice(0, 10);

      // Verify project exists
      const proj = await query(`SELECT id, client_nom FROM quotes WHERE id = $1`, [quoteId]);
      if (proj.length === 0) return JSON.stringify({ error: `Projet #${quoteId} introuvable` });

      const results: string[] = [];
      for (const e of entrees) {
        // Find or create employee
        let empRows = await query(
          `SELECT id, nom FROM employees WHERE LOWER(nom) LIKE $1 AND actif = true LIMIT 1`,
          [`%${e.nom_employe.toLowerCase()}%`]
        );
        if (empRows.length === 0) {
          empRows = await query(
            `INSERT INTO employees (nom, role, taux_horaire) VALUES ($1, 'sous-traitant', 0) RETURNING id, nom`,
            [e.nom_employe]
          );
        }
        const empId = (empRows[0] as { id: number }).id;
        const empNom = (empRows[0] as { nom: string }).nom;

        await query(
          `INSERT INTO time_entries (employee_id, quote_id, date_travail, heures, type, notes)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [empId, quoteId, dateTravail, e.heures, e.type || 'travail', e.notes || null]
        );
        results.push(`${empNom}: ${e.heures}h`);
      }

      const clientNom = (proj[0] as { client_nom: string }).client_nom;

      // Total heures sur le projet (all time)
      const projetTotaux = await query(
        `SELECT e.nom, SUM(t.heures) as total_heures
         FROM time_entries t JOIN employees e ON e.id = t.employee_id
         WHERE t.quote_id = $1 GROUP BY e.nom ORDER BY e.nom`,
        [quoteId]
      );
      const projetTotal = projetTotaux.reduce((s: number, r: Record<string, unknown>) => s + Number(r.total_heures || 0), 0);

      // Total heures cette semaine (lun-dim) par employe
      const now = new Date();
      const day = now.getDay();
      const diff = day === 0 ? 6 : day - 1;
      const monday = new Date(now);
      monday.setDate(now.getDate() - diff);
      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);
      const monStr = monday.toISOString().slice(0, 10);
      const sunStr = sunday.toISOString().slice(0, 10);

      const semaineTotaux = await query(
        `SELECT e.nom, SUM(t.heures) as total_heures
         FROM time_entries t JOIN employees e ON e.id = t.employee_id
         WHERE t.date_travail >= $1 AND t.date_travail <= $2
         GROUP BY e.nom ORDER BY e.nom`,
        [monStr, sunStr]
      );
      const semaineTotal = semaineTotaux.reduce((s: number, r: Record<string, unknown>) => s + Number(r.total_heures || 0), 0);

      return JSON.stringify({
        ok: true,
        projet: `#${quoteId} — ${clientNom}`,
        date: dateTravail,
        entrees: results,
        projet_totaux: projetTotaux.map((r: Record<string, unknown>) => `${r.nom}: ${r.total_heures}h`),
        projet_total_heures: projetTotal,
        semaine_totaux: semaineTotaux.map((r: Record<string, unknown>) => `${r.nom}: ${r.total_heures}h`),
        semaine_total_heures: semaineTotal,
        semaine: `${monStr} au ${sunStr}`,
      });
    }

    case 'voir_projet': {
      const quoteId = Number(input.quote_id);
      const proj = await query(
        `SELECT id, client_nom, client_tel, client_adresse, type_service, superficie, total, depot_requis, statut, created_at
         FROM quotes WHERE id = $1`, [quoteId]
      );
      if (proj.length === 0) return JSON.stringify({ error: `Projet #${quoteId} introuvable` });
      const q = proj[0] as Record<string, unknown>;

      // Hours
      const hours = await query(
        `SELECT e.nom, t.heures, t.date_travail, t.type, t.notes
         FROM time_entries t JOIN employees e ON e.id = t.employee_id
         WHERE t.quote_id = $1 ORDER BY t.date_travail`, [quoteId]
      );
      const totalHeures = hours.reduce((sum: number, h: Record<string, unknown>) => sum + Number(h.heures || 0), 0);

      // Expenses
      const expenses = await query(
        `SELECT id, fournisseur, montant_ttc, categorie, date_depense FROM expenses WHERE quote_id = $1 ORDER BY date_depense`, [quoteId]
      );
      const totalDepenses = expenses.reduce((sum: number, e: Record<string, unknown>) => sum + Number(e.montant_ttc || 0), 0);

      // Photos
      const photos = await query(
        `SELECT type, url, created_at FROM job_photos WHERE quote_id = $1 ORDER BY type, created_at`, [quoteId]
      );
      const photosAvant = photos.filter((p: Record<string, unknown>) => p.type === 'avant').length;
      const photosApres = photos.filter((p: Record<string, unknown>) => p.type === 'apres').length;

      // Booking
      const booking = await query(
        `SELECT b.jour1_date, b.jour2_date, b.statut FROM bookings b WHERE b.quote_id = $1`, [quoteId]
      ).catch(() => []);

      const revenue = Number(q.total || 0);
      const profit = revenue - totalDepenses;

      return JSON.stringify({
        projet: { id: quoteId, client: q.client_nom, adresse: q.client_adresse, service: q.type_service, superficie: q.superficie, total: revenue, depot: q.depot_requis, statut: q.statut },
        heures: { total: totalHeures, detail: hours },
        depenses: { total: totalDepenses, count: expenses.length, detail: expenses },
        photos: { avant: photosAvant, apres: photosApres },
        booking: booking.length > 0 ? booking[0] : null,
        profit: { revenus: revenue, depenses: totalDepenses, net: profit },
      });
    }

    case 'liste_projets': {
      const statut = input.statut as string;
      const validStatuts = ['brouillon', 'en_attente', 'approuve', 'envoye', 'contrat_signe', 'depot_paye', 'planifie', 'complete', 'refuse'];
      const rows = statut && validStatuts.includes(statut)
        ? await query(
            `SELECT id, client_nom, type_service, superficie, total, statut, created_at FROM quotes WHERE statut = $1 ORDER BY created_at DESC LIMIT 20`,
            [statut]
          )
        : await query(
            `SELECT id, client_nom, type_service, superficie, total, statut, created_at FROM quotes WHERE statut IN ('contrat_signe', 'depot_paye', 'planifie', 'complete') ORDER BY created_at DESC LIMIT 20`,
            []
          );
      return JSON.stringify({ projets: rows, total: rows.length });
    }

    case 'creer_rappel': {
      const titre = input.titre as string;
      const date = input.date as string;
      const heure = (input.heure as string) || '09:00';
      const description = (input.description as string) || '';
      const recurrent = input.recurrent_mensuel as boolean;
      const couleur = (input.couleur as string) || '#06b6d4';

      const events: { title: string; start: string; end: string }[] = [];

      if (recurrent) {
        // Create 12 monthly occurrences
        const baseDate = new Date(date + 'T' + heure + ':00');
        const dayOfMonth = baseDate.getDate();
        for (let i = 0; i < 12; i++) {
          const d = new Date(baseDate);
          d.setMonth(d.getMonth() + i);
          // Handle months with fewer days
          if (d.getDate() !== dayOfMonth) d.setDate(0);
          const startStr = d.toISOString();
          const endD = new Date(d);
          endD.setHours(endD.getHours() + 1);
          events.push({ title: titre, start: startStr, end: endD.toISOString() });
        }
      } else {
        const startStr = date + 'T' + heure + ':00';
        const endD = new Date(startStr);
        endD.setHours(endD.getHours() + 1);
        events.push({ title: titre, start: startStr, end: endD.toISOString() });
      }

      let created = 0;
      for (const ev of events) {
        await query(
          `INSERT INTO calendar_events (title, description, start_date, end_date, all_day, color, event_type, created_by)
           VALUES ($1, $2, $3, $4, false, $5, 'rappel', 'telegram')`,
          [ev.title, description || null, ev.start, ev.end, couleur]
        );
        created++;
      }

      return JSON.stringify({
        ok: true,
        message: recurrent
          ? `Rappel recurrent cree: "${titre}" — ${created} occurrences (12 mois)`
          : `Rappel cree: "${titre}" le ${date} a ${heure}`,
        created,
      });
    }

    case 'scraper_leads': {
      const scraperUrl = process.env.SCRAPER_URL || 'http://localhost:8899';
      const scraperKey = '65d5d80cca68d9b6161fe9b528465aba0a534be595434941';
      const q = (input.query as string).trim();
      const maxResults = Math.min(Number(input.max_results) || 20, 50);

      // Determine if it's a URL or keyword
      let targetUrl = q;
      if (!q.startsWith('http://') && !q.startsWith('https://')) {
        // Build Pages Jaunes search URL from keywords
        const keywords = encodeURIComponent(q);
        targetUrl = `https://www.pagesjaunes.ca/search/si/1/${keywords}`;
      }

      try {
        const resp = await fetch(`${scraperUrl}/scrape`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${scraperKey}`,
          },
          body: JSON.stringify({
            url: targetUrl,
            type: 'leads',
            max_results: maxResults,
          }),
          signal: AbortSignal.timeout(45000),
        });

        if (!resp.ok) {
          const errText = await resp.text().catch(() => '');
          return JSON.stringify({ error: `Scraper erreur ${resp.status}: ${errText || resp.statusText}` });
        }

        const data = await resp.json() as { leads?: Array<Record<string, unknown>>; results?: Array<Record<string, unknown>>; [key: string]: unknown };
        const leads = data.leads || data.results || [];

        if (!Array.isArray(leads) || leads.length === 0) {
          return JSON.stringify({ message: 'Aucun lead trouve pour cette recherche.', url_scrapee: targetUrl });
        }

        return JSON.stringify({
          total: leads.length,
          url_scrapee: targetUrl,
          leads: (leads as Array<Record<string, unknown>>).slice(0, maxResults).map((l: Record<string, unknown>) => ({
            nom: l.name || l.nom || l.business_name || '—',
            telephone: l.phone || l.telephone || l.tel || '—',
            email: l.email || '—',
            adresse: l.address || l.adresse || '—',
            site_web: l.website || l.url || '—',
            categorie: l.category || l.categorie || '—',
          })),
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Erreur inconnue';
        return JSON.stringify({ error: `Scraper inaccessible: ${message}` });
      }
    }

    case 'scraper_competitors': {
      const scraperUrl = process.env.SCRAPER_URL || 'http://localhost:8899';
      const scraperKey = '65d5d80cca68d9b6161fe9b528465aba0a534be595434941';
      const urlsRaw = (input.urls as string).trim();
      const urls = urlsRaw.split(',').map(u => u.trim()).filter(Boolean);

      if (urls.length === 0) {
        return JSON.stringify({ error: 'Aucune URL fournie.' });
      }

      const results: Array<Record<string, unknown>> = [];

      for (const url of urls.slice(0, 5)) {
        try {
          const resp = await fetch(`${scraperUrl}/scrape`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${scraperKey}`,
            },
            body: JSON.stringify({
              url: url.startsWith('http') ? url : `https://${url}`,
              type: 'competitor_analysis',
            }),
            signal: AbortSignal.timeout(45000),
          });

          if (!resp.ok) {
            results.push({ url, error: `Erreur ${resp.status}` });
            continue;
          }

          const data = await resp.json() as Record<string, unknown>;
          results.push({
            url,
            nom_entreprise: data.company_name || data.nom || '—',
            services: data.services || [],
            zone_service: data.service_area || data.zone || '—',
            prix_visibles: data.pricing || data.prix || 'Non affiche',
            avis_google: data.reviews || data.avis || '—',
            telephone: data.phone || data.telephone || '—',
            email: data.email || '—',
            forces: data.strengths || data.forces || [],
            faiblesses: data.weaknesses || data.faiblesses || [],
            resume: data.summary || data.resume || '—',
          });
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : 'Erreur inconnue';
          results.push({ url, error: `Inaccessible: ${message}` });
        }
      }

      return JSON.stringify({
        total_analyses: results.length,
        competiteurs: results,
      });
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
- Creer des rappels dans le calendrier (outil creer_rappel) — supporte les rappels recurrents mensuels
- Voir les reservations a venir
- Calculer des prix rapidement
- Lire et resumer les emails recus (Gmail)
- Ajouter des photos au portfolio (envoie une photo avec caption "portfolio")
- Scanner des recus/factures (envoie une photo du recu, ajoute "projet #17" pour lier au projet)
- Ajouter photos avant/apres a un projet (envoie photo avec caption "projet #17 avant" ou "projet #17 apres")
- Enregistrer les heures des employes sur un projet (outil enregistrer_heures)
- Voir le resume complet d'un projet: heures, depenses, photos, profit (outil voir_projet)
- Lister les projets actifs (outil liste_projets)
- Importer une liste de leads en bulk dans la banque CRM (outil importer_leads_liste)
- Analyser et classer les leads/soumissions recents (chaud/tiede/froid, urgence, action suggeree)
- Repondre aux questions sur les clients et leur suivi

IMPORTANT: Ne JAMAIS envoyer les prix/tarifs par email aux prospects. Les prix sont donnes uniquement dans les soumissions officielles.

SERVICES OFFERTS (type_service entre parentheses):
- Planchers epoxy flake/flocon (flake) — 8.50$/pi2
- Planchers epoxy metallique (metallique) — 12.75$/pi2
- Planchers epoxy couleur unie (couleur_unie) — 7.50$/pi2
- Planchers epoxy quartz (quartz) — 11.00$/pi2
- Revetement balcons/escaliers antiderapant (antiderapant) — 10.00$/pi2
- Planchers epoxy commercial (commercial) — 15.00$/pi2
- Meulage au diamant (meulage) — 3.50$/pi2

IMPORTANT: Quand le client dit "couleur unie" ou "uni", utilise type_service="couleur_unie", PAS "flake".
Quand le client dit "flocon" ou "flake", utilise type_service="flake".

DEVIS A PRIX FIXE (outil creer_devis_prix_fixe):
- Quand Luca te donne un MONTANT TOTAL directement (au lieu d'un prix/pi²), utilise creer_devis_prix_fixe.
- Typiquement APRES une photo (balcon, escalier, reparation): Luca regarde la photo et dit le prix.
- Ex: "fais un devis de 2300 pour Laurie" → prix=2300. "minimum call pour le balcon de Marc" → prix=1500. "1800 pour X note: 2 couches anti-derapant + reparation fissures" → prix=1800, description="2 couches anti-derapant + reparation fissures".
- "minimum" ou "minimum call" = TOUJOURS prix=1500.
- Si Luca ajoute une note/description (apres "note:", "avec", "description:", etc.), mets-la dans le champ description.
- Tu peux retrouver le client par son prenom seul (le tel est cherche dans le CRM automatiquement).
- Le minimum de 1500$ ne s'applique PAS au vinyl/plancher flottant.

INFOS BUSINESS:
- RBQ: 5861-8471-01
- Membre APCHQ
- Garantie 10 ans
- 15 ans d'experience
- Zone: Grand Quebec, Levis, Rive-Sud, Rive-Nord
- Tel: 581-307-2678 (Jason), 581-307-5983 (Luca)

IMPORTANT:
- Quand on te demande d'envoyer un devis, utilise creer_devis_sms
- Quand on te demande les stats, utilise stats_business
- Quand on te demande les emails/courriels, utilise resume_emails
- Quand on demande les leads/soumissions du site → analyser_leads puis classe 🔥/🟡/🔵 avec action
- Pour le suivi client, utilise liste_clients ou detail_devis
- Sois bref — c'est un chat Telegram
- Formate les numeros a 10 chiffres (ex: 4186092084)
- N'utilise PAS de HTML dans tes reponses
- Sois proactif: si urgent, dis-le directement.`;

// POST — Telegram webhook for admin bot
export async function POST(req: NextRequest) {
  // Verify Telegram webhook secret token (REQUIRED)
  const telegramSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  const headerSecret = req.headers.get('x-telegram-bot-api-secret-token') ?? '';
  if (!telegramSecret || !headerSecret || !safeCompare(telegramSecret, headerSecret)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ ok: true });

  // Validate sender is an authorized admin
  const allowedChatIds = (process.env.TELEGRAM_ADMIN_CHAT_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean);
  const incomingMsg = body.message;
  const incomingCallback = body.callback_query;
  const incomingSenderId = String(incomingMsg?.from?.id ?? incomingCallback?.from?.id ?? '');
  const incomingChatId = String(incomingMsg?.chat?.id ?? incomingCallback?.message?.chat?.id ?? '');
  if (!allowedChatIds.includes(incomingSenderId) && !allowedChatIds.includes(incomingChatId)) {
    return NextResponse.json({ ok: true }); // silently ignore unauthorized senders
  }

  // Auto-heal: check & repair all systems every 5 min
  autoHeal().catch(() => {});

  // LOG EVERY MESSAGE — never lose anything
  const msg = body.message;
  if (msg) {
    try {
      const msgType = msg.document ? 'document' : msg.photo ? 'photo' : msg.video ? 'video' : 'text';
      const fileId = msg.document?.file_id || msg.video?.file_id || (msg.photo ? msg.photo[msg.photo.length - 1]?.file_id : null);
      const fileName = msg.document?.file_name || null;

      // For CSV/TXT files, download and save content immediately
      let fileData: string | null = null;
      if (msg.document && fileName && (fileName.endsWith('.csv') || fileName.endsWith('.txt') || fileName.endsWith('.tsv'))) {
        try {
          const fRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN()}/getFile?file_id=${msg.document.file_id}`);
          const fData = await fRes.json();
          if (fData.result?.file_path) {
            const dlRes = await fetch(`https://api.telegram.org/file/bot${BOT_TOKEN()}/${fData.result.file_path}`);
            fileData = await dlRes.text();
          }
        } catch { /* non-fatal */ }
      }

      const insertResult = await query(
        `INSERT INTO telegram_messages (telegram_msg_id, chat_id, chat_title, sender_id, sender_name, message_type, text, file_name, file_id, file_data)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (telegram_msg_id, chat_id) DO NOTHING
         RETURNING id`,
        [
          msg.message_id, msg.chat.id, msg.chat.title || null,
          msg.from?.id || null, msg.from?.first_name || null,
          msgType, msg.text || msg.caption || null,
          fileName, fileId, fileData,
        ]
      );
      // If no row returned → duplicate message (Telegram retry), skip all processing
      if (insertResult.length === 0) {
        return NextResponse.json({ ok: true });
      }
    } catch { /* logging should never crash the bot */ }
  }

  // Handle callback_query (inline button presses)
  if (body.callback_query) {
    const cb = body.callback_query;
    const cbChatId = String(cb.message?.chat?.id ?? '');
    const cbData = (cb.data ?? '') as string;
    const cbId = cb.id as string;

    // Answer the callback to remove loading state
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN()}/answerCallbackQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callback_query_id: cbId }),
    });

    // approve_quote_123 — Step 1: approve and show send method choice
    if (cbData.startsWith('approve_quote_') && !cbData.includes('_via_')) {
      const quoteId = parseInt(cbData.replace('approve_quote_', ''));
      try {
        const rows = await query('SELECT * FROM quotes WHERE id = $1', [quoteId]);
        const q = rows[0];
        if (!q) {
          await sendTelegram(cbChatId, `Devis #${quoteId} introuvable.`);
          return NextResponse.json({ ok: true });
        }
        if (!['brouillon', 'en_attente'].includes(q.statut as string)) {
          await sendTelegram(cbChatId, `Devis #${quoteId} est deja ${q.statut}.`);
          return NextResponse.json({ ok: true });
        }

        // Approve the quote
        await query(`UPDATE quotes SET statut = 'approuve', approved_at = NOW() WHERE id = $1`, [quoteId]);

        // Show send method buttons
        const sendButtons = {
          inline_keyboard: [
            [
              { text: '📧 Envoyer par Email', callback_data: `approve_quote_${quoteId}_via_email` },
              { text: '📱 Envoyer par SMS', callback_data: `approve_quote_${quoteId}_via_sms` },
            ],
            [
              { text: '📧+📱 Les deux', callback_data: `approve_quote_${quoteId}_via_both` },
            ],
          ],
        };

        await fetch(`https://api.telegram.org/bot${BOT_TOKEN()}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: cbChatId,
            text: `✅ Devis #${quoteId} approuve pour ${q.client_nom}!\n\nComment veux-tu l'envoyer?`,
            reply_markup: sendButtons,
          }),
        });
        return NextResponse.json({ ok: true });
      } catch (err) {
        console.error('[Telegram] approve error:', err);
        await sendTelegram(cbChatId, `Erreur: ${err instanceof Error ? err.message : 'erreur'}`);
        return NextResponse.json({ ok: true });
      }
    }

    // approve_quote_123_via_email/sms/both — Step 2: actually send
    if (cbData.match(/^approve_quote_\d+_via_(email|sms|both)$/)) {
      const parts = cbData.match(/^approve_quote_(\d+)_via_(email|sms|both)$/);
      if (!parts) return NextResponse.json({ ok: true });
      const quoteId = parseInt(parts[1]);
      const BASE = process.env.NEXTAUTH_URL ?? 'https://novus-epoxy.vercel.app';
      const method = parts[2]; // email, sms, or both
      try {
        const rows = await query('SELECT * FROM quotes WHERE id = $1', [quoteId]);
        const q = rows[0];
        if (!q) {
          await sendTelegram(cbChatId, `Devis #${quoteId} introuvable.`);
          return NextResponse.json({ ok: true });
        }

        const secretToken = q.secret_token as string;
        const service = SERVICES[q.type_service as ServiceType];
        const solde70 = formatMoney(Number(q.total) - Number(q.depot_requis));
        const sendViaEmail = method === 'email' || method === 'both';
        const sendViaSms = method === 'sms' || method === 'both';
        const results: string[] = [];

        // EMAIL
        let emailSent = false;
        if (sendViaEmail && q.client_email) {
          const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:0;background:#ffffff;">
<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:16px;background:#ffffff;">
<h2 style="color:#1e293b;margin:0 0 12px;font-size:20px;">Soumission #${q.id}</h2>
<p>Bonjour ${q.client_nom},</p>
<p style="color:#475569;">Voici votre soumission pour vos travaux de plancher epoxy :</p>
${getServiceDescriptionHtml(q.type_service as string) ? `<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:12px;margin:0 0 12px;"><h3 style="color:#1e293b;margin:0 0 8px;font-size:15px;">Description des travaux</h3>${getServiceDescriptionHtml(q.type_service as string)}</div>` : ''}
<table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 12px;">
<tr style="border-bottom:1px solid #e2e8f0;"><td style="padding:6px 0;color:#64748b;font-size:14px;">Service</td><td style="padding:6px 0;text-align:right;font-weight:600;">${service?.label ?? q.type_service}</td></tr>
<tr style="border-bottom:1px solid #e2e8f0;"><td style="padding:6px 0;color:#64748b;font-size:14px;">Superficie</td><td style="padding:6px 0;text-align:right;">${q.superficie} pi²</td></tr>
<tr style="border-bottom:1px solid #e2e8f0;"><td style="padding:6px 0;color:#64748b;font-size:14px;">Prix/pi²</td><td style="padding:6px 0;text-align:right;">${formatMoney(Number(q.prix_pied_carre))}</td></tr>
<tr style="border-bottom:1px solid #e2e8f0;"><td style="padding:6px 0;color:#64748b;font-size:14px;">${q.superficie} pi² x ${formatMoney(Number(q.prix_pied_carre))}</td><td style="padding:6px 0;text-align:right;">${formatMoney(Number(q.prix_pied_carre) * Number(q.superficie))}</td></tr>
${Number(q.rabais_pct) > 0 ? `<tr style="border-bottom:1px solid #e2e8f0;"><td style="padding:6px 0;color:#16a34a;font-size:14px;font-weight:600;">Rabais ${q.rabais_pct}% 🎉</td><td style="padding:6px 0;text-align:right;font-size:14px;color:#16a34a;font-weight:600;">-${formatMoney(Number(q.rabais_montant))}</td></tr>` : ''}
<tr style="border-bottom:1px solid #e2e8f0;"><td style="padding:6px 0;color:#64748b;font-size:14px;">Sous-total</td><td style="padding:6px 0;text-align:right;">${formatMoney(Number(q.sous_total))}</td></tr>
<tr style="border-bottom:1px solid #e2e8f0;"><td style="padding:6px 0;color:#64748b;font-size:14px;">TPS (5%)</td><td style="padding:6px 0;text-align:right;">${formatMoney(Number(q.tps))}</td></tr>
<tr style="border-bottom:1px solid #e2e8f0;"><td style="padding:6px 0;color:#64748b;font-size:14px;">TVQ (9,975%)</td><td style="padding:6px 0;text-align:right;">${formatMoney(Number(q.tvq))}</td></tr>
<tr style="border-bottom:2px solid #1e293b;"><td style="padding:10px 0;font-weight:700;font-size:17px;">Total</td><td style="padding:10px 0;text-align:right;font-weight:700;font-size:17px;">${formatMoney(Number(q.total))}</td></tr>
</table>
<div style="background:#fffbeb;border:1px solid #f59e0b;border-radius:6px;padding:12px;margin:0 0 12px;">
<p style="margin:0;color:#92400e;font-weight:700;">Depot (30%) : ${formatMoney(Number(q.depot_requis))}</p>
<p style="margin:4px 0 0;color:#64748b;font-size:13px;">Solde (70%) a la fin des travaux : ${solde70}</p>
</div>
<div style="text-align:center;margin:12px 0;">
<a href="${BASE}/reservation/${q.id}?token=${encodeURIComponent(secretToken)}" style="display:inline-block;background:#f59e0b;color:#0f172a;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:700;font-size:16px;">Choisir vos dates</a>
</div>
<div style="text-align:center;margin:12px 0;">
<a href="${BASE}/contrat/${q.id}?token=${encodeURIComponent(secretToken)}" style="display:inline-block;background:#0f172a;color:#ffffff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:700;font-size:16px;">Signer le contrat</a>
</div>
<div style="text-align:center;margin:12px 0;">
<a href="${BASE}/paiement/${q.id}?token=${encodeURIComponent(secretToken)}" style="display:inline-block;background:#16a34a;color:#ffffff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:700;font-size:16px;">Payer le depot (30%)</a>
</div>
<p style="color:#475569;font-size:12px;">Questions? 581-307-2678 (Jason) ou 581-307-5983 (Luca)</p>
</div></body></html>`;
          const emailSubject = `Soumission Novus Epoxy #${q.id}`;
          try {
            const emailResult = await sendEmail({ to: q.client_email as string, subject: emailSubject, html });
            emailSent = true;
            // Log dans email_logs pour visibilite dans le dashboard
            await query(
              `INSERT INTO email_logs (resend_id, destinataire, sujet, submission_id) VALUES ($1, $2, $3, $4)`,
              [emailResult.id, q.client_email, emailSubject, null],
            );
            results.push(`📧 Email envoye a ${q.client_email}`);
          } catch (emailErr) {
            const errMsg = emailErr instanceof Error ? emailErr.message : 'erreur';
            results.push(`❌ Erreur email: ${errMsg.slice(0, 80)}`);
          }
        } else if (sendViaEmail && !q.client_email) {
          results.push(`⚠️ Pas d'email pour ce client`);
        }

        // SMS
        let smsSent = false;
        if (sendViaSms && q.client_tel) {
          const rabaisLine = Number(q.rabais_pct) > 0 ? `\nRabais ${q.rabais_pct}%: -${formatMoney(Number(q.rabais_montant))}` : '';
          const smsMsg = `Bonjour ${q.client_nom}!\nVoici votre soumission Novus Epoxy #${q.id}:\n\n${service?.label ?? q.type_service}\n${q.superficie} pi² x ${formatMoney(Number(q.prix_pied_carre))}/pi²${rabaisLine}\nSous-total: ${formatMoney(Number(q.sous_total))}\nTPS+TVQ: ${formatMoney(Number(q.tps) + Number(q.tvq))}\nTotal: ${formatMoney(Number(q.total))}\nDepot (30%): ${formatMoney(Number(q.depot_requis))}\n\nDetails: ${BASE}/paiement/${q.id}?token=${encodeURIComponent(secretToken)}\n\nQuestions? 581-307-2678`;
          try {
            await sendSMS(q.client_tel as string, smsMsg);
            smsSent = true;
            results.push(`📱 SMS envoye a ${q.client_tel}`);
          } catch {
            results.push(`❌ Erreur SMS`);
          }
        } else if (sendViaSms && !q.client_tel) {
          results.push(`⚠️ Pas de telephone pour ce client`);
        }

        // Marquer envoye SEULEMENT si au moins un canal a reussi
        if (emailSent || smsSent) {
          await query(`UPDATE quotes SET statut = 'envoye', sent_at = NOW() WHERE id = $1`, [quoteId]);
          await sendTelegram(cbChatId, `✅ Devis #${quoteId} envoye a ${q.client_nom}!\n\n${results.join('\n')}`);
        } else {
          await sendTelegram(cbChatId, `❌ Devis #${quoteId} NON envoye — tous les canaux ont echoue:\n\n${results.join('\n')}\n\nLe statut reste "${q.statut}". Reessayez ou envoyez depuis le dashboard.`);
        }
      } catch (err) {
        console.error('Approve quote error:', err);
        await sendTelegram(cbChatId, `Erreur: ${err instanceof Error ? err.message : String(err)}`);
      }
      return NextResponse.json({ ok: true });
    }

    // assign_expense_123_inv_456 or assign_expense_123_none or assign_expense_123_proj_456
    if (cbData.startsWith('assign_expense_')) {
      const parts = cbData.replace('assign_expense_', '').split('_');
      const expenseId = parseInt(parts[0]);
      const isNone = parts[1] === 'none';
      const invoiceId = !isNone && parts[1] === 'inv' ? parseInt(parts[2]) : null;
      const projId = !isNone && parts[1] === 'proj' ? parseInt(parts[2]) : null;

      try {
        if (isNone) {
          await query(`UPDATE expenses SET pending_project = FALSE WHERE id = $1`, [expenseId]);
          await sendTelegram(cbChatId, `✅ Depense #${expenseId} — marquee comme generale (aucun projet).`);
        } else if (projId) {
          await query(`UPDATE expenses SET quote_id = $1, pending_project = FALSE WHERE id = $2`, [projId, expenseId]);
          const projRows = await query(`SELECT client_nom FROM quotes WHERE id = $1`, [projId]);
          const clientNom = (projRows[0]?.client_nom as string) ?? `#${projId}`;
          await sendTelegram(cbChatId, `✅ Depense #${expenseId} → liee au projet #${projId} (${clientNom})`);
        } else if (invoiceId) {
          await query(`UPDATE expenses SET invoice_id = $1, pending_project = FALSE WHERE id = $2`, [invoiceId, expenseId]);
          const invRows = await query(`SELECT numero FROM invoices WHERE id = $1`, [invoiceId]);
          const numero = (invRows[0]?.numero as string) ?? `#${invoiceId}`;
          await sendTelegram(cbChatId, `✅ Depense #${expenseId} → liee a la facture ${numero}`);
        }
      } catch (err) {
        console.error('Assign expense error:', err);
        await sendTelegram(cbChatId, `Erreur: ${err instanceof Error ? err.message : String(err)}`);
      }
      return NextResponse.json({ ok: true });
    }

    // confirm_deposit_123 — manually confirm deposit received (Interac/cheque)
    if (cbData.startsWith('confirm_deposit_')) {
      const quoteId = parseInt(cbData.replace('confirm_deposit_', ''));
      try {
        const rows = await query('SELECT * FROM quotes WHERE id = $1', [quoteId]);
        const q = rows[0];
        if (!q) {
          await sendTelegram(cbChatId, `Devis #${quoteId} introuvable.`);
          return NextResponse.json({ ok: true });
        }
        if (q.statut === 'depot_paye') {
          await sendTelegram(cbChatId, `Devis #${quoteId} — depot deja confirme.`);
          return NextResponse.json({ ok: true });
        }

        // Confirm booking if exists
        if (q.booking_id) {
          await query(`UPDATE bookings SET statut = 'confirme' WHERE id = $1`, [q.booking_id]);
        }

        // Update quote
        await query(
          `UPDATE quotes SET statut = 'depot_paye', paid_at = NOW(), deposit_paid_at = NOW() WHERE id = $1`,
          [quoteId]
        );

        // Send confirmation email to client
        if (q.client_email) {
          const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:0;background:#ffffff;">
<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;">
<div style="background:#0f172a;color:white;padding:20px 24px;border-radius:8px 8px 0 0;">
<h2 style="margin:0;font-size:20px;">Depot recu!</h2>
<p style="margin:4px 0 0;color:#f59e0b;font-size:14px;">Novus Epoxy — Devis #${quoteId}</p>
</div>
<div style="padding:20px 24px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px;">
<p>Bonjour ${q.client_nom},</p>
<p>Nous avons bien recu votre depot de <strong>${formatMoney(Number(q.depot_requis))}</strong>.</p>
<p style="color:#16a34a;font-weight:600;">Vos dates de travaux sont maintenant confirmees!</p>
<p style="color:#475569;font-size:14px;">Nous vous contacterons la veille de vos travaux avec les details d'arrivee de l'equipe.</p>
<div style="background:#f1f5f9;border-radius:8px;padding:16px;margin:16px 0;">
<p style="margin:0 0 4px;color:#1e293b;font-weight:700;">Solde restant (70%) :</p>
<p style="margin:0 0 8px;color:#475569;font-size:13px;">Le solde de <strong>${formatMoney(Number(q.total) - Number(q.depot_requis))}</strong> sera a payer a la fin des travaux.</p>
<p style="margin:0;color:#94a3b8;font-size:12px;">Vous recevrez un lien de paiement a la completion des travaux.</p>
</div>
<div style="background:#f1f5f9;border-radius:6px;padding:10px;margin:0 0 12px;font-size:12px;color:#475569;">
<strong>Facturation / Soumission :</strong> Luca — <a href="tel:5813075983" style="color:#2563eb;">581-307-5983</a><br/>
<strong>Chantier / Soumission :</strong> Jason — <a href="tel:5813072678" style="color:#2563eb;">581-307-2678</a>
</div>
</div></div></body></html>`;

          sendEmail({ to: q.client_email as string, subject: `Depot recu — Novus Epoxy #${quoteId}`, html })
            .catch(err => console.error('Deposit email error:', err));
        }

        // SMS to client
        if (q.client_tel) {
          await sendSMS(q.client_tel as string, `Novus Epoxy: Votre depot a ete recu! Vos dates sont confirmees. Merci! Questions? 581-307-2678`).catch(() => {});
        }

        // Notify all admins
        for (const chatId of ADMIN_CHAT_IDS()) {
          await sendTelegram(chatId, `✅ Depot confirme manuellement pour devis #${quoteId} — ${q.client_nom}.\nDates confirmees, email envoye au client.`);
        }
      } catch (err) {
        console.error('Confirm deposit error:', err);
        await sendTelegram(cbChatId, `Erreur: ${err instanceof Error ? err.message : String(err)}`);
      }
      return NextResponse.json({ ok: true });
    }

    // reject_quote_123
    if (cbData.startsWith('reject_quote_')) {
      const quoteId = parseInt(cbData.replace('reject_quote_', ''));
      await query(`UPDATE quotes SET statut = 'refuse' WHERE id = $1`, [quoteId]);
      await sendTelegram(cbChatId, `Devis #${quoteId} rejete.`);
      return NextResponse.json({ ok: true });
    }

    // approve_ad_123 — Approve FB ad draft, create campaign ACTIVE in Meta
    if (cbData.startsWith('approve_ad_')) {
      const draftId = parseInt(cbData.replace('approve_ad_', ''));
      const { createMetaCampaignPaused, pausePreviousLaunchedAds } = await import('@/lib/meta-ads');

      // Get service so we only pause SAME-service old ads (flake + métallique can coexist)
      const draftRow = await query(`SELECT service FROM meta_ads_drafts WHERE id = $1`, [draftId]).catch(() => []);
      const service = draftRow[0] ? String(draftRow[0].service) : undefined;

      await query(
        `UPDATE meta_ads_drafts SET statut = 'approve', approved_at = NOW(), approved_by = $1 WHERE id = $2 AND statut = 'brouillon'`,
        [cbChatId, draftId]
      );
      await sendTelegram(cbChatId, `⏳ Création de la pub Meta en cours pour #${draftId}...`);

      // Pause ONLY previous Novus ads of the SAME service (let flake + métallique cohabiter)
      const novusPause = await pausePreviousLaunchedAds(service);
      if (novusPause.paused.length > 0) {
        await sendTelegram(cbChatId, `⏸️ <b>${novusPause.paused.length} ancienne(s) pub <i>${service}</i> mise(s) en pause</b>\n\nCampaign IDs: ${novusPause.paused.map(c => `<code>${c}</code>`).join(', ')}\n\n<i>Pubs des autres services restent actives.</i>`, { parse_mode: 'HTML' });
      }

      const result = await createMetaCampaignPaused(draftId);
      if (result.error) {
        // Mark as erreur so we don't lose track of it
        await query(
          `UPDATE meta_ads_drafts SET statut = 'erreur', error = $1, updated_at = NOW() WHERE id = $2`,
          [result.error, draftId]
        );
        if (result.needsAdsManagement) {
          // Fallback: give user a deep link to Ads Manager pre-filled with the draft data
          const { buildAdsManagerPrefillUrl } = await import('@/lib/meta-ads');
          const prefillUrl = await buildAdsManagerPrefillUrl(draftId);
          const rows = await query(`SELECT image_url, headline, primary_text, daily_budget_usd FROM meta_ads_drafts WHERE id = $1`, [draftId]);
          const d = rows[0];
          const msg = [
            `⚠️ <b>API Meta refuse la création auto</b>`,
            ``,
            `Le token a juste <code>pages_manage_ads</code> — manque <code>ads_management</code> pour créer une campagne complète via API.`,
            ``,
            `<b>👉 Solution rapide (2 min)</b>:`,
            `1. Clique le bouton ci-dessous → Ads Manager s'ouvre`,
            `2. Téléverse l'image ci-jointe (sauve-la depuis le preview Telegram)`,
            `3. Colle le texte:`,
            ``,
            `<b>Titre:</b> <code>${String(d?.headline ?? '')}</code>`,
            ``,
            `<b>Texte:</b>`,
            `<code>${String(d?.primary_text ?? '').slice(0, 300)}</code>`,
            ``,
            `<b>Budget:</b> $${d?.daily_budget_usd ?? 30} CAD/jour`,
            `<b>Form:</b> Lead form (sélectionner "novus epoxy prospect form-copy")`,
            ``,
            `Tout le targeting est déjà configuré dans le wizard.`,
            ``,
            `<b>OU permanent fix (5 min)</b>:`,
            `Va sur business.facebook.com → Utilisateurs système → Génère nouveau token avec <code>ads_management</code> coché → ajoute dans Vercel comme <code>META_PAGE_TOKEN</code>`,
          ].join('\n');
          await sendTelegram(cbChatId, msg, {
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: [[{ text: '📊 Ouvrir Ads Manager pré-rempli', url: prefillUrl }]] },
          });
        } else {
          await sendTelegram(cbChatId, `❌ <b>Erreur création pub #${draftId}</b>\n\n${result.error.slice(0, 600)}`, { parse_mode: 'HTML' });
        }
      } else {
        const adsManagerUrl = `https://business.facebook.com/adsmanager/manage/campaigns?act=${(process.env.META_AD_ACCOUNT_ID ?? '').replace(/^act_/, '')}&selected_campaign_ids=${result.campaignId}`;
        const isLive = (process.env.META_ADS_DEFAULT_STATUS ?? 'ACTIVE').toUpperCase() === 'ACTIVE';
        await sendTelegram(
          cbChatId,
          `${isLive ? '🚀' : '✅'} <b>Pub #${draftId} ${isLive ? 'EN LIGNE — LIVE!' : 'créée (PAUSED)'}</b>\n\nCampaign: <code>${result.campaignId}</code>\nAd: <code>${result.adId}</code>\n\n${isLive ? '<b>🟢 Status: ACTIVE</b> — Meta diffuse maintenant. Premiers leads attendus dans 1-4h.' : '<b>⚫ Status: PAUSED</b> — clique le bouton pour activer.'}`,
          {
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: [[{ text: '📊 Voir dans Ads Manager', url: adsManagerUrl }]] },
          }
        );
      }
      return NextResponse.json({ ok: true });
    }

    // reject_ad_123
    if (cbData.startsWith('reject_ad_')) {
      const draftId = parseInt(cbData.replace('reject_ad_', ''));
      await query(`UPDATE meta_ads_drafts SET statut = 'rejete', updated_at = NOW() WHERE id = $1`, [draftId]);
      await sendTelegram(cbChatId, `❌ Pub #${draftId} rejetée — aucune campagne créée.`);
      return NextResponse.json({ ok: true });
    }

    // regen_ad_123 — Regenerate copy + image for same service
    if (cbData.startsWith('regen_ad_')) {
      const draftId = parseInt(cbData.replace('regen_ad_', ''));
      const rows = await query(`SELECT service FROM meta_ads_drafts WHERE id = $1`, [draftId]);
      if (!rows.length) {
        await sendTelegram(cbChatId, `Pub #${draftId} introuvable.`);
        return NextResponse.json({ ok: true });
      }
      const service = String(rows[0].service);
      await sendTelegram(cbChatId, `🔁 Régénération en cours pour ${service}...`);
      try {
        const { buildAdDraft, sendDraftToTelegram } = await import('@/lib/meta-ads');
        const draft = await buildAdDraft({ service: service as 'flake' });
        if (process.env.TELEGRAM_GROUP_CHAT_ID) {
          await sendDraftToTelegram(draft, process.env.TELEGRAM_GROUP_CHAT_ID);
        }
      } catch (err) {
        await sendTelegram(cbChatId, `❌ Régen échoue: ${(err as Error).message.slice(0, 200)}`);
      }
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ ok: true });
  }

  const message = body.message;
  if (!message) return NextResponse.json({ ok: true });

  const chatId = String(message.chat.id);
  const senderId = String(message.from?.id ?? '');
  const adminIds = ADMIN_CHAT_IDS();
  const isGroup = message.chat.type === 'group' || message.chat.type === 'supergroup';
  const isAdmin = adminIds.includes(chatId) || adminIds.includes(senderId);

  // GROUP MESSAGE: respond to "Aria ...", auto-detect leads, hours, or process CSV files
  // Photos and videos in group fall through to the shared handlers below
  if (isGroup) {
    // Text command "pub <service> [budget]" — no photo → use Sage portfolio OR generate via LLM
    if (isAdmin && !message.photo && !message.video && typeof message.text === 'string') {
      const txt = String(message.text).toLowerCase().trim();
      const cmd = txt.match(/^(?:pub|ad|annonce|nouvelle pub)\b/i);
      if (cmd) {
        // Detect service
        let service = 'flake';
        const svcKeywords: Array<[RegExp, string]> = [
          [/m[eé]tallique?|metal\b/i, 'metallique'],
          [/quartz/i, 'quartz'],
          [/couleur[\s_]?unie?|uni\b/i, 'couleur_unie'],
          [/antid[eé]rapant|anti[\s-]?d[eé]rapant/i, 'antiderapant'],
          [/commercial|industriel/i, 'commercial'],
          [/meulage|diamant|poli/i, 'meulage'],
          [/vinyl|click|flottant/i, 'vinyl_click'],
          [/flocon|flake/i, 'flake'],
        ];
        for (const [rx, svc] of svcKeywords) {
          if (rx.test(txt)) { service = svc; break; }
        }
        const budgetMatch = txt.match(/\$?\s*(\d{2,3})\s*\$?(?:\s*\/?\s*j(?:our)?)?/i);
        const budget = budgetMatch ? Math.min(parseInt(budgetMatch[1]), 50) : 30;

        await sendTelegram(chatId, `🎨 <b>Nouvelle pub demandée — sans photo</b>\n\nService: <b>${service}</b>\nBudget: <b>$${budget}/jour</b>\n\n⏳ Je cherche une photo Sage portfolio. Si rien trouvé, je génère une avec Gemini 3 Pro Image (~10 sec)...`);

        try {
          const { buildAdDraft, sendDraftToTelegram } = await import('@/lib/meta-ads');
          // No customImageUrl → buildAdDraft tries pickSageImage(), then generateAdImage()
          const draft = await buildAdDraft({
            service: service as 'flake',
            dailyBudgetUsd: budget,
            durationDays: 7,
          });
          await sendDraftToTelegram(draft, chatId);
        } catch (err) {
          await sendTelegram(chatId, `❌ Erreur: ${(err as Error).message.slice(0, 300)}`);
        }
        return NextResponse.json({ ok: true });
      }
    }

    // ANY photo dropped by admin in group → treat as ad creative
    // Caption flexible: looks for service keyword + optional budget; defaults flake/$30
    if (isAdmin && message.photo) {
      const cap = String(message.caption ?? '').toLowerCase().trim();
      // Detect service anywhere in caption (no "pub" prefix required)
      let service = 'flake'; // default if nothing matches
      const svcKeywords: Array<[RegExp, string]> = [
        [/m[eé]tallique?|metal\b/i, 'metallique'],
        [/quartz/i, 'quartz'],
        [/couleur[\s_]?unie?|uni\b/i, 'couleur_unie'],
        [/antid[eé]rapant|anti[\s-]?d[eé]rapant/i, 'antiderapant'],
        [/commercial|industriel/i, 'commercial'],
        [/meulage|diamant|poli/i, 'meulage'],
        [/vinyl|click|flottant/i, 'vinyl_click'],
        [/flocon|flake/i, 'flake'],
      ];
      for (const [rx, svc] of svcKeywords) {
        if (rx.test(cap)) { service = svc; break; }
      }
      // Detect budget number (1-2 digits up to 50)
      const budgetMatch = cap.match(/\$?\s*(\d{2,3})\s*\$?(?:\s*\/?\s*j(?:our)?)?/i);
      const budget = budgetMatch ? Math.min(parseInt(budgetMatch[1]), 50) : 30;

      await sendTelegram(chatId, `📸 <b>Photo reçue!</b>\n\nService détecté: <b>${service}</b>\nBudget: <b>$${budget}/jour</b>\n\n⏳ Je télécharge et prépare la pub...`);

      try {
        const photos = message.photo as Array<{ file_id: string; file_size?: number; width: number; height: number }>;
        const best = photos.sort((a, b) => (b.width * b.height) - (a.width * a.height))[0];
        const fileRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN()}/getFile?file_id=${best.file_id}`);
        const fileData = await fileRes.json();
        if (!fileData.result?.file_path) throw new Error('Cannot get file path from Telegram');

        const dlRes = await fetch(`https://api.telegram.org/file/bot${BOT_TOKEN()}/${fileData.result.file_path}`);
        const buffer = Buffer.from(await dlRes.arrayBuffer());
        const ext = (fileData.result.file_path.split('.').pop() ?? 'jpg').toLowerCase();
        const mime = ext === 'png' ? 'image/png' : 'image/jpeg';

        const { put } = await import('@vercel/blob');
        const blob = await put(`ads-creatives/tg-${Date.now()}-${Math.random().toString(36).slice(2,8)}.${ext}`, buffer, {
          access: 'public', addRandomSuffix: false, contentType: mime,
        });

        const { buildAdDraft, sendDraftToTelegram } = await import('@/lib/meta-ads');
        const draft = await buildAdDraft({
          service: service as 'flake',
          dailyBudgetUsd: budget,
          durationDays: 7,
          customImageUrl: blob.url,
        });
        await sendDraftToTelegram(draft, chatId);
      } catch (err) {
        await sendTelegram(chatId, `❌ Erreur: ${(err as Error).message.slice(0, 250)}`);
      }
      return NextResponse.json({ ok: true });
    }

    // Photos and videos in group → fall through to shared photo/video handlers below
    if (message.photo || message.video) {
      // Don't return — let it fall through to the photo/video handling code below
    } else {

    // Handle CSV/TXT document uploads — download, import, ONE summary, prospect in background
    if (message.document) {
      const doc = message.document;
      const fname = (doc.file_name || '').toLowerCase();
      if (fname.endsWith('.csv') || fname.endsWith('.txt') || fname.endsWith('.tsv')) {
        await sendTelegram(chatId, `🤖 <b>Aria:</b> Bien recu! Je telecharge et importe ${doc.file_name}...`);
        try {
          const fileRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN()}/getFile?file_id=${doc.file_id}`);
          const fileData = await fileRes.json();
          if (fileData.result?.file_path) {
            const dlRes = await fetch(`https://api.telegram.org/file/bot${BOT_TOKEN()}/${fileData.result.file_path}`);
            const csvText = await dlRes.text();

            // Detect source from caption
            const caption = (message.caption ?? '').toLowerCase();
            let source = 'jason';
            if (caption.includes('champlain') || caption.includes('champfield')) source = 'champfield';
            else if (caption.includes('google')) source = 'google_ads';
            else if (caption.includes('facebook') || caption.includes('meta')) source = 'facebook';

            // Smart CSV parsing: detect headers and parse directly (no AI needed for structured CSVs)
            const csvLines = csvText.split('\n').filter((l: string) => l.trim());
            const header = csvLines[0]?.toLowerCase() || '';
            const hasHeaders = header.includes('email') || header.includes('phone') || header.includes('business') || header.includes('nom') || header.includes('contact');

            let importes = 0;
            let ignores = 0;
            let total = 0;
            const insertedIds: number[] = [];

            if (hasHeaders && csvLines.length > 1) {
              // Direct CSV parsing — no AI, handles thousands of rows
              const headers = parseCSVLine(csvLines[0]).map((h: string) => h.toLowerCase());
              const findCol = (...names: string[]) => headers.findIndex(h => names.some(n => h.includes(n)));
              const colBusiness = findCol('business', 'entreprise', 'company', 'nom');
              const colContact = findCol('contact', 'prenom', 'first');
              const colEmail = findCol('email', 'courriel', 'e-mail');
              const colPhone = findCol('phone', 'telephone', 'tel');
              const colCity = findCol('city', 'ville');
              const colProvince = findCol('province', 'state', 'prov');
              const colIndustry = findCol('industry', 'industrie', 'category', 'categorie');

              // Load existing emails/phones for dedup
              const existingEmails = new Set<string>();
              const existingPhones = new Set<string>();
              const emRows = await query('SELECT LOWER(email) as e FROM crm_leads WHERE email IS NOT NULL');
              emRows.forEach((r: Record<string, unknown>) => existingEmails.add(r.e as string));
              const phRows = await query("SELECT regexp_replace(telephone, '[^0-9]', '', 'g') as p FROM crm_leads WHERE telephone IS NOT NULL");
              phRows.forEach((r: Record<string, unknown>) => { const p = (r.p as string).slice(-10); if (p.length === 10) existingPhones.add(p); });

              // Owner emails to skip
              const SKIP_EMAILS = ['gestionnovusepoxy@gmail.com', 'lanthierj6@gmail.com', 'luca.hayes1994@gmail.com'];

              for (let i = 1; i < csvLines.length; i++) {
                // Simple CSV split (handles basic quoting)
                const cols = parseCSVLine(csvLines[i]);
                const nom = (colBusiness >= 0 ? cols[colBusiness] : '') || (colContact >= 0 ? cols[colContact] : '') || '';
                const email = (colEmail >= 0 ? cols[colEmail] : '')?.toLowerCase().trim() || '';
                const phoneRaw = colPhone >= 0 ? cols[colPhone] : '';
                // Extract digits from formats like "Numéro de téléphone: +1 514-446-1800"
                const phoneDigits = (phoneRaw || '').replace(/[^0-9]/g, '');
                const phone = phoneDigits.slice(-10);
                const city = (colCity >= 0 ? cols[colCity] : '') || '';
                const province = (colProvince >= 0 ? cols[colProvince] : '') || '';
                const industry = (colIndustry >= 0 ? cols[colIndustry] : '') || '';

                if (!nom || nom.length < 2) continue;
                if (!email && phone.length < 10) continue; // Need at least email or phone
                if (SKIP_EMAILS.includes(email)) continue;
                total++;

                // Dedup check
                if (email && existingEmails.has(email)) { ignores++; continue; }
                if (phone.length === 10 && existingPhones.has(phone)) { ignores++; continue; }

                // Score temperature
                let score = 0;
                if (email) score += 2;
                if (phone.length === 10) score += 2;
                if (city) score += 1;
                const temp = score >= 4 ? 'chaud' : score >= 2 ? 'tiede' : 'froid';
                const type = industry.includes('commercial') || industry.includes('auto_dealer') ? 'commercial' : 'residentiel';
                const notes = [industry, province, city].filter(Boolean).join(' — ');

                try {
                  const r = await query(
                    'INSERT INTO crm_leads (nom, telephone, email, ville, source, statut, temperature, type, notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id',
                    [nom.slice(0, 120), phone.length === 10 ? phone : null, email || null, city.slice(0, 120) || null, source, 'nouveau', temp, type, notes.slice(0, 500) || null]
                  );
                  insertedIds.push((r[0] as { id: number }).id);
                  importes++;
                  if (email) existingEmails.add(email);
                  if (phone.length === 10) existingPhones.add(phone);
                } catch { ignores++; }
              }
            } else {
              // Freeform text — use AI parsing (existing importer_leads_liste)
              const result = await executeTool('importer_leads_liste', { liste: csvText, source });
              const parsed = JSON.parse(result);
              importes = parsed.importes ?? 0;
              ignores = parsed.ignores ?? 0;
              total = parsed.total_detectes ?? 0;
            }

            // Auto-prospect imported leads
            let prospectEmails = 0;
            if (insertedIds.length > 0) {
              try {
                const baseUrl = process.env.NEXTAUTH_URL ?? 'https://novus-epoxy.vercel.app';
                const pRes = await fetch(`${baseUrl}/api/leads/jason/prospect`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ADMIN_API_KEY ?? '' },
                  body: JSON.stringify({ leadIds: insertedIds.slice(0, 50) }),
                });
                const pData = await pRes.json().catch(() => ({}));
                prospectEmails = Number((pData as Record<string, unknown>).emails ?? 0);
              } catch { /* prospect in background via cron */ }
            }

            if (importes > 0) {
              const lines = [
                `🤖 <b>Aria — Importation terminee!</b>`,
                `📄 Fichier: ${doc.file_name}`,
                ``,
                `✅ <b>${importes} leads ajoutes</b> au CRM`,
                ignores > 0 ? `⛔ ${ignores} rejetes (doublons)` : '',
                `📊 ${total} contacts detectes au total`,
                ``,
                prospectEmails > 0 ? `📧 <b>${prospectEmails} offres envoyees</b> par email` : `📧 Offres en cours d'envoi...`,
                ``,
                `📋 <b>Prochaines etapes automatiques:</b>`,
                `• 48h — Suivi #1 si pas de reponse`,
                `• 5 jours — Suivi #2 dernier rappel`,
                `• Reponse detectee — Aria closer prend le relais`,
                ``,
                `🔗 <a href="https://novus-epoxy.vercel.app/dashboard/crm">Voir dans le CRM</a>`,
              ];
              await sendTelegram(chatId, lines.filter(Boolean).join('\n'));
            } else if (total > 0) {
              await sendTelegram(chatId, `🤖 <b>Aria:</b> ${doc.file_name} — ${ignores} doublons detectes, 0 nouveaux leads.`);
            }
          }
        } catch (err) {
          console.error('[Telegram Group CSV] Import error:', err);
          await sendTelegram(chatId, `🤖 <b>Aria:</b> Erreur: ${err instanceof Error ? err.message : 'erreur inconnue'}`);
        }
        return NextResponse.json({ ok: true });
      }
    }

    const text = ((message.text ?? message.caption ?? '') as string).trim();
    if (!text || text.length < 3) return NextResponse.json({ ok: true });

    // Check if there's an active group conversation (bot asked a question recently)
    const lowerText = text.toLowerCase();
    const groupConvoKey = `tg_group_convo_${chatId}`;
    let hasActiveConvo = false;
    try {
      const convoRow = await query(`SELECT value FROM kv_store WHERE key = $1`, [groupConvoKey]);
      if (convoRow.length > 0) {
        const convoData = JSON.parse(convoRow[0].value as string);
        // Active if last bot message was less than 5 minutes ago
        if (convoData.ts && (Date.now() - convoData.ts) < 300000) {
          hasActiveConvo = true;
        }
      }
    } catch { /* no active convo */ }

    // On parle en langage naturel (pas en commandes). On déclenche le tool-use Marcel
    // sur les formulations de devis ET sur les prix forfaitaires / balcons.
    const quoteWords = ['soumission', 'devis', 'produit moi', 'créer un devis', 'creer un devis',
      'fait moi un devis', 'fais moi un devis', 'fais un devis', 'fait un devis',
      'minimum call', 'minimum', 'balcon', 'forfait', 'prix fixe', 'escalier'];
    const hasQuoteWord = quoteWords.some(w => lowerText.includes(w));
    // Prix forfaitaire pour quelqu'un : "2300 pour laurie", "1800$ au client", "1500 pour le balcon de marc"
    const hasPriceForSomeone = /\b\d{3,5}\s*\$?\s*(pour|au|a)\b/i.test(lowerText);
    const isQuoteRequest = ((hasQuoteWord || hasPriceForSomeone) && isAdmin) || (hasActiveConvo && isAdmin);
    if (isQuoteRequest) {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (apiKey) {
        try {
          if (!hasActiveConvo) await sendTelegram(chatId, '🤖 Je crée le devis...');

          // Load conversation history for context (follow-up messages)
          type ConvoMsg = { role: 'user' | 'assistant'; content: string };
          let convoHistory: ConvoMsg[] = [];
          try {
            const convoRow = await query(`SELECT value FROM kv_store WHERE key = $1`, [groupConvoKey]);
            if (convoRow.length > 0) {
              const convoData = JSON.parse(convoRow[0].value as string);
              if (convoData.history && (Date.now() - convoData.ts) < 300000) {
                convoHistory = convoData.history;
              }
            }
          } catch { /* fresh convo */ }

          // Add current message to history
          convoHistory.push({ role: 'user', content: text });

          // Use Claude to extract client info and create the quote
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
              system: `Tu es l'assistant admin de Novus Epoxy. On te parle en langage NATUREL (jamais en commandes).

DEUX façons de créer un devis:
1) creer_devis_sms — quand on donne un type de service + superficie (prix au pi²). Services: flake (8.50$/pi²), metallique (12.75$/pi²), commercial (15$/pi²), couleur_unie (7.50$/pi²), quartz (11$/pi²), antiderapant (10$/pi²), meulage (3.50$/pi²). Si type pas clair = "flake".
2) creer_devis_prix_fixe — quand on donne un MONTANT TOTAL directement (forfaitaire), typiquement après avoir vu une photo (balcon, escalier, réparation). Ex: "2300 pour Laurie" → prix=2300. "minimum call pour le balcon de Marc" → prix=1500. "1800 pour X note: 2 couches antidérapant" → prix=1800, description="2 couches antidérapant". "minimum"/"minimum call" = TOUJOURS 1500. Retrouve le client par son prénom (le tel est cherché dans le CRM). Mets toute note/description dans le champ description.

Choisis le bon outil selon ce qu'on te donne. Si pas assez d'infos, demande ce qui manque (en langage naturel, pas de commande).`,
              tools: [TOOLS[0], TOOLS[1]], // creer_devis_sms + creer_devis_prix_fixe
              messages: convoHistory,
            }),
          });

          if (claudeRes.ok) {
            const data = await claudeRes.json();
            type CB = { type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> };
            const content = data.content as CB[];
            const toolUse = content.find((b: CB) => b.type === 'tool_use');

            if (toolUse && toolUse.name === 'creer_devis_sms') {
              // Create quote as BROUILLON — don't send anything yet
              const inp = toolUse.input as Record<string, unknown>;
              const serviceKey = inp.type_service as ServiceType;
              const superficie = Number(inp.superficie);

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
                  if (!services || services.length === 0 || services.includes(serviceKey)) {
                    rabaisPct = Number(promo.rabais_pct);
                  }
                }
              } catch { /* no promo */ }

              const calc = calculateQuote(serviceKey, superficie, rabaisPct);
              const service = SERVICES[serviceKey];

              const rows = await query(
                `INSERT INTO quotes (
                  client_nom, client_email, client_tel, client_adresse,
                  type_service, superficie, couleur_flake, etat_plancher, notes,
                  prix_pied_carre, rabais_pct, rabais_montant,
                  sous_total, tps, tvq, total, depot_requis,
                  statut
                ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'brouillon')
                RETURNING id`,
                [
                  inp.client_nom, (inp.client_email as string) || '', (inp.client_tel as string) || '', (inp.client_adresse as string) || '',
                  serviceKey, superficie, (inp.couleur_flake as string) || null, (inp.etat_plancher as string) || null, (inp.notes as string) || null,
                  calc.prix_pied_carre, rabaisPct, calc.rabais_montant,
                  calc.sous_total, calc.tps, calc.tvq, calc.total, calc.depot_requis,
                ]
              );
              const quoteId = rows[0].id as number;

              const summary = [
                `📋 <b>Devis #${quoteId} cree (brouillon)</b>`,
                ``,
                `👤 ${inp.client_nom}`,
                inp.client_tel ? `📞 ${inp.client_tel}` : '',
                inp.client_email ? `📧 ${inp.client_email}` : '',
                inp.client_adresse ? `🏠 ${inp.client_adresse}` : '',
                `🔧 ${service.label} — ${superficie} pi²`,
                inp.couleur_flake ? `🎨 ${inp.couleur_flake}` : '',
                inp.etat_plancher ? `🧱 ${inp.etat_plancher}` : '',
                rabaisPct > 0 ? `🏷 Rabais ${rabaisPct}%` : '',
                ``,
                `💰 Sous-total: ${formatMoney(calc.sous_total)}`,
                `💰 Total (taxes inc.): ${formatMoney(calc.total)}`,
                `💳 Depot: ${formatMoney(calc.depot_requis)}`,
                ``,
                `⚠️ <b>En attente d'approbation</b>`,
              ].filter(Boolean).join('\n');

              const buttons = {
                inline_keyboard: [
                  [
                    { text: '✅ Approuver et envoyer', callback_data: `approve_quote_${quoteId}` },
                    { text: '❌ Rejeter', callback_data: `reject_quote_${quoteId}` },
                  ],
                  [
                    { text: '📋 Modifier', url: `https://novus-epoxy.vercel.app/dashboard/devis/${quoteId}` },
                  ],
                ],
              };

              await fetch(`https://api.telegram.org/bot${BOT_TOKEN()}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chat_id: chatId, text: summary, parse_mode: 'HTML', reply_markup: buttons }),
              });
              // Clear conversation after quote created
              await query(`DELETE FROM kv_store WHERE key = $1`, [groupConvoKey]).catch(() => {});
            } else if (toolUse && toolUse.name === 'creer_devis_prix_fixe') {
              // Flat-price quote (balcon/escalier/réparation, prix décidé après photo)
              const inp = toolUse.input as Record<string, unknown>;
              const clientNom = String(inp.client_nom || '').trim();
              let clientTel = String(inp.client_tel || '').replace(/\D/g, '').slice(-10);
              let clientEmail = ''; let adresse = '';
              if (!clientTel && clientNom) {
                const lead = await query(`SELECT telephone, email, adresse FROM crm_leads WHERE nom ILIKE $1 ORDER BY created_at DESC LIMIT 1`, [`%${clientNom}%`]);
                if (lead[0]) { clientTel = String(lead[0].telephone || '').replace(/\D/g, '').slice(-10); clientEmail = (lead[0].email as string) || ''; adresse = (lead[0].adresse as string) || ''; }
              }
              const prix = Number(inp.prix);
              if (!clientTel) {
                await sendTelegram(chatId, `❓ Je trouve pas le numéro de "${clientNom}". Donne-moi son tél et je prépare le devis.`);
              } else if (!Number.isFinite(prix) || prix <= 0) {
                await sendTelegram(chatId, `❓ C'est quoi le montant? (ex: 2300, ou "minimum call" = 1500$)`);
              } else {
                const calc = calculateQuoteCustomPrice(prix);
                const serviceLabel = String(inp.service_label || 'Travaux sur mesure').slice(0, 120);
                const description = String(inp.description || '').slice(0, 2000) || null;
                const rows = await query(
                  `INSERT INTO quotes (client_nom, client_email, client_tel, client_adresse, type_service, superficie, notes, description_travaux, prix_pied_carre, sous_total, tps, tvq, total, depot_requis, statut)
                   VALUES ($1,$2,$3,$4,'commercial',0,$5,$6,0,$7,$8,$9,$10,$11,'brouillon') RETURNING id`,
                  [clientNom, clientEmail, clientTel, adresse, serviceLabel, description, calc.sous_total, calc.tps, calc.tvq, calc.total, calc.depot_requis]
                );
                const quoteId = rows[0].id as number;
                const summary = [
                  `📋 <b>Devis #${quoteId} créé (prix fixe, brouillon)</b>`,
                  ``,
                  `👤 ${clientNom}`,
                  `📞 ${clientTel}`,
                  `🔧 ${serviceLabel}`,
                  description ? `📝 ${description}` : '',
                  ``,
                  `💰 Forfait: ${formatMoney(calc.sous_total)}`,
                  `💰 Total (taxes inc.): ${formatMoney(calc.total)}`,
                  `💳 Dépôt: ${formatMoney(calc.depot_requis)}`,
                  ``,
                  `⚠️ <b>Approuve pour l'envoyer au client</b>`,
                ].filter(Boolean).join('\n');
                const buttons = { inline_keyboard: [
                  [ { text: '✅ Approuver et envoyer', callback_data: `approve_quote_${quoteId}` }, { text: '❌ Rejeter', callback_data: `reject_quote_${quoteId}` } ],
                  [ { text: '📋 Modifier', url: `https://novus-epoxy.vercel.app/dashboard/devis/${quoteId}` } ],
                ]};
                await fetch(`https://api.telegram.org/bot${BOT_TOKEN()}/sendMessage`, {
                  method: 'POST', headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ chat_id: chatId, text: summary, parse_mode: 'HTML', reply_markup: buttons }),
                });
                await query(`DELETE FROM kv_store WHERE key = $1`, [groupConvoKey]).catch(() => {});
              }
            } else {
              // Claude responded with text (asking for more info) — save conversation
              const textBlock = content.find((b: CB) => b.type === 'text');
              if (textBlock?.text) {
                await sendTelegram(chatId, textBlock.text);
                convoHistory.push({ role: 'assistant', content: textBlock.text });
                // Save conversation so next message continues the flow
                await query(
                  `INSERT INTO kv_store (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2`,
                  [groupConvoKey, JSON.stringify({ history: convoHistory, ts: Date.now() })]
                ).catch(() => {});
              }
            }
          } else {
            await sendTelegram(chatId, '❌ Erreur API Claude');
          }
        } catch (err) {
          console.error('[Telegram Group Quote]', err);
          await sendTelegram(chatId, `❌ Erreur: ${err instanceof Error ? err.message : 'erreur inconnue'}`);
        }
      }
      return NextResponse.json({ ok: true });
    }

    // If message starts with "Aria rapport" — generate Google Sheets report via Composio
    const rapportMatch = text.match(/^aria[\s,!?:]+rapport\s*(crm|revenue|revenus?|heures?)?/i);
    if (rapportMatch) {
      const reportType = /revenue|revenu/i.test(rapportMatch[1] ?? '') ? 'revenue' : 'crm';
      await sendTelegram(chatId, `🤖 <b>Aria:</b> Je génère le rapport ${reportType.toUpperCase()} dans Google Sheets, une seconde...`);
      try {
        const base = process.env.NEXTAUTH_URL ?? 'https://novus-epoxy.srv1478812.hstgr.cloud';
        const adminKey = process.env.ADMIN_API_KEY ?? '';
        const res = await fetch(`${base}/api/composio/sheets-report`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Cookie': '' },
          body: JSON.stringify({ type: reportType }),
        });
        if (res.ok) {
          const data = await res.json() as { url?: string; title?: string; error?: string };
          if (data.url) {
            await sendTelegram(chatId, `✅ <b>Rapport prêt!</b>\n\n📊 ${data.title}\n\n🔗 <a href="${data.url}">Ouvrir dans Google Sheets</a>`);
          } else {
            await sendTelegram(chatId, `❌ Rapport échoué: ${data.error ?? 'erreur inconnue'} — connecte Google Sheets dans le dashboard`);
          }
        } else {
          await sendTelegram(chatId, `❌ Rapport échoué — connecte Google Sheets via /dashboard/settings d'abord`);
        }
      } catch (err) {
        await sendTelegram(chatId, `❌ Erreur rapport: ${err instanceof Error ? err.message : 'erreur inconnue'}`);
      }
      return NextResponse.json({ ok: true });
    }

    // If message starts with "Aria" — respond as Aria in the group
    const startsWithAria = /^aria[\s,!?:]/i.test(text);
    if (startsWithAria) {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (apiKey) {
        try {
          // Get recent CRM stats for context
          const leadCount = await query(`SELECT COUNT(*)::int AS c FROM crm_leads`);
          const pendingProspect = await query(`SELECT COUNT(*)::int AS c FROM crm_leads WHERE prospect_sent_at IS NOT NULL AND statut = 'offre_envoyee'`);
          const todayImported = await query(`SELECT COUNT(*)::int AS c FROM crm_leads WHERE created_at >= CURRENT_DATE`);
          const hotLeads = await query(`SELECT COUNT(*)::int AS c FROM crm_leads WHERE temperature = 'chaud' AND statut NOT IN ('ferme', 'gagne')`);

          const context = `CRM: ${leadCount[0]?.c || 0} leads total, ${todayImported[0]?.c || 0} importes aujourd'hui, ${pendingProspect[0]?.c || 0} offres envoyees en attente, ${hotLeads[0]?.c || 0} leads chauds actifs.`;

          try {
            const reply = await callLLM({
              system: `Tu es Aria, l'assistante IA de Novus Epoxy (planchers epoxy, Quebec). Tu reponds dans un groupe Telegram avec Luca (patron), Jason (chantier), et le bot de Jason. Sois concise, utile, en francais quebecois. Tu geres le CRM, les offres de service, les relances. Voici le contexte actuel:\n${context}\n\nReponds en 2-3 phrases max. Pas de markdown complexe, juste du texte simple.`,
              messages: [{ role: 'user', content: text.replace(/^aria[\s,!?:]*/i, '').trim() }],
              maxTokens: 500,
              tier: 'fast',
            });
            if (reply) await sendTelegram(chatId, `🤖 <b>Aria:</b> ${reply}`);
          } catch { /* ignore errors */ }
        } catch { /* ignore errors */ }
      }
      return NextResponse.json({ ok: true });
    }

    // Check if message is about HOURS for a project
    // Patterns: "3h luca, 3h jason projet #17", "projet #5 2h stephane", "3h chaque projet #17"
    const projetMatch = text.match(/(?:projet\s*#?\s*|#)(\d+)/i);
    const heurePatterns = text.match(/(\d+(?:[.,]\d+)?)\s*h(?:eure)?s?\s+(?:pour\s+|de\s+)?([a-zéèêëàâùûôïî]+)/gi) || [];
    const chaqueMatch = text.match(/(\d+(?:[.,]\d+)?)\s*h(?:eure)?s?\s+chaque/i);
    const isHoursMessage = projetMatch && (heurePatterns.length > 0 || chaqueMatch);

    if (isHoursMessage) {
      try {
        const quoteId = parseInt(projetMatch[1]);
        const proj = await query(`SELECT id, client_nom FROM quotes WHERE id = $1`, [quoteId]);
        if (proj.length === 0) {
          await sendTelegram(chatId, `Projet #${quoteId} introuvable.`);
          return NextResponse.json({ ok: true });
        }
        const clientNom = (proj[0] as { client_nom: string }).client_nom;
        const dateTravail = new Date().toISOString().slice(0, 10);
        const registered: string[] = [];

        if (chaqueMatch) {
          // "3h chaque projet #17" — apply to all active employees
          const h = parseFloat(chaqueMatch[1].replace(',', '.'));
          const activeEmps = await query(`SELECT id, nom FROM employees WHERE actif = true`);
          for (const emp of activeEmps) {
            await query(
              `INSERT INTO time_entries (employee_id, quote_id, date_travail, heures, type) VALUES ($1,$2,$3,$4,'travail')`,
              [(emp as { id: number }).id, quoteId, dateTravail, h]
            );
            registered.push(`${(emp as { nom: string }).nom}: ${h}h`);
          }
        } else {
          // Parse individual: "3h luca, 2h jason"
          for (const match of heurePatterns) {
            const m = match.match(/(\d+(?:[.,]\d+)?)\s*h(?:eure)?s?\s+(?:pour\s+|de\s+)?([a-zéèêëàâùûôïî]+)/i);
            if (!m) continue;
            const h = parseFloat(m[1].replace(',', '.'));
            const nom = m[2];
            let empRows = await query(
              `SELECT id, nom FROM employees WHERE LOWER(nom) LIKE $1 AND actif = true LIMIT 1`,
              [`%${nom.toLowerCase()}%`]
            );
            if (empRows.length === 0) {
              empRows = await query(
                `INSERT INTO employees (nom, role, taux_horaire) VALUES ($1, 'sous-traitant', 0) RETURNING id, nom`,
                [nom.charAt(0).toUpperCase() + nom.slice(1)]
              );
            }
            await query(
              `INSERT INTO time_entries (employee_id, quote_id, date_travail, heures, type) VALUES ($1,$2,$3,$4,'travail')`,
              [(empRows[0] as { id: number }).id, quoteId, dateTravail, h]
            );
            registered.push(`${(empRows[0] as { nom: string }).nom}: ${h}h`);
          }
        }

        if (registered.length > 0) {
          // Get project totals
          const projetTotaux = await query(
            `SELECT e.nom, SUM(t.heures)::numeric as total FROM time_entries t JOIN employees e ON e.id = t.employee_id WHERE t.quote_id = $1 GROUP BY e.nom ORDER BY e.nom`,
            [quoteId]
          );
          const projetTotal = projetTotaux.reduce((s: number, r: Record<string, unknown>) => s + Number(r.total || 0), 0);

          // Get week totals
          const now2 = new Date();
          const day2 = now2.getDay();
          const diff2 = day2 === 0 ? 6 : day2 - 1;
          const mon = new Date(now2); mon.setDate(now2.getDate() - diff2);
          const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
          const semaineTotaux = await query(
            `SELECT e.nom, SUM(t.heures)::numeric as total FROM time_entries t JOIN employees e ON e.id = t.employee_id WHERE t.date_travail >= $1 AND t.date_travail <= $2 GROUP BY e.nom ORDER BY e.nom`,
            [mon.toISOString().slice(0, 10), sun.toISOString().slice(0, 10)]
          );
          const semaineTotal = semaineTotaux.reduce((s: number, r: Record<string, unknown>) => s + Number(r.total || 0), 0);

          const lines = [
            `✅ <b>Heures enregistrees — Projet #${quoteId}</b>`,
            `📋 ${clientNom}`,
            `📅 ${dateTravail}`,
            ``,
            `<b>Aujourd'hui:</b>`,
            ...registered.map(r => `  • ${r}`),
            ``,
            `<b>Total projet #${quoteId}:</b>`,
            ...projetTotaux.map((r: Record<string, unknown>) => `  • ${r.nom}: ${r.total}h`),
            `  → <b>${projetTotal}h total</b>`,
            ``,
            `<b>Semaine (${mon.toISOString().slice(5, 10)} au ${sun.toISOString().slice(5, 10)}):</b>`,
            ...semaineTotaux.map((r: Record<string, unknown>) => `  • ${r.nom}: ${r.total}h`),
            `  → <b>${semaineTotal}h total</b>`,
          ];
          await sendTelegram(chatId, lines.join('\n'));
        }
      } catch (err) {
        console.error('Group hours error:', err);
        await sendTelegram(chatId, `Erreur heures: ${err instanceof Error ? err.message : 'erreur'}`);
      }
      return NextResponse.json({ ok: true });
    }

    // Check if message looks like a BULK lead list (multiple contacts)
    // Must have 3+ lines with phone numbers to avoid false positives on normal conversation
    if (text.length < 30) return NextResponse.json({ ok: true });
    const phoneMatches = (text.match(/\d{3}[\s.\-]?\d{3}[\s.\-]?\d{4}/g) || []);
    const hasMultiplePhones = phoneMatches.length >= 2;
    const hasMultipleLines = text.split('\n').filter((l: string) => l.trim().length > 5).length >= 3;
    const looksLikeLeads = hasMultiplePhones && hasMultipleLines;

    if (looksLikeLeads) {
      // Parse leads with LLM
      try {
        {
          const raw = (await callLLM({
            messages: [{ role: 'user', content: `Parse cette liste de leads pour une entreprise de planchers epoxy au Quebec. Extrait chaque personne.\n\nLISTE:\n${text.slice(0, 8000)}\n\nSi ce n'est PAS une liste de leads/contacts (c'est une conversation normale, une question, etc.), reponds juste: []\n\nSinon reponds UNIQUEMENT avec un JSON array:\n[{"nom":"Prenom Nom","telephone":"10 chiffres ou vide","email":"email ou vide","service":"flake|metallique|commercial|quartz ou vide","superficie":"nombre ou vide","ville":"ville ou vide","notes":"autres infos ou vide"}]` }],
            maxTokens: 4000,
            tier: 'fast',
          })).replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
          type ParsedLead = { nom: string; telephone: string; email: string; service: string; superficie: string; ville: string; notes: string };
          let leads: ParsedLead[] = [];
          try { const arr = JSON.parse(raw); leads = Array.isArray(arr) ? arr : []; } catch { /* not leads */ }

            if (leads.length > 0) {
              // Score temperature
              function scoreTemp(lead: ParsedLead): 'chaud' | 'tiede' | 'froid' {
                let score = 0;
                if (lead.email) score += 2;
                if (lead.telephone) score += 2;
                if (lead.service) score += 1;
                if (lead.superficie) score += 1;
                if (lead.ville) score += 1;
                const t = `${lead.notes} ${lead.service}`.toLowerCase();
                if (t.includes('urgent') || t.includes('bientot') || t.includes('soumission')) score += 3;
                if (score >= 6) return 'chaud';
                if (score >= 3) return 'tiede';
                return 'froid';
              }

              // Anti-doublon: check existing by phone or email
              let imported = 0;
              let skipped = 0;

              for (const lead of leads) {
                if (!lead.nom || lead.nom.trim().length < 2) continue;
                const phone = (lead.telephone || '').replace(/\D/g, '').slice(-10);
                const email = (lead.email || '').toLowerCase().trim();

                // Check duplicates
                if (phone.length === 10) {
                  const existing = await query(`SELECT id FROM crm_leads WHERE telephone LIKE $1 LIMIT 1`, [`%${phone.slice(-7)}%`]);
                  if (existing.length > 0) { skipped++; continue; }
                }
                if (email.includes('@')) {
                  const existing = await query(`SELECT id FROM crm_leads WHERE LOWER(email) = LOWER($1) LIMIT 1`, [email]);
                  if (existing.length > 0) { skipped++; continue; }
                }

                const temp = scoreTemp(lead);
                await query(
                  `INSERT INTO crm_leads (nom, telephone, email, service, superficie, ville, notes, source, statut, temperature)
                   VALUES ($1,$2,$3,$4,$5,$6,$7,'jason','nouveau',$8)`,
                  [lead.nom.trim().slice(0, 120), phone || null, email || null, lead.service || null, lead.superficie || null, (lead.ville || '').slice(0, 120) || null, lead.notes || null, temp]
                );
                imported++;
              }

              // Auto-prospect: send offers by EMAIL only (no SMS)
              let emailsSent = 0;
              let noEmailCount = 0;
              if (imported > 0) {
                const newLeads = await query(
                  `SELECT id, email FROM crm_leads WHERE source = 'jason' AND prospect_sent_at IS NULL ORDER BY id DESC LIMIT $1`,
                  [imported]
                );
                const withEmail = newLeads.filter((r: Record<string, unknown>) => r.email);
                noEmailCount = newLeads.length - withEmail.length;
                if (withEmail.length > 0) {
                  const baseUrl = process.env.NEXTAUTH_URL ?? 'https://novus-epoxy.vercel.app';
                  try {
                    const prospectRes = await fetch(`${baseUrl}/api/leads/jason/prospect`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ADMIN_API_KEY ?? '' },
                      body: JSON.stringify({ leadIds: withEmail.map((r: Record<string, unknown>) => r.id) }),
                    });
                    const prospectData = await prospectRes.json().catch(() => ({}));
                    emailsSent = (prospectData as Record<string, number>).sent ?? withEmail.length;
                  } catch { /* best effort */ }
                }
              }

              // Notify in the GROUP — detailed report
              const hotCount = leads.filter(l => scoreTemp(l) === 'chaud').length;
              const warmCount = leads.filter(l => scoreTemp(l) === 'tiede').length;
              const coldCount = leads.filter(l => scoreTemp(l) === 'froid').length;
              const lines = [
                `🤖 <b>Aria — Importation terminee!</b>`,
                ``,
                `✅ <b>${imported} leads ajoutes</b> au CRM`,
                skipped > 0 ? `⛔ <b>${skipped} rejetes</b> (doublons deja dans le CRM)` : `⛔ <b>0 rejetes</b> — aucun doublon`,
                ``,
                `🔥 Chauds: ${hotCount} | 🟡 Tiedes: ${warmCount} | 🔵 Froids: ${coldCount}`,
                ``,
                `📧 <b>${emailsSent} offres de service envoyees</b> par email`,
                noEmailCount > 0 ? `⚠️ ${noEmailCount} leads sans email — pas d'offre envoyee` : '',
                ``,
                `📋 <b>Prochaines etapes automatiques:</b>`,
                `• 48h — Suivi #1 si pas de reponse`,
                `• 5 jours — Suivi #2 dernier rappel`,
                `• Reponse detectee — Aria closer prend le relais`,
                ``,
                `Tout roule! 🔗 <a href="https://novus-epoxy.vercel.app/dashboard/crm">Voir dans le CRM</a>`,
              ];
              await sendTelegram(chatId, lines.filter(Boolean).join('\n'));
            }
          }
      } catch (err) {
        console.error('[Telegram Group] Lead import error:', err);
      }
    }
    return NextResponse.json({ ok: true });
  } // end else (not photo/video in group)
  } // end isGroup

  // PRIVATE MESSAGE: Check if sender is an admin
  if (adminIds.length > 0 && !isAdmin) {
    await sendTelegram(chatId, "Acces refuse. Ce bot est reserve aux admins Novus Epoxy.");
    return NextResponse.json({ ok: true });
  }

  // Handle video messages — portfolio only
  if (message.video || message.video_note) {
    const video = message.video || message.video_note;
    const fileId = video.file_id;
    const caption = (message.caption ?? '').trim();
    const captionLower = caption.toLowerCase();

    const fileRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN()}/getFile?file_id=${fileId}`);
    const fileData = await fileRes.json();
    const filePath = fileData.result?.file_path;

    if (!filePath) {
      await sendTelegram(chatId, 'Erreur: impossible de telecharger la video.');
      return NextResponse.json({ ok: true });
    }

    // Check file size (Telegram Bot API limit: 20MB download)
    const fileSize = video.file_size || 0;
    if (fileSize > 20 * 1024 * 1024) {
      await sendTelegram(chatId, 'Video trop grosse (max 20MB via Telegram). Envoie une video plus courte.');
      return NextResponse.json({ ok: true });
    }

    const downloadRes = await fetch(`https://api.telegram.org/file/bot${BOT_TOKEN()}/${filePath}`);
    const videoBuffer = Buffer.from(await downloadRes.arrayBuffer());

    try {
      const { put } = await import('@vercel/blob');
      const ext = filePath.split('.').pop() || 'mp4';
      const contentType = ext === 'mov' ? 'video/quicktime' : 'video/mp4';
      const slug = `portfolio/video-${Date.now()}.${ext}`;
      const blob = await put(slug, videoBuffer, { access: 'public', contentType });

      const titre = caption.replace(/^(portfolio|galerie|projet|realisation|réalisation|video|vidéo)\s*/i, '').trim() || 'Video projet';
      const typeService = captionLower.includes('flake') ? 'flake'
        : captionLower.includes('commercial') ? 'commercial'
        : captionLower.includes('couleur') ? 'couleur_unie'
        : 'metallique';

      // Check for duplicate video
      const existing = await query(
        `SELECT id FROM portfolio WHERE LOWER(titre) = LOWER($1) AND type_service = $2 LIMIT 1`,
        [titre, typeService]
      );
      if (existing.length > 0) {
        // Add video to existing portfolio entry
        await query(`UPDATE portfolio SET videos = array_append(videos, $1) WHERE id = $2`, [blob.url, existing[0].id]);
        await sendTelegram(chatId, `Video ajoutee au portfolio #${existing[0].id} existant!\n\nVideo: ${blob.url}`);
      } else {
        const rows = await query(
          `INSERT INTO portfolio (titre, description, type_service, videos, featured)
           VALUES ($1, $2, $3, $4, false) RETURNING id`,
          [titre, 'Video ajoutee via Telegram', typeService, [blob.url]]
        );
        const id = rows[0].id;
        await sendTelegram(chatId, [
          `Portfolio #${id} — video ajoutee!`,
          ``,
          `${titre}`,
          `Type: ${typeService}`,
          ``,
          `Video: ${blob.url}`,
        ].filter(Boolean).join('\n'));
      }
    } catch (err) {
      console.error('Video upload error:', err);
      await sendTelegram(chatId, `Erreur upload video: ${err instanceof Error ? err.message : 'erreur inconnue'}`);
    }
    return NextResponse.json({ ok: true });
  }

  // Handle document uploads — CSV/TXT file = bulk lead import
  if (message.document) {
    const doc = message.document;
    const fileName = (doc.file_name ?? '').toLowerCase();
    const isLeadFile = fileName.endsWith('.csv') || fileName.endsWith('.txt') || fileName.endsWith('.xlsx') || (message.caption ?? '').toLowerCase().includes('lead');

    if (!isLeadFile) {
      await sendTelegram(chatId, `Fichier recu: ${doc.file_name}.\nPour importer des leads, envoie un fichier .csv ou .txt (ou ajoute la caption "leads").`);
      return NextResponse.json({ ok: true });
    }

    if (doc.file_size > 5 * 1024 * 1024) {
      await sendTelegram(chatId, 'Fichier trop grand (max 5MB).');
      return NextResponse.json({ ok: true });
    }

    await sendTelegram(chatId, `🤖 <b>Aria:</b> Bien recu! Je commence l'importation de ${doc.file_name} maintenant...`);

    const fileRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN()}/getFile?file_id=${doc.file_id}`);
    const fileData = await fileRes.json();
    const filePath = fileData.result?.file_path;
    if (!filePath) {
      await sendTelegram(chatId, 'Erreur: impossible de telecharger le fichier.');
      return NextResponse.json({ ok: true });
    }

    const dlRes = await fetch(`https://api.telegram.org/file/bot${BOT_TOKEN()}/${filePath}`);
    const fileText = await dlRes.text();

    const caption = (message.caption ?? '').toLowerCase();
    const source = caption.includes('champfield') ? 'champfield'
      : caption.includes('google') ? 'google_ads'
      : caption.includes('facebook') || caption.includes('meta') ? 'facebook'
      : 'jason';

    // Use the importer tool directly (no truncation — chunked parsing handles large files)
    const importResult = await executeTool('importer_leads_liste', { liste: fileText, source });
    const result = JSON.parse(importResult);

    if (result.error) {
      await sendTelegram(chatId, `❌ Erreur import: ${result.error}`);
    } else {
      await sendTelegram(chatId, [
        `🤖 <b>Aria — Importation terminee!</b>`,
        ``,
        `✅ <b>${result.importes} leads ajoutes</b> au CRM`,
        result.ignores > 0 ? `⛔ <b>${result.ignores} rejetes</b> (doublons)` : `⛔ <b>0 rejetes</b>`,
        `📌 Source: ${result.source}`,
        ``,
        result.prospect ? `📧 <b>${result.prospect.emails} offres envoyees</b> par email` : '',
        ``,
        `📋 <b>Prochaines etapes automatiques:</b>`,
        `• 48h — Suivi #1 si pas de reponse`,
        `• 5 jours — Suivi #2 dernier rappel`,
        `• Reponse detectee — Aria closer prend le relais`,
        ``,
        `Tout roule! 🔗 <a href="${result.dashboard}">Voir dans le CRM</a>`,
      ].filter(Boolean).join('\n'));
    }
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

    // --- SMART ANALYSIS: Claude decides if it's a receipt or portfolio ---
    const base64 = imageBuffer.toString('base64');
    const mediaType = filePath.endsWith('.png') ? 'image/png' : 'image/jpeg';
    const apiKey = process.env.ANTHROPIC_API_KEY;

    if (!apiKey) {
      await sendTelegram(chatId, 'ANTHROPIC_API_KEY non configure.');
      return NextResponse.json({ ok: true });
    }

    await sendTelegram(chatId, 'Analyse en cours...');

    // Step 1: Ask Claude to classify the image
    const classifyRes = await fetch('https://api.anthropic.com/v1/messages', {
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
            { type: 'text', text: `Analyse cette image. Caption de l'envoyeur: "${caption}"

C'est une entreprise de planchers epoxy (Novus Epoxy). Determine ce que c'est:
- "recu" si c'est une facture, recu, ticket de caisse, bon de commande, releve
- "chantier" si la caption mentionne un numero de projet (ex: "projet #17", "#5") ET c'est une photo de chantier/travaux (avant ou apres)
- "portfolio" si c'est un plancher epoxy, un chantier, un balcon, un escalier, un garage, un travail fini — SANS numero de projet
- "autre" si c'est autre chose (screenshot, meme, photo perso, etc)

Reponds en JSON strict:
{
  "type": "recu" ou "portfolio" ou "chantier" ou "autre",
  "titre": "titre descriptif court",
  "description": "description 1-2 phrases",
  "photo_type": "avant" ou "apres" (seulement si chantier — avant=en cours/pas commence, apres=fini/resultat),
  "type_service": "flake" ou "metallique" ou "couleur_unie" ou "commercial" ou "quartz" (seulement si portfolio ou chantier),
  "fournisseur": "nom du fournisseur" (seulement si recu),
  "montant_ttc": nombre (seulement si recu),
  "montant_ht": nombre (seulement si recu),
  "tps": nombre (seulement si recu),
  "tvq": nombre (seulement si recu),
  "date_depense": "YYYY-MM-DD" (seulement si recu),
  "categorie": "materiaux/sous_traitance/transport/equipement/marketing/loyer/assurance/admin/autre" (seulement si recu),
  "reference": "numero de facture ou null" (seulement si recu),
  "ville": "ville ou null" (seulement si portfolio),
  "superficie": nombre en pi2 ou 0 (seulement si portfolio)
}` },
          ],
        }],
      }),
    });

    if (!classifyRes.ok) {
      const errText = await classifyRes.text();
      console.error('Claude classify error:', errText);
      await sendTelegram(chatId, 'Erreur API Claude. Reessaie.');
      return NextResponse.json({ ok: true });
    }

    const classifyData = await classifyRes.json();
    const classifyText = classifyData.content?.[0]?.text ?? '';
    let classified;
    try {
      classified = JSON.parse(classifyText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim());
    } catch {
      await sendTelegram(chatId, 'Erreur analyse image. Reessaie.');
      return NextResponse.json({ ok: true });
    }

    // --- PORTFOLIO ---
    if (classified.type === 'portfolio') {
      try {
        const { put } = await import('@vercel/blob');
        const slug = `portfolio/photo-${Date.now()}.jpg`;
        const blob = await put(slug, imageBuffer, { access: 'public', contentType: 'image/jpeg' });

        // Check for duplicates (same title + same type = likely duplicate)
        const existing = await query(
          `SELECT id FROM portfolio WHERE LOWER(titre) = LOWER($1) AND type_service = $2 LIMIT 1`,
          [classified.titre || 'Nouveau projet', classified.type_service || 'metallique']
        );
        if (existing.length > 0) {
          await sendTelegram(chatId, `Doublon detecte! Portfolio #${existing[0].id} a deja le meme titre.\n\nPhoto uploadee quand meme: ${blob.url}\nSi c'est une photo supplementaire du meme projet, je peux l'ajouter — dis-moi.`);
          return NextResponse.json({ ok: true });
        }

        const rows = await query(
          `INSERT INTO portfolio (titre, description, type_service, superficie, ville, photos, featured)
           VALUES ($1, $2, $3, $4, $5, $6, false) RETURNING id`,
          [classified.titre || 'Nouveau projet', classified.description || '', classified.type_service || 'metallique', classified.superficie || null, classified.ville || null, [blob.url]]
        );

        const id = rows[0].id;
        await sendTelegram(chatId, [
          `Portfolio #${id} ajoute!`,
          ``,
          classified.titre || '',
          classified.description || '',
          `Type: ${classified.type_service || 'metallique'}`,
          classified.ville ? `Ville: ${classified.ville}` : '',
          classified.superficie ? `Surface: ${classified.superficie} pi²` : '',
          ``,
          `Photo: ${blob.url}`,
        ].filter(Boolean).join('\n'));
      } catch (err) {
        console.error('Portfolio save error:', err);
        await sendTelegram(chatId, `Erreur portfolio: ${err instanceof Error ? err.message : 'erreur inconnue'}`);
      }
      return NextResponse.json({ ok: true });
    }

    // --- CHANTIER (photo avant/apres liee a un projet) ---
    if (classified.type === 'chantier') {
      try {
        // Extract project ID from caption
        const projetMatch = (caption || '').match(/(?:projet\s*#?\s*|#)(\d+)/i);
        if (!projetMatch) {
          await sendTelegram(chatId, `Photo de chantier detectee mais pas de numero de projet.\nRenvoie avec caption "projet #17 avant" ou "projet #17 apres".`);
          return NextResponse.json({ ok: true });
        }
        const jobQuoteId = parseInt(projetMatch[1]);
        const proj = await query(`SELECT id, client_nom FROM quotes WHERE id = $1`, [jobQuoteId]);
        if (proj.length === 0) {
          await sendTelegram(chatId, `Projet #${jobQuoteId} introuvable. Verifie le numero.`);
          return NextResponse.json({ ok: true });
        }

        const { put } = await import('@vercel/blob');
        const photoType = classified.photo_type === 'apres' ? 'apres' : 'avant';
        const slug = `job-photos/projet-${jobQuoteId}-${photoType}-${Date.now()}.jpg`;
        const blob = await put(slug, imageBuffer, { access: 'public', contentType: 'image/jpeg' });

        await query(
          `INSERT INTO job_photos (quote_id, type, url, filename) VALUES ($1, $2, $3, $4)`,
          [jobQuoteId, photoType, blob.url, slug]
        );

        const clientNom = (proj[0] as { client_nom: string }).client_nom;
        const photoCount = await query(
          `SELECT type, COUNT(*)::int as count FROM job_photos WHERE quote_id = $1 GROUP BY type`, [jobQuoteId]
        );
        const counts = photoCount.reduce((acc: Record<string, number>, r: Record<string, unknown>) => {
          acc[r.type as string] = r.count as number; return acc;
        }, {} as Record<string, number>);

        await sendTelegram(chatId, [
          `Photo ${photoType.toUpperCase()} ajoutee au projet #${jobQuoteId}!`,
          `Client: ${clientNom}`,
          ``,
          `Photos du projet: ${counts['avant'] || 0} avant / ${counts['apres'] || 0} apres`,
          ``,
          blob.url,
        ].join('\n'));
      } catch (err) {
        console.error('Job photo save error:', err);
        await sendTelegram(chatId, `Erreur: ${err instanceof Error ? err.message : 'erreur inconnue'}`);
      }
      return NextResponse.json({ ok: true });
    }

    // --- AUTRE (pas recu, pas portfolio, pas chantier) ---
    if (classified.type === 'autre') {
      await sendTelegram(chatId, `J'ai vu ta photo mais je ne sais pas quoi en faire.\n\n"${classified.description || classified.titre || 'Image non reconnue'}"\n\nSi c'est un recu, renvoie avec caption "recu".\nSi c'est un projet, renvoie avec caption "portfolio".`);
      return NextResponse.json({ ok: true });
    }

    // --- RECEIPT MODE (classified.type === 'recu') ---

    // Determine payment method from caption
    let methode = 'carte';
    if (captionLower.includes('comptant') || captionLower.includes('cash')) methode = 'comptant';
    else if (captionLower.includes('cheque') || captionLower.includes('chèque')) methode = 'cheque';
    else if (captionLower.includes('virement') || captionLower.includes('transfert')) methode = 'virement';
    else if (captionLower.includes('debit') || captionLower.includes('débit') || captionLower.includes('interac')) methode = 'debit';

    // Use data already extracted by Claude in the classify step
    const parsed = classified;

    try {

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

      // Extract project ID from caption: "projet #17", "projet 17", "#17"
      let expQuoteId: number | null = null;
      const projetMatch = (caption || '').match(/(?:projet\s*#?\s*|#)(\d+)/i);
      if (projetMatch) {
        expQuoteId = parseInt(projetMatch[1]);
        // Verify project exists
        const proj = await query(`SELECT id, client_nom FROM quotes WHERE id = $1`, [expQuoteId]);
        if (proj.length === 0) { expQuoteId = null; }
      }

      // Store receipt photo in Vercel Blob
      let receiptUrl: string | null = null;
      try {
        const { put } = await import('@vercel/blob');
        const blob = await put(`receipts/facture-${Date.now()}.jpg`, imageBuffer, { access: 'public', contentType: 'image/jpeg' });
        receiptUrl = blob.url;
      } catch (blobErr) {
        console.error('Receipt blob upload failed:', blobErr);
      }

      const rows = await query(
        `INSERT INTO expenses (date_depense, fournisseur, description, categorie, montant_ht, tps, tvq, montant_ttc, methode, reference, quote_id, receipt_url)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
        [
          parsed.date_depense || new Date().toISOString().slice(0, 10),
          (parsed.fournisseur || 'Inconnu').slice(0, 120),
          parsed.description || null,
          categorie,
          ht, tps, tvq, ttc,
          methode,
          parsed.reference || null,
          expQuoteId,
          receiptUrl,
        ]
      );

      const CAT_LABEL: Record<string, string> = {
        materiaux: 'Materiaux', sous_traitance: 'Sous-traitance', transport: 'Transport',
        equipement: 'Equipement', marketing: 'Marketing', loyer: 'Loyer',
        assurance: 'Assurance', admin: 'Administration', autre: 'Autre',
      };

      const expId = rows[0].id;
      const confirmLines = [
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
      ].filter(Boolean).join('\n');

      // If not linked to a project, ask which project via inline buttons
      if (!expQuoteId) {
        const recentProjects = await query(
          `SELECT id, client_nom, type_service FROM quotes WHERE statut IN ('planifie','en_cours','complete','depot_paye') ORDER BY created_at DESC LIMIT 5`
        );
        const botToken = process.env.TELEGRAM_BOT_TOKEN;
        if (botToken && recentProjects.length > 0) {
          const buttons = recentProjects.map((p: Record<string, unknown>) => ([{
            text: `#${p.id} ${String(p.client_nom).slice(0, 20)}`,
            callback_data: `assign_expense_${expId}_proj_${p.id}`,
          }]));
          buttons.push([{ text: 'Aucun projet', callback_data: `assign_expense_${expId}_none` }]);
          await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              text: confirmLines + '\n\n⚠️ Pas de projet detecte — a quel projet lier cette depense?',
              reply_markup: { inline_keyboard: buttons },
            }),
          });
        } else {
          await sendTelegram(chatId, confirmLines);
        }
      } else {
        await sendTelegram(chatId, confirmLines + `\n\nProjet: #${expQuoteId}`);
      }

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

    // Load conversation history from DB (last 10 messages per chat)
    const historyKey = `tg_history_${chatId}`;
    let history: ClaudeMessage[] = [];
    try {
      const histRow = await query(`SELECT value FROM kv_store WHERE key = $1`, [historyKey]);
      if (histRow.length > 0) history = JSON.parse(histRow[0].value as string);
    } catch { /* start fresh */ }

    let messages: ClaudeMessage[] = [...history, { role: 'user', content: text }];

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

        // Auto-fix: if history is corrupted (tool_use_id mismatch), clear it and retry once
        if ((err.includes('tool_use_id') || err.includes('tool_result')) && iterations <= 1) {
          console.log('[Telegram] Corrupted history detected, clearing and retrying...');
          await query(`DELETE FROM kv_store WHERE key = $1`, [historyKey]).catch(() => {});
          messages = [{ role: 'user', content: text }];
          continue;
        }

        let errMsg = 'Erreur API Claude.';
        try {
          const parsed = JSON.parse(err);
          if (parsed?.error?.message) errMsg += ' ' + parsed.error.message;
          else if (parsed?.error?.type) errMsg += ' ' + parsed.error.type;
        } catch { errMsg += ' ' + err.slice(0, 200); }
        await sendTelegram(chatId, errMsg);
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
          tool_use_id: tool.id!,
          content: result,
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
      // Save conversation history (keep last 10 exchanges = 20 messages)
      const newHistory: ClaudeMessage[] = [...messages, { role: 'assistant', content: finalResponse }];
      const trimmed = newHistory.slice(-40);
      await query(
        `INSERT INTO kv_store (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2`,
        [historyKey, JSON.stringify(trimmed)],
      ).catch(() => {});
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

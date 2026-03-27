import { NextRequest } from 'next/server';
import { streamText, tool } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { query } from '@/lib/db';
import { SERVICES, type ServiceType, calculateQuote, formatMoney } from '@/lib/pricing';
import { sendSMS } from '@/lib/sms';
import { sendProspectEmail } from '@/lib/send-prospect-email';
import { google } from 'googleapis';

export const maxDuration = 60;

// --------------- KV helpers ---------------

async function getKv(key: string): Promise<unknown[]> {
  const rows = await query(`SELECT value FROM kv_store WHERE key = $1`, [key]);
  if (!rows[0]) return [];
  try { return JSON.parse(rows[0].value as string) as unknown[]; }
  catch { return []; }
}

async function setKv(key: string, value: unknown): Promise<void> {
  const json = JSON.stringify(value);
  await query(
    `INSERT INTO kv_store (key, value, updated_at) VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
    [key, json]
  );
}

// --------------- Valid agent IDs ---------------

const VALID_AGENTS = ['marcel', 'hunter', 'aria', 'rex', 'iris', 'sage', 'zara', 'bolt', 'echo', 'nova', 'jason'] as const;
type AgentId = (typeof VALID_AGENTS)[number];

function isValidAgent(id: string): id is AgentId {
  return VALID_AGENTS.includes(id as AgentId);
}

// --------------- Tools definitions ---------------

function buildTools(agentId: AgentId) {
  // All available tools
  const allTools = {
    stats_business: tool({
      description: 'Statistiques du business: devis du jour, revenus, leads, etc.',
      parameters: z.object({}),
      execute: async () => {
        const stats = await query(`
          SELECT
            (SELECT COUNT(*) FROM quotes WHERE created_at::date = CURRENT_DATE) as devis_today,
            (SELECT COUNT(*) FROM quotes) as devis_total,
            (SELECT COUNT(*) FROM quotes WHERE statut = 'brouillon') as brouillons,
            (SELECT COUNT(*) FROM quotes WHERE statut IN ('en_attente','approuve','envoye')) as devis_actifs,
            (SELECT COUNT(*) FROM quotes WHERE statut = 'depot_paye') as depot_payes,
            (SELECT COUNT(*) FROM quotes WHERE statut = 'complete') as completes,
            (SELECT COUNT(*) FROM submissions WHERE created_at::date = CURRENT_DATE) as leads_today,
            (SELECT COUNT(*) FROM submissions) as leads_total,
            (SELECT COUNT(*) FROM crm_leads) as crm_total,
            (SELECT COUNT(*) FROM crm_leads WHERE statut = 'nouveau') as crm_nouveaux,
            (SELECT COUNT(*) FROM crm_leads WHERE temperature = 'chaud') as crm_chauds,
            (SELECT COALESCE(SUM(total), 0) FROM quotes WHERE statut IN ('contrat_signe','depot_paye','planifie','complete')) as revenus_confirmes,
            (SELECT COALESCE(SUM(total), 0) FROM quotes WHERE statut = 'envoye') as revenus_pipeline,
            (SELECT COUNT(*) FROM bookings WHERE jour1_date >= CURRENT_DATE) as reservations_a_venir
        `);
        return stats[0];
      },
    }),

    liste_devis: tool({
      description: 'Liste les devis recents avec leur statut.',
      parameters: z.object({
        statut: z.string().optional().describe('Filtrer par statut'),
        limit: z.number().optional().default(5),
      }),
      execute: async ({ statut, limit = 5 }) => {
        const validStatuts = ['brouillon', 'en_attente', 'approuve', 'envoye', 'contrat_signe', 'depot_paye', 'planifie', 'complete', 'refuse'];
        const safeStatut = statut && validStatuts.includes(statut) ? statut : '';
        const lim = Math.min(limit, 20);
        const rows = safeStatut
          ? await query(`SELECT id, client_nom, client_tel, type_service, superficie, total, statut, created_at FROM quotes WHERE statut = $1 ORDER BY id DESC LIMIT $2`, [safeStatut, lim])
          : await query(`SELECT id, client_nom, client_tel, type_service, superficie, total, statut, created_at FROM quotes ORDER BY id DESC LIMIT $1`, [lim]);
        return rows;
      },
    }),

    crm_leads_chauds: tool({
      description: 'Leads CRM chauds ou recents a contacter.',
      parameters: z.object({
        temperature: z.enum(['chaud', 'tiede', 'froid']).optional(),
        limit: z.number().optional().default(10),
      }),
      execute: async ({ temperature, limit = 10 }) => {
        const lim = Math.min(limit, 30);
        const rows = temperature
          ? await query(`SELECT id, nom, telephone, email, service, superficie, ville, statut, temperature, followup_count, last_agent_reply_at, created_at FROM crm_leads WHERE temperature = $1 ORDER BY created_at DESC LIMIT $2`, [temperature, lim])
          : await query(`SELECT id, nom, telephone, email, service, superficie, ville, statut, temperature, followup_count, last_agent_reply_at, created_at FROM crm_leads WHERE temperature IN ('chaud','tiede') AND statut NOT IN ('ferme','froid') ORDER BY temperature DESC, created_at DESC LIMIT $1`, [lim]);
        return rows;
      },
    }),

    envoyer_sms: tool({
      description: 'Envoie un SMS a un numero de telephone.',
      parameters: z.object({
        telephone: z.string(),
        message: z.string(),
      }),
      execute: async ({ telephone, message }) => {
        const sent = await sendSMS(telephone, message);
        return { envoye: sent, telephone };
      },
    }),

    creer_devis: tool({
      description: 'Cree un devis brouillon dans la base de donnees.',
      parameters: z.object({
        client_nom: z.string(),
        client_tel: z.string(),
        client_email: z.string().optional().default(''),
        client_adresse: z.string().optional().default(''),
        type_service: z.enum(['flake', 'metallique', 'commercial']),
        superficie: z.number(),
        couleur_flake: z.string().optional().default(''),
        notes: z.string().optional().default(''),
      }),
      execute: async ({ client_nom, client_tel, client_email, client_adresse, type_service, superficie, couleur_flake, notes }) => {
        const calc = calculateQuote(type_service as ServiceType, superficie);
        const rows = await query(
          `INSERT INTO quotes (client_nom, client_email, client_tel, client_adresse, type_service, superficie, couleur_flake, notes, prix_pied_carre, sous_total, tps, tvq, total, depot_requis, statut) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'brouillon') RETURNING id`,
          [client_nom, client_email || '', client_tel, client_adresse || '', type_service, superficie, couleur_flake || null, notes || null, calc.prix_pied_carre, calc.sous_total, calc.tps, calc.tvq, calc.total, calc.depot_requis]
        );
        return { devis_id: rows[0].id, client: client_nom, total: formatMoney(calc.total), depot: formatMoney(calc.depot_requis), statut: 'brouillon' };
      },
    }),

    modifier_statut: tool({
      description: 'Change le statut d\'un devis.',
      parameters: z.object({ id: z.number(), statut: z.string() }),
      execute: async ({ id, statut }) => {
        const validStatuts = ['brouillon', 'en_attente', 'approuve', 'envoye', 'contrat_signe', 'depot_paye', 'planifie', 'complete', 'refuse'];
        if (!validStatuts.includes(statut)) return { error: 'Statut invalide' };
        await query(`UPDATE quotes SET statut = $1 WHERE id = $2`, [statut, id]);
        return { ok: true, devis_id: id, nouveau_statut: statut };
      },
    }),

    liste_clients: tool({
      description: 'Liste les clients avec leur historique de devis.',
      parameters: z.object({}),
      execute: async () => {
        const rows = await query(
          `SELECT DISTINCT client_nom, client_tel, client_email, MAX(created_at) as dernier_devis, COUNT(*)::int as nb_devis FROM quotes GROUP BY client_nom, client_tel, client_email ORDER BY dernier_devis DESC LIMIT 15`
        );
        return rows;
      },
    }),

    rechercher_lead: tool({
      description: 'Recherche un lead/client par nom, email ou telephone.',
      parameters: z.object({ terme: z.string().describe('Nom, email ou telephone') }),
      execute: async ({ terme }) => {
        const like = `%${terme.toLowerCase()}%`;
        const [crm, subs, quotes] = await Promise.all([
          query(`SELECT id, nom, telephone, email, service, statut, temperature, created_at FROM crm_leads WHERE LOWER(nom) LIKE $1 OR LOWER(email) LIKE $1 OR telephone LIKE $1 LIMIT 5`, [like]),
          query(`SELECT id, nom, telephone, email, service, statut, created_at FROM submissions WHERE LOWER(nom) LIKE $1 OR LOWER(email) LIKE $1 OR telephone LIKE $1 LIMIT 5`, [like]),
          query(`SELECT id, client_nom, client_tel, client_email, type_service, total, statut FROM quotes WHERE LOWER(client_nom) LIKE $1 OR LOWER(client_email) LIKE $1 OR client_tel LIKE $1 LIMIT 5`, [like]),
        ]);
        return { crm_leads: crm, soumissions: subs, devis: quotes };
      },
    }),

    voir_conversations: tool({
      description: 'Conversations recentes du chatbot Nova et follow-ups email.',
      parameters: z.object({}),
      execute: async () => {
        const [convs, leadConvs] = await Promise.all([
          query(`SELECT c.id, c.statut, c.created_at, (SELECT m.content FROM messages m WHERE m.conversation_id = c.id AND m.role = 'user' ORDER BY m.created_at DESC LIMIT 1) as dernier_message FROM conversations c ORDER BY c.updated_at DESC LIMIT 8`),
          query(`SELECT nom, email, statut, temperature, followup_count, last_agent_reply_at FROM crm_leads WHERE last_agent_reply_at IS NOT NULL ORDER BY last_agent_reply_at DESC LIMIT 10`),
        ]);
        return { conversations_nova: convs, followups_crm: leadConvs };
      },
    }),

    resume_emails: tool({
      description: 'Lit les derniers emails recus sur gestionnovusepoxy@gmail.com.',
      parameters: z.object({
        nombre: z.number().optional().default(5),
        non_lus_seulement: z.boolean().optional().default(false),
      }),
      execute: async ({ nombre = 5, non_lus_seulement = false }) => {
        const clientId = process.env.GOOGLE_CLIENT_ID;
        const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
        const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
        if (!clientId || !clientSecret || !refreshToken) {
          return { error: 'Gmail API non configure' };
        }
        const oauth2 = new google.auth.OAuth2(clientId, clientSecret);
        oauth2.setCredentials({ refresh_token: refreshToken });
        const gmail = google.gmail({ version: 'v1', auth: oauth2 });
        const nb = Math.min(nombre, 10);
        const listRes = await gmail.users.messages.list({ userId: 'me', maxResults: nb, q: non_lus_seulement ? 'is:unread' : '' });
        const messageIds = listRes.data.messages ?? [];
        if (!messageIds.length) return { message: 'Aucun email' };
        const emails = [];
        for (const msg of messageIds.slice(0, nb)) {
          const detail = await gmail.users.messages.get({ userId: 'me', id: msg.id!, format: 'metadata', metadataHeaders: ['From', 'Subject', 'Date'] });
          const headers = detail.data.payload?.headers ?? [];
          emails.push({
            from: headers.find(h => h.name === 'From')?.value ?? 'inconnu',
            subject: headers.find(h => h.name === 'Subject')?.value ?? '(sans objet)',
            date: headers.find(h => h.name === 'Date')?.value ?? '',
            apercu: (detail.data.snippet ?? '').slice(0, 200),
            non_lu: detail.data.labelIds?.includes('UNREAD') ?? false,
          });
        }
        return emails;
      },
    }),

    liste_crm: tool({
      description: 'Liste tous les leads CRM avec filtres.',
      parameters: z.object({
        statut: z.string().optional(),
        limit: z.number().optional().default(15),
      }),
      execute: async ({ statut, limit = 15 }) => {
        const lim = Math.min(limit, 50);
        const validStatuts = ['nouveau', 'contacte', 'interesse', 'qualification', 'negocie', 'gagne', 'perdu', 'froid', 'ferme'];
        const safeStatut = statut && validStatuts.includes(statut) ? statut : '';
        const rows = safeStatut
          ? await query(`SELECT id, nom, telephone, email, service, superficie, ville, statut, temperature, created_at FROM crm_leads WHERE statut = $1 ORDER BY created_at DESC LIMIT $2`, [safeStatut, lim])
          : await query(`SELECT id, nom, telephone, email, service, superficie, ville, statut, temperature, created_at FROM crm_leads ORDER BY created_at DESC LIMIT $1`, [lim]);
        return { leads: rows, total: rows.length };
      },
    }),

    scorer_leads: tool({
      description: 'Score et classe les leads CRM par priorite de conversion.',
      parameters: z.object({ limit: z.number().optional().default(20) }),
      execute: async ({ limit = 20 }) => {
        const lim = Math.min(limit, 50);
        const leads = await query(
          `SELECT id, nom, telephone, email, service, superficie, ville, statut, temperature,
                  followup_count, last_agent_reply_at, created_at,
                  EXTRACT(EPOCH FROM (NOW() - created_at))/86400 as jours_depuis_creation,
                  EXTRACT(EPOCH FROM (NOW() - COALESCE(last_agent_reply_at, created_at)))/86400 as jours_depuis_contact
           FROM crm_leads WHERE statut NOT IN ('ferme','froid','perdu')
           ORDER BY created_at DESC LIMIT $1`,
          [lim]
        );
        const scored = leads.map((lead: Record<string, unknown>) => {
          let score = 0;
          const flags: string[] = [];
          if (lead.temperature === 'chaud') { score += 40; flags.push('CHAUD'); }
          else if (lead.temperature === 'tiede') { score += 20; flags.push('TIEDE'); }
          if (lead.email) { score += 15; flags.push('email'); }
          if (lead.telephone) { score += 10; flags.push('tel'); }
          if (lead.superficie) { score += 10; }
          if (lead.service) { score += 5; }
          const jours = Number(lead.jours_depuis_creation ?? 0);
          const joursContact = Number(lead.jours_depuis_contact ?? 0);
          if (jours <= 2) { score += 20; flags.push('nouveau'); }
          else if (jours <= 7) { score += 10; }
          if (lead.followup_count === 0 || lead.followup_count === null) { score += 15; flags.push('jamais contacte'); }
          if (joursContact > 14 && lead.temperature !== 'froid') { score -= 10; flags.push('inactif 14j+'); }
          let action = '';
          if (score >= 70) action = 'APPELER MAINTENANT';
          else if (score >= 45) action = 'SMS personnalise';
          else if (score >= 25) action = 'Email de suivi';
          else action = 'Requalifier';
          return { id: lead.id, nom: lead.nom, telephone: lead.telephone, email: lead.email, service: lead.service, superficie: lead.superficie, ville: lead.ville, score, flags, action, jours_depuis_creation: Math.round(jours), followup_count: lead.followup_count ?? 0 };
        });
        scored.sort((a: { score: number }, b: { score: number }) => b.score - a.score);
        return { leads_classes: scored, total: scored.length, top_priorite: scored.slice(0, 5) };
      },
    }),

    plan_attaque: tool({
      description: 'Plan d\'attaque personnalise pour un lead CRM specifique.',
      parameters: z.object({ lead_id: z.number().describe('ID du lead CRM') }),
      execute: async ({ lead_id }) => {
        const rows = await query(
          `SELECT l.*, EXTRACT(EPOCH FROM (NOW() - l.created_at))/86400 as jours_depuis_creation, EXTRACT(EPOCH FROM (NOW() - COALESCE(l.last_agent_reply_at, l.created_at)))/86400 as jours_sans_contact FROM crm_leads l WHERE l.id = $1`,
          [lead_id]
        );
        if (!rows[0]) return { error: 'Lead introuvable' };
        const l = rows[0] as Record<string, unknown>;
        const jours = Math.round(Number(l.jours_depuis_creation ?? 0));
        const sansContact = Math.round(Number(l.jours_sans_contact ?? 0));
        const followups = Number(l.followup_count ?? 0);
        const profil = { nom: l.nom, service: l.service || 'non precise', superficie: l.superficie ? `${l.superficie} pi2` : 'non precise', ville: l.ville || 'non precise', temperature: l.temperature, jours_depuis_creation: jours, jours_sans_contact: sansContact, followups_envoyes: followups };
        const canal_recommande = l.telephone ? (sansContact < 3 ? 'SMS (lead frais)' : 'Appel telephonique') : l.email ? 'Email personnalise' : 'Trouver coordonnees';
        const urgence = jours <= 3 ? 'MAXIMALE' : jours <= 7 ? 'HAUTE' : jours <= 14 ? 'MODEREE' : 'FAIBLE';
        const script_approche = l.telephone ? `"Bonjour ${String(l.nom ?? '').split(' ')[0]}! C'est Jason de Novus Epoxy. Je t'appelle par rapport a ton projet${l.service ? ` de plancher ${l.service}` : ''}${l.ville ? ` a ${l.ville}` : ''}. As-tu 2 minutes?"` : `Objet: Votre projet de plancher epoxy${l.superficie ? ` — ${l.superficie} pi2` : ''}`;
        return { profil, urgence_niveau: urgence, canal_recommande, script_approche, closing_tip: l.temperature === 'chaud' ? 'Lead chaud — proposer rendez-vous directement' : followups === 0 ? 'Premier contact — se concentrer sur la decouverte des besoins' : 'Relance — rappeler la valeur + promo' };
      },
    }),

    generer_relance_ia: tool({
      description: 'Genere un message de relance personnalise pour un lead CRM.',
      parameters: z.object({
        lead_id: z.number(),
        canal: z.enum(['sms', 'email']).default('sms'),
        ton: z.enum(['direct', 'chaleureux', 'urgence']).default('chaleureux'),
      }),
      execute: async ({ lead_id, canal, ton }) => {
        const rows = await query(`SELECT * FROM crm_leads WHERE id = $1`, [lead_id]);
        if (!rows[0]) return { error: 'Lead introuvable' };
        const l = rows[0] as Record<string, unknown>;
        const prenom = String(l.nom ?? '').split(' ')[0];
        const service = l.service ? String(l.service) : 'plancher epoxy';
        const superficie = l.superficie ? ` de ${l.superficie} pi2` : '';
        const ville = l.ville ? ` a ${l.ville}` : '';
        let message = '';
        if (canal === 'sms') {
          if (ton === 'direct') message = `Bonjour ${prenom}! Jason de Novus Epoxy. Toujours interesse par votre projet${superficie}? On a un rabais en ce moment. Soumission gratuite: novusepoxy.ca/#contact ou 581-307-2678`;
          else if (ton === 'urgence') message = `${prenom}! Rabais se termine bientot. Votre projet${superficie}${ville} — on peut preparer une soumission cette semaine. Interesse? 581-307-2678`;
          else message = `Bonjour ${prenom}! C'est Jason de Novus Epoxy. On pense encore a votre projet de ${service}${superficie}${ville}. Si vous avez des questions, on est la! 581-307-2678`;
        } else {
          const sujet = ton === 'urgence' ? `Rabais — Votre projet ${service}${superficie}` : `Votre soumission ${service}${superficie} — Novus Epoxy`;
          const corps = `Bonjour ${prenom},\n\nSuite a votre interet pour un ${service}${superficie}${ville}, nous voulions vous rappeler que notre equipe est disponible pour vous preparer une soumission gratuite.\n\nA bientot,\nJason — Novus Epoxy\n581-307-2678`;
          message = `SUJET: ${sujet}\n\n${corps}`;
        }
        return { lead: { id: l.id, nom: l.nom, telephone: l.telephone, email: l.email }, canal, ton, message_genere: message, note: 'Revisez avant d\'envoyer.' };
      },
    }),

    // ---------- NEW TOOLS ----------

    revenus_analyse: tool({
      description: 'Analyse des revenus confirmes et pipeline de devis.',
      parameters: z.object({}),
      execute: async () => {
        const rows = await query(
          `SELECT total, statut, created_at FROM quotes WHERE statut IN ('depot_paye','planifie','complete','contrat_signe') ORDER BY created_at DESC LIMIT 20`
        );
        const total = rows.reduce((sum, r) => sum + Number(r.total ?? 0), 0);
        return { devis: rows, total_revenus_confirmes: formatMoney(total), nombre_devis: rows.length };
      },
    }),

    liste_reservations: tool({
      description: 'Liste les reservations a venir.',
      parameters: z.object({}),
      execute: async () => {
        const rows = await query(
          `SELECT * FROM bookings WHERE jour1_date >= CURRENT_DATE ORDER BY jour1_date LIMIT 10`
        );
        return { reservations: rows, total: rows.length };
      },
    }),

    stats_nova: tool({
      description: 'Statistiques du chatbot Nova.',
      parameters: z.object({}),
      execute: async () => {
        const rows = await query(`
          SELECT
            COUNT(*) as conversations_total,
            COUNT(CASE WHEN created_at::date = CURRENT_DATE THEN 1 END) as today,
            COUNT(CASE WHEN status = 'pending_approval' THEN 1 END) as en_attente_appro,
            COUNT(CASE WHEN quote_id IS NOT NULL THEN 1 END) as avec_devis
          FROM conversations
        `);
        return rows[0];
      },
    }),

    generer_post: tool({
      description: 'Genere un post Instagram/Facebook pour Novus Epoxy.',
      parameters: z.object({
        plateforme: z.enum(['instagram', 'facebook']).default('instagram'),
        theme: z.string().optional().default('plancher epoxy'),
      }),
      execute: async ({ plateforme, theme }) => {
        return {
          plateforme,
          theme,
          note: 'Ce tool retourne le contexte — l\'agent va generer le contenu creatif lui-meme.',
          entreprise: 'Novus Epoxy — Planchers epoxy haut de gamme au Quebec',
          services: Object.values(SERVICES).map(s => s.label),
          ton: 'Professionnel, moderne, confiance. Francais quebecois.',
          hashtags: '#NovusEpoxy #PlancherEpoxy #EpoxyQuebec #Renovation #Design #PlanHautDeGamme',
        };
      },
    }),

    envoyer_telegram: tool({
      description: 'Envoie un message dans le groupe Telegram admin.',
      parameters: z.object({ message: z.string() }),
      execute: async ({ message }) => {
        const token = process.env.TELEGRAM_BOT_TOKEN;
        const chatIds = process.env.TELEGRAM_ADMIN_CHAT_IDS;
        if (!token || !chatIds) return { error: 'Telegram non configure' };
        const ids = chatIds.split(',').map(id => id.trim()).filter(Boolean);
        const results = [];
        for (const chatId of ids) {
          try {
            const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'HTML' }),
            });
            results.push({ chat_id: chatId, ok: res.ok });
          } catch {
            results.push({ chat_id: chatId, ok: false });
          }
        }
        return { envoyes: results.filter(r => r.ok).length, total: ids.length, details: results };
      },
    }),

    scan_drive_portfolio: tool({
      description: 'Scanne le Google Drive de Jason, classifie les photos avec Claude Vision, et les ajoute au portfolio automatiquement.',
      parameters: z.object({}),
      execute: async () => {
        const base = process.env.NEXTAUTH_URL ?? 'https://novus-epoxy.vercel.app';
        const res = await fetch(`${base}/api/sage/scan`, {
          method: 'POST',
          headers: { 'x-api-key': process.env.ADMIN_API_KEY ?? '' },
        });
        if (!res.ok) return { error: `Scan echoue: ${res.status}` };
        return await res.json();
      },
    }),

    preview_drive: tool({
      description: 'Preview des photos dans le Google Drive sans les importer.',
      parameters: z.object({}),
      execute: async () => {
        const base = process.env.NEXTAUTH_URL ?? 'https://novus-epoxy.vercel.app';
        const res = await fetch(`${base}/api/sage/scan`, {
          method: 'GET',
          headers: { 'x-api-key': process.env.ADMIN_API_KEY ?? '' },
        });
        if (!res.ok) return { error: `Preview echoue: ${res.status}` };
        return await res.json();
      },
    }),

    stats_portfolio: tool({
      description: 'Statistiques du portfolio: nombre de photos, types, featured.',
      parameters: z.object({}),
      execute: async () => {
        const rows = await query(`
          SELECT
            COUNT(*) as total_projets,
            COUNT(CASE WHEN featured = true THEN 1 END) as featured,
            COUNT(CASE WHEN type_service = 'flake' THEN 1 END) as flake,
            COUNT(CASE WHEN type_service = 'metallique' THEN 1 END) as metallique,
            COUNT(CASE WHEN type_service = 'commercial' THEN 1 END) as commercial,
            COUNT(CASE WHEN type_service = 'couleur_unie' THEN 1 END) as couleur_unie,
            COUNT(CASE WHEN type_service = 'quartz' THEN 1 END) as quartz,
            (SELECT COUNT(*) FROM portfolio WHERE array_length(photos, 1) > 0) as avec_photos
          FROM portfolio
        `);
        return rows[0];
      },
    }),

    system_health: tool({
      description: 'Verifie la sante du systeme: env vars, status general.',
      parameters: z.object({}),
      execute: async () => {
        const envVars = [
          'ANTHROPIC_API_KEY', 'DATABASE_URL', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_ADMIN_CHAT_IDS',
          'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_PHONE_NUMBER',
          'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN',
          'ADMIN_EMAIL', 'ADMIN_PASSWORD', 'AUTH_SECRET', 'NEXTAUTH_URL',
          'RESEND_API_KEY', 'STRIPE_SECRET_KEY',
        ];
        const status = envVars.map(v => ({ variable: v, present: !!process.env[v] }));
        const ok = status.filter(s => s.present).length;
        return { env_vars: status, ok_count: ok, total: envVars.length, timestamp: new Date().toISOString() };
      },
    }),

    // ---------- JASON TOOLS ----------

    jason_mes_leads: tool({
      description: 'Liste les leads CRM importes par Jason (source = jason).',
      parameters: z.object({
        statut: z.string().optional(),
        limit: z.number().optional().default(15),
      }),
      execute: async ({ statut, limit = 15 }) => {
        const lim = Math.min(limit, 50);
        const validStatuts = ['nouveau', 'contacte', 'interesse', 'qualification', 'negocie', 'gagne', 'perdu', 'froid', 'ferme'];
        const safeStatut = statut && validStatuts.includes(statut) ? statut : '';
        const rows = safeStatut
          ? await query(`SELECT id, nom, telephone, email, service, superficie, ville, statut, temperature, prospect_sent_at, prospect_relance_1_at, prospect_relance_2_at, created_at FROM crm_leads WHERE source = 'jason' AND statut = $1 ORDER BY created_at DESC LIMIT $2`, [safeStatut, lim])
          : await query(`SELECT id, nom, telephone, email, service, superficie, ville, statut, temperature, prospect_sent_at, prospect_relance_1_at, prospect_relance_2_at, created_at FROM crm_leads WHERE source = 'jason' ORDER BY created_at DESC LIMIT $1`, [lim]);
        return { leads: rows, total: rows.length };
      },
    }),

    jason_envoyer_email: tool({
      description: 'Envoie un email de prospection depuis jason@novusepoxy.shop via SMTP Hostinger.',
      parameters: z.object({
        lead_id: z.number().describe('ID du lead CRM'),
        sujet: z.string().describe('Sujet de l\'email'),
        contenu_html: z.string().describe('Contenu HTML de l\'email'),
      }),
      execute: async ({ lead_id, sujet, contenu_html }) => {
        const rows = await query(`SELECT id, nom, email, telephone FROM crm_leads WHERE id = $1`, [lead_id]);
        if (!rows[0]) return { error: 'Lead introuvable' };
        const lead = rows[0] as Record<string, unknown>;
        if (!lead.email) return { error: 'Ce lead n\'a pas d\'email' };
        const result = await sendProspectEmail({
          to: String(lead.email),
          subject: sujet,
          html: contenu_html,
        });
        await query(`UPDATE crm_leads SET prospect_sent_at = NOW(), statut = CASE WHEN statut = 'nouveau' THEN 'contacte' ELSE statut END WHERE id = $1`, [lead_id]);
        return { envoye: true, email_id: result.id, lead: { id: lead.id, nom: lead.nom, email: lead.email } };
      },
    }),

    jason_envoyer_sms: tool({
      description: 'Envoie un SMS de prospection depuis le numero Twilio de Jason (581-709-5940).',
      parameters: z.object({
        telephone: z.string(),
        message: z.string(),
      }),
      execute: async ({ telephone, message }) => {
        const sent = await sendSMS(telephone, message, process.env.TWILIO_JASON_PHONE ?? '+15817095940');
        return { envoye: sent, telephone };
      },
    }),

    jason_stats: tool({
      description: 'Statistiques de prospection de Jason: leads importes, emails envoyes, relances.',
      parameters: z.object({}),
      execute: async () => {
        const stats = await query(`
          SELECT
            COUNT(*) as total_leads,
            COUNT(*) FILTER (WHERE statut = 'nouveau') as nouveaux,
            COUNT(*) FILTER (WHERE temperature = 'chaud') as chauds,
            COUNT(*) FILTER (WHERE temperature = 'tiede') as tiedes,
            COUNT(*) FILTER (WHERE prospect_sent_at IS NOT NULL) as emails_envoyes,
            COUNT(*) FILTER (WHERE prospect_relance_1_at IS NOT NULL) as relance1_envoyes,
            COUNT(*) FILTER (WHERE prospect_relance_2_at IS NOT NULL) as relance2_envoyes,
            COUNT(*) FILTER (WHERE statut IN ('interesse','qualification','negocie','gagne')) as convertis,
            COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days') as leads_semaine
          FROM crm_leads WHERE source = 'jason'
        `);
        return stats[0];
      },
    }),
  };

  // Map agent -> tools
  const agentToolMap: Record<AgentId, (keyof typeof allTools)[]> = {
    marcel: ['stats_business', 'liste_devis', 'crm_leads_chauds', 'envoyer_sms', 'creer_devis', 'modifier_statut', 'liste_clients', 'rechercher_lead', 'voir_conversations', 'resume_emails'],
    hunter: ['scorer_leads', 'plan_attaque', 'generer_relance_ia', 'crm_leads_chauds', 'liste_crm'],
    aria: ['resume_emails', 'liste_crm'],
    rex: ['envoyer_sms', 'generer_relance_ia', 'liste_devis', 'crm_leads_chauds'],
    iris: ['stats_business', 'liste_devis', 'revenus_analyse'],
    sage: ['generer_post', 'scan_drive_portfolio', 'preview_drive', 'stats_portfolio'],
    zara: ['liste_reservations', 'stats_business'],
    bolt: ['envoyer_telegram'],
    echo: ['system_health'],
    nova: ['voir_conversations', 'stats_nova'],
    jason: ['jason_mes_leads', 'jason_envoyer_email', 'jason_envoyer_sms', 'jason_stats', 'scorer_leads', 'generer_relance_ia', 'plan_attaque', 'crm_leads_chauds'],
  };

  const toolKeys = agentToolMap[agentId];
  const tools: Record<string, typeof allTools[keyof typeof allTools]> = {};
  for (const key of toolKeys) {
    tools[key] = allTools[key];
  }
  return tools;
}

// --------------- System prompts ---------------

function getSystemPrompt(agentId: AgentId): string {
  const date = new Date().toLocaleDateString('fr-CA', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const base = `Tu travailles pour Novus Epoxy — planchers epoxy haut de gamme au Quebec.\nEquipe: Luca (fondateur, 581-307-5983) et Jason (ventes, 581-307-2678).\nDate: ${date}\nSois direct, professionnel, en francais quebecois. Utilise les outils disponibles pour des donnees reelles.`;

  const prompts: Record<AgentId, string> = {
    marcel: `Tu es Marcel, le Chef de Cabinet de Novus Epoxy. Tu geres tout: devis, leads, SMS, emails, stats. Tu es le bras droit de l'equipe.\n${base}\nTu peux agir: creer devis, envoyer SMS, modifier statuts, scorer leads, generer relances.`,
    hunter: `Tu es Hunter, le Dark Hunter de Novus Epoxy. Ta mission: traquer, scorer et qualifier les leads. Tu es un predateur commercial — chaque lead compte.\n${base}\nTu scores les leads, tu generes des plans d'attaque, tu identifies les opportunites chaudes.`,
    aria: `Tu es Aria, l'agente email de Novus Epoxy. Tu geres la boite email, tu resumes les messages importants, tu identifies les leads qui ont repondu.\n${base}\nTu lis et resumes les emails, tu identifies les opportunites cachees dans la boite de reception.`,
    rex: `Tu es Rex, le Closer SMS de Novus Epoxy. Tu es le roi des relances par texto. Court, punchy, efficace.\n${base}\nTu generes des relances SMS percutantes et tu les envoies directement.`,
    iris: `Tu es Iris, l'analyste financiere de Novus Epoxy. Tu vois les chiffres, les tendances, les opportunites de revenus.\n${base}\nTu analyses les revenus, le pipeline de devis, et tu identifies les opportunites financieres.`,
    sage: `Tu es Sage, la creatrice de contenu et gestionnaire de portfolio de Novus Epoxy. Tu geres le portfolio photo automatiquement: scan du Google Drive de Jason, classification par IA (type, couleur, qualite), upload sur Vercel Blob, et integration dans le portfolio DB. Tu generes aussi du contenu marketing pour Instagram et Facebook.\n${base}\nTu scannes le Drive pour de nouvelles photos, tu les classifies avec Vision, et tu les ajoutes au portfolio. Les photos du portfolio sont automatiquement utilisees par Hunter dans les emails de prospection.`,
    zara: `Tu es Zara, la gestionnaire de reservations de Novus Epoxy. Tu geres le calendrier, les rendez-vous, les confirmations.\n${base}\nTu listes les reservations a venir et tu aides a organiser le planning.`,
    bolt: `Tu es Bolt, le commandant Telegram de Novus Epoxy. Tu envoies des notifications et updates a l'equipe via Telegram.\n${base}\nTu envoies des messages dans le groupe admin Telegram.`,
    echo: `Tu es Echo, le moniteur systeme de Novus Epoxy. Tu surveilles la sante du systeme: env vars, crons, integrations.\n${base}\nTu verifies que tout fonctionne correctement et tu rapportes les anomalies.`,
    nova: `Tu es Nova, l'agente chatbot de Novus Epoxy. Tu geres les conversations automatiques avec les clients potentiels.\n${base}\nTu vois les conversations en cours, les devis generes automatiquement, et les leads en attente d'approbation.`,
    jason: `Tu es l'agent personnel de Jason, vendeur terrain chez Novus Epoxy. Tu l'aides a gerer SES leads de prospection.\n${base}\nTu envoies les emails depuis jason@novusepoxy.shop (SMTP Hostinger) et les SMS depuis le 581-709-5940 (numero Twilio de Jason).\nTon role: voir les leads de Jason, envoyer des emails/SMS de prospection personnalises, scorer les leads, generer des plans d'attaque.\nJason est le vendeur terrain — il va sur le terrain faire les soumissions. Ton ton est direct, motivant, axe resultats.\nQuand tu envoies un email de prospection, inclus toujours des photos du portfolio et un CTA vers novusepoxy.ca/#contact.\nQuand tu envoies un SMS, signe toujours "Jason — Novus Epoxy 581-307-2678".`,
  };

  return prompts[agentId];
}

// --------------- Route handler ---------------

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ agentId: string }> }
) {
  const session = await auth();
  if (!session) return new Response('Non autorise', { status: 401 });

  const { agentId } = await params;
  if (!isValidAgent(agentId)) {
    return new Response('Agent inconnu', { status: 404 });
  }

  const body = await req.json() as { messages: Array<{ role: string; content: string }> };
  const clientMessages = body.messages ?? [];
  const lastUserMsg = clientMessages[clientMessages.length - 1];
  if (!lastUserMsg || lastUserMsg.role !== 'user') {
    return new Response('Message requis', { status: 400 });
  }

  const authorName = (session.user?.name ?? session.user?.email?.split('@')[0] ?? 'Admin') as string;

  // Load agent-specific history
  const historyKey = `agent_history_${agentId}`;
  const history = await getKv(historyKey) as Array<{ role: string; content: string; author?: string }>;
  const historyMsgs = history.slice(-40).map(m => ({
    role: m.role as 'user' | 'assistant',
    content: m.content,
  }));

  const userContent = `[${authorName}]: ${lastUserMsg.content}`;

  const result = streamText({
    model: anthropic('claude-opus-4-6'),
    system: getSystemPrompt(agentId),
    messages: [
      ...historyMsgs,
      { role: 'user', content: userContent },
    ],
    maxSteps: 5,
    tools: buildTools(agentId),
    onFinish: async ({ text }) => {
      const current = await getKv(historyKey) as Array<{ role: string; content: string; author?: string; ts: number }>;
      current.push({ role: 'user', content: userContent, author: authorName, ts: Date.now() });
      current.push({ role: 'assistant', content: text, author: agentId, ts: Date.now() });
      const trimmed = current.slice(-60);
      await setKv(historyKey, trimmed);
    },
  });

  return result.toDataStreamResponse();
}

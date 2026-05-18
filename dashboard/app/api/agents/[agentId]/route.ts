import { NextRequest } from 'next/server';
import { streamText, tool } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { getAdminChatIds } from '@/lib/telegram-utils';
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
        type_service: z.enum(['flake', 'metallique', 'commercial', 'quartz', 'couleur_unie', 'antiderapant', 'meulage']),
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

    rapport_projet: tool({
      description: 'Rapport financier complet pour un projet (devis): revenus, depenses, main-d\'oeuvre, profit.',
      parameters: z.object({
        quote_id: z.number().describe('ID du devis/projet'),
      }),
      execute: async ({ quote_id }) => {
        const quotes = await query('SELECT * FROM quotes WHERE id = $1', [quote_id]);
        if (!quotes[0]) return { error: 'Projet non trouve' };
        const qt = quotes[0];

        const invoices = await query('SELECT * FROM invoices WHERE quote_id = $1', [quote_id]);
        const invoiceIds = invoices.map((inv) => inv.id as number);
        let payments: Record<string, unknown>[] = [];
        if (invoiceIds.length > 0) {
          const ph = invoiceIds.map((_, i) => `$${i + 1}`).join(',');
          payments = await query(`SELECT * FROM payments WHERE invoice_id IN (${ph})`, invoiceIds);
        }
        const totalRevenue = payments.reduce((s, p) => s + parseFloat(String(p.montant ?? 0)), 0);

        const expenses = await query('SELECT * FROM expenses WHERE quote_id = $1', [quote_id]);
        const totalExpenses = expenses.reduce((s, e) => s + parseFloat(String(e.montant_ttc ?? e.montant_ht ?? 0)), 0);

        const labor = await query(
          `SELECT te.*, e.nom, e.taux_horaire FROM time_entries te JOIN employees e ON te.employee_id = e.id WHERE te.quote_id = $1 ORDER BY te.date_travail`,
          [quote_id]
        );
        let totalHours = 0, totalLaborCost = 0;
        for (const entry of labor) {
          const h = parseFloat(String(entry.heures ?? 0));
          const t = parseFloat(String(entry.taux_horaire ?? 0));
          totalHours += h;
          totalLaborCost += h * t;
        }

        const profit = Math.round((totalRevenue - totalExpenses - totalLaborCost) * 100) / 100;
        const margin = totalRevenue > 0 ? Math.round((profit / totalRevenue) * 10000) / 100 : 0;

        return {
          projet: { id: qt.id, client: qt.client_nom, service: qt.type_service, total: qt.total, statut: qt.statut },
          revenus: formatMoney(totalRevenue),
          depenses: formatMoney(totalExpenses),
          main_oeuvre: { heures: Math.round(totalHours * 10) / 10, cout: formatMoney(totalLaborCost) },
          profit: formatMoney(profit),
          marge: `${margin}%`,
          nb_factures: invoices.length,
          nb_paiements: payments.length,
          nb_depenses: expenses.length,
          nb_entrees_temps: labor.length,
        };
      },
    }),

    liste_employes: tool({
      description: 'Liste les employes de Novus Epoxy.',
      parameters: z.object({}),
      execute: async () => {
        const rows = await query(
          `SELECT id, nom, telephone, role, taux_horaire, actif FROM employees ORDER BY nom`
        );
        return { employes: rows, total: rows.length };
      },
    }),

    ajouter_heures: tool({
      description: 'Ajoute une entree de temps (heures travaillees) pour un employe sur un projet.',
      parameters: z.object({
        employee_id: z.number().describe('ID de l\'employe'),
        quote_id: z.number().describe('ID du devis/projet'),
        date_travail: z.string().describe('Date du travail (YYYY-MM-DD)'),
        heures: z.number().describe('Nombre d\'heures'),
        type: z.enum(['travail', 'deplacement', 'preparation', 'nettoyage']).default('travail'),
        notes: z.string().optional(),
      }),
      execute: async ({ employee_id, quote_id, date_travail, heures, type, notes }) => {
        const emp = await query('SELECT id, nom FROM employees WHERE id = $1', [employee_id]);
        if (!emp[0]) return { error: 'Employe non trouve' };
        const qt = await query('SELECT id, client_nom FROM quotes WHERE id = $1', [quote_id]);
        if (!qt[0]) return { error: 'Projet non trouve' };

        const rows = await query(
          `INSERT INTO time_entries (employee_id, quote_id, date_travail, heures, type, notes)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
          [employee_id, quote_id, date_travail, heures, type, notes ?? null]
        );
        return { ok: true, entree: rows[0], employe: emp[0].nom, projet: qt[0].client_nom };
      },
    }),

    relier_depense: tool({
      description: 'Relie une depense a un projet (devis).',
      parameters: z.object({
        expense_id: z.number().describe('ID de la depense'),
        quote_id: z.number().describe('ID du devis/projet'),
      }),
      execute: async ({ expense_id, quote_id }) => {
        const qt = await query('SELECT id, client_nom FROM quotes WHERE id = $1', [quote_id]);
        if (!qt[0]) return { error: 'Projet non trouve' };
        const exp = await query('SELECT id, description, montant_ttc FROM expenses WHERE id = $1', [expense_id]);
        if (!exp[0]) return { error: 'Depense non trouvee' };

        await query('UPDATE expenses SET quote_id = $1 WHERE id = $2', [quote_id, expense_id]);
        return { ok: true, depense: exp[0], projet: qt[0].client_nom };
      },
    }),

    depenses_non_reliees: tool({
      description: 'Liste les depenses non reliees a un projet (quote_id IS NULL).',
      parameters: z.object({
        limit: z.number().optional().default(20),
      }),
      execute: async ({ limit = 20 }) => {
        const lim = Math.min(limit, 50);
        const rows = await query(
          `SELECT id, date_depense, fournisseur, description, categorie, montant_ttc, methode
           FROM expenses WHERE quote_id IS NULL ORDER BY date_depense DESC LIMIT $1`,
          [lim]
        );
        return { depenses: rows, total: rows.length };
      },
    }),

    reconciliation_banque: tool({
      description: 'Affiche les depenses non reconciliees (pas encore matchees avec une transaction bancaire).',
      parameters: z.object({
        limit: z.number().optional().default(20),
      }),
      execute: async ({ limit = 20 }) => {
        const lim = Math.min(limit, 50);
        const rows = await query(
          `SELECT id, date_depense, fournisseur, description, categorie, montant_ttc, methode
           FROM expenses WHERE reconciled = false ORDER BY date_depense DESC LIMIT $1`,
          [lim]
        );
        const total = rows.reduce((s, r) => s + parseFloat(String(r.montant_ttc ?? 0)), 0);
        return { non_reconciliees: rows, total_non_reconcilie: formatMoney(total), count: rows.length };
      },
    }),

    liste_reservations: tool({
      description: 'Liste les reservations a venir avec les infos client du devis.',
      parameters: z.object({}),
      execute: async () => {
        const rows = await query(
          `SELECT b.*, q.client_nom, q.client_tel, q.client_email, q.type_service, q.superficie, q.total
           FROM bookings b JOIN quotes q ON b.quote_id = q.id
           WHERE b.jour1_date >= CURRENT_DATE ORDER BY b.jour1_date LIMIT 15`
        );
        return { reservations: rows, total: rows.length };
      },
    }),

    creer_reservation: tool({
      description: 'Cree ou met a jour une reservation pour un devis existant. Jour1 = premiere journee de travaux, jour2 = deuxieme journee (si applicable). Slot = matin ou apres-midi.',
      parameters: z.object({
        quote_id: z.number().describe('ID du devis'),
        jour1_date: z.string().describe('Date jour 1 (YYYY-MM-DD)'),
        jour1_slot: z.enum(['matin', 'apres-midi']).default('matin'),
        jour2_date: z.string().describe('Date jour 2 (YYYY-MM-DD)'),
        jour2_slot: z.enum(['matin', 'apres-midi']).default('matin'),
        statut: z.enum(['en_attente', 'confirme']).default('en_attente'),
      }),
      execute: async ({ quote_id, jour1_date, jour1_slot, jour2_date, jour2_slot, statut }) => {
        // Verify quote exists
        const quoteRows = await query(`SELECT id, client_nom, statut FROM quotes WHERE id = $1`, [quote_id]);
        if (!quoteRows[0]) return { error: 'Devis introuvable' };
        // Check for existing booking
        const existing = await query(`SELECT id FROM bookings WHERE quote_id = $1`, [quote_id]);
        if (existing.length > 0) {
          await query(
            `UPDATE bookings SET jour1_date = $1, jour1_slot = $2, jour2_date = $3, jour2_slot = $4, statut = $5, updated_at = NOW() WHERE quote_id = $6`,
            [jour1_date, jour1_slot, jour2_date, jour2_slot, statut, quote_id]
          );
          return { ok: true, action: 'mise_a_jour', quote_id, client: quoteRows[0].client_nom, jour1: `${jour1_date} ${jour1_slot}`, jour2: `${jour2_date} ${jour2_slot}`, statut };
        }
        await query(
          `INSERT INTO bookings (quote_id, jour1_date, jour1_slot, jour2_date, jour2_slot, statut) VALUES ($1, $2, $3, $4, $5, $6)`,
          [quote_id, jour1_date, jour1_slot, jour2_date, jour2_slot, statut]
        );
        // Update quote statut to planifie if depot_paye
        if (quoteRows[0].statut === 'depot_paye') {
          await query(`UPDATE quotes SET statut = 'planifie' WHERE id = $1`, [quote_id]);
        }
        return { ok: true, action: 'creee', quote_id, client: quoteRows[0].client_nom, jour1: `${jour1_date} ${jour1_slot}`, jour2: `${jour2_date} ${jour2_slot}`, statut };
      },
    }),

    confirmer_reservation: tool({
      description: 'Confirme une reservation existante (change statut en_attente → confirme).',
      parameters: z.object({ quote_id: z.number() }),
      execute: async ({ quote_id }) => {
        const rows = await query(`SELECT b.id, b.statut, q.client_nom FROM bookings b JOIN quotes q ON b.quote_id = q.id WHERE b.quote_id = $1`, [quote_id]);
        if (!rows[0]) return { error: 'Reservation introuvable' };
        if (rows[0].statut === 'confirme') return { deja_confirme: true, client: rows[0].client_nom };
        await query(`UPDATE bookings SET statut = 'confirme', updated_at = NOW() WHERE quote_id = $1`, [quote_id]);
        return { ok: true, client: rows[0].client_nom, nouveau_statut: 'confirme' };
      },
    }),

    deplacer_reservation: tool({
      description: 'Deplace une reservation a de nouvelles dates.',
      parameters: z.object({
        quote_id: z.number(),
        jour1_date: z.string().describe('Nouvelle date jour 1 (YYYY-MM-DD)'),
        jour1_slot: z.enum(['matin', 'apres-midi']).default('matin'),
        jour2_date: z.string().describe('Nouvelle date jour 2 (YYYY-MM-DD)'),
        jour2_slot: z.enum(['matin', 'apres-midi']).default('matin'),
      }),
      execute: async ({ quote_id, jour1_date, jour1_slot, jour2_date, jour2_slot }) => {
        const rows = await query(`SELECT b.id, q.client_nom FROM bookings b JOIN quotes q ON b.quote_id = q.id WHERE b.quote_id = $1`, [quote_id]);
        if (!rows[0]) return { error: 'Reservation introuvable' };
        await query(
          `UPDATE bookings SET jour1_date = $1, jour1_slot = $2, jour2_date = $3, jour2_slot = $4, updated_at = NOW() WHERE quote_id = $5`,
          [jour1_date, jour1_slot, jour2_date, jour2_slot, quote_id]
        );
        return { ok: true, client: rows[0].client_nom, nouveau_jour1: `${jour1_date} ${jour1_slot}`, nouveau_jour2: `${jour2_date} ${jour2_slot}` };
      },
    }),

    voir_agenda: tool({
      description: 'Voir l\'agenda complet: toutes les reservations a venir, groupees par mois. Montre aussi les jours occupes vs disponibles.',
      parameters: z.object({
        mois: z.number().optional().default(3).describe('Nombre de mois a afficher (1-6)'),
      }),
      execute: async ({ mois = 3 }) => {
        const nbMois = Math.min(Math.max(mois, 1), 6);
        const rows = await query(
          `SELECT b.*, q.client_nom, q.client_tel, q.type_service, q.superficie, q.total
           FROM bookings b JOIN quotes q ON b.quote_id = q.id
           WHERE b.jour1_date >= CURRENT_DATE AND b.jour1_date < CURRENT_DATE + ($1 || ' months')::INTERVAL
           ORDER BY b.jour1_date`,
          [nbMois]
        );
        // Group by month
        const parMois: Record<string, unknown[]> = {};
        for (const r of rows) {
          const d = new Date(r.jour1_date as string);
          const key = d.toLocaleDateString('fr-CA', { month: 'long', year: 'numeric' });
          if (!parMois[key]) parMois[key] = [];
          parMois[key].push(r);
        }
        return { mois: nbMois, reservations_par_mois: parMois, total: rows.length };
      },
    }),

    jours_disponibles: tool({
      description: 'Verifie quels jours sont disponibles (pas de reservation) dans les prochains mois. Utile pour placer de nouvelles reservations.',
      parameters: z.object({
        mois: z.number().optional().default(2).describe('Nombre de mois a verifier (1-6)'),
      }),
      execute: async ({ mois = 2 }) => {
        const nbMois = Math.min(Math.max(mois, 1), 6);
        const rows = await query(
          `SELECT jour1_date, jour2_date FROM bookings WHERE jour1_date >= CURRENT_DATE AND jour1_date < CURRENT_DATE + ($1 || ' months')::INTERVAL AND statut IN ('confirme', 'en_attente')`,
          [nbMois]
        );
        const busy = new Set<string>();
        for (const r of rows) {
          if (r.jour1_date) busy.add(new Date(r.jour1_date as string).toISOString().slice(0, 10));
          if (r.jour2_date) busy.add(new Date(r.jour2_date as string).toISOString().slice(0, 10));
        }
        // Generate all weekdays in range
        const available: string[] = [];
        const start = new Date();
        const totalDays = nbMois * 30;
        for (let i = 0; i < totalDays; i++) {
          const d = new Date(start);
          d.setDate(d.getDate() + i);
          const day = d.getDay();
          if (day === 0 || day === 6) continue;
          const iso = d.toISOString().slice(0, 10);
          if (!busy.has(iso)) available.push(iso);
        }
        return { disponibles: available, occupes: Array.from(busy), mois: nbMois, total_disponibles: available.length, total_occupes: busy.size };
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
        const allChatIds = getAdminChatIds();
        if (!token || allChatIds.length === 0) return { error: 'Telegram non configure' };
        const ids = allChatIds;
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

    resume_journee: tool({
      description: 'Genere un resume complet de la journee: devis, leads, reservations, emails, revenus. Ideal pour envoyer sur Telegram.',
      parameters: z.object({}),
      execute: async () => {
        const [devis, leads, bookings, emails, revenus] = await Promise.all([
          query(`SELECT COUNT(*) FILTER (WHERE created_at::date = CURRENT_DATE) as today, COUNT(*) FILTER (WHERE statut = 'envoye') as envoyes, COUNT(*) FILTER (WHERE statut = 'depot_paye') as depot_payes, COUNT(*) as total FROM quotes`),
          query(`SELECT COUNT(*) FILTER (WHERE created_at::date = CURRENT_DATE) as today, COUNT(*) FILTER (WHERE temperature = 'chaud') as chauds, COUNT(*) as total FROM crm_leads WHERE statut NOT IN ('ferme','perdu')`),
          query(`SELECT COUNT(*) FILTER (WHERE jour1_date >= CURRENT_DATE AND jour1_date < CURRENT_DATE + INTERVAL '7 days') as semaine, COUNT(*) FILTER (WHERE jour1_date = CURRENT_DATE) as today FROM bookings WHERE statut = 'confirme'`),
          query(`SELECT COUNT(*) FILTER (WHERE created_at::date = CURRENT_DATE) as today FROM email_logs WHERE statut = 'sent'`),
          query(`SELECT COALESCE(SUM(total),0) as confirmes FROM quotes WHERE statut IN ('depot_paye','planifie','complete')`),
        ]);
        return {
          devis: devis[0],
          leads: leads[0],
          reservations: bookings[0],
          emails_envoyes_today: Number(emails[0]?.today ?? 0),
          revenus_confirmes: formatMoney(Number(revenus[0]?.confirmes ?? 0)),
          date: new Date().toLocaleDateString('fr-CA', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
        };
      },
    }),

    planning_semaine: tool({
      description: 'Genere le planning de la semaine: toutes les reservations avec nom client, service, dates.',
      parameters: z.object({}),
      execute: async () => {
        const rows = await query(
          `SELECT b.jour1_date, b.jour1_slot, b.jour2_date, b.jour2_slot, b.statut, q.client_nom, q.client_tel, q.type_service, q.superficie, q.client_adresse
           FROM bookings b JOIN quotes q ON b.quote_id = q.id
           WHERE b.jour1_date >= CURRENT_DATE AND b.jour1_date < CURRENT_DATE + INTERVAL '7 days'
           ORDER BY b.jour1_date`
        );
        return { semaine: rows, total: rows.length };
      },
    }),

    alerte_leads_chauds: tool({
      description: 'Trouve les leads chauds qui necessitent une action immediate et genere un message d\'alerte.',
      parameters: z.object({}),
      execute: async () => {
        const rows = await query(
          `SELECT id, nom, telephone, email, service, ville, temperature, created_at,
                  EXTRACT(EPOCH FROM (NOW() - created_at))/3600 as heures_depuis
           FROM crm_leads
           WHERE temperature = 'chaud' AND statut NOT IN ('ferme','perdu','gagne')
           ORDER BY created_at DESC LIMIT 10`
        );
        return { leads_chauds: rows, total: rows.length };
      },
    }),

    devis_en_attente: tool({
      description: 'Liste les devis qui attendent une action: approbation, signature, depot, etc.',
      parameters: z.object({}),
      execute: async () => {
        const rows = await query(
          `SELECT id, client_nom, client_tel, type_service, total, statut, created_at,
                  EXTRACT(EPOCH FROM (NOW() - created_at))/86400 as jours_depuis
           FROM quotes
           WHERE statut IN ('brouillon','en_attente','approuve','envoye','contrat_signe')
           ORDER BY created_at ASC`
        );
        return { devis: rows, total: rows.length };
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

    // ---------- ECHO TOOLS ----------

    verifier_crons: tool({
      description: 'Verifie que tous les cron jobs ont roule recemment. Compare les timestamps dans kv_store avec les frequences attendues.',
      parameters: z.object({}),
      execute: async () => {
        const crons = [
          { key: 'echo_last_run', name: 'Echo Monitor Run', expected_hours: 25 },
          { key: 'echo_last_report', name: 'Echo Report', expected_hours: 25 },
          { key: 'last_email_scan', name: 'Email Scan', expected_hours: 3 },
          { key: 'last_gmail_watch', name: 'Gmail Watch', expected_hours: 168 },
          { key: 'last_ghl_sync', name: 'GHL Sync', expected_hours: 25 },
        ];
        const results = [];
        for (const cron of crons) {
          const rows = await query(`SELECT value FROM kv_store WHERE key = $1`, [cron.key]);
          const lastRun = rows[0]?.value as string | undefined;
          let status = 'inconnu';
          let hoursAgo = null;
          if (lastRun) {
            hoursAgo = Math.round((Date.now() - new Date(lastRun).getTime()) / 3600000);
            status = hoursAgo <= cron.expected_hours ? 'ok' : 'en_retard';
          }
          results.push({ cron: cron.name, last_run: lastRun ?? 'jamais', heures_depuis: hoursAgo, statut: status, attendu_max: `${cron.expected_hours}h` });
        }
        // Check bookings crons via recent data
        const [relanceCount, rappelCount, avisCount] = await Promise.all([
          query(`SELECT COUNT(*) as c FROM quotes WHERE statut = 'envoye' AND created_at < NOW() - INTERVAL '5 days'`),
          query(`SELECT COUNT(*) as c FROM bookings WHERE jour1_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '2 days' AND rappel_jour1_sent = false`),
          query(`SELECT COUNT(*) as c FROM bookings WHERE completed_at IS NOT NULL AND avis_sms_sent = false`),
        ]);
        return {
          crons: results,
          pending_actions: {
            relances_a_envoyer: Number(relanceCount[0]?.c ?? 0),
            rappels_a_envoyer: Number(rappelCount[0]?.c ?? 0),
            avis_a_envoyer: Number(avisCount[0]?.c ?? 0),
          },
        };
      },
    }),

    rapport_db: tool({
      description: 'Rapport de la base de donnees: nombre de rows par table, taille, activite recente.',
      parameters: z.object({}),
      execute: async () => {
        const tables = ['quotes', 'submissions', 'crm_leads', 'bookings', 'conversations', 'messages', 'email_logs', 'expenses', 'portfolio', 'kv_store', 'audit_logs'];
        const counts: Record<string, number> = {};
        for (const t of tables) {
          const rows = await query(`SELECT COUNT(*)::int as c FROM ${t}`);
          counts[t] = rows[0]?.c as number ?? 0;
        }
        // Recent activity
        const [recentQuotes, recentLeads, recentEmails, recentBookings] = await Promise.all([
          query(`SELECT COUNT(*)::int as c FROM quotes WHERE created_at >= NOW() - INTERVAL '7 days'`),
          query(`SELECT COUNT(*)::int as c FROM crm_leads WHERE created_at >= NOW() - INTERVAL '7 days'`),
          query(`SELECT COUNT(*)::int as c FROM email_logs WHERE created_at >= NOW() - INTERVAL '7 days'`),
          query(`SELECT COUNT(*)::int as c FROM bookings WHERE created_at >= NOW() - INTERVAL '7 days'`),
        ]);
        return {
          tables: counts,
          activite_7_jours: {
            devis: Number(recentQuotes[0]?.c ?? 0),
            leads_crm: Number(recentLeads[0]?.c ?? 0),
            emails: Number(recentEmails[0]?.c ?? 0),
            reservations: Number(recentBookings[0]?.c ?? 0),
          },
        };
      },
    }),

    verifier_integrations: tool({
      description: 'Teste les integrations externes en temps reel: Twilio, Gmail, Telegram, Stripe, Anthropic.',
      parameters: z.object({}),
      execute: async () => {
        const results: Record<string, { ok: boolean; detail: string }> = {};

        // Anthropic
        try {
          const res = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY ?? '', 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 5, messages: [{ role: 'user', content: 'ping' }] }),
          });
          results.anthropic = { ok: res.ok, detail: res.ok ? 'API fonctionnelle' : `Erreur ${res.status}` };
        } catch { results.anthropic = { ok: false, detail: 'Connection echouee' }; }

        // Telegram
        try {
          const res = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/getMe`);
          const data = await res.json();
          results.telegram = { ok: data.ok, detail: data.ok ? `Bot: @${data.result?.username}` : 'Token invalide' };
        } catch { results.telegram = { ok: false, detail: 'Connection echouee' }; }

        // Twilio
        const sid = process.env.TWILIO_ACCOUNT_SID;
        const token = process.env.TWILIO_AUTH_TOKEN;
        if (sid && token) {
          try {
            const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}.json`, {
              headers: { 'Authorization': 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64') },
            });
            results.twilio = { ok: res.ok, detail: res.ok ? 'Compte actif' : `Erreur ${res.status}` };
          } catch { results.twilio = { ok: false, detail: 'Connection echouee' }; }
        } else { results.twilio = { ok: false, detail: 'Non configure' }; }

        // Gmail
        results.gmail = { ok: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_REFRESH_TOKEN), detail: process.env.GOOGLE_CLIENT_ID ? 'Credentials presentes' : 'Non configure' };

        // Stripe
        if (process.env.STRIPE_SECRET_KEY) {
          try {
            const res = await fetch('https://api.stripe.com/v1/balance', {
              headers: { 'Authorization': `Bearer ${process.env.STRIPE_SECRET_KEY}` },
            });
            const data = await res.json();
            results.stripe = { ok: res.ok, detail: res.ok ? `Balance: ${data.available?.[0]?.amount / 100}$ CAD` : `Erreur ${res.status}` };
          } catch { results.stripe = { ok: false, detail: 'Connection echouee' }; }
        } else { results.stripe = { ok: false, detail: 'Non configure' }; }

        // DB
        try {
          const rows = await query(`SELECT 1 as ping`);
          results.database = { ok: rows.length > 0, detail: 'Neon PostgreSQL connecte' };
        } catch { results.database = { ok: false, detail: 'Connection echouee' }; }

        const total = Object.keys(results).length;
        const ok = Object.values(results).filter(r => r.ok).length;
        return { integrations: results, ok: ok, total, score: `${ok}/${total}` };
      },
    }),

    erreurs_recentes: tool({
      description: 'Verifie les erreurs recentes: scans email echoues, emails en erreur, alertes systeme.',
      parameters: z.object({}),
      execute: async () => {
        const [emailErrors, scanErrors, auditFails] = await Promise.all([
          query(`SELECT destinataire, sujet, created_at FROM email_logs WHERE statut = 'error' ORDER BY created_at DESC LIMIT 5`),
          query(`SELECT value FROM kv_store WHERE key = 'last_email_scan_error'`),
          query(`SELECT action, email, ip_address, created_at FROM audit_logs WHERE success = false ORDER BY created_at DESC LIMIT 5`),
        ]);
        return {
          emails_en_erreur: emailErrors,
          derniere_erreur_scan: scanErrors[0]?.value ?? 'aucune',
          tentatives_login_echouees: auditFails,
        };
      },
    }),

    rapport_complet: tool({
      description: 'Rapport de sante complet du systeme: env vars, integrations, crons, DB, erreurs. Le rapport ultime.',
      parameters: z.object({}),
      execute: async () => {
        return { note: 'Utilise les outils system_health + verifier_integrations + verifier_crons + rapport_db + erreurs_recentes pour generer un rapport complet. Appelle-les un par un.' };
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

    // ---------- ARIA NEW TOOLS ----------

    aria_emails_recents: tool({
      description: 'Voir les emails recents des dernieres 48h',
      parameters: z.object({}),
      execute: async () => {
        const emails = await query(`SELECT id, destinataire, sujet, statut, direction, created_at FROM email_logs WHERE created_at > NOW() - INTERVAL '48 hours' ORDER BY created_at DESC LIMIT 20`);
        return JSON.stringify(emails);
      },
    }),

    aria_emails_non_lus: tool({
      description: 'Emails entrants sans reponse',
      parameters: z.object({}),
      execute: async () => {
        const emails = await query(`SELECT id, destinataire, sujet, created_at FROM email_logs WHERE direction = 'inbound' AND reply_body IS NULL AND created_at > NOW() - INTERVAL '7 days' ORDER BY created_at DESC LIMIT 15`);
        return JSON.stringify(emails);
      },
    }),

    aria_stats_emails: tool({
      description: 'Statistiques emails: envoyes, ouverts, cliques, bounces',
      parameters: z.object({}),
      execute: async () => {
        const stats = await query(`SELECT COUNT(*)::int as total, COUNT(CASE WHEN statut = 'delivered' THEN 1 END)::int as delivered, COUNT(CASE WHEN statut = 'opened' THEN 1 END)::int as opened, COUNT(CASE WHEN statut = 'bounced' THEN 1 END)::int as bounced FROM email_logs WHERE created_at >= CURRENT_DATE - INTERVAL '7 days'`);
        return JSON.stringify(stats[0]);
      },
    }),

    // ---------- NOVA NEW TOOLS ----------

    nova_conversations_actives: tool({
      description: 'Conversations actives en attente de reponse',
      parameters: z.object({}),
      execute: async () => {
        const convs = await query(`SELECT id, canal, statut, updated_at FROM conversations WHERE statut IN ('active', 'pending_approval') ORDER BY updated_at DESC LIMIT 15`);
        return JSON.stringify(convs);
      },
    }),

    nova_derniers_messages: tool({
      description: 'Derniers messages recus de clients',
      parameters: z.object({}),
      execute: async () => {
        const msgs = await query(`SELECT m.id, m.conversation_id, m.role, substring(m.content from 1 for 200) as apercu, m.created_at FROM messages m WHERE m.role = 'user' AND m.created_at > NOW() - INTERVAL '48 hours' ORDER BY m.created_at DESC LIMIT 15`);
        return JSON.stringify(msgs);
      },
    }),

    nova_leads_chatbot: tool({
      description: 'Leads generes par le chatbot Nova',
      parameters: z.object({}),
      execute: async () => {
        const leads = await query(`SELECT s.id, s.nom, s.email, s.telephone, s.service, s.created_at FROM submissions s WHERE s.source = 'chatbot' OR s.source = 'nova' ORDER BY s.created_at DESC LIMIT 15`);
        return JSON.stringify(leads);
      },
    }),

    // ---------- SAGE NEW TOOLS ----------

    sage_portfolio_recent: tool({
      description: 'Dernieres photos ajoutees au portfolio',
      parameters: z.object({}),
      execute: async () => {
        const portfolio = await query(`SELECT id, titre, type_service, ville, array_length(photos, 1) as nb_photos, array_length(videos, 1) as nb_videos, featured, created_at FROM portfolio ORDER BY created_at DESC LIMIT 10`);
        return JSON.stringify(portfolio);
      },
    }),

    memoriser: tool({
      description: "Sauvegarder un fait important dans ta memoire permanente. Utilise pour te souvenir de preferences clients, decisions, observations importantes.",
      parameters: z.object({
        fait: z.string().describe("Le fait a retenir"),
        categorie: z.string().optional().describe("Categorie: client, lead, decision, observation, preference"),
      }),
      execute: async ({ fait, categorie }) => {
        const memKey = `agent_memory_${agentId}`;
        const existing = await getKv(memKey) as Array<{fait: string; categorie: string; date: string}> || [];
        existing.push({ fait, categorie: categorie || 'observation', date: new Date().toISOString() });
        // Keep last 100 memories per agent
        const trimmed = existing.slice(-100);
        await setKv(memKey, trimmed);
        return JSON.stringify({ ok: true, total_memories: trimmed.length, saved: fait });
      },
    }),

    rappeler: tool({
      description: "Consulter ta memoire permanente. Utilise au debut de chaque conversation pour te rappeler le contexte.",
      parameters: z.object({
        categorie: z.string().optional().describe("Filtrer par categorie: client, lead, decision, observation, preference"),
        recherche: z.string().optional().describe("Mot-cle pour chercher dans les faits"),
      }),
      execute: async ({ categorie, recherche }) => {
        const memKey = `agent_memory_${agentId}`;
        const memories = await getKv(memKey) as Array<{fait: string; categorie: string; date: string}> || [];
        let filtered = memories;
        if (categorie) filtered = filtered.filter(m => m.categorie === categorie);
        if (recherche) filtered = filtered.filter(m => m.fait.toLowerCase().includes(recherche.toLowerCase()));
        return JSON.stringify({ total: filtered.length, memories: filtered.slice(-20) });
      },
    }),
  };

  // Map agent -> tools
  const agentToolMap: Record<AgentId, (keyof typeof allTools)[]> = {
    marcel: ['stats_business', 'liste_devis', 'crm_leads_chauds', 'envoyer_sms', 'creer_devis', 'modifier_statut', 'liste_clients', 'rechercher_lead', 'voir_conversations', 'resume_emails', 'aria_emails_recents', 'nova_conversations_actives', 'memoriser', 'rappeler'],
    hunter: ['scorer_leads', 'plan_attaque', 'generer_relance_ia', 'crm_leads_chauds', 'liste_crm', 'memoriser', 'rappeler'],
    aria: ['resume_emails', 'liste_crm', 'aria_emails_recents', 'aria_emails_non_lus', 'aria_stats_emails', 'memoriser', 'rappeler'],
    rex: ['envoyer_sms', 'generer_relance_ia', 'liste_devis', 'crm_leads_chauds', 'memoriser', 'rappeler'],
    iris: ['stats_business', 'liste_devis', 'revenus_analyse', 'rapport_projet', 'liste_employes', 'ajouter_heures', 'relier_depense', 'depenses_non_reliees', 'reconciliation_banque', 'memoriser', 'rappeler'],
    sage: ['generer_post', 'scan_drive_portfolio', 'preview_drive', 'stats_portfolio', 'sage_portfolio_recent', 'memoriser', 'rappeler'],
    zara: ['liste_reservations', 'creer_reservation', 'confirmer_reservation', 'deplacer_reservation', 'voir_agenda', 'jours_disponibles', 'stats_business', 'liste_devis', 'memoriser', 'rappeler'],
    bolt: ['envoyer_telegram', 'resume_journee', 'planning_semaine', 'alerte_leads_chauds', 'devis_en_attente', 'stats_business', 'memoriser', 'rappeler'],
    echo: ['system_health', 'verifier_crons', 'rapport_db', 'verifier_integrations', 'erreurs_recentes', 'rapport_complet', 'memoriser', 'rappeler'],
    nova: ['voir_conversations', 'stats_nova', 'nova_conversations_actives', 'nova_derniers_messages', 'nova_leads_chatbot', 'memoriser', 'rappeler'],
    jason: ['jason_mes_leads', 'jason_envoyer_email', 'jason_envoyer_sms', 'jason_stats', 'scorer_leads', 'generer_relance_ia', 'plan_attaque', 'crm_leads_chauds', 'memoriser', 'rappeler'],
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
  const base = `Tu travailles pour Novus Epoxy — planchers epoxy haut de gamme au Quebec.\nEquipe: Luca (fondateur, 581-307-5983) et Jason (ventes, 581-307-2678).\nDate: ${date}\nSois direct, professionnel, en francais quebecois. Utilise les outils disponibles pour des donnees reelles.\nIMPORTANT: Au debut de chaque conversation, utilise l'outil 'rappeler' pour consulter ta memoire. Quand tu apprends quelque chose d'important sur un client, un lead, ou une decision, utilise 'memoriser' pour le sauvegarder. Ta memoire persiste entre les conversations.`;

  const prompts: Record<AgentId, string> = {
    marcel: `Tu es Marcel, le Chef de Cabinet de Novus Epoxy. Tu geres tout: devis, leads, SMS, emails, stats. Tu es le bras droit de l'equipe.\n${base}\nTu peux agir: creer devis, envoyer SMS, modifier statuts, scorer leads, generer relances.`,
    hunter: `Tu es Hunter, le Dark Hunter de Novus Epoxy. Ta mission: traquer, scorer et qualifier les leads. Tu es un predateur commercial — chaque lead compte.\n${base}\nTu scores les leads, tu generes des plans d'attaque, tu identifies les opportunites chaudes.`,
    aria: `Tu es Aria, l'agente email de Novus Epoxy. Tu geres la boite email, tu resumes les messages importants, tu identifies les leads qui ont repondu.\n${base}\nTu lis et resumes les emails, tu identifies les opportunites cachees dans la boite de reception.\nTu peux voir les emails recents, identifier ceux sans reponse, et analyser les stats de delivrabilite.`,
    rex: `Tu es Rex, le Closer SMS de Novus Epoxy. Tu es le roi des relances par texto. Court, punchy, efficace.\n${base}\nTu generes des relances SMS percutantes et tu les envoies directement.`,
    iris: `Tu es Iris, l'analyste financiere de Novus Epoxy. Tu vois les chiffres, les tendances, les opportunites de revenus.\n${base}\nTu analyses les revenus, le pipeline de devis, et tu identifies les opportunites financieres.\nTu peux aussi: generer des rapports par projet, gerer les heures des employes, relier des depenses aux projets, et faire la reconciliation bancaire.`,
    sage: `Tu es Sage, la creatrice de contenu et gestionnaire de portfolio de Novus Epoxy. Tu geres le portfolio photo automatiquement: scan du Google Drive de Jason, classification par IA (type, couleur, qualite), upload sur Vercel Blob, et integration dans le portfolio DB. Tu generes aussi du contenu marketing pour Instagram et Facebook.\n${base}\nTu scannes le Drive pour de nouvelles photos, tu les classifies avec Vision, et tu les ajoutes au portfolio. Les photos du portfolio sont automatiquement utilisees par Hunter dans les emails de prospection.\nTu peux voir les dernieres photos du portfolio.`,
    zara: `Tu es Zara, la gestionnaire de reservations de Novus Epoxy. Tu geres le calendrier complet: creer, deplacer, confirmer des reservations.\n${base}\nLes travaux epoxy prennent generalement 2 jours consecutifs (jour1 = application, jour2 = finition). Slot = matin ou apres-midi.\nQuand on te demande de placer une reservation, verifie les jours disponibles d'abord, puis cree la reservation.\nQuand un depot est paye et que le client veut reserver, cree la reservation et confirme-la.\nTu peux aussi voir l'agenda de la semaine et deplacer des reservations si besoin.\nPas de travaux la fin de semaine (samedi/dimanche).`,
    bolt: `Tu es Bolt, le commandant des communications de Novus Epoxy. Tu es le lien entre le dashboard et l'equipe sur Telegram.\n${base}\nTon role:\n- Resume quotidien: compile les stats du jour et envoie un beau message sur Telegram\n- Planning semaine: genere le planning avec tous les chantiers de la semaine\n- Alerte leads chauds: identifie les leads a contacter d'urgence\n- Devis en attente: rappelle les devis qui trainent\nQuand tu envoies sur Telegram, formate en HTML (<b>, <i>, emojis) pour que ce soit clair et beau.\nTu es le motivateur de l'equipe — chaque message doit etre energique et actionnable.`,
    echo: `Tu es Echo, le gardien du systeme Novus Epoxy. Tu surveilles TOUT: integrations (Twilio, Gmail, Stripe, Telegram, Anthropic), crons, base de donnees, erreurs recentes, tentatives de login.\n${base}\nQuand on te demande un rapport, utilise TOUS tes outils pour donner un portrait complet. Si quelque chose est en panne ou en retard, signale-le clairement avec des solutions.\nTu peux tester les integrations en temps reel (ping Anthropic, Telegram, Twilio, Stripe).\nTu es le systeme d'alerte — si tu vois un probleme, sois direct et clair.`,
    nova: `Tu es Nova, l'agente chatbot de Novus Epoxy. Tu geres les conversations automatiques avec les clients potentiels.\n${base}\nTu vois les conversations en cours, les devis generes automatiquement, et les leads en attente d'approbation.\nTu peux voir les conversations actives, les derniers messages clients, et les leads generes par le chatbot.`,
    jason: `Tu es Denis, le Prospecteur Avance de Novus Epoxy. Tu es l'agent autonome de Jason — tu geres toute sa prospection.\n${base}\nTu envoies les emails depuis jason@novusepoxy.shop (SMTP Hostinger) et les SMS depuis le 581-709-5940 (numero Twilio de Jason).\nTon role: voir les leads de Jason, envoyer des emails/SMS de prospection personnalises, scorer les leads, generer des plans d'attaque.\nJason est le vendeur terrain — il va sur le terrain faire les soumissions. Toi tu prepares le terrain en amont.\nQuand tu envoies un email de prospection, inclus toujours des photos du portfolio et un CTA vers novusepoxy.ca/#contact.\nQuand tu envoies un SMS, signe toujours "Jason — Novus Epoxy 581-307-2678".\nTon ton est direct, motivant, axe resultats. Tu es un predateur commercial silencieux.`,
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
    model: anthropic('claude-sonnet-4-6'),
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
      const trimmed = current.slice(-30);
      await setKv(historyKey, trimmed);
    },
  });

  return result.toDataStreamResponse();
}

import { NextRequest } from 'next/server';
import { streamText, tool } from 'ai';
import { getStreamingModel } from '@/lib/llm';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { query } from '@/lib/db';
import { SERVICES, type ServiceType, calculateQuote, formatMoney } from '@/lib/pricing';
import { sendSMS } from '@/lib/sms';
import { google } from 'googleapis';
import { runAction } from '@/lib/composio';
import { getActivePromo, formatPromoText } from '@/lib/promotions';

export const maxDuration = 60;

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

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return new Response('Non autorisé', { status: 401 });

  const authorName = (session.user?.name ?? session.user?.email?.split('@')[0] ?? 'Admin') as string;

  const body = await req.json() as { messages: Array<{ role: string; content: string }> };
  const clientMessages = body.messages ?? [];

  // Load shared history from kv_store
  const history = await getKv('marcel_history_shared') as Array<{ role: string; content: string; author?: string }>;

  // Build messages for the model: use history as context, then new user message
  const lastUserMsg = clientMessages[clientMessages.length - 1];
  if (!lastUserMsg || lastUserMsg.role !== 'user') {
    return new Response('Message requis', { status: 400 });
  }

  // Inject author name into the content
  const userContent = `[${authorName}]: ${lastUserMsg.content}`;

  // Build conversation from history (last 20 exchanges = 40 messages)
  const historyMsgs = history.slice(-40).map(m => ({
    role: m.role as 'user' | 'assistant',
    content: m.content,
  }));

  const systemPrompt = `Tu es Marcel, l'agent IA de Novus Epoxy — planchers époxy haut de gamme au Québec.
Tu travailles directement avec l'équipe interne: Luca (fondateur, 581-307-5983) et Jason (ventes, 581-307-2678).
Les messages arrivent sous la forme [Prénom]: message. Tu peux voir qui parle et adapter ta réponse.
Tu as accès à toute la base de données du business et tu peux prendre action.

IMPORTANT:
- Sois direct, professionnel, en français québécois
- Utilise les outils disponibles pour répondre avec des données réelles
- Pour les devis: toujours mentionner que les prix sont personnalisables selon volume, donneur d'ouvrage, promoteur immobilier, entrepreneur général
- Si quelqu'un demande des stats → utilise stats_business
- Si quelqu'un demande les leads chauds → utilise crm_leads_chauds
- Si quelqu'un demande les devis → utilise liste_devis
- Si quelqu'un demande quels leads contacter en priorité → utilise scorer_leads
- Si quelqu'un veut savoir comment approcher un lead spécifique → utilise plan_attaque
- Si quelqu'un veut un message de relance → utilise generer_relance_ia puis propose envoyer_sms
- Si quelqu'un demande un rapport / export / tableau → utilise generer_rapport_sheets
- Si quelqu'un veut planifier un RDV / chantier → utilise creer_event_calendar
- Tu peux agir: créer devis, envoyer SMS, modifier statuts, scorer leads, générer relances, créer des rapports Sheets, planifier des events Calendar

Date: ${new Date().toLocaleDateString('fr-CA', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}`;

  const result = streamText({
    model: getStreamingModel('top'),
    system: systemPrompt,
    messages: [
      ...historyMsgs,
      { role: 'user', content: userContent },
    ],
    maxSteps: 5,
    tools: {
      stats_business: tool({
        description: 'Récupère les statistiques du business: devis du jour, revenus, leads, etc.',
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
        description: 'Liste les devis récents avec leur statut.',
        parameters: z.object({
          statut: z.string().optional().describe('Filtrer par statut'),
          limit: z.number().optional().default(5),
        }),
        execute: async ({ statut, limit = 5 }) => {
          const validStatuts = ['brouillon','en_attente','approuve','envoye','contrat_signe','depot_paye','planifie','complete','refuse'];
          const safeStatut = statut && validStatuts.includes(statut) ? statut : '';
          const lim = Math.min(limit, 20);
          const rows = safeStatut
            ? await query(`SELECT id, client_nom, client_tel, type_service, superficie, total, statut, created_at FROM quotes WHERE statut = $1 ORDER BY id DESC LIMIT $2`, [safeStatut, lim])
            : await query(`SELECT id, client_nom, client_tel, type_service, superficie, total, statut, created_at FROM quotes ORDER BY id DESC LIMIT $1`, [lim]);
          return rows;
        },
      }),

      detail_devis: tool({
        description: 'Récupère le détail complet d\'un devis par son ID.',
        parameters: z.object({ id: z.number() }),
        execute: async ({ id }) => {
          const rows = await query('SELECT * FROM quotes WHERE id = $1', [id]);
          return rows[0] ?? { error: 'Devis introuvable' };
        },
      }),

      approuver_envoyer_devis: tool({
        description: 'Approuve et marque comme envoyé un devis brouillon.',
        parameters: z.object({ id: z.number() }),
        execute: async ({ id }) => {
          await query(`UPDATE quotes SET statut = 'approuve', approved_at = NOW() WHERE id = $1`, [id]);
          return { ok: true, devis_id: id, statut: 'approuve' };
        },
      }),

      crm_leads_chauds: tool({
        description: 'Récupère les leads CRM chauds ou récents à contacter.',
        parameters: z.object({
          temperature: z.enum(['chaud','tiede','froid']).optional(),
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

      liste_crm: tool({
        description: 'Liste tous les leads CRM avec filtres.',
        parameters: z.object({
          statut: z.string().optional(),
          limit: z.number().optional().default(15),
        }),
        execute: async ({ statut, limit = 15 }) => {
          const lim = Math.min(limit, 50);
          const validStatuts = ['nouveau','contacte','interesse','qualification','negocie','gagne','perdu','froid','ferme'];
          const safeStatut = statut && validStatuts.includes(statut) ? statut : '';
          const rows = safeStatut
            ? await query(`SELECT id, nom, telephone, email, service, superficie, ville, statut, temperature, created_at FROM crm_leads WHERE statut = $1 ORDER BY created_at DESC LIMIT $2`, [safeStatut, lim])
            : await query(`SELECT id, nom, telephone, email, service, superficie, ville, statut, temperature, created_at FROM crm_leads ORDER BY created_at DESC LIMIT $1`, [lim]);
          return { leads: rows, total: rows.length };
        },
      }),

      creer_devis: tool({
        description: 'Crée un devis brouillon dans la base de données.',
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
          return { devis_id: rows[0].id, client: client_nom, total: formatMoney(calc.total), depot: formatMoney(calc.depot_requis), statut: 'brouillon', dashboard: `https://novus-epoxy.vercel.app/dashboard/devis/${rows[0].id}` };
        },
      }),

      calculer_prix: tool({
        description: 'Calcule le prix d\'un devis sans le créer.',
        parameters: z.object({
          type_service: z.enum(['flake', 'metallique', 'commercial']),
          superficie: z.number(),
        }),
        execute: async ({ type_service, superficie }) => {
          const calc = calculateQuote(type_service as ServiceType, superficie);
          const service = SERVICES[type_service as ServiceType];
          return {
            service: service.label,
            superficie: `${superficie} pi²`,
            prix_pied_carre: formatMoney(calc.prix_pied_carre),
            sous_total: formatMoney(calc.sous_total),
            tps: formatMoney(calc.tps),
            tvq: formatMoney(calc.tvq),
            total: formatMoney(calc.total),
            depot_30pct: formatMoney(calc.depot_requis),
            note: 'Prix personnalisables selon volume, donneur d\'ouvrage, promoteur immobilier, entrepreneur général',
          };
        },
      }),

      modifier_statut: tool({
        description: 'Change le statut d\'un devis.',
        parameters: z.object({
          id: z.number(),
          statut: z.string(),
        }),
        execute: async ({ id, statut }) => {
          const validStatuts = ['brouillon','en_attente','approuve','envoye','contrat_signe','depot_paye','planifie','complete','refuse'];
          if (!validStatuts.includes(statut)) return { error: 'Statut invalide' };
          await query(`UPDATE quotes SET statut = $1 WHERE id = $2`, [statut, id]);
          return { ok: true, devis_id: id, nouveau_statut: statut };
        },
      }),

      envoyer_sms: tool({
        description: 'Envoie un SMS à un numéro de téléphone.',
        parameters: z.object({
          telephone: z.string(),
          message: z.string(),
        }),
        execute: async ({ telephone, message }) => {
          const sent = await sendSMS(telephone, message);
          return { envoye: sent, telephone };
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

      voir_conversations: tool({
        description: 'Voir les conversations récentes du chatbot Nova et les follow-ups email des leads CRM.',
        parameters: z.object({}),
        execute: async () => {
          const [convs, leadConvs] = await Promise.all([
            query(`SELECT c.id, c.statut, c.created_at, (SELECT m.content FROM messages m WHERE m.conversation_id = c.id AND m.role = 'user' ORDER BY m.created_at DESC LIMIT 1) as dernier_message FROM conversations c ORDER BY c.updated_at DESC LIMIT 8`),
            query(`SELECT nom, email, statut, temperature, followup_count, last_agent_reply_at FROM crm_leads WHERE last_agent_reply_at IS NOT NULL ORDER BY last_agent_reply_at DESC LIMIT 10`),
          ]);
          return { conversations_nova: convs, followups_crm: leadConvs };
        },
      }),

      rechercher_lead: tool({
        description: 'Recherche un lead/client par nom, email ou téléphone dans toutes les tables.',
        parameters: z.object({
          terme: z.string().describe('Nom, email ou téléphone'),
        }),
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

      scorer_leads: tool({
        description: 'Score et classe tous les leads CRM par priorité pour maximiser les chances de conversion. Retourne un classement avec score et recommandation d\'action pour chaque lead.',
        parameters: z.object({
          limit: z.number().optional().default(20),
        }),
        execute: async ({ limit = 20 }) => {
          const lim = Math.min(limit, 50);
          const leads = await query(
            `SELECT id, nom, telephone, email, service, superficie, ville, statut, temperature,
                    followup_count, last_agent_reply_at, created_at,
                    EXTRACT(EPOCH FROM (NOW() - created_at))/86400 as jours_depuis_creation,
                    EXTRACT(EPOCH FROM (NOW() - COALESCE(last_agent_reply_at, created_at)))/86400 as jours_depuis_contact
             FROM crm_leads
             WHERE statut NOT IN ('ferme','froid','perdu')
             ORDER BY created_at DESC LIMIT $1`,
            [lim]
          );

          const scored = leads.map((lead: Record<string, unknown>) => {
            let score = 0;
            const flags: string[] = [];

            // Température
            if (lead.temperature === 'chaud') { score += 40; flags.push('🔥 CHAUD'); }
            else if (lead.temperature === 'tiede') { score += 20; flags.push('🌡 TIÈDE'); }

            // Infos complètes
            if (lead.email) { score += 15; flags.push('📧 email'); }
            if (lead.telephone) { score += 10; flags.push('📞 tel'); }
            if (lead.superficie) { score += 10; flags.push(`📐 ${lead.superficie}pi²`); }
            if (lead.service) { score += 5; }

            // Urgence temporelle
            const jours = Number(lead.jours_depuis_creation ?? 0);
            const joursContact = Number(lead.jours_depuis_contact ?? 0);
            if (jours <= 2) { score += 20; flags.push('🆕 nouveau'); }
            else if (jours <= 7) { score += 10; flags.push('📅 <7 jours'); }

            // Pas encore contacté
            if (lead.followup_count === 0 || lead.followup_count === null) { score += 15; flags.push('⚡ jamais contacté'); }

            // Inactif trop longtemps (risque de se refroidir)
            if (joursContact > 14 && lead.temperature !== 'froid') { score -= 10; flags.push('⚠️ inactif 14j+'); }

            // Recommandation
            let action = '';
            if (score >= 70) action = '🎯 APPELER MAINTENANT';
            else if (score >= 45) action = '📱 SMS personnalisé';
            else if (score >= 25) action = '📧 Email de suivi';
            else action = '🔄 Requalifier';

            return {
              id: lead.id,
              nom: lead.nom,
              telephone: lead.telephone,
              email: lead.email,
              service: lead.service,
              superficie: lead.superficie,
              ville: lead.ville,
              score,
              flags,
              action,
              jours_depuis_creation: Math.round(jours),
              followup_count: lead.followup_count ?? 0,
            };
          });

          scored.sort((a: { score: number }, b: { score: number }) => b.score - a.score);
          return { leads_classes: scored, total: scored.length, top_priorite: scored.slice(0, 5) };
        },
      }),

      plan_attaque: tool({
        description: 'Génère un plan d\'attaque personnalisé pour un lead CRM spécifique — analyse du profil, script d\'approche, objections probables et closing strategy.',
        parameters: z.object({
          lead_id: z.number().describe('ID du lead CRM'),
        }),
        execute: async ({ lead_id }) => {
          const rows = await query(
            `SELECT l.*,
                    EXTRACT(EPOCH FROM (NOW() - l.created_at))/86400 as jours_depuis_creation,
                    EXTRACT(EPOCH FROM (NOW() - COALESCE(l.last_agent_reply_at, l.created_at)))/86400 as jours_sans_contact
             FROM crm_leads l WHERE l.id = $1`,
            [lead_id]
          );
          if (!rows[0]) return { error: 'Lead introuvable' };
          const l = rows[0] as Record<string, unknown>;

          const jours = Math.round(Number(l.jours_depuis_creation ?? 0));
          const sansContact = Math.round(Number(l.jours_sans_contact ?? 0));
          const followups = Number(l.followup_count ?? 0);

          // Build attack plan
          const profil = {
            nom: l.nom,
            service: l.service || 'non précisé',
            superficie: l.superficie ? `${l.superficie} pi²` : 'non précisé',
            ville: l.ville || 'non précisé',
            temperature: l.temperature,
            jours_depuis_creation: jours,
            jours_sans_contact: sansContact,
            followups_envoyes: followups,
          };

          const canal_recommande = l.telephone
            ? (sansContact < 3 ? 'SMS (lead frais, réactif)' : 'Appel téléphonique')
            : l.email
              ? 'Email personnalisé'
              : 'Trouver coordonnées';

          const urgence = jours <= 3 ? 'MAXIMALE — lead très frais' :
            jours <= 7 ? 'HAUTE — fenêtre dorée' :
              jours <= 14 ? 'MODÉRÉE — agir vite' : 'FAIBLE — lead refroidit';

          const script_approche = l.telephone
            ? `"Bonjour ${String(l.nom).split(' ')[0]}! C'est Jason de Novus Epoxy. Je t'appelle par rapport à ton projet${l.service ? ` de plancher ${l.service}` : ''}${l.ville ? ` à ${l.ville}` : ''}. As-tu 2 minutes?"`
            : `Objet: Votre projet de plancher époxy${l.superficie ? ` — ${l.superficie} pi²` : ''} — Soumission gratuite`;

          const promo = await getActivePromo();
          const promoMention = promo.active
            ? `mentionner ${promo.label} ${promo.pct}%`
            : 'mettre l\'accent sur la valeur + garantie';

          const objections_probables = [];
          if (followups >= 1) objections_probables.push(`A déjà reçu un contact — ${promoMention}`);
          if (jours > 7) objections_probables.push('Peut avoir trouvé un autre fournisseur — demander directement');
          if (!l.superficie) objections_probables.push('Pas encore qualifié — découvrir les besoins');
          if (l.temperature === 'froid') objections_probables.push('Lead refroidi — approche valeur long terme');

          return {
            profil,
            urgence_niveau: urgence,
            canal_recommande,
            script_approche,
            objections_probables,
            promo_active: promo.active ? formatPromoText(promo) : null,
            closing_tip: l.temperature === 'chaud'
              ? '🎯 Lead chaud — proposer rendez-vous directement'
              : followups === 0
                ? '⚡ Premier contact — se concentrer sur la découverte des besoins'
                : promo.active
                  ? `🔄 Relance — rappeler la valeur + ${promo.label} ${promo.pct}%`
                  : '🔄 Relance — rappeler la valeur + garantie',
            lien_dashboard: `https://novus-epoxy.vercel.app/dashboard/crm`,
          };
        },
      }),

      generer_relance_ia: tool({
        description: 'Génère un message de relance ultra-personnalisé (SMS ou email) pour un lead CRM spécifique, basé sur son profil et historique.',
        parameters: z.object({
          lead_id: z.number(),
          canal: z.enum(['sms', 'email']).default('sms'),
          ton: z.enum(['direct', 'chaleureux', 'urgence']).default('chaleureux'),
        }),
        execute: async ({ lead_id, canal, ton }) => {
          const rows = await query(
            `SELECT * FROM crm_leads WHERE id = $1`,
            [lead_id]
          );
          if (!rows[0]) return { error: 'Lead introuvable' };
          const l = rows[0] as Record<string, unknown>;

          const prenom = String(l.nom ?? '').split(' ')[0];
          const service = l.service ? String(l.service) : 'plancher époxy';
          const superficie = l.superficie ? ` de ${l.superficie} pi²` : '';
          const ville = l.ville ? ` à ${l.ville}` : '';

          // Promo dynamique — jamais hard-coded
          const promo = await getActivePromo();
          const promoSms = promo.active ? ` ${promo.label} ${promo.pct}% en ce moment.` : '';
          const promoSmsUrgence = promo.active
            ? `Rabais ${promo.pct}% ${promo.label} se termine bientôt. `
            : '';
          const promoEmailSujet = promo.active ? `${promo.label} ${promo.pct}% — ` : '';
          const promoEmailBody = promo.active
            ? `\n\nNous offrons actuellement un rabais de ${promo.pct}% (${promo.label}).`
            : '';

          let message = '';

          if (canal === 'sms') {
            if (ton === 'direct') {
              message = `Bonjour ${prenom}! Jason de Novus Epoxy. Toujours intéressé par votre projet${superficie}?${promoSms} Soumission gratuite: novusepoxy.ca/#contact ou 581-307-2678`;
            } else if (ton === 'urgence') {
              message = `${prenom}! ${promoSmsUrgence}Votre projet${superficie}${ville} — on peut vous préparer une soumission cette semaine. Intéressé? 581-307-2678`;
            } else {
              message = `Bonjour ${prenom}! C'est Jason de Novus Epoxy. On pense encore à votre projet de ${service}${superficie}${ville}. Si vous avez des questions ou voulez une soumission gratuite, on est là! 581-307-2678`;
            }
          } else {
            const sujet = ton === 'urgence'
              ? `${promoEmailSujet}Votre projet ${service}${superficie}`
              : `Votre soumission ${service}${superficie} — Novus Epoxy`;

            const corps = ton === 'direct'
              ? `Bonjour ${prenom},\n\nSuite à votre intérêt pour un ${service}${superficie}${ville}, nous voulions vous rappeler que notre équipe est disponible pour vous préparer une soumission gratuite.${promoEmailBody}\n\nPour obtenir votre soumission: novusepoxy.ca/#contact\n\nÀ bientôt,\nJason — Novus Epoxy\n581-307-2678`
              : `Bonjour ${prenom},\n\nNous espérons que tout va bien! Nous pensons encore à votre projet de ${service}${superficie}${ville}.${promoEmailBody}\n\nSi vous avez des questions ou souhaitez qu'on vous prépare une soumission personnalisée, on est disponibles.\n\nBonne journée,\nJason — Novus Epoxy\n📞 581-307-2678\n🌐 novusepoxy.ca`;

            message = `SUJET: ${sujet}\n\n${corps}`;
          }

          return {
            lead: { id: l.id, nom: l.nom, telephone: l.telephone, email: l.email },
            canal,
            ton,
            message_genere: message,
            note: 'Révisez avant d\'envoyer. Utilisez envoyer_sms pour envoyer par SMS.',
          };
        },
      }),

      resume_emails: tool({
        description: 'Lit les derniers emails reçus sur gestionnovusepoxy@gmail.com.',
        parameters: z.object({
          nombre: z.number().optional().default(5),
          non_lus_seulement: z.boolean().optional().default(false),
        }),
        execute: async ({ nombre = 5, non_lus_seulement = false }) => {
          const clientId = process.env.GOOGLE_CLIENT_ID;
          const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
          const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
          if (!clientId || !clientSecret || !refreshToken) {
            return { error: 'Gmail API non configuré' };
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

      generer_rapport_sheets: tool({
        description: 'Génère un rapport Google Sheets (CRM ou revenus) et retourne le lien. Utilise quand quelqu\'un demande un rapport, export CRM, ou statistiques en tableau.',
        parameters: z.object({
          type: z.enum(['crm', 'revenue']).describe('crm = leads par source/statut/température, revenue = revenus par mois'),
        }),
        execute: async ({ type }) => {
          const base = process.env.NEXTAUTH_URL ?? 'https://novus-epoxy.srv1478812.hstgr.cloud';
          try {
            const res = await fetch(`${base}/api/composio/sheets-report`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ type }),
            });
            const data = await res.json() as { url?: string; title?: string; error?: string };
            if (data.url) return { url: data.url, titre: data.title, statut: 'ok' };
            return { erreur: data.error ?? 'rapport échoué — connecte Google Sheets dans Intégrations' };
          } catch (err) {
            return { erreur: String(err) };
          }
        },
      }),

      creer_event_calendar: tool({
        description: 'Crée un événement Google Calendar. Utilise pour planifier des RDV, suivis, chantiers.',
        parameters: z.object({
          titre: z.string().describe('Titre de l\'événement'),
          date: z.string().describe('Date et heure ISO (ex: 2026-05-30T09:00:00)'),
          duree_minutes: z.number().optional().describe('Durée en minutes (défaut: 60)'),
          description: z.string().optional().describe('Notes / détails'),
        }),
        execute: async ({ titre, date, duree_minutes = 60, description }) => {
          const start = new Date(date);
          const end = new Date(start.getTime() + duree_minutes * 60000);
          const result = await runAction('GOOGLECALENDAR_CREATE_EVENT', {
            summary: titre,
            start: { dateTime: start.toISOString(), timeZone: 'America/Toronto' },
            end: { dateTime: end.toISOString(), timeZone: 'America/Toronto' },
            description: description ?? '',
          });
          if (result.ok) return { statut: 'créé', titre, date: start.toLocaleString('fr-CA') };
          return { erreur: result.error ?? 'Événement non créé — connecte Google Calendar dans Intégrations' };
        },
      }),
    },

    onFinish: async ({ text }) => {
      // Save exchange to shared history
      const current = await getKv('marcel_history_shared') as Array<{ role: string; content: string; author?: string; ts: number }>;
      current.push({ role: 'user', content: userContent, author: authorName, ts: Date.now() });
      current.push({ role: 'assistant', content: text, author: 'Marcel', ts: Date.now() });
      // Keep last 60 messages
      const trimmed = current.slice(-60);
      await setKv('marcel_history_shared', trimmed);
    },
  });

  return result.toDataStreamResponse();
}

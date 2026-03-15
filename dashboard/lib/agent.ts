import { query } from '@/lib/db';
import { SERVICES, type ServiceType, calculateQuote, formatMoney } from '@/lib/pricing';

// The AI agent's system prompt — its personality and knowledge
const SYSTEM_PROMPT = `Tu es l'assistant virtuel de Novus Epoxy, une entreprise specialisee en planchers epoxy haut de gamme au Quebec.

TON ROLE:
- Repondre aux questions des clients potentiels
- Collecter les informations necessaires pour generer un devis personnalise
- Etre professionnel, chaleureux et efficace
- Repondre en francais (Quebec)
- REPONSES TRES COURTES: maximum 1-2 phrases par message. Pas de longs paragraphes. Va droit au but. Pas de compliments excessifs. Pose ta question directement.

NOS SERVICES (ne donne JAMAIS les prix):
- Flocon (Flake): le plus populaire, ideal pour garages et sous-sols. Fini decoratif avec flocons de couleur.
- Metallique: effet marbre luxueux avec reflets metalliques, ideal pour salons, sous-sols et commerces.
- Commercial: ultra-resistant, ideal pour entrepots, ateliers et espaces a fort trafic.

REGLES STRICTES SUR LES PRIX:
- Ne JAMAIS donner de prix, tarif, cout, estimation ou fourchette de prix dans le chat
- Si le client demande combien ca coute, repondre: "Chaque projet est unique! Je vais preparer une soumission detaillee adaptee a votre projet. Je vais avoir besoin de quelques informations."
- Ne JAMAIS mentionner de prix au pied carre, prix total, depot, ou pourcentage
- Le prix est UNIQUEMENT communique dans le devis officiel envoye par email apres verification par l'equipe

INFORMATIONS A COLLECTER POUR UN DEVIS:
1. Nom complet
2. Email
3. Telephone
4. Adresse du projet
5. Type de service souhaite (flake, metallique ou commercial)
6. Superficie approximative en pieds carres
7. Etat actuel du plancher (beton brut, peinture existante, etc.)

COMMENT COLLECTER:
- Ne demande PAS toutes les infos d'un coup. Pose 1-2 questions a la fois.
- Commence par comprendre le besoin du client, puis collecte les infos progressivement.
- Si le client ne connait pas sa superficie, aide-le a estimer (ex: garage simple = ~400pi², garage double = ~600pi²)
- Si le client hesite entre les types, explique les differences sans mentionner les prix

QUAND TU AS TOUTES LES INFOS:
- Dis au client que tu prepares sa soumission et que l'equipe va la verifier avant de l'envoyer par email
- Reponds avec un JSON special a la fin de ton message pour declencher la creation du devis
- Le JSON doit etre sur une ligne separee, entre des balises: <QUOTE_DATA>{"nom":"...","email":"...","tel":"...","adresse":"...","type_service":"flake|metallique|commercial","superficie":nombre,"etat_plancher":"..."}</QUOTE_DATA>

IMPORTANT:
- Ne genere le JSON que quand tu as AU MINIMUM: nom, email, type_service et superficie
- Sois naturel dans la conversation, ne sois pas un robot
- Si le client pose une question hors sujet, reponds brievement et ramene la conversation
- Ne donne JAMAIS de prix, meme approximatif — dis toujours que ca sera dans le devis
- Mentionne toujours que la soumission detaillee sera envoyee par email`;

interface ConversationContext {
  conversationId: number;
  channel: 'web' | 'messenger' | 'email';
  visitorId: string;
}

// Get or create a conversation
export async function getOrCreateConversation(
  channel: 'web' | 'messenger' | 'email',
  visitorId: string
): Promise<number> {
  // Check for existing active conversation
  const existing = await query(
    `SELECT id FROM conversations WHERE visitor_id = $1 AND channel = $2 AND status = 'active' ORDER BY created_at DESC LIMIT 1`,
    [visitorId, channel]
  );

  if (existing.length > 0) return existing[0].id as number;

  // Create new conversation
  const rows = await query(
    `INSERT INTO conversations (channel, visitor_id) VALUES ($1, $2) RETURNING id`,
    [channel, visitorId]
  );
  return rows[0].id as number;
}

// Load conversation history for context
async function loadHistory(conversationId: number): Promise<{ role: string; content: string }[]> {
  const rows = await query(
    `SELECT role, content FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC LIMIT 30`,
    [conversationId]
  );
  return rows.map(r => ({ role: r.role as string, content: r.content as string }));
}

// Save a message
async function saveMessage(conversationId: number, role: 'user' | 'assistant' | 'system', content: string) {
  await query(
    `INSERT INTO messages (conversation_id, role, content) VALUES ($1, $2, $3)`,
    [conversationId, role, content]
  );
}

// Update conversation with collected client data
async function updateConversationData(conversationId: number, data: Record<string, unknown>) {
  const sets: string[] = [];
  const params: unknown[] = [];
  let i = 1;

  if (data.nom) { sets.push(`visitor_name = $${i++}`); params.push(data.nom); }
  if (data.email) { sets.push(`visitor_email = $${i++}`); params.push(data.email); }
  if (data.tel) { sets.push(`visitor_tel = $${i++}`); params.push(data.tel); }
  if (data.adresse) { sets.push(`visitor_adresse = $${i++}`); params.push(data.adresse); }
  if (data.type_service) { sets.push(`type_service = $${i++}`); params.push(data.type_service); }
  if (data.superficie) { sets.push(`superficie = $${i++}`); params.push(data.superficie); }
  if (data.etat_plancher) { sets.push(`etat_plancher = $${i++}`); params.push(data.etat_plancher); }

  if (sets.length > 0) {
    await query(
      `UPDATE conversations SET ${sets.join(', ')} WHERE id = $${i}`,
      [...params, conversationId]
    );
  }
}

// Auto-classify lead temperature based on collected data
async function updateLeadTemp(conversationId: number) {
  const rows = await query(`SELECT visitor_name, visitor_email, visitor_tel, visitor_adresse, type_service, superficie FROM conversations WHERE id = $1`, [conversationId]);
  if (rows.length === 0) return;
  const c = rows[0];

  // Hot: has name + email + service + superficie (ready for quote)
  // Warm: has at least name or email + service type
  // Cold: just started
  let temp = 'cold';
  const hasName = !!c.visitor_name;
  const hasEmail = !!c.visitor_email;
  const hasService = !!c.type_service;
  const hasSuperficie = !!c.superficie;

  if (hasName && hasEmail && hasService && hasSuperficie) {
    temp = 'hot';
  } else if ((hasName || hasEmail) && hasService) {
    temp = 'warm';
  } else if (hasName || hasEmail || hasService) {
    temp = 'warm';
  }

  await query(`UPDATE conversations SET lead_temp = $1 WHERE id = $2`, [temp, conversationId]);
}

// Create a quote from conversation data and send email
async function createQuoteFromConversation(conversationId: number, data: {
  nom: string; email: string; tel?: string; adresse?: string;
  type_service: string; superficie: number; etat_plancher?: string;
}): Promise<{ quoteId: number; total: number; depot: number } | null> {
  if (!(data.type_service in SERVICES)) return null;

  const calc = calculateQuote(data.type_service as ServiceType, data.superficie);

  const rows = await query(
    `INSERT INTO quotes (client_nom, client_email, client_tel, client_adresse, type_service, superficie, etat_plancher, prix_pied_carre, sous_total, tps, tvq, total, depot_requis, statut)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'brouillon')
     RETURNING id`,
    [
      data.nom, data.email, data.tel ?? null, data.adresse ?? null,
      data.type_service, data.superficie, data.etat_plancher ?? null,
      calc.prix_pied_carre, calc.sous_total, calc.tps, calc.tvq, calc.total, calc.depot_requis,
    ]
  );

  const quoteId = rows[0].id as number;

  // Link quote to conversation (pending approval)
  await query(
    `UPDATE conversations SET quote_id = $1, status = 'pending_approval' WHERE id = $2`,
    [quoteId, conversationId]
  );

  // Also create a submission for tracking
  const subRows = await query(
    `INSERT INTO submissions (nom, email, telephone, service, message, statut)
     VALUES ($1, $2, $3, $4, $5, 'en_traitement') RETURNING id`,
    [data.nom, data.email, data.tel ?? null, SERVICES[data.type_service as ServiceType].label, `Via agent chat — ${data.superficie} pi²`]
  );
  const subId = subRows[0].id as number;

  await query(`UPDATE conversations SET submission_id = $1 WHERE id = $2`, [subId, conversationId]);
  await query(`UPDATE quotes SET submission_id = $1 WHERE id = $2`, [subId, quoteId]);

  // Notify admin via email
  const apiKey = process.env.RESEND_API_KEY;
  const adminEmail = process.env.ADMIN_EMAIL;
  const from = process.env.EMAIL_FROM ?? 'onboarding@resend.dev';
  if (apiKey && adminEmail) {
    try {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from,
          to: [adminEmail],
          subject: `Nouveau devis #${quoteId} a approuver — ${data.nom}`,
          html: `
            <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;">
              <h2 style="color:#1e293b;">Nouveau devis a approuver</h2>
              <p><strong>Client:</strong> ${data.nom} (${data.email})</p>
              <p><strong>Service:</strong> ${SERVICES[data.type_service as ServiceType].label}</p>
              <p><strong>Superficie:</strong> ${data.superficie} pi²</p>
              <p><strong>Total:</strong> ${formatMoney(calc.total)}</p>
              <p><strong>Depot:</strong> ${formatMoney(calc.depot_requis)}</p>
              <p style="margin-top:20px;">
                <a href="https://novus-epoxy.vercel.app/dashboard/devis/${quoteId}"
                   style="background:#f59e0b;color:#0f172a;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;">
                  Voir et approuver le devis
                </a>
              </p>
            </div>`,
        }),
      });
    } catch { /* notification failed */ }
  }

  return { quoteId, total: calc.total, depot: calc.depot_requis };
}

// Main agent function — process a user message and return response
export async function processMessage(ctx: ConversationContext, userMessage: string): Promise<string> {
  const { conversationId } = ctx;

  // Save user message
  await saveMessage(conversationId, 'user', userMessage);

  // Load conversation history
  const history = await loadHistory(conversationId);

  // Call Claude API
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    const fallback = 'Merci pour votre message! Notre equipe va vous repondre rapidement. En attendant, vous pouvez nous appeler ou remplir le formulaire sur novusepoxy.ca';
    await saveMessage(conversationId, 'assistant', fallback);
    return fallback;
  }

  const claudeMessages = history.map(m => ({
    role: m.role === 'system' ? 'user' as const : m.role as 'user' | 'assistant',
    content: m.content,
  }));

  const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 800,
      system: SYSTEM_PROMPT,
      messages: claudeMessages,
    }),
  });

  if (!claudeRes.ok) {
    const fallback = 'Desolee, je rencontre un probleme technique. Vous pouvez nous joindre directement a gestionnovusepoxy@gmail.com ou remplir le formulaire sur novusepoxy.ca';
    await saveMessage(conversationId, 'assistant', fallback);
    return fallback;
  }

  const claudeData = await claudeRes.json();
  const assistantText = claudeData.content?.[0]?.text ?? '';

  // Check if the agent wants to create a quote
  const quoteMatch = assistantText.match(/<QUOTE_DATA>([\s\S]*?)<\/QUOTE_DATA>/);
  let responseText = assistantText.replace(/<QUOTE_DATA>[\s\S]*?<\/QUOTE_DATA>/, '').trim();

  if (quoteMatch) {
    try {
      const quoteData = JSON.parse(quoteMatch[1]);

      // Update conversation with collected data
      await updateConversationData(conversationId, quoteData);

      // Create the quote
      const result = await createQuoteFromConversation(conversationId, quoteData);
      if (result) {
        responseText += `\n\nMerci! Votre soumission a ete preparee. Notre equipe va la verifier et vous l'envoyer par email a ${quoteData.email} tres bientot.`;
      }
    } catch {
      // JSON parse failed — continue with text response
    }
  }

  // Save assistant response
  await saveMessage(conversationId, 'assistant', responseText);

  // Update lead temperature
  await updateLeadTemp(conversationId);

  return responseText;
}

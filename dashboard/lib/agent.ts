import { query } from '@/lib/db';
import { getAdminChatIds } from '@/lib/telegram-utils';
import { SERVICES, type ServiceType, calculateQuote, formatMoney } from '@/lib/pricing';
import { getColorCatalogText } from '@/lib/torginol';
import { notifyAdminSMS } from '@/lib/sms';
import { escapeHtml } from '@/lib/utils';
import { callLLM } from '@/lib/llm';

// Send notification to Telegram admins when bot needs human help
async function notifyTelegramHandoff(conversationId: number, visitorName: string, reason: string) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const groupId = process.env.TELEGRAM_GROUP_CHAT_ID;
  const chatIds = groupId
    ? [groupId]
    : getAdminChatIds();
  if (!botToken || chatIds.length === 0) return;

  // Inclure les derniers messages de l'échange pour que Luca LISE la conversation
  // directement dans Telegram (avant: il voyait juste la "raison", incompréhensible).
  let transcript = '';
  try {
    const rows = await query(
      `SELECT role, content FROM messages WHERE conversation_id = $1 ORDER BY created_at DESC LIMIT 8`,
      [conversationId]
    );
    const lines = (rows as Array<{ role: string; content: string }>)
      .reverse()
      .map(m => {
        const who = m.role === 'assistant' ? '🤖 Nova' : m.role === 'user' ? '👤 Client' : '⚙️';
        const txt = escapeHtml(String(m.content || '').slice(0, 280));
        return `<b>${who}:</b> ${txt}`;
      });
    if (lines.length) transcript = '\n\n<b>━━ Conversation ━━</b>\n' + lines.join('\n');
  } catch { /* si la lecture échoue, on envoie quand même la notif de base */ }

  const msg = [
    `🔔🔔 <b>HANDOFF REQUIS</b>`,
    ``,
    `<b>Client:</b> ${escapeHtml(visitorName || 'Anonyme')}`,
    `<b>Raison:</b> ${escapeHtml(reason)}`,
    transcript,
    ``,
    `<i>Le client attend une réponse humaine.</i>`,
    ``,
    `🔗 Répondre ici: https://novus-epoxy.vercel.app/dashboard/conversations/${conversationId}`,
  ].join('\n');

  const keyboard = {
    inline_keyboard: [[
      { text: '📋 Voir conversation', url: `https://novus-epoxy.vercel.app/dashboard/conversations/${conversationId}` },
    ]]
  };

  await Promise.all(chatIds.map(chatId =>
    fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId.trim(),
        text: msg,
        parse_mode: 'HTML',
        reply_markup: keyboard
      }),
    }).catch(err => console.error('Telegram handoff notification failed:', err))
  ));
}

// The AI agent's system prompt — its personality and knowledge
const SYSTEM_PROMPT = `Tu es Nova, l'assistante de Novus Epoxy (planchers epoxy haut de gamme, Quebec).

[[feedback_chatbot_nova]] — ORDRE DES QUESTIONS VALIDE PAR LUCA, NE JAMAIS DEVIER:
Espace → Fini → Surface → Couleur → Superficie → Nom+Adresse → Tel+Email → Resume → Devis.

TON STYLE:
- Chaleureuse et humaine, comme une vraie quebecoise. Jamais robotique.
- Reponses TRES courtes, comme un texto: 1-2 phrases max. Pas de paragraphes, pas de listes.
- UNE seule question a la fois. Simple et claire (le client peut etre distrait).
- Petites expressions naturelles: "Super!", "Parfait!", "C'est beau!".
- Si le client est deja venu (contexte plus bas), accueille-le par son prenom et reprends ou il etait.

REGLE D'OR — PRIX:
- Ne JAMAIS donner de prix, tarif, cout, estimation ou fourchette. Jamais.
- Si on te demande combien: "Chaque projet est unique! Je te prepare une soumission gratuite, j'ai juste besoin de quelques infos."
- Le prix sort seulement dans le devis officiel par email.

LE FLOW (pose chaque question l'une apres l'autre, le widget affiche des boutons):
1. Espace — "C'est pour quel type d'espace?" → Garage, Sous-sol, Balcon, Commercial, Industriel
2. Fini — "Quel fini t'interesse?" → Flocon, Quartz, Metallique, Couleur unie, Antiderapant, Commercial, Meulage
3. Surface — "C'est quoi la surface actuelle a couvrir?" → Beton, Bois, Peinture existante, Epoxy a refaire
   (On fait le bois — c'est notre specialite. Ne JAMAIS dire qu'on ne fait pas le bois. Skip cette question si Meulage = toujours beton.)
4. Couleur — SI Flocon, Couleur unie OU Quartz: reponds UNIQUEMENT avec le lien, rien d'autre. Pas de description.
   - Flocon: https://novus-epoxy.vercel.app/couleurs?vid={VISITOR_ID}
   - Couleur unie: https://novus-epoxy.vercel.app/couleurs?vid={VISITOR_ID}&tab=solid
   - Quartz: https://novus-epoxy.vercel.app/couleurs?vid={VISITOR_ID}&tab=quartz
   Le client clique, son choix arrive auto (ex: "J'ai choisi Nightfall"). Reponds "Parfait, Nightfall!" et enchaine.
5. Superficie — "Combien de pieds carres? Donne-moi le nombre ou tes mesures (ex: 20x40), je calcule!"
   (Si mesures, calcule toi-meme: 20x40 = 800 pi².)
6. "Ton nom complet et ton adresse avec code postal?"
7. "Et ton telephone + email pour t'envoyer la soumission?"

CAS SPECIAUX (collecte TOUT pareil, mais photo + handoff au lieu du devis auto):
- BALCON: meme flow (Fini, Surface, etc.). Pi² approximatif OK. Demande une PHOTO du balcon (icone photo en bas a gauche). Une fois tout recu (nom, email, tel, adresse): <HANDOFF>Balcon — photo recue, prix admin</HANDOFF>. Dis: "Merci! Notre equipe regarde la photo et te prepare une soumission sous peu!"
- BETON FISSURE / ABIME / AUTONIVELANT: demande des PHOTOS dans le chat. Collecte tout puis <HANDOFF>Reparation beton — photo recue, eval admin</HANDOFF>. Meme message de fin.
- MEULAGE: pas de couleur, pas de surface (toujours beton). Collecte pi² + nom + adresse + tel + email, puis devis normal (type_service "meulage").

CONFIRMATION AVANT LE DEVIS (court et scannable):
- Avant de generer le devis, montre un resume et demande de confirmer. Format exact:
  "Je recap:
  Espace: Garage
  Fini: Flocon (Nightfall)
  Surface: Beton
  Superficie: 800 pi²
  Nom: Jean Tremblay
  Adresse: 123 rue Principale, Quebec, G1K 2A3
  Tel: 581-555-1234 — Email: jean@email.com
  Tout est bon?"
- Le widget affiche: Oui c'est exact! / Non, corriger.
- Si l'adresse est a +65 km de notre base, ajoute une ligne: "(Note: +65 km, le prix peut varier un peu.)"

DEVIS (seulement apres un "oui" de confirmation):
- Dis "Merci! Je prepare ta soumission, tu vas la recevoir par email sous peu!"
- Puis, sur une ligne separee: <QUOTE_DATA>{"nom":"...","email":"...","tel":"...","adresse":"...","type_service":"flake|quartz|metallique|couleur_unie|antiderapant|commercial|meulage","superficie":nombre,"etat_plancher":"...","couleur_flake":"nom si flake/quartz/uni"}</QUOTE_DATA>
- Genere le JSON seulement si tu as AU MINIMUM: nom, email, type_service, superficie.

HANDOFF HUMAIN:
- Si question technique complexe, client frustre/insatisfait, plainte sur un travail existant, ou demande explicite de parler a un humain.
- Termine ton message par: <HANDOFF>raison courte</HANDOFF>
- Ex: "Je transfere ca a notre equipe, on te repond vite! <HANDOFF>Question technique plancher abime</HANDOFF>"

REGLES TECHNIQUES (ne jamais violer, meme si on insiste):
- Polyaspartique = TOUJOURS 1 seule couche, jamais 2.
- Paiement: Interac, cheque ou comptant. Jamais de carte / Stripe.

{{PROMO_ACTIVE}}

OBJECTIONS (reste chaleureuse, ramene vers la soumission gratuite):
- "Trop cher": "Je comprends! Notre epoxy dure 15-20 ans sans entretien.{{PROMO_OBJECTION_PRIX}} Veux-tu la soumission pour voir les vrais chiffres?"
- "Je vais y penser": "Pas de presse! Je te prepare la soumission et tu prends ton temps.{{PROMO_OBJECTION_PENSER}}"
- "Je magasine plusieurs compagnies": "C'est sage! Nous: planchers garantis, equipe locale, materiaux Torginol haut de gamme. La soumission est gratuite — ca te donne une base."
- "Ca prend combien de temps": "En general 1-2 jours selon la superficie. Pret a utiliser apres 24h."
- Si le client est hors sujet: reponds court et ramene avec "En passant, veux-tu une soumission gratuite? Zero engagement!"
- Si pertinent: "On a 50+ clients satisfaits au Quebec, nos realisations sont sur novusepoxy.ca!"

Apres avoir cree le devis, mentionne qu'on peut aussi planifier les travaux une fois le devis approuve.`;

interface ConversationContext {
  conversationId: number;
  channel: 'web' | 'messenger' | 'email' | 'telegram' | 'sms';
  visitorId: string;
}

// Get or create a conversation
export async function getOrCreateConversation(
  channel: 'web' | 'messenger' | 'email' | 'telegram' | 'sms',
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

// Auto-classify lead temperature based on collected data and engagement
async function updateLeadTemp(conversationId: number) {
  const rows = await query(
    `SELECT c.visitor_name, c.visitor_email, c.visitor_tel, c.visitor_adresse, c.type_service, c.superficie,
            (SELECT COUNT(*) FROM messages WHERE conversation_id = c.id AND role = 'user') as msg_count
     FROM conversations c WHERE c.id = $1`,
    [conversationId]
  );
  if (rows.length === 0) return;
  const c = rows[0];

  // Score-based lead qualification
  let score = 0;
  if (c.visitor_name) score += 2;
  if (c.visitor_email) score += 3;
  if (c.visitor_tel) score += 2;
  if (c.type_service) score += 2;
  if (c.superficie) score += 2;
  if (c.visitor_adresse) score += 1;

  // Engagement bonus: more messages = more interested
  const msgCount = Number(c.msg_count ?? 0);
  if (msgCount >= 6) score += 2;
  else if (msgCount >= 3) score += 1;

  // hot >= 9 (ready for quote), warm >= 4 (engaged), cold < 4
  const temp = score >= 9 ? 'hot' : score >= 4 ? 'warm' : 'cold';

  await query(`UPDATE conversations SET lead_temp = $1 WHERE id = $2`, [temp, conversationId]);
}

// Create a quote from conversation data and send email
async function createQuoteFromConversation(conversationId: number, data: {
  nom: string; email: string; tel?: string; adresse?: string;
  type_service: string; superficie: number; etat_plancher?: string; couleur_flake?: string;
}): Promise<{ quoteId: number; total: number; depot: number } | null> {
  if (!(data.type_service in SERVICES)) return null;

  // Check for active promotions and apply discount automatically
  let rabaisPct = 0;
  try {
    const promoRows = await query(
      `SELECT rabais_pct, services FROM promotions
       WHERE actif = true AND date_debut <= CURRENT_DATE AND date_fin >= CURRENT_DATE
       ORDER BY rabais_pct DESC LIMIT 1`
    );
    if (promoRows.length > 0) {
      const promo = promoRows[0];
      const services = promo.services as string[];
      // Apply if no specific services or if service matches
      if (!services || services.length === 0 || services.includes(data.type_service)) {
        rabaisPct = Number(promo.rabais_pct);
      }
    }
  } catch (err) {
    console.error('Failed to check active promos for quote:', err);
  }

  const calc = calculateQuote(data.type_service as ServiceType, data.superficie, rabaisPct);

  const rows = await query(
    `INSERT INTO quotes (client_nom, client_email, client_tel, client_adresse, type_service, superficie, etat_plancher, couleur_flake, prix_pied_carre, rabais_pct, rabais_montant, sous_total, tps, tvq, total, depot_requis, statut)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'brouillon')
     RETURNING id`,
    [
      data.nom, data.email, data.tel ?? null, data.adresse ?? null,
      data.type_service, data.superficie, data.etat_plancher ?? null, data.couleur_flake ?? null,
      calc.prix_pied_carre, calc.rabais_pct, calc.rabais_montant, calc.sous_total, calc.tps, calc.tvq, calc.total, calc.depot_requis,
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

  // Notify admins via Telegram with approve/reject buttons (same as form submissions)
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatIds = getAdminChatIds();
  if (botToken && chatIds.length > 0) {
    const serviceLabel = SERVICES[data.type_service as ServiceType]?.label ?? data.type_service;
    const tgLines = [
      `📋 <b>Nouveau devis #${quoteId} (chatbot)</b>`,
      ``,
      `👤 ${escapeHtml(data.nom)}`,
      data.email ? `📧 ${escapeHtml(data.email)}` : '',
      data.tel ? `📞 ${escapeHtml(data.tel)}` : '',
      data.adresse ? `🏠 ${escapeHtml(data.adresse)}` : '',
      `🔧 ${serviceLabel} — ${data.superficie} pi²`,
      ``,
      `💰 Total: ${formatMoney(calc.total)}`,
      `💳 Depot: ${formatMoney(calc.depot_requis)}`,
    ].filter(Boolean).join('\n');

    const buttons = {
      inline_keyboard: [
        [
          { text: '✅ Approuver et envoyer', callback_data: `approve_quote_${quoteId}` },
          { text: '❌ Rejeter', callback_data: `reject_quote_${quoteId}` },
        ],
        [
          { text: '📋 Voir dashboard', url: `https://novus-epoxy.vercel.app/dashboard/devis` },
        ],
      ],
    };

    await Promise.all(chatIds.map(chatId =>
      fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId.trim(), text: tgLines, parse_mode: 'HTML', reply_markup: buttons }),
      }).then(async r => {
        if (!r.ok) console.error('Telegram error:', await r.text().catch(() => r.status));
      }).catch(err => console.error('Telegram fetch error:', err))
    ));
  }

  // SMS to both admins with dashboard link
  await notifyAdminSMS(quoteId, data.nom).catch(err => console.error('SMS notification failed:', err));

  return { quoteId, total: calc.total, depot: calc.depot_requis };
}

// Load returning client context for memory
async function getClientContext(conversationId: number, visitorId: string): Promise<string> {
  // Check if this visitor has previous conversations
  const prevConvos = await query(
    `SELECT c.visitor_name, c.visitor_email, c.type_service, c.superficie, c.created_at,
            (SELECT COUNT(*) FROM messages WHERE conversation_id = c.id) as msg_count
     FROM conversations c
     WHERE c.visitor_id = $1 AND c.id != $2
     ORDER BY c.created_at DESC LIMIT 3`,
    [visitorId, conversationId]
  );

  // Check current conversation data
  const current = await query(
    `SELECT visitor_name, visitor_email, type_service, superficie, visitor_adresse, etat_plancher
     FROM conversations WHERE id = $1`,
    [conversationId]
  );

  const parts: string[] = [];

  if (prevConvos.length > 0) {
    const prev = prevConvos[0];
    parts.push(`CLIENT DE RETOUR: Ce client est deja venu chatter.`);
    if (prev.visitor_name) parts.push(`Prenom/nom connu: ${prev.visitor_name}`);
    if (prev.type_service) parts.push(`Interesse par: ${prev.type_service}`);
    if (prev.superficie) parts.push(`Superficie mentionnee: ${prev.superficie} pi²`);
    parts.push(`Nombre de visites precedentes: ${prevConvos.length}`);
  }

  if (current.length > 0) {
    const c = current[0];
    if (c.visitor_name) parts.push(`Nom actuel: ${c.visitor_name}`);
    if (c.type_service) parts.push(`Service choisi: ${c.type_service}`);
    if (c.superficie) parts.push(`Superficie: ${c.superficie} pi²`);
    if (c.visitor_adresse) parts.push(`Adresse: ${c.visitor_adresse}`);
  }

  return parts.length > 0 ? `\n\nCONTEXTE CLIENT:\n${parts.join('\n')}` : '';
}

// Fetch active promotions and build prompt text
async function getActivePromosText(): Promise<{ promoBlock: string; objectionPrix: string; objectionPenser: string }> {
  try {
    const rows = await query(
      `SELECT nom, description, rabais_pct, date_debut, date_fin, services
       FROM promotions
       WHERE actif = true AND date_debut <= CURRENT_DATE AND date_fin >= CURRENT_DATE
       ORDER BY rabais_pct DESC`
    );

    if (rows.length === 0) {
      return {
        promoBlock: '',
        objectionPrix: '',
        objectionPenser: '',
      };
    }

    const promo = rows[0];
    const pct = promo.rabais_pct;
    const nom = promo.nom as string;
    const dateFin = new Date(promo.date_fin as string).toLocaleDateString('fr-CA', { year: 'numeric', month: 'long', day: 'numeric' });

    const promoBlock = `PROMO EN COURS — ${nom} (IMPORTANT):
- On a presentement un rabais de ${pct}%${(promo.services as string[])?.length ? ' sur certains services' : ' sur tous nos services'}.
- Mentionne-le UNE SEULE FOIS, juste avant de confirmer le resume du projet (avant de demander "Est-ce que tout est exact?").
- Ex: "En passant, on a un rabais de ${pct}% en ce moment — ca s'applique automatiquement a ton devis!"
- Si le client demande des details sur le rabais: "C'est notre promo actuelle, valable jusqu'au ${dateFin}."
- Ne le mentionne PAS au debut de la conversation — seulement quand tu as les infos du projet.`;

    const objectionPrix = ` Et avec notre rabais de ${pct}%, c'est le meilleur moment!`;
    const objectionPenser = ` Les prix avec le rabais de ${pct}% sont valides jusqu'au ${dateFin}.`;

    return { promoBlock, objectionPrix, objectionPenser };
  } catch (err) {
    console.error('Failed to fetch active promos:', err);
    return { promoBlock: '', objectionPrix: '', objectionPenser: '' };
  }
}

// Sanitize user input to prevent prompt injection via control tags
function sanitizeUserInput(msg: string): string {
  return msg
    .replace(/<QUOTE_DATA>/gi, '&lt;QUOTE_DATA&gt;')
    .replace(/<\/QUOTE_DATA>/gi, '&lt;/QUOTE_DATA&gt;')
    .replace(/<HANDOFF>/gi, '&lt;HANDOFF&gt;')
    .replace(/<\/HANDOFF>/gi, '&lt;/HANDOFF&gt;');
}

// Validate quote data from AI output
function isValidQuoteData(data: Record<string, unknown>): boolean {
  if (!data.nom || typeof data.nom !== 'string' || data.nom.length > 200) return false;
  if (!data.email || typeof data.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) return false;
  if (!data.type_service || !(data.type_service as string in SERVICES)) return false;
  if (!data.superficie || typeof data.superficie !== 'number' || data.superficie < 10 || data.superficie > 100000) return false;
  return true;
}

// Main agent function — process a user message and return response
export async function processMessage(ctx: ConversationContext, userMessage: string): Promise<string> {
  const { conversationId } = ctx;

  // Sanitize user input to prevent control tag injection
  const sanitizedMessage = sanitizeUserInput(userMessage);

  // Save user message (original for display)
  await saveMessage(conversationId, 'user', userMessage);

  // Load conversation history, client context, and active promos in parallel
  const [history, clientContext, promosText] = await Promise.all([
    loadHistory(conversationId),
    getClientContext(conversationId, ctx.visitorId),
    getActivePromosText(),
  ]);

  // callLLM routes via OpenRouter — gate on that key, not the legacy Anthropic one.
  if (!process.env.OPENROUTER_API_KEY && !process.env.ANTHROPIC_API_KEY) {
    const fallback = 'Merci pour ton message! Notre equipe va te repondre rapidement. En attendant, tu peux nous appeler ou remplir le formulaire sur novusepoxy.ca';
    await saveMessage(conversationId, 'assistant', fallback);
    return fallback;
  }

  const claudeMessages = history.map(m => ({
    role: m.role === 'system' ? 'user' as const : m.role as 'user' | 'assistant',
    content: m.role === 'user' ? sanitizeUserInput(m.content) : m.content,
  }));

  const systemPrompt = SYSTEM_PROMPT
    .replaceAll('{VISITOR_ID}', ctx.visitorId)
    .replace('{{PROMO_ACTIVE}}', promosText.promoBlock)
    .replace('{{PROMO_OBJECTION_PRIX}}', promosText.objectionPrix)
    .replace('{{PROMO_OBJECTION_PENSER}}', promosText.objectionPenser)
    + clientContext;

  const assistantText = await callLLM({
    system: systemPrompt,
    messages: claudeMessages,
    maxTokens: 300,
    tier: 'smart',
  }).catch(async () => {
    const fallback = 'Desolee, je rencontre un probleme technique! Tu peux nous joindre directement a gestionnovusepoxy@gmail.com ou au 581-307-2678!';
    await saveMessage(conversationId, 'assistant', fallback);
    return fallback;
  });

  // Check for handoff request
  const handoffMatch = assistantText.match(/<HANDOFF>([\s\S]*?)<\/HANDOFF>/);
  let responseText = assistantText.replace(/<HANDOFF>[\s\S]*?<\/HANDOFF>/, '').trim();

  if (handoffMatch) {
    const current = await query(`SELECT visitor_name FROM conversations WHERE id = $1`, [conversationId]);
    const name = current[0]?.visitor_name ?? '';
    await notifyTelegramHandoff(conversationId, name as string, handoffMatch[1]);
    await query(`UPDATE conversations SET status = 'handoff' WHERE id = $1`, [conversationId]);
    // SMS notification to admins with dashboard link
    const phones = [process.env.ADMIN_PHONE, process.env.JASON_PHONE].filter(Boolean) as string[];
    const { sendSMS } = await import('@/lib/sms');
    const smsMsg = `Novus Epoxy: ${name || 'Un client'} demande de parler a un humain! https://novus-epoxy.vercel.app/dashboard/conversations/${conversationId}`;
    await Promise.all(phones.map(phone => sendSMS(phone, smsMsg)));
  }

  // Check if the agent wants to create a quote
  const quoteMatch = responseText.match(/<QUOTE_DATA>([\s\S]*?)<\/QUOTE_DATA>/);
  responseText = responseText.replace(/<QUOTE_DATA>[\s\S]*?<\/QUOTE_DATA>/, '').trim();

  if (quoteMatch) {
    try {
      const quoteData = JSON.parse(quoteMatch[1]);

      // Validate quote data to prevent forged quotes
      if (!isValidQuoteData(quoteData)) {
        console.error('Invalid quote data rejected:', quoteData);
        throw new Error('Invalid quote data');
      }

      // Update conversation with collected data
      await updateConversationData(conversationId, quoteData);

      // Create the quote
      const result = await createQuoteFromConversation(conversationId, quoteData);
      if (result) {
        responseText += `\n\nC'est beau! Ta soumission est en preparation. L'equipe va la verifier et te l'envoyer par email a ${quoteData.email} tres bientot!`;
      }
    } catch (err) {
      console.error('Failed to parse quote data from agent response:', err);
      // Alert admins via Telegram
      const botToken = process.env.TELEGRAM_BOT_TOKEN;
      const chatIds = getAdminChatIds();
      if (botToken && chatIds.length > 0) {
        await Promise.all(chatIds.map(chatId =>
          fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId.trim(),
              text: `⚠️ Erreur création devis automatique — conversation #${conversationId}. Vérifiez le dashboard.`,
              parse_mode: 'HTML',
            }),
          }).catch(() => {})
        ));
      }
      // Tell client about the error instead of fake success
      responseText = "Désolé, une erreur technique est survenue. Notre équipe va te contacter directement pour préparer ta soumission!";
    }
  }

  // Save assistant response
  await saveMessage(conversationId, 'assistant', responseText);

  // Update lead temperature
  await updateLeadTemp(conversationId);

  return responseText;
}

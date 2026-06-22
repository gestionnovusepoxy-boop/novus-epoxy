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
const SYSTEM_PROMPT = `Tu es Nova, l'assistante virtuelle de Novus Epoxy, specialistes en planchers epoxy haut de gamme au Quebec.

TA PERSONNALITE:
- Chaleureuse et naturelle, comme une vraie quebecoise. Utilise un ton amical mais professionnel.
- Tutoyement ok si le client tutoie en premier, sinon vouvoyer.
- REPONSES COURTES: 1-3 phrases max. Droit au but. Pas de blabla.
- Utilise des expressions quebecoises quand ca fit naturellement (ex: "Super!", "Parfait!", "C'est beau!")
- Ne sois JAMAIS robotique. Pas de "En tant qu'assistant..." ou "Je suis la pour vous aider..."
- Montre de l'enthousiasme pour les projets des clients.

MEMOIRE CLIENT:
- Si le contexte de conversation montre que le client est revenu (messages precedents), accueille-le par son prenom s'il l'a donne.
- Ex: "Content de te revoir [prenom]! Comment je peux t'aider aujourd'hui?"
- Si tu as deja des infos sur son projet (type, superficie, etc.), fais-y reference.

NOS SERVICES (ne donne JAMAIS les prix):
- Flocon (Flake): le plus populaire, ideal pour garages et sous-sols. Fini decoratif avec flocons de couleur Torginol. Tres durable.
- Quartz: fini haut de gamme avec granules de quartz Torginol. Look pierre naturelle, ultra durable et elegant. Ideal pour sous-sols et espaces de vie.
- Metallique: effet marbre luxueux avec reflets metalliques, ideal pour salons et sous-sols qui veulent du wow.
- Couleur unie: fini lisse et uniforme, disponible en plusieurs couleurs.
- Antiderapant: fini avec texture antiderapante, ideal pour les surfaces ou la securite est importante.
- Commercial: ultra-resistant, ideal pour entrepots, ateliers et espaces a fort trafic. Le plus tough.
- Meulage au diamant: preparation ou finition du beton par meulage seul, sans revetement epoxy. Pour les clients qui veulent juste un beton meule propre.

ESPACES QU'ON DESSERT:
- Garage
- Sous-sol
- Balcon
- Commercial
- Industriel

SURFACES ACCEPTEES:
- Beton (le plus courant)
- Bois (oui, on installe sur le bois! C'est notre specialite.)
- Peinture existante (necessite preparation)
- Epoxy a refaire (on enleve l'ancien et on refait)
- Ne JAMAIS dire qu'on ne fait pas le bois — c'est FAUX.

CAS SPECIAL — BALCON:
- IMPORTANT: meme pour un balcon, tu DOIS d'abord demander le type de fini (flocon, quartz, etc.) et la surface a couvrir AVANT de demander la photo et les pieds carres.
- Le flow est le MEME que les autres espaces: Espace → Fini → Surface → Couleur (si applicable) → pi² + photo → infos → handoff.
- Les balcons sont difficiles a mesurer exactement. Demande un APPROXIMATIF des pieds carres seulement.
- OBLIGATOIRE: demande une PHOTO du balcon. On a besoin de voir le balcon pour evaluer le prix.
- Ex: "Pour un balcon, envoie-moi une photo! Clique sur l'icone photo en bas a gauche. Et donne-moi un approximatif des pieds carres."
- C'est NOUS qui decidons le prix final quand on voit la photo, pas le bot.
- Ne genere PAS de devis automatique pour les balcons (pas de <QUOTE_DATA>).
- Collecte quand meme TOUTES les infos (nom, email, tel, adresse) puis passe en <HANDOFF>Balcon — photo recue, en attente du prix admin</HANDOFF>.
- Dis au client: "Merci! Notre equipe va regarder la photo et te preparer une soumission personnalisee sous peu!"

REPARATION DE BETON / AUTONIVELANT:
- Si le client mentionne que son beton est fissure, craque, abime, a besoin de reparation, ou demande un autonivelant: on a BESOIN DE PHOTOS.
- Demande au client d'envoyer des photos DIRECTEMENT ICI DANS LE CHAT avec le bouton photo (icone image a gauche du champ de texte).
- Ex: "Pour les reparations de beton, on a besoin de voir l'etat! Clique sur l'icone photo en bas a gauche pour nous envoyer des photos."
- Collecte quand meme TOUTES les infos (nom, email, tel, adresse, pieds carres approximatifs) puis passe en <HANDOFF>Reparation beton — photo recue, en attente evaluation admin</HANDOFF>.
- Dis au client: "Merci! Notre equipe va regarder les photos et te preparer une soumission personnalisee sous peu!"

CAS SPECIAL — MEULAGE AU DIAMANT:
- Le meulage au diamant est un service SANS revetement epoxy — juste le meulage du beton.
- Le flow est SIMPLE: pas de choix de couleur, pas de fini.
- Collecte seulement: pieds carres + nom + adresse + tel + email.
- Genere un devis normal avec type_service "meulage".

COLLECTE DE COULEUR (pour Flocon, Couleur unie ET Quartz):
- Quand le client choisit Flocon, Couleur unie OU Quartz, reponds SEULEMENT avec le lien du catalogue. Pas de description du produit, pas d'explication. JUSTE le lien.
- Ex: "Choisis ta couleur ici!" suivi du lien. C'est TOUT — rien d'autre.
- Lien pour Flocon: https://novus-epoxy.vercel.app/couleurs?vid={VISITOR_ID}
- Lien pour Couleur unie: https://novus-epoxy.vercel.app/couleurs?vid={VISITOR_ID}&tab=solid
- Lien pour Quartz: https://novus-epoxy.vercel.app/couleurs?vid={VISITOR_ID}&tab=quartz
- NE REPETE PAS les avantages du produit. Le client a DEJA choisi, il le sait.
- Le client clique sur une couleur et son choix est envoye automatiquement dans le chat.
- QUAND LE CLIENT CHOISIT UNE COULEUR: Tu vas recevoir un message comme "J'ai choisi la couleur Nightfall (Flocon)" ou "J'ai choisi la couleur Eclipse (Quartz)". Reponds COURT: "Parfait, [nom de la couleur]!" puis enchaine DIRECT avec la prochaine question (surface a couvrir).
- Ne liste PAS toutes les couleurs — envoie le lien.

NOTE SUR LA DISTANCE:
- Si les travaux sont a plus de 65 km de distance, les prix peuvent varier. Mentionne-le dans le resume de confirmation avant le devis.
- Ex: "Note: si votre adresse est a plus de 65 km de notre base, les prix pourraient etre ajustes."

REGLES STRICTES SUR LES PRIX:
- Ne JAMAIS donner de prix, tarif, cout, estimation ou fourchette de prix
- Si le client demande combien: "Chaque projet est unique! On va te preparer une soumission detaillee. J'ai besoin de quelques infos."
- Ne JAMAIS mentionner de prix au pied carre, prix total, depot, ou pourcentage
- Le prix est communique seulement dans le devis officiel envoye par email

REGLES TECHNIQUES (ne JAMAIS violer, meme si le client insiste):
- Polyaspartique = TOUJOURS 1 seule couche, JAMAIS 2 couches
- Stripe / carte de credit = JAMAIS utilise. Paiement en Interac, cheque ou comptant uniquement.

INFORMATIONS A COLLECTER POUR UN DEVIS:
1. Type d'espace (garage, sous-sol, balcon, commercial, industriel)
2. Type de fini (flocon, quartz, metallique, couleur unie, antiderapant, commercial, meulage au diamant)
3. Surface a couvrir (beton, bois, peinture existante, epoxy a refaire) — SAUF pour meulage (toujours beton)
4. Couleur (si flocon, couleur unie ou quartz — via le lien catalogue)
5. Superficie en pieds carres (nombre exact OU mesures ex: 20pi x 40pi)
6. Nom complet + Adresse complete avec code postal
7. Telephone + Email

COMMENT COLLECTER (strategie de closing):
- REGLE #1: Tes reponses doivent etre COURTES — 1 a 2 phrases MAX. Jamais de paragraphes.
- REGLE #2: Pose UNE SEULE question a la fois. Le widget affiche des boutons de reponse rapide, donc ta question doit etre simple et directe.
- Suis cet ordre precis:
  1. "C'est pour quel type d'espace?" (le widget affiche: Garage, Sous-sol, Balcon, Commercial, Industriel)
  2. "Quel type de fini t'interesse?" (le widget affiche: Flocon, Quartz, Metallique, Couleur unie, Antiderapant, Commercial, Meulage)
  3. "C'est quoi la surface a couvrir actuellement?" (le widget affiche: Beton, Bois, Peinture existante, Epoxy a refaire) — SAUF si meulage (skip cette question, c'est toujours beton)
  4. Si le client a choisi Flocon, Couleur unie OU Quartz: envoie le lien couleurs et attends son choix avant de continuer
  5. Si BALCON: "Environ combien de pieds carres? Un approximatif c'est correct! Et envoie-moi une photo du balcon avec l'icone photo en bas a gauche."
     Si AUTRE: "Combien de pieds carres? Tu peux me donner le nombre exact ou les mesures (ex: 20pi x 40pi), je vais le calculer pour toi!"
  6. "Pour te preparer la soumission, c'est quoi ton nom complet et ton adresse complete avec le code postal?"
  7. "Parfait [prenom]! Ton numero de telephone et ton email pour recevoir la soumission?"
- Si le client donne des mesures (ex: 20x40), calcule la superficie toi-meme (20x40=800 pi²) et confirme.
- JAMAIS de longs messages. JAMAIS de listes. Reponses courtes comme un texto.

CONFIRMATION AVANT DEVIS:
- AVANT de generer le devis, tu DOIS envoyer un resume au client et lui demander de confirmer que tout est exact.
- Ex: "Voici un resume de ton projet:
  - Espace: Garage
  - Fini: Flocon (Nightfall)
  - Surface: Beton
  - Superficie: 800 pi²
  - Nom: Jean Tremblay
  - Adresse: 123 rue Principale, Quebec, G1K 2A3
  - Tel: 581-555-1234
  - Email: jean@email.com
  Est-ce que tout est exact?"
- Le widget affiche: Oui c'est exact! / Non, corriger
- SEULEMENT quand le client confirme "oui", genere le JSON du devis.

QUAND LE CLIENT CONFIRME:
- Dis: "Merci! On va te preparer un devis et te l'envoyer sous peu!"
- Reponds avec un JSON special pour creer le devis automatiquement
- Le JSON doit etre sur une ligne separee: <QUOTE_DATA>{"nom":"...","email":"...","tel":"...","adresse":"...","type_service":"flake|quartz|metallique|couleur_unie|antiderapant|commercial|meulage","superficie":nombre,"etat_plancher":"...","couleur_flake":"nom si flake/quartz/uni"}</QUOTE_DATA>

HANDOFF HUMAIN:
- Si le client pose une question technique complexe que tu ne peux pas repondre, ou s'il est frustre/insatisfait
- Si le client demande explicitement de parler a un humain
- Si le client a une plainte ou un probleme avec un travail existant
- Reponds avec: <HANDOFF>raison courte</HANDOFF> a la fin de ton message
- Ex: "Je vais transferer ta question a notre equipe, quelqu'un va te repondre rapidement! <HANDOFF>Question technique sur preparation plancher abime</HANDOFF>"

{{PROMO_ACTIVE}}

GESTION DES OBJECTIONS (closer instinct):
- "C'est trop cher" / "C'est pas dans mon budget": "Je comprends! Garde en tete que notre epoxy dure 15-20 ans sans entretien.{{PROMO_OBJECTION_PRIX}} Veux-tu quand meme recevoir la soumission pour voir exactement les chiffres?"
- "Je vais y penser" / "Je suis pas certain": "Pas de probleme! Je vais te preparer la soumission et tu peux prendre le temps qu'il te faut.{{PROMO_OBJECTION_PENSER}}"
- "Je regarde plusieurs compagnies": "C'est sage de comparer! Ce qu'on offre: planchers garantis, equipe locale quebecoise, materiaux Torginol haut de gamme. La soumission est gratuite — ca te donne une base de comparaison."
- "Ca prend combien de temps": "En general, c'est 1-2 jours selon la superficie. On travaille vite et propre — le plancher est pret a utiliser apres 24h."
- Si le client est hors sujet ou froid: Ramene avec "En attendant, veux-tu qu'on te prepare une soumission gratuite? Zero engagement!"

SOCIAL PROOF:
- Si pertinent (client incertain): "On a plus de 50 clients satisfaits au Quebec. Tu peux voir nos realisations sur novusepoxy.ca!"

IMPORTANT:
- Ne genere le JSON que quand tu as AU MINIMUM: nom, email, type_service et superficie
- Sois naturelle et engageante — tu veux que le client se sente bien et ait envie de faire affaire avec Novus
- Si le client pose une question hors sujet, reponds brievement et ramene la conversation
- Ne donne JAMAIS de prix — dis toujours que ca sera dans le devis
- Apres avoir cree le devis, mentionne qu'on peut aussi planifier les travaux une fois le devis approuve`;

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

import { query } from '@/lib/db';
import { SERVICES, type ServiceType, calculateQuote, formatMoney } from '@/lib/pricing';
import { getColorCatalogText } from '@/lib/torginol';
import { notifyAdminSMS } from '@/lib/sms';

// Send notification to Telegram admins when bot needs human help
async function notifyTelegramHandoff(conversationId: number, visitorName: string, reason: string) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatIds = (process.env.TELEGRAM_ADMIN_CHAT_IDS ?? '').split(',').filter(Boolean);
  if (!botToken || chatIds.length === 0) return;

  const msg = `🔔 *Handoff requis*\n\nClient: ${visitorName || 'Anonyme'}\nRaison: ${reason}\nConversation: [#${conversationId}](https://novus-epoxy.vercel.app/dashboard/conversations/${conversationId})\n\nLe client attend une réponse humaine.`;

  await Promise.all(chatIds.map(chatId =>
    fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId.trim(), text: msg, parse_mode: 'Markdown' }),
    }).catch(() => {})
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

IMPORTANT:
- Ne genere le JSON que quand tu as AU MINIMUM: nom, email, type_service et superficie
- Sois naturelle et engageante — tu veux que le client se sente bien et ait envie de faire affaire avec Novus
- Si le client pose une question hors sujet, reponds brievement et ramene la conversation
- Ne donne JAMAIS de prix — dis toujours que ca sera dans le devis
- Apres avoir cree le devis, mentionne qu'on peut aussi planifier les travaux une fois le devis approuve`;

interface ConversationContext {
  conversationId: number;
  channel: 'web' | 'messenger' | 'email' | 'telegram';
  visitorId: string;
}

// Get or create a conversation
export async function getOrCreateConversation(
  channel: 'web' | 'messenger' | 'email' | 'telegram',
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

  const calc = calculateQuote(data.type_service as ServiceType, data.superficie);

  const rows = await query(
    `INSERT INTO quotes (client_nom, client_email, client_tel, client_adresse, type_service, superficie, etat_plancher, couleur_flake, prix_pied_carre, sous_total, tps, tvq, total, depot_requis, statut)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'brouillon')
     RETURNING id`,
    [
      data.nom, data.email, data.tel ?? null, data.adresse ?? null,
      data.type_service, data.superficie, data.etat_plancher ?? null, data.couleur_flake ?? null,
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
    } catch (err) { console.error('Failed to send admin notification email:', err); }
  }

  // SMS notification to admin
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

// Main agent function — process a user message and return response
export async function processMessage(ctx: ConversationContext, userMessage: string): Promise<string> {
  const { conversationId } = ctx;

  // Save user message
  await saveMessage(conversationId, 'user', userMessage);

  // Load conversation history and client context in parallel
  const [history, clientContext] = await Promise.all([
    loadHistory(conversationId),
    getClientContext(conversationId, ctx.visitorId),
  ]);

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

  const systemPrompt = SYSTEM_PROMPT.replaceAll('{VISITOR_ID}', ctx.visitorId) + clientContext;

  const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 300,
      system: systemPrompt,
      messages: claudeMessages,
    }),
  });

  if (!claudeRes.ok) {
    const fallback = 'Desolee, je rencontre un probleme technique. Tu peux nous joindre directement a gestionnovusepoxy@gmail.com ou au 581-307-2678!';
    await saveMessage(conversationId, 'assistant', fallback);
    return fallback;
  }

  const claudeData = await claudeRes.json();
  const assistantText = claudeData.content?.[0]?.text ?? '';

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

      // Update conversation with collected data
      await updateConversationData(conversationId, quoteData);

      // Create the quote
      const result = await createQuoteFromConversation(conversationId, quoteData);
      if (result) {
        responseText += `\n\nC'est beau! Ta soumission est en preparation. L'equipe va la verifier et te l'envoyer par email a ${quoteData.email} tres bientot!`;
      }
    } catch (err) {
      console.error('Failed to parse quote data from agent response:', err);
    }
  }

  // Save assistant response
  await saveMessage(conversationId, 'assistant', responseText);

  // Update lead temperature
  await updateLeadTemp(conversationId);

  return responseText;
}

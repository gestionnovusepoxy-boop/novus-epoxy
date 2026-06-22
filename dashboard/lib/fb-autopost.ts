/**
 * lib/fb-autopost.ts — Brouillons de posts pour la PAGE Facebook Novus Epoxy.
 *
 * Flux: buildPostDraft() propose un brouillon (vraie photo portfolio + texte
 * québécois), sendDraftToTelegram() l'envoie au groupe Telegram avec boutons
 * "✅ Publier" / "❌ Rejeter". La publication réelle se fait UNIQUEMENT quand
 * Luca clique le bouton (→ /api/fb-post). JAMAIS de publication full-auto.
 *
 * Le brouillon est stocké dans kv_store sous la clé fb_post_draft_<ts>.
 */

import { callLLM } from '@/lib/llm';
import { query } from '@/lib/db';

const NOVUS_PHONE = '581-307-5983';

export interface FbPostDraft {
  id: string;        // ex: fb_post_draft_1718000000000
  portfolioId: number | null;
  imageUrl: string;  // URL absolue (Telegram + Graph API)
  message: string;   // texte du post québécois
  service: string | null;
  createdAt: string;
}

const SERVICE_LABELS: Record<string, string> = {
  flake: 'flake (multi-couleur)',
  metallique: 'métallique',
  quartz: 'quartz',
  couleur_unie: 'couleur unie',
  antiderapant: 'antidérapant',
  commercial: 'commercial',
  meulage: 'polissage de béton',
  vinyl_click: 'vinyle click',
};

/** Convertit un chemin relatif (/portfolio/foo.jpg) en URL absolue. */
function toAbsoluteUrl(url: string): string {
  if (url.startsWith('/')) {
    const base = process.env.NEXTAUTH_URL ?? 'https://novus-epoxy.vercel.app';
    return `${base}${url}`;
  }
  return url;
}

/**
 * Choisit une vraie photo du portfolio (featured d'abord, sinon aléatoire) et
 * génère un court texte de post québécois engageant avec CTA soumission gratuite
 * + numéro. Stocke le brouillon dans kv_store et le retourne.
 */
export async function buildPostDraft(): Promise<FbPostDraft> {
  // 1) Vraie photo du portfolio (jamais d'image IA pour un post organique)
  const rows = await query(
    `SELECT id, photos, titre, description, type_service, ville, couleur
       FROM portfolio
      WHERE photos IS NOT NULL AND array_length(photos, 1) > 0
      ORDER BY featured DESC, RANDOM()
      LIMIT 1`
  ).catch(() => []);

  if (!rows.length) {
    throw new Error('Aucune photo de portfolio disponible pour le post Facebook.');
  }

  const r = rows[0] as Record<string, unknown>;
  const portfolioId = typeof r.id === 'number' ? r.id : null;
  const photos = (r.photos ?? []) as string[];
  const rawUrl = Array.isArray(photos) && photos.length > 0 ? photos[0] : null;
  if (!rawUrl) {
    throw new Error('Photo de portfolio invalide (tableau vide).');
  }
  const imageUrl = toAbsoluteUrl(rawUrl);

  const service = (r.type_service as string) ?? null;
  const serviceLabel = service ? (SERVICE_LABELS[service] ?? service) : 'plancher époxy';
  const ville = (r.ville as string) ?? null;
  const couleur = (r.couleur as string) ?? null;
  const titre = (r.titre as string) ?? null;

  // 2) Texte de post québécois engageant via LLM (tier smart)
  let message = '';
  try {
    const ctx = [
      `Service: ${serviceLabel}`,
      titre ? `Projet: ${titre}` : '',
      ville ? `Ville: ${ville}` : '',
      couleur ? `Couleur: ${couleur}` : '',
    ].filter(Boolean).join('\n');

    message = (await callLLM({
      agent: 'fb-autopost',
      tier: 'smart',
      traceName: 'fb-post-draft',
      maxTokens: 400,
      system:
        `Tu écris des posts Facebook pour Novus Epoxy, compagnie de planchers époxy haut de gamme au Québec. ` +
        `Ton: québécois chaleureux, fier du travail, jamais corporatif. Style "petite business locale qui livre du gros stock". ` +
        `Règles STRICTES:\n` +
        `- 3 à 5 lignes courtes max, français québécois naturel (tu/vous neutre, "on", expressions d'ici).\n` +
        `- Mets en valeur la photo (le résultat fini, brillant, durable).\n` +
        `- JAMAIS de prix, JAMAIS de pourcentage de rabais, JAMAIS d'inventions de détails non fournis.\n` +
        `- Termine TOUJOURS par un appel à l'action soumission gratuite et le numéro ${NOVUS_PHONE}.\n` +
        `- 1 à 4 émojis pertinents max. Quelques hashtags pertinents à la fin (#epoxy #quebec ...).\n` +
        `Retourne UNIQUEMENT le texte du post, rien d'autre.`,
      messages: [
        { role: 'user', content: `Écris le post pour cette réalisation:\n${ctx}` },
      ],
    })).trim();
  } catch {
    message = '';
  }

  // Fallback si le LLM échoue: post simple mais correct (avec CTA + numéro)
  if (!message) {
    message =
      `Un autre plancher ${serviceLabel} de fini par l'équipe Novus Epoxy${ville ? ` à ${ville}` : ''} ! 🔥\n` +
      `Brillant, durable et fait pour durer des années.\n\n` +
      `Soumission GRATUITE : 📞 ${NOVUS_PHONE}\n` +
      `#epoxy #plancherepoxy #quebec #novusepoxy`;
  }

  // Garantit le numéro dans le texte (CTA obligatoire)
  if (!message.includes(NOVUS_PHONE)) {
    message = `${message}\n\nSoumission GRATUITE : 📞 ${NOVUS_PHONE}`;
  }

  const id = `fb_post_draft_${Date.now()}`;
  const draft: FbPostDraft = {
    id,
    portfolioId,
    imageUrl,
    message,
    service,
    createdAt: new Date().toISOString(),
  };

  // 3) Stocke le brouillon dans kv_store (clé = id)
  await query(
    `INSERT INTO kv_store (key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
    [id, JSON.stringify(draft)]
  );

  return draft;
}

/** Récupère un brouillon stocké par son id. */
export async function getPostDraft(id: string): Promise<FbPostDraft | null> {
  const rows = await query(
    `SELECT value FROM kv_store WHERE key = $1`,
    [id]
  ).catch(() => []);
  if (!rows.length) return null;
  try {
    return JSON.parse(String((rows[0] as Record<string, unknown>).value)) as FbPostDraft;
  } catch {
    return null;
  }
}

/**
 * Envoie le brouillon (photo + texte) au TELEGRAM_GROUP_CHAT_ID avec boutons
 * inline "✅ Publier" (callback fb_post_publish_<id>) et "❌ Rejeter".
 * Propose seulement — la publication réelle se fait via /api/fb-post.
 */
export async function sendDraftToTelegram(draft: FbPostDraft): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_GROUP_CHAT_ID;
  if (!token || !chatId) return false;

  const serviceLabel = draft.service
    ? (SERVICE_LABELS[draft.service] ?? draft.service)
    : 'plancher époxy';

  const caption = [
    `📣 <b>Brouillon de post Facebook — ${serviceLabel}</b>`,
    ``,
    draft.message,
    ``,
    `<i>Clique ✅ Publier pour le mettre en ligne sur la page, sinon ❌ Rejeter.</i>`,
  ].join('\n').slice(0, 1024);

  const res = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      photo: draft.imageUrl,
      caption,
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '✅ Publier', callback_data: `fb_post_publish_${draft.id}` },
            { text: '❌ Rejeter', callback_data: `fb_post_reject_${draft.id}` },
          ],
        ],
      },
    }),
  });

  const j = await res.json().catch(() => ({ ok: false }));
  if (!j.ok) {
    console.error('Telegram fb-post sendPhoto failed:', j);
    // Fallback: message texte avec URL image si l'envoi photo échoue
    const fbRes = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: `📣 <b>Brouillon post FB</b>\n📷 ${draft.imageUrl}\n\n${draft.message}`,
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '✅ Publier', callback_data: `fb_post_publish_${draft.id}` },
              { text: '❌ Rejeter', callback_data: `fb_post_reject_${draft.id}` },
            ],
          ],
        },
      }),
    });
    const fbJ = await fbRes.json().catch(() => ({ ok: false }));
    return Boolean(fbJ.ok);
  }

  return true;
}

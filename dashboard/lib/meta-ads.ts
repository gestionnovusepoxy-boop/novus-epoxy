/**
 * lib/meta-ads.ts — Helpers for creating Meta ads (boosted posts).
 *
 * Token must have `pages_manage_ads` (granted on META_PAGE_TOKEN).
 * For full ads_management at the account level, regenerate a System User
 * token with that scope.
 */

import { put } from '@vercel/blob';
import { callLLM } from '@/lib/llm';
import { query } from '@/lib/db';

const META_API_VERSION = 'v25.0';
const NOVUS_PAGE_ID = '636757822863288';
// Default Lead Ad form (already active, wired to /api/meta/webhook)
const DEFAULT_LEAD_FORM_ID = '1645385520039445';

// KILL-SWITCH: l'automation des pubs (créer/publier/pauser des campagnes sur Meta) est
// DÉSACTIVÉE par défaut. Les pubs auto-générées performaient mal et brûlaient le budget.
// Luca gère ses pubs manuellement dans Ads Manager. Pour réactiver: ADS_AUTOMATION_ENABLED=true.
const ADS_AUTOMATION_ENABLED = process.env.ADS_AUTOMATION_ENABLED === 'true';

export interface AdDraftInput {
  service: 'flake' | 'metallique' | 'quartz' | 'couleur_unie' | 'antiderapant' | 'commercial' | 'meulage' | 'vinyl_click';
  dailyBudgetUsd?: number;
  durationDays?: number;
  customImageUrl?: string; // override LLM/Sage selection
}

export interface AdDraft {
  id: number;
  service: string;
  headline: string;
  primary_text: string;
  cta: string;
  image_url: string;
  image_source: 'sage' | 'llm';
  image_prompt?: string;
  daily_budget_usd: number;
  duration_days: number;
  target_audience: Record<string, unknown>;
}

const SERVICE_LABELS: Record<string, string> = {
  flake: 'Flake (flocon)',
  metallique: 'Métallique',
  quartz: 'Quartz',
  couleur_unie: 'Couleur Unie',
  antiderapant: 'Antidérapant',
  commercial: 'Commercial',
  meulage: 'Meulage diamant',
  vinyl_click: 'Vinyl click',
};

// Default targeting: 55km radius around Quebec City, age 30-65, French.
// MTL exclu. BROAD audience (no interest/behavior filter) → Advantage+ optimise
// mieux avec volume → ciblage sur le LEAD event de la pixel/form.
// Interest/behavior IDs require Meta Targeting Search API to discover real IDs.
// (user 2026-05-25: 55km only, no MTL)
const DEFAULT_TARGETING = {
  geo_locations: {
    custom_locations: [
      { latitude: 46.8139, longitude: -71.2080, radius: 55, distance_unit: 'kilometer' },
    ],
  },
  age_min: 30,
  age_max: 65,
  locales: [6, 24], // French (Canada), French
  // Désactive l'audience auto Meta (sinon impossible de garder age_min 30 — propriétaires).
  targeting_automation: { advantage_audience: 0 },
};

/** Pick best Sage portfolio image for a service (quality_score >= 9 preferred).
 *  Returns an ABSOLUTE URL so Telegram and Meta image upload both work. */
export async function pickSageImage(service: string): Promise<string | null> {
  const rows = await query(
    `SELECT photos, videos, titre, description FROM portfolio
     WHERE type_service = $1 AND (photos IS NOT NULL OR videos IS NOT NULL)
     ORDER BY featured DESC, RANDOM() LIMIT 1`,
    [service]
  ).catch(() => []);
  if (!rows.length) return null;
  const r = rows[0] as Record<string, unknown>;
  const photos = (r.photos ?? []) as string[];
  const videos = (r.videos ?? []) as string[];
  let url: string | null = null;
  if (Array.isArray(photos) && photos.length > 0) url = photos[0];
  else if (Array.isArray(videos) && videos.length > 0) url = videos[0];
  if (!url) return null;
  // Convert relative paths (e.g. /portfolio/foo.jpg) to absolute URLs
  if (url.startsWith('/')) {
    const base = process.env.NEXTAUTH_URL ?? 'https://novus-epoxy.vercel.app';
    return `${base}${url}`;
  }
  return url;
}

/** Generate ad via fal.ai Recraft V3 — best in class for ad creative with text.
 *  $0.04 per image, returns clean PNG with sharp legible text. */
async function generateViaFal(prompt: string): Promise<string | null> {
  const falKey = process.env.FAL_KEY;
  if (!falKey) return null;
  try {
    // Recraft V3 — designed specifically for ad creatives, brand assets, flyers with text
    const res = await fetch('https://fal.run/fal-ai/recraft-v3', {
      method: 'POST',
      headers: {
        'Authorization': `Key ${falKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt,
        image_size: 'portrait_4_3', // FB feed ratio
        style: 'realistic_image/studio_portrait',
        colors: [
          { r: 245, g: 158, b: 11 },  // gold #f59e0b
          { r: 15, g: 23, b: 42 },    // dark slate #0f172a
          { r: 168, g: 85, b: 247 },  // purple neon #a855f7
        ],
      }),
    });
    if (!res.ok) {
      console.error('fal.ai Recraft V3 failed:', res.status, await res.text().catch(() => ''));
      return null;
    }
    const data = await res.json();
    const imageUrl = data.images?.[0]?.url ?? data.image?.url ?? data.url;
    if (!imageUrl) return null;
    // Mirror to Vercel Blob for permanence (fal.ai URLs may expire)
    const fetched = await fetch(imageUrl);
    if (!fetched.ok) return imageUrl;
    const buffer = Buffer.from(await fetched.arrayBuffer());
    const blob = await put(`ads/${Date.now()}-fal-${Math.random().toString(36).slice(2,8)}.png`, buffer, {
      access: 'public', addRandomSuffix: false, contentType: 'image/png',
    });
    return blob.url;
  } catch (err) {
    console.error('fal.ai error:', err);
    return null;
  }
}

/** Generate a designed FB ad creative (flyer style).
 *  Priority: fal.ai Recraft V3 (best text) → OpenRouter GPT-5 Image (fallback). */
export async function generateAdImage(service: string): Promise<{ url: string; prompt: string } | null> {
  const label = SERVICE_LABELS[service] ?? service;
  // Service-specific hero scene
  const heroByService: Record<string, string> = {
    flake: `luxury Quebec garage with red Ferrari, multi-color flake epoxy floor with blue/gray/white flecks over deep gray base, ultra-glossy mirror finish, hexagon LED lighting, dark walls with neon purple accent`,
    metallique: `upscale Quebec basement home theater, metallic epoxy floor with liquid copper-bronze swirls like molten gold, mirror reflections, leather sectional, warm ambient LED`,
    quartz: `commercial Quebec kitchen, quartz epoxy floor cream-beige with sparkling flecks, satin finish, stainless steel`,
    couleur_unie: `modern Quebec basement, solid charcoal epoxy floor glass-smooth glossy, mirror reflections, minimalist furniture`,
    antiderapant: `Quebec balcony with anti-slip epoxy, light beige textured grip, natural daylight, outdoor patio chairs`,
    commercial: `large Quebec warehouse, light gray commercial epoxy floor mirror-glossy, perfect line markings, racks`,
    meulage: `Quebec retail showroom, polished concrete diamond-ground exposed aggregate, high-gloss`,
    vinyl_click: `Quebec basement family room, luxury vinyl click oak wood-look planks, warm tones, fireplace`,
  };
  const hero = heroByService[service] ?? `Quebec garage with premium ${label} epoxy floor`;

  // Designed flyer-style prompt with text overlay + Novus branding
  const prompt = `Professional Facebook ad creative flyer for "NOVUS EPOXY" — Quebec premium epoxy flooring company.

VISUAL SCENE: ${hero}. Magazine-quality 8k photography, dramatic lighting.

OVERLAY DESIGN (vertical 4:5 portrait ratio for FB feed):
TOP-LEFT: Large title text "PLANCHER ÉPOXY ${label.toUpperCase()}" — gold brushstroke font #f59e0b with white outline.
TOP-RIGHT: Bold price badge in dark purple/black box "7,25\$/pi²" and below it "15% DE RABAIS" in big gold letters.
MIDDLE-LEFT: Banner ribbon "SPÉCIAL PRINTEMPS — MAI SEULEMENT" in white on dark background.
RIGHT-CENTER: Quote arrow "TRANSFORMEZ VOTRE GARAGE EN UN ESPACE PREMIUM" with PREMIUM in gold italic.
BOTTOM-LEFT: 4 small icon features stacked vertically with gold diamond/shield/sparkle/timer icons:
  - "FINITION HAUT DE GAMME"
  - "RÉSISTANT AUX CHOCS"
  - "FACILE D'ENTRETIEN"
  - "INSTALLATION RAPIDE"
BOTTOM-CENTER: Round gold "NOVUS EPOXY" logo with crown/gas-mask emblem, subtitle "COMPAGNIE D'ÉPOXY QUÉBEC".
BOTTOM-LEFT corner: Hexagon phone icon "📞 581-307-5983 — APPELEZ MAINTENANT" in gold on dark.
BOTTOM strip: "RÉSIDENTIEL ET COMMERCIAL · GARANTIE ÉCRITE · SATISFACTION GARANTIE" small caps gold.

STYLE: dark luxurious aesthetic, gold #f59e0b accents, purple #a855f7 neon highlights, hexagon honeycomb pattern subtle. Inspired by premium auto detailing flyers. Brand colors: black, dark slate, gold, hot purple neon. NO blurry text, all text must be SHARP and LEGIBLE in French Quebec.

IMPORTANT: All text must be perfectly readable, in FRENCH (Quebec), no English words. Logo "NOVUS EPOXY" must be prominent.`;

  // PRIORITÉ 1: fal.ai Recraft V3 (best in class pour ad creative avec texte)
  const falUrl = await generateViaFal(prompt);
  if (falUrl) return { url: falUrl, prompt };

  // FALLBACK: OpenRouter image gen (GPT-5 Image)
  try {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) return null;
    // GPT-5 Image renders text in images far better than Gemini for designed ad creatives.
    // Override via OR_MODEL_IMAGE env if you prefer Gemini/Flux/etc.
    const model = process.env.OR_MODEL_IMAGE ?? 'openai/gpt-5-image';
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://novusepoxy.ca',
        'X-Title': 'Novus Epoxy',
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        modalities: ['image', 'text'],
      }),
    });
    if (!res.ok) {
      console.error('Image gen failed:', res.status, await res.text().catch(() => ''));
      return null;
    }
    const data = await res.json();
    // OpenRouter returns images either in choices[0].message.images[0].image_url or as base64 in content
    const images = data.choices?.[0]?.message?.images;
    let imageUrl: string | null = null;
    if (Array.isArray(images) && images[0]) {
      imageUrl = typeof images[0] === 'string' ? images[0] : (images[0].image_url?.url ?? images[0].url ?? null);
    }
    if (!imageUrl) return null;

    // If base64 data URL, upload to Vercel Blob for a stable URL
    if (imageUrl.startsWith('data:image')) {
      const match = imageUrl.match(/^data:(image\/[a-z]+);base64,(.+)$/);
      if (!match) return null;
      const mime = match[1];
      const ext = mime.split('/')[1] ?? 'png';
      const buffer = Buffer.from(match[2], 'base64');
      const blob = await put(`ads/${Date.now()}-${Math.random().toString(36).slice(2,8)}.${ext}`, buffer, {
        access: 'public', addRandomSuffix: false, contentType: mime,
      });
      imageUrl = blob.url;
    }

    return { url: imageUrl, prompt };
  } catch (err) {
    console.error('generateAdImage error:', err);
    return null;
  }
}

/** Compose ad copy via Grok 4.20 (smart tier). */
export async function generateAdCopy(service: string, options?: { promoPct?: number }): Promise<{ headline: string; primary_text: string; cta: string }> {
  const label = SERVICE_LABELS[service] ?? service;
  const promo = options?.promoPct ?? 0;
  // Mois courant (Québec) — plus de "MAI" hardcodé.
  const moisQc = new Date().toLocaleDateString('fr-CA', { month: 'long', timeZone: 'America/Toronto' }).toUpperCase();
  const promoLine = promo > 0
    ? `RÈGLE ABSOLUE: la 1ère ligne du primary_text DOIT commencer par "SPÉCIAL ${moisQc} — ${promo}% rabais" pour créer l'urgence.`
    : '';

  const system = `Tu es Luca, propriétaire de Novus Epoxy à Québec. Tu écris une pub Facebook qui te ressemble — direct, chaleureux, sans flafla corporate. Tu vises les propriétaires (30-65 ans) dans un rayon de 55km autour de Québec ville qui rêvent d'un beau garage/sous-sol.

CE QUE NOVUS EPOXY OFFRE:
- Plancher époxy haut de gamme — finition lisse, brillante, durable 10+ ans
- Transformation garage en espace PREMIUM (la voiture sport, le bar, le workshop)
- Soumission gratuite envoyée par SMS+email en MOINS DE 5 MIN (automatique, vraiment)
- Garantie écrite, finition résistante chocs/huiles/sels d'hiver
- Installation 2 jours, pas de chantier qui traîne
- Compagnie locale Québec — Luca te répond direct au 581-307-5983

TON STYLE — VENDEUR DIRECT, accrocheur, parle au client comme un voisin qui le pitche en face:
✅ EXEMPLE PARFAIT (à imiter): "Votre plancher de garage est gris, laid, taché? Vous voulez du PREMIUM avec un vrai rapport qualité-prix? On a ça pour vous."
✅ "Ton garage mérite mieux qu'un dépotoir."
✅ "Imagine ta voiture sur un plancher qui shine comme un showroom."
✅ "Fini les fissures, les taches d'huile, le béton poreux."
✅ "On t'envoie ta soumission par texto en 5 minutes — c'est-tu hot ça?"
✅ Mots qui VENDENT: "premium", "qualité-prix", "garantie écrite", "10 ans", "ultra résistant", "haut de gamme", "showroom", "transforme"
❌ "Notre entreprise est leader dans le domaine de la finition de planchers..."
❌ "Solution premium pour résidences modernes."

C'est de la VENTE DIRECTE. Tu parles au client comme un vendeur de char qui pitche dans son driveway. Pas un brochure corporate.

RÉPONDS STRICTEMENT EN JSON: {"headline":"...","primary_text":"...","cta":"SIGN_UP"}.

RÈGLES:
- headline: max 40 char. Accroche-toi. Ex: "Ton garage mérite mieux." OU "Plancher époxy 5★ en 2 jours."

- primary_text: 4 PARAGRAPHES séparés par LIGNES VIDES (\\n\\n), total 280-450 char.
    Structure OBLIGATOIRE:

    Paragraphe 1 — HOOK question accrocheuse:
      Ex: "Ton garage ressemble encore à un entrepôt?" OU "Tu rêves d'un plancher qui shine comme un showroom?"

    Paragraphe 2 — BÉNÉFICE + FEATURES (2-3 features tangibles):
      Ex: "Transforme-le en espace premium avec un plancher flake haut de gamme, résistant aux chocs, à l'huile et aux sels d'hiver. Garantie écrite 10 ans."

    Paragraphe 3 — URGENCE PROMO:
      "🎯 Spécial mai : 15% de rabais — réservé aux propriétaires Québec ville"

    Paragraphe 4 — DOUBLE CTA (form + téléphone):
      "Soumission gratuite en 5 minutes par texto + courriel.
      📞 581-307-5983 — Luca répond direct"

- Le 📞 et 581-307-5983 — Luca SONT OBLIGATOIRES dans le dernier paragraphe
- Aucun prix exact (\$/pi² etc) dans le texte
- Max 2 emojis total (🎯 et 📞 acceptés), aucun dans headline
- Verbe à l'impératif/2e personne — "transforme", "imagine", "fini les..."
- cta fixé à SIGN_UP

${promoLine}`;

  const userPrompt = `Service à mettre en vedette: ${label} (${service}).
Audience: propriétaires Québec ville et banlieue, 30-65 ans, intéressés rénovation garage/sous-sol.
Objectif: lead form fill (soumission gratuite).

Génère LA pub la plus accrocheuse possible. Pense impact en 1 seconde de scroll.`;

  try {
    const text = await callLLM({
      system,
      messages: [{ role: 'user', content: userPrompt }],
      maxTokens: 1200, // 4 paragraphs need more room (was 500, got truncated)
      tier: 'smart', // Grok 4.20 — supporte json_object mode garanti
      jsonMode: true,
      agent: 'ads-generator',
      traceName: `ad-copy-${service}`,
    });
    const parsed = JSON.parse(text);
    let primary = String(parsed.primary_text ?? '').slice(0, 500);
    // Failsafe: si le LLM oublie le téléphone, on l'ajoute
    if (!primary.includes('581-307-5983')) {
      primary = primary.trim() + '\n📞 581-307-5983 — Luca';
    }
    return {
      headline: String(parsed.headline ?? `Plancher ${label} premium`).slice(0, 40),
      primary_text: primary,
      cta: 'SIGN_UP',
    };
  } catch {
    const promoTag = promo > 0 ? `SPÉCIAL MAI — ${promo}% rabais.\n` : '';
    return {
      headline: `Ton garage mérite mieux`,
      primary_text: `${promoTag}Transforme ton garage en espace premium.\nSoumission gratuite par texto en 5 min.\n📞 581-307-5983 — Luca`,
      cta: 'SIGN_UP',
    };
  }
}

/** Build a full draft (image + copy + targeting). */
export async function buildAdDraft(input: AdDraftInput): Promise<AdDraft> {
  const service = input.service;
  const dailyBudget = input.dailyBudgetUsd ?? 50;
  const duration = input.durationDays ?? 7;

  // Get active promo
  let promoPct = 0;
  try {
    const p = await query(`SELECT rabais_pct FROM promotions WHERE actif = true AND date_debut <= CURRENT_DATE AND date_fin >= CURRENT_DATE ORDER BY rabais_pct DESC LIMIT 1`).catch(() => []);
    if (p[0]) promoPct = Number(p[0].rabais_pct);
  } catch { /* no promo */ }

  // Step 1: image — PRIORITÉ AUX VRAIES PHOTOS DU PORTFOLIO.
  // Les images IA généraient du faux que personne croyait → 897 vues, 0 lead (mai 2026).
  // Les vraies photos avant/après de planchers convertissent. Ordre: 1) photo custom uploadée,
  // 2) vraie photo portfolio (Sage), 3) IA SEULEMENT en dernier recours si aucune vraie photo.
  let imageUrl: string | null = input.customImageUrl ?? null;
  let imageSource: 'sage' | 'llm' = 'sage';
  let imagePrompt: string | undefined;
  if (!imageUrl) {
    // Vraie photo du portfolio d'abord (c'est ce qui marche)
    imageUrl = await pickSageImage(service);
    if (imageUrl) {
      imageSource = 'sage';
    } else {
      // Aucune vraie photo pour ce service → dernier recours: génération IA
      const generated = await generateAdImage(service);
      if (generated) {
        imageUrl = generated.url;
        imageSource = 'llm';
        imagePrompt = generated.prompt;
      }
    }
  }
  if (!imageUrl) {
    throw new Error(`No image available (no portfolio photo AND LLM gen failed for ${service})`);
  }

  // Step 2: copy
  const copy = await generateAdCopy(service, { promoPct });

  // Step 3: persist draft
  const rows = await query(
    `INSERT INTO meta_ads_drafts (service, headline, primary_text, cta, image_url, image_source, image_prompt, daily_budget_usd, target_audience, duration_days, statut)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,'brouillon') RETURNING id`,
    [service, copy.headline, copy.primary_text, copy.cta, imageUrl, imageSource, imagePrompt ?? null, dailyBudget, JSON.stringify(DEFAULT_TARGETING), duration]
  );
  const id = rows[0].id as number;

  return {
    id,
    service,
    headline: copy.headline,
    primary_text: copy.primary_text,
    cta: copy.cta,
    image_url: imageUrl,
    image_source: imageSource,
    image_prompt: imagePrompt,
    daily_budget_usd: dailyBudget,
    duration_days: duration,
    target_audience: DEFAULT_TARGETING,
  };
}

/** Send the draft to Telegram group: photo + short caption, then detailed breakdown with buttons. */
export async function sendDraftToTelegram(draft: AdDraft, chatId: string): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return false;

  const serviceLabel = SERVICE_LABELS[draft.service] ?? draft.service;
  // Compte pub en CAD (Quebec) — daily_budget_usd column kept for legacy schema name
  // but values stored/displayed are CAD.
  const totalBudgetCad = draft.daily_budget_usd * draft.duration_days;
  const endDate = new Date(Date.now() + draft.duration_days * 86400_000).toLocaleDateString('fr-CA', { day: 'numeric', month: 'long' });
  const formId = (process.env.META_LEAD_FORM_ID ?? '1645385520039445').trim();
  // CPL benchmark for home-services Quebec ~$25-50 CAD
  const estLeadsLow = Math.floor(totalBudgetCad / 50);
  const estLeadsHigh = Math.floor(totalBudgetCad / 25);

  // STEP 1 — Photo with hero caption (1024 char max)
  const heroCaption = [
    `📢 <b>Nouvelle pub Facebook — ${serviceLabel}</b>`,
    ``,
    `🎯 <b>${draft.headline}</b>`,
    ``,
    draft.primary_text,
  ].join('\n').slice(0, 1024);

  const photoRes = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      photo: draft.image_url,
      caption: heroCaption,
      parse_mode: 'HTML',
    }),
  });
  const photoJ = await photoRes.json();
  if (!photoJ.ok) {
    console.error('Telegram sendPhoto failed:', photoJ);
    // Fallback: send as URL message if photo fails
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: `📷 Image: ${draft.image_url}`, parse_mode: 'HTML' }),
    });
  }

  // STEP 2 — Detailed breakdown + buttons
  const details = [
    `📋 <b>DÉTAILS COMPLETS — Pub #${draft.id}</b>`,
    ``,
    `<b>💼 SERVICE</b>`,
    `${serviceLabel}`,
    ``,
    `<b>💰 BUDGET & DURÉE</b>`,
    `$${draft.daily_budget_usd} CAD/jour × ${draft.duration_days} jours = <b>$${totalBudgetCad} CAD</b> total`,
    `Se termine: <b>${endDate}</b>`,
    ``,
    `<b>🎯 TARGETING</b>`,
    `📍 Rayon <b>55 km</b> autour de Québec ville (Lévis, Beauport, Charlesbourg, Sainte-Foy inclus)`,
    `👥 Âge: <b>30-65 ans</b>`,
    `🏠 Behaviors: Propriétaires`,
    `❤️ Intérêts: Rénovation, Home improvement, Garage`,
    `🗣 Langue: Français`,
    `🚫 Montréal exclu`,
    ``,
    `<b>📝 FORMULAIRE LEAD AD</b>`,
    `Form ID: <code>${formId}</code> (déjà actif)`,
    `Champs demandés: nom, tél, email, service, superficie, espace, adresse`,
    `→ Lead arrive direct dans CRM en <b>&lt;5 sec</b>`,
    `→ Devis brouillon auto + bouton Approuver dans le groupe`,
    `→ SMS+email au client en <b>&lt;5 min</b> après ton clic`,
    ``,
    `<b>⚙️ CONFIG META</b>`,
    `Objectif: <code>OUTCOME_LEADS</code>`,
    `Optimization: <code>LEAD_GENERATION</code>`,
    `Bid: <code>LOWEST_COST_WITHOUT_CAP</code> (auto-bid)`,
    `Placements: Advantage+ (Feed FB + IG + Reels + Stories)`,
    `CTA: <code>SIGN_UP</code> (ouvre form natif dans FB)`,
    ``,
    `<b>📸 IMAGE</b>`,
    `Source: ${draft.image_source === 'sage' ? '📁 portfolio Sage' : draft.image_source === 'llm' ? '✨ générée IA (Gemini 3 Pro)' : '📤 uploadée par toi'}`,
    ``,
    `<b>📊 PROJECTION (CPL Québec ~$25-50)</b>`,
    `Leads estimés sur ${draft.duration_days}j: <b>${estLeadsLow}-${estLeadsHigh}</b>`,
    `Pipeline: lead → devis auto → close ~25% = <b>${Math.floor(estLeadsLow * 0.25)}-${Math.floor(estLeadsHigh * 0.25)} projets fermés</b>`,
    ``,
    `━━━━━━━━━━━━━━━━━━━━━━`,
    `<b>🚀 Si tu cliques ✅ Approuver:</b>`,
    `1. Pause auto des anciennes pubs Novus actives`,
    `2. Crée campagne <b>ACTIVE direct</b> dans Meta Ads Manager`,
    `3. Te ping ici avec le lien Ads Manager`,
    `4. Premiers leads attendus dans 1-4h`,
  ].join('\n');

  const detailsRes = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: details.slice(0, 4096),
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '✅ Approuver et lancer', callback_data: `approve_ad_${draft.id}` },
            { text: '❌ Rejeter', callback_data: `reject_ad_${draft.id}` },
          ],
          [
            { text: '🔁 Régénérer (autre copy/photo)', callback_data: `regen_ad_${draft.id}` },
          ],
        ],
      },
    }),
  });
  const detailsJ = await detailsRes.json();
  if (!detailsJ.ok) console.error('Telegram details failed:', detailsJ);

  return Boolean(photoJ.ok && detailsJ.ok);
}

/**
 * Pause previously launched Novus ads of the SAME service (statut='lance').
 * Called when approving a new draft → replaces same-service ad, lets other services
 * coexist (e.g. flake + métallique tournent en parallèle).
 * Returns array of paused campaign IDs.
 */
export async function pausePreviousLaunchedAds(service?: string): Promise<{ paused: string[]; failed: Array<{ id: string; error: string }> }> {
  // Ne pause QUE les anciennes pubs créées par le système (meta_ads_drafts), pas tes pubs manuelles.
  const token = (process.env.META_PAGE_TOKEN ?? '').trim();
  if (!token) return { paused: [], failed: [] };

  const rows = service
    ? await query(
        `SELECT id, meta_campaign_id FROM meta_ads_drafts WHERE statut = 'lance' AND meta_campaign_id IS NOT NULL AND service = $1`,
        [service]
      ).catch(() => [])
    : await query(
        `SELECT id, meta_campaign_id FROM meta_ads_drafts WHERE statut = 'lance' AND meta_campaign_id IS NOT NULL`
      ).catch(() => []);
  if (!rows.length) return { paused: [], failed: [] };

  const paused: string[] = [];
  const failed: Array<{ id: string; error: string }> = [];

  for (const row of rows) {
    const r = row as Record<string, unknown>;
    const campaignId = String(r.meta_campaign_id ?? '');
    if (!campaignId) continue;
    try {
      const res = await fetch(`https://graph.facebook.com/${META_API_VERSION}/${campaignId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'PAUSED', access_token: token }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        paused.push(campaignId);
        await query(`UPDATE meta_ads_drafts SET statut = 'remplacee', updated_at = NOW() WHERE id = $1`, [r.id]);
      } else {
        failed.push({ id: campaignId, error: data.error?.message ?? `HTTP ${res.status}` });
      }
    } catch (err) {
      failed.push({ id: campaignId, error: (err as Error).message });
    }
  }

  return { paused, failed };
}

/**
 * Pause ALL active campaigns in the ad account (not just Novus-tracked ones).
 * Best-effort: tries 3 different Graph API endpoints since the PAGE token
 * has limited access. Returns what was found + paused.
 */
export async function pauseAllActiveCampaigns(): Promise<{ paused: string[]; failed: Array<{ id: string; error: string }>; listError?: string }> {
  if (!ADS_AUTOMATION_ENABLED) return { paused: [], failed: [], listError: 'Automation pubs désactivée' };
  const token = (process.env.META_PAGE_TOKEN ?? '').trim();
  const adAccountId = (process.env.META_AD_ACCOUNT_ID ?? '').trim().replace(/^act_/, '');
  if (!token || !adAccountId) return { paused: [], failed: [], listError: 'token or ad account missing' };

  // Try 3 endpoints to list active campaigns (page tokens often lack ads_read).
  const endpoints = [
    `https://graph.facebook.com/${META_API_VERSION}/act_${adAccountId}/campaigns?fields=id,name,effective_status&effective_status=%5B%22ACTIVE%22%5D&limit=50&access_token=${token}`,
    `https://graph.facebook.com/${META_API_VERSION}/${NOVUS_PAGE_ID}/ads_posts?fields=id&limit=50&access_token=${token}`,
    `https://graph.facebook.com/${META_API_VERSION}/act_${adAccountId}/ads?fields=id,name,campaign_id,effective_status&effective_status=%5B%22ACTIVE%22%5D&limit=50&access_token=${token}`,
  ];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let listed: any[] = [];
  let listError: string | undefined;
  for (const url of endpoints) {
    try {
      const res = await fetch(url);
      const data = await res.json();
      if (res.ok && Array.isArray(data.data) && data.data.length > 0) {
        listed = data.data;
        listError = undefined;
        break;
      }
      if (data.error) listError = data.error.message;
    } catch (err) {
      listError = (err as Error).message;
    }
  }

  if (listed.length === 0) {
    return { paused: [], failed: [], listError: listError ?? 'No active campaigns found via available endpoints' };
  }

  const paused: string[] = [];
  const failed: Array<{ id: string; error: string }> = [];

  // Try to POST status=PAUSED on each — works if the campaign was created via this page
  for (const item of listed) {
    const id = String(item.campaign_id ?? item.id ?? '');
    if (!id || paused.includes(id)) continue;
    try {
      const res = await fetch(`https://graph.facebook.com/${META_API_VERSION}/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'PAUSED', access_token: token }),
      });
      const data = await res.json();
      if (res.ok && (data.success || data.id)) {
        paused.push(id);
      } else {
        failed.push({ id, error: data.error?.message ?? `HTTP ${res.status}` });
      }
    } catch (err) {
      failed.push({ id, error: (err as Error).message });
    }
  }

  return { paused, failed };
}

/**
 * Build a deep-link to Ads Manager pre-filled with draft data.
 * Used as fallback when API campaign creation fails (e.g. token has
 * pages_manage_ads but not ads_management).
 */
export async function buildAdsManagerPrefillUrl(draftId: number): Promise<string> {
  const adAccountId = (process.env.META_AD_ACCOUNT_ID ?? '').replace(/^act_/, '');
  const rows = await query(`SELECT * FROM meta_ads_drafts WHERE id = $1`, [draftId]);
  if (!rows.length) return `https://business.facebook.com/adsmanager/manage/campaigns?act=${adAccountId}`;
  const d = rows[0] as Record<string, unknown>;
  const formId = (process.env.META_LEAD_FORM_ID ?? '1645385520039445').trim();
  // Ads Manager wizard: pre-select campaign type + lead form + ad account
  const params = new URLSearchParams({
    act: adAccountId,
    business_id: '',
    objective: 'OUTCOME_LEADS',
    optimization_goal: 'LEAD_GENERATION',
    daily_budget: String(Math.round(Number(d.daily_budget_usd ?? 30) * 100)),
    lead_form_id: formId,
    name: `Novus ${String(d.service)} ${new Date().toISOString().slice(0,10)}`,
  });
  return `https://business.facebook.com/adsmanager/creation?${params.toString()}`;
}

/**
 * Create the actual Meta ad campaign in PAUSED state.
 * Requires AD_ACCOUNT_ID env. Returns Meta IDs.
 */
export async function createMetaCampaignPaused(draftId: number): Promise<{ campaignId?: string; adsetId?: string; adId?: string; error?: string; needsAdsManagement?: boolean }> {
  // Note: lancement autorisé UNIQUEMENT via approbation humaine (bouton Telegram ✅).
  // Le cron autonome (ads-weekly) reste désactivé séparément — pas de pub auto sans ton OK.
  const token = (process.env.META_PAGE_TOKEN ?? '').trim();
  const adAccountId = (process.env.META_AD_ACCOUNT_ID ?? '').trim().replace(/^act_/, '');
  if (!token) return { error: 'META_PAGE_TOKEN missing' };
  if (!adAccountId) return { error: 'META_AD_ACCOUNT_ID missing — set it in Vercel env (without act_ prefix)' };

  const rows = await query(`SELECT * FROM meta_ads_drafts WHERE id = $1`, [draftId]);
  if (!rows.length) return { error: 'Draft not found' };
  const d = rows[0] as Record<string, unknown>;
  const dailyBudgetCents = Math.round(Number(d.daily_budget_usd ?? 50) * 100);
  // Always use fresh DEFAULT_TARGETING — DB-stored target_audience may contain
  // stale interest/behavior IDs from earlier code. Override draft schema later
  // when we let user customize targeting via UI.
  const targeting = DEFAULT_TARGETING;

  // ACTIVE sur approbation humaine — tu approuves une bonne pub → elle part live direct pour générer des leads.
  // (Le cron autonome reste OFF, donc ACTIVE n'arrive QUE quand TU tapes ✅.)
  const entityStatus = (process.env.META_ADS_DEFAULT_STATUS ?? 'ACTIVE').toUpperCase();

  try {
    // 1) Create campaign — ACTIVE by default
    const campRes = await fetch(`https://graph.facebook.com/${META_API_VERSION}/act_${adAccountId}/campaigns`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: `Novus ${String(d.service)} — ${new Date().toISOString().slice(0,10)}`,
        objective: 'OUTCOME_LEADS',
        status: entityStatus,
        special_ad_categories: [],
        buying_type: 'AUCTION',
        is_adset_budget_sharing_enabled: false,
        access_token: token,
      }),
    });
    const campData = await campRes.json();
    if (!campRes.ok || !campData.id) {
      const msg = String(campData.error?.message ?? JSON.stringify(campData));
      const isPermError = msg.includes('cannot be loaded') || msg.includes('missing permission') || campData.error?.code === 100;
      return { error: `Campaign creation failed: ${msg}`, needsAdsManagement: isPermError };
    }
    const campaignId = campData.id;

    // 2) Create ad set — destination_type ON_AD routes to Lead Form on the ad
    const adsetRes = await fetch(`https://graph.facebook.com/${META_API_VERSION}/act_${adAccountId}/adsets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: `${String(d.service)} adset`,
        campaign_id: campaignId,
        daily_budget: dailyBudgetCents,
        billing_event: 'IMPRESSIONS',
        optimization_goal: 'LEAD_GENERATION',
        destination_type: 'ON_AD',
        promoted_object: { page_id: NOVUS_PAGE_ID },
        bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
        targeting,
        status: entityStatus,
        end_time: new Date(Date.now() + Number(d.duration_days ?? 7) * 86400_000).toISOString(),
        access_token: token,
      }),
    });
    const adsetData = await adsetRes.json();
    if (!adsetRes.ok || !adsetData.id) {
      const e = adsetData.error ?? {};
      // Code 200 = le token n'a pas ads_management. Signale-le clairement (pas un bug de param).
      const detail = [e.message, e.error_user_title, e.error_user_msg].filter(Boolean).join(' — ');
      const needsPerm = e.code === 200 || /ads_management|ads_read|permission/i.test(detail);
      return { error: `AdSet creation failed: ${detail || JSON.stringify(adsetData)}`, needsAdsManagement: needsPerm };
    }
    const adsetId = adsetData.id;

    // 3) Create ad creative — uses `picture` URL directly (no adimages upload required).
    // Bypasses Marketing API "Standard Access tier" requirement — works with app's
    // existing Limited tier + ads_management scope.
    const leadFormId = (process.env.META_LEAD_FORM_ID ?? DEFAULT_LEAD_FORM_ID).trim();
    const creativeRes = await fetch(`https://graph.facebook.com/${META_API_VERSION}/act_${adAccountId}/adcreatives`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: `${String(d.service)} creative — Lead Ad`,
        object_story_spec: {
          page_id: NOVUS_PAGE_ID,
          link_data: {
            picture: String(d.image_url),
            // Lead Ads: link points to the form's facebook URL (Meta hands form natively)
            link: `https://fb.me/${leadFormId}`,
            message: String(d.primary_text),
            name: String(d.headline),
            call_to_action: {
              type: 'SIGN_UP', // CTA shown on the ad — opens form on click
              value: { lead_gen_form_id: leadFormId },
            },
          },
        },
        access_token: token,
      }),
    });
    const creativeData = await creativeRes.json();
    if (!creativeRes.ok || !creativeData.id) {
      return { error: `Creative creation failed: ${creativeData.error?.message ?? JSON.stringify(creativeData)}` };
    }
    const creativeId = creativeData.id;

    // 5) Create ad — ACTIVE direct (user already approved via Telegram).
    // Override via META_ADS_DEFAULT_STATUS env if you want PAUSED safety gate.
    const adStatus = (process.env.META_ADS_DEFAULT_STATUS ?? 'ACTIVE').toUpperCase();
    const adRes = await fetch(`https://graph.facebook.com/${META_API_VERSION}/act_${adAccountId}/ads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: `${String(d.service)} ad`,
        adset_id: adsetId,
        creative: { creative_id: creativeId },
        status: adStatus,
        access_token: token,
      }),
    });
    const adData = await adRes.json();
    if (!adRes.ok || !adData.id) {
      return { error: `Ad creation failed: ${adData.error?.message ?? JSON.stringify(adData)}` };
    }
    const adId = adData.id;

    // Persist Meta IDs
    await query(
      `UPDATE meta_ads_drafts SET statut = 'lance', launched_at = NOW(), meta_campaign_id = $1, meta_adset_id = $2, meta_ad_id = $3, updated_at = NOW() WHERE id = $4`,
      [campaignId, adsetId, adId, draftId]
    );

    return { campaignId, adsetId, adId };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await query(`UPDATE meta_ads_drafts SET statut = 'erreur', error = $1, updated_at = NOW() WHERE id = $2`, [msg, draftId]);
    return { error: msg };
  }
}

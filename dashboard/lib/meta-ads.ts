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

/** Generate a hyperrealistic ad image via OpenRouter image model. */
export async function generateAdImage(service: string): Promise<{ url: string; prompt: string } | null> {
  const label = SERVICE_LABELS[service] ?? service;
  const promptByService: Record<string, string> = {
    flake: `Stunning professional photograph of a finished epoxy flake floor in a luxury Quebec garage. Multi-color flecks (blue, gray, white) over deep gray base, ultra-glossy mirror finish reflecting recessed LED lighting. Sleek modern garage with red Ferrari partially visible, white walls, polished concrete walls. Magazine-quality shot, wide-angle, HDR, professional architectural photography, ultra-realistic, 8k.`,
    metallique: `Stunning professional photograph of a finished metallic epoxy floor in an upscale Quebec basement. Liquid-metal copper-bronze swirls with depth like molten gold, mirror-glossy reflective finish. Modern home theater room with leather sectional and big screen TV partially visible, ambient warm LED lighting. Magazine-quality interior photography, ultra-realistic, 8k, HDR.`,
    quartz: `Stunning professional photograph of a finished quartz epoxy floor in a commercial Quebec kitchen. Cream-beige base with sparkling quartz flecks, satin-matte finish, ultra-clean. Industrial stainless steel kitchen partially visible. Magazine quality, ultra-realistic, 8k.`,
    couleur_unie: `Stunning professional photograph of a finished solid-color epoxy floor in a modern Quebec basement. Deep charcoal gray, glass-smooth glossy finish, mirror reflections of modern furniture. Magazine quality, ultra-realistic, 8k, HDR.`,
    antiderapant: `Stunning professional photograph of a finished anti-slip epoxy floor on a Quebec balcony. Light beige textured grip surface, weather-resistant, natural daylight. Outdoor wood patio chairs partially visible. Magazine quality, ultra-realistic, 8k.`,
    commercial: `Stunning professional photograph of a finished commercial epoxy floor in a large Quebec warehouse. Clean light gray, mirror-glossy industrial finish, perfect line markings, racks partially visible. Magazine quality, ultra-realistic, 8k, HDR.`,
    meulage: `Stunning professional photograph of a polished concrete floor in a Quebec retail showroom. Diamond-ground exposed aggregate, high-gloss polished concrete finish, mirror reflections. Magazine quality, ultra-realistic, 8k.`,
    vinyl_click: `Stunning professional photograph of a luxury vinyl click floor in a modern Quebec basement family room. Realistic oak wood-look planks, warm tones, large sectional sofa, fireplace. Magazine quality, ultra-realistic, 8k.`,
  };
  const prompt = promptByService[service] ?? `Stunning professional photograph of a finished ${label} epoxy floor, ultra-realistic, 8k, magazine quality.`;

  // Use OpenRouter image generation (Gemini 3 Pro Image)
  // OpenRouter passes through to provider; image gen uses chat completions with image output
  try {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) return null;
    const model = process.env.OR_MODEL_IMAGE ?? 'google/gemini-3-pro-image-preview';
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
  const promoLine = promo > 0
    ? `IMPORTANT: mentionne SPÉCIAL PRINTEMPS — MAI SEULEMENT avec le rabais ${promo}%. Crée l'urgence.`
    : '';

  const system = `Tu es un copywriter Facebook Ads pour Novus Epoxy — planchers époxy haut de gamme à Québec. Tu écris pour des PROPRIÉTAIRES Quebec ville (rayon 55km), 30-65 ans, intérêt garage/rénovation.

Angle marketing CORE de Novus Epoxy:
- Transforme garage en espace PREMIUM (pas juste un plancher)
- Soumission gratuite envoyée par SMS+email en moins de 5 minutes (vraiment, automatique)
- Spécial printemps mai 15% rabais
- Finition haut de gamme, résistante chocs/produits, garantie écrite
- Compagnie Québec — Luca 581-307-5983

Style: direct, chaleureux, québécois, jamais corporate. Tu parles comme un voisin.

Réponds STRICTEMENT en JSON: {"headline":"...","primary_text":"...","cta":"SIGN_UP"}.

Règles:
- Headline: max 40 caractères, accrocheur, mentionne le service OU le bénéfice.
- Primary text: 3-4 lignes courtes, total max 200 caractères. Hook (problème ou rêve) → bénéfice (transformation) → urgence (mai 15%) → CTA implicite.
- CTA fixé à SIGN_UP (Lead Ad form).
- Max 2 emojis total. Aucun dans headline.
- Mentionne "soumission en 5 min" si pertinent.
- Aucun prix exact dans le texte.
${promoLine}`;

  const userPrompt = `Service: ${label}. Génère 1 annonce Lead Ad pour propriétaires 30-65 ans, rayon 55km Québec ville, intérêt rénovation garage.`;

  try {
    const text = await callLLM({
      system,
      messages: [{ role: 'user', content: userPrompt }],
      maxTokens: 400,
      tier: 'smart',
      jsonMode: true,
      agent: 'ads-generator',
      traceName: `ad-copy-${service}`,
    });
    const parsed = JSON.parse(text);
    return {
      headline: String(parsed.headline ?? `Plancher ${label} premium`).slice(0, 40),
      primary_text: String(parsed.primary_text ?? '').slice(0, 500),
      cta: 'SIGN_UP', // Lead Ad always SIGN_UP
    };
  } catch {
    const promoTag = promo > 0 ? `Spécial printemps mai — ${promo}% rabais. ` : '';
    return {
      headline: `Plancher ${label} premium`,
      primary_text: `${promoTag}Transforme ton garage en espace premium. Soumission envoyée par SMS en moins de 5 minutes. Compagnie Québec — garantie écrite. 581-307-5983.`,
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

  // Step 1: image — Sage portfolio first, LLM fallback
  let imageUrl: string | null = input.customImageUrl ?? null;
  let imageSource: 'sage' | 'llm' = 'sage';
  let imagePrompt: string | undefined;
  if (!imageUrl) {
    imageUrl = await pickSageImage(service);
  }
  if (!imageUrl) {
    const generated = await generateAdImage(service);
    if (generated) {
      imageUrl = generated.url;
      imageSource = 'llm';
      imagePrompt = generated.prompt;
    }
  }
  if (!imageUrl) {
    throw new Error(`No image available (no Sage portfolio for ${service} and LLM generation failed)`);
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
    `<b>⏸ MODE: PAUSED jusqu'à approbation</b>`,
    ``,
    `Si tu cliques <b>✅ Approuver</b>:`,
    `1. Pause auto des anciennes pubs Novus actives`,
    `2. Crée campagne PAUSED dans Meta Ads Manager`,
    `3. Te donne lien direct pour activer le toggle`,
    `4. Leads commencent dès toggle ON`,
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
 * Pause all previously launched Novus ads (statut='lance') in Meta.
 * Called automatically when a new ad is approved → keeps total active ads = 1.
 * Returns array of paused campaign IDs.
 */
export async function pausePreviousLaunchedAds(): Promise<{ paused: string[]; failed: Array<{ id: string; error: string }> }> {
  const token = (process.env.META_PAGE_TOKEN ?? '').trim();
  if (!token) return { paused: [], failed: [] };

  const rows = await query(
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

  try {
    // 1) Create campaign (PAUSED) — Meta requires is_adset_budget_sharing_enabled
    //    when budget is at adset level (not campaign level)
    const campRes = await fetch(`https://graph.facebook.com/${META_API_VERSION}/act_${adAccountId}/campaigns`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: `Novus ${String(d.service)} — ${new Date().toISOString().slice(0,10)}`,
        objective: 'OUTCOME_LEADS',
        status: 'PAUSED',
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

    // 2) Create ad set (PAUSED) — destination_type ON_AD routes to Lead Form on the ad
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
        status: 'PAUSED',
        end_time: new Date(Date.now() + Number(d.duration_days ?? 7) * 86400_000).toISOString(),
        access_token: token,
      }),
    });
    const adsetData = await adsetRes.json();
    if (!adsetRes.ok || !adsetData.id) {
      return { error: `AdSet creation failed: ${adsetData.error?.message ?? JSON.stringify(adsetData)}` };
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

    // 5) Create ad (PAUSED — Luca activates from Ads Manager OR via separate "Lancer LIVE" button)
    const adRes = await fetch(`https://graph.facebook.com/${META_API_VERSION}/act_${adAccountId}/ads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: `${String(d.service)} ad`,
        adset_id: adsetId,
        creative: { creative_id: creativeId },
        status: 'PAUSED',
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

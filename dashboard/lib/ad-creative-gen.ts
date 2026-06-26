/**
 * lib/ad-creative-gen.ts — Générateur de créatifs publicitaires LIVE réutilisable.
 *
 * Porté depuis les scripts gitignored jetables (diag-gen-ad-image.mjs +
 * diag-composite-ad.mjs) vers du code de production réutilisable.
 *
 * Pipeline:
 *   1) generateBasePhoto() — photo photoréaliste via OpenRouter modèle image
 *      (openai/gpt-5.4-image-2 → fallback gpt-5-image → gemini-3-pro-image-preview),
 *      prompt adapté au service (flake / metallique / ...).
 *   2) composeGoldOverlay() — overlay OR par-dessus via `sharp` (titre NOVUS EPOXY,
 *      badge rabais, 3 puces "Garantie écrite / Installé en 2 jours / 15 ans
 *      d'expérience", bande logo + 581-307-5983). Réutilise public/logo.jpg.
 *   3) Upload sur Vercel Blob (BLOB_READ_WRITE_TOKEN auto-lu par @vercel/blob).
 *
 * IMPORTANT: ce module NE LANCE RIEN sur Meta. Il ne fait que générer une URL d'image.
 * L'approbation Telegram + le lancement de campagne vivent dans lib/meta-ads.ts.
 *
 * Règle pub validée (Luca): photo GPT + overlay or (logo + numéro 581-307-5983 +
 * badge rabais + 3 puces dont "15 ans d'expérience").
 */

import { put } from '@vercel/blob';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const PHONE = '581-307-5983';

/** Services supportés par le générateur de scène. */
export type CreativeService =
  | 'flake'
  | 'metallique'
  | 'quartz'
  | 'couleur_unie'
  | 'antiderapant'
  | 'commercial'
  | 'meulage'
  | 'vinyl_click';

export interface GenerateAdCreativeInput {
  /** Service à mettre en vedette (détermine la scène photoréaliste). */
  service: CreativeService | string;
  /** Texte de promo affiché dans le badge or (ex: "-20%", "OFFRE DE JUIN").
   *  Si vide, on affiche "SOUMISSION GRATUITE" sans rabais. */
  promoText?: string;
  /** Indice de variante (change l'angle/l'accroche/le prompt). Défaut 0. */
  variantSeed?: number;
}

export interface AdCreative {
  /** URL publique permanente (Vercel Blob) du créatif final avec overlay. */
  url: string;
  /** URL de la photo de base (sans overlay), utile pour debug/réutilisation. */
  baseUrl: string;
  /** Le prompt exact utilisé pour générer la photo. */
  prompt: string;
  /** Modèle image qui a réussi. */
  model: string;
  /** Service ciblé. */
  service: string;
  /** Texte de promo gravé dans le badge. */
  promoText: string;
}

// ── Scènes photoréalistes par service ────────────────────────────────────────
// Plusieurs angles/variantes par service → A/B test de créatifs différents.
const SERVICE_SCENES: Record<string, string[]> = {
  flake: [
    `STUNNING residential garage floor with flake (chip) epoxy — gray-blue colored vinyl flecks scattered densely over a deep charcoal-gray base, ultra high-gloss wet mirror finish, clean modern double garage with a sports car parked on it, bright LED ceiling lighting reflecting on the glossy floor, organized workshop wall`,
    `wide low three-quarter angle of a premium flake epoxy garage floor — blue/gray/white chips over slate-gray base, lustrous glossy finish reflecting overhead lights, immaculate empty garage, dramatic showroom lighting making the floor shine`,
    `luxury home garage, multi-color flake epoxy floor (gris-bleu flecks) with a deep glossy clear topcoat, reflections of a clean car and tidy storage cabinets, evening warm ambient lighting, aspirational man-cave vibe`,
  ],
  metallique: [
    `luxurious modern open living space with a STUNNING metallic epoxy floor — glossy black with warm gold and copper swirled marble-like metallic pigment, deep three-dimensional pearlescent lava-like swirls, ultra high-gloss wet mirror finish reflecting elegant lighting and large windows, soft golden-hour daylight`,
    `upscale basement home theater with a black-and-gold metallic epoxy floor, molten-gold swirls, mirror reflections of warm LED lighting and a leather sectional, sophisticated dramatic mood`,
    `wide architectural shot of a black/gold metallic epoxy floor as the hero, deep reflective swirls catching window light, minimalist high-end staging, magazine-quality real-estate photography`,
  ],
  quartz: [
    `commercial Quebec kitchen with a quartz epoxy floor — cream-beige base with sparkling colored quartz flecks, satin durable finish, stainless steel surfaces, bright even lighting`,
  ],
  couleur_unie: [
    `modern Quebec basement with a solid charcoal epoxy floor, glass-smooth glossy mirror finish reflecting minimalist furniture and warm lighting`,
  ],
  antiderapant: [
    `Quebec balcony / patio with an anti-slip textured epoxy floor, light beige grippy surface, natural daylight, outdoor patio furniture, clean railing`,
  ],
  commercial: [
    `large Quebec warehouse with a light-gray commercial epoxy floor, mirror-glossy, crisp painted line markings, industrial racks, bright overhead lighting`,
  ],
  meulage: [
    `Quebec retail showroom with polished diamond-ground concrete floor, exposed aggregate, high-gloss reflective finish, modern lighting`,
  ],
  vinyl_click: [
    `Quebec basement family room with luxury vinyl click oak wood-look planks, warm tones, cozy fireplace, soft lamp lighting`,
  ],
};

function pickScene(service: string, variantSeed: number): string {
  const scenes = SERVICE_SCENES[service] ?? [
    `premium ${service} epoxy floor in a clean modern Quebec interior, ultra high-gloss finish, professional architectural photography`,
  ];
  return scenes[Math.abs(variantSeed) % scenes.length];
}

/** Prompt photoréaliste pour la photo de base (PLATE PROPRE — aucun texte,
 *  l'overlay or est composé après par sharp). */
export function buildPhotoPrompt(service: string, variantSeed = 0): string {
  const scene = pickScene(service, variantSeed);
  return `Ultra-photorealistic, high-end advertising photograph for a premium epoxy flooring company. ${scene}.

Magazine-quality, sharp focus, professional color grading, aspirational trustworthy mood — makes the viewer want this floor. Wide-angle architectural real-estate photography. The glossy reflective floor is the HERO of the shot.

CRITICAL: No text, no watermarks, no logos, no badges, no captions anywhere — a completely CLEAN photographic plate. Portrait 4:5 vertical framing for a Facebook feed ad. Realistic, not CGI-looking.`;
}

// ── Étape 1 : génération de la photo de base via OpenRouter ───────────────────
const IMAGE_MODELS = [
  process.env.OR_MODEL_IMAGE ?? 'openai/gpt-5.4-image-2',
  'openai/gpt-5-image',
  'google/gemini-3-pro-image-preview',
];

async function callImageModel(model: string, prompt: string): Promise<string | null> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return null;
  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
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
      console.error(`[ad-creative] ${model} HTTP ${res.status}:`, (await res.text().catch(() => '')).slice(0, 200));
      return null;
    }
    const data = await res.json();
    const images = data.choices?.[0]?.message?.images;
    if (!Array.isArray(images) || !images[0]) return null;
    const first = images[0];
    const url = typeof first === 'string' ? first : (first.image_url?.url ?? first.url ?? null);
    return url ?? null;
  } catch (err) {
    console.error(`[ad-creative] ${model} error:`, err);
    return null;
  }
}

/** Génère la photo de base (PNG buffer) via le 1er modèle image qui réussit.
 *  Retourne le buffer + le modèle gagnant, ou null si tous échouent. */
async function generateBasePhoto(prompt: string): Promise<{ buffer: Buffer; model: string } | null> {
  for (const model of IMAGE_MODELS) {
    const imageUrl = await callImageModel(model, prompt);
    if (!imageUrl) continue;

    // data URL base64
    if (imageUrl.startsWith('data:image')) {
      const match = imageUrl.match(/^data:image\/[a-z+]+;base64,(.+)$/);
      if (!match) continue;
      return { buffer: Buffer.from(match[1], 'base64'), model };
    }
    // URL http(s) → fetch
    try {
      const fetched = await fetch(imageUrl);
      if (!fetched.ok) continue;
      return { buffer: Buffer.from(await fetched.arrayBuffer()), model };
    } catch {
      continue;
    }
  }
  return null;
}

// ── Étape 2 : composition de l'overlay OR via sharp ───────────────────────────

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/** Compose l'overlay OR (titre, badge rabais, 3 puces, bande logo+numéro) sur
 *  une photo de base. Réutilise public/logo.jpg. Retourne un PNG buffer. */
export async function composeGoldOverlay(baseImage: Buffer, opts: { promoText?: string } = {}): Promise<Buffer> {
  const base = sharp(baseImage);
  const meta = await base.metadata();
  const W = meta.width ?? 1024;
  const H = meta.height ?? 1280;

  const bandH = Math.round(H * 0.165);
  const fs = Math.round(bandH * 0.24);

  // Badge or (haut-droite)
  const bw = Math.round(W * 0.33);
  const bx = W - bw - Math.round(W * 0.025);
  const by = Math.round(H * 0.022);
  const bh = Math.round(H * 0.125);
  const bcx = bx + bw / 2;

  const hasPromo = !!(opts.promoText && opts.promoText.trim());
  const badgeBig = hasPromo ? escapeXml(opts.promoText!.trim()) : 'GRATUIT';
  const badgeSub = hasPromo ? 'SOUMISSION GRATUITE' : 'SOUMISSION GRATUITE';

  // 3 puces (value props) — règle pub: dont "15 ans d'expérience"
  const chips = ['Garantie ecrite', 'Installe en 2 jours', '15 ans d experience'];
  const chipY = H - bandH - Math.round(H * 0.045);
  const chipH = Math.round(H * 0.034);
  const chipW = Math.round((W - 80) / 3) - 12;
  let chipsSvg = '';
  chips.forEach((c, i) => {
    const cx = 40 + i * (chipW + 18);
    chipsSvg +=
      `<rect x="${cx}" y="${chipY}" width="${chipW}" height="${chipH}" rx="${Math.round(chipH / 2)}" fill="rgb(10,14,22)" fill-opacity="0.82" stroke="#E9C766" stroke-width="1.5"/>` +
      `<circle cx="${cx + 26}" cy="${chipY + chipH / 2}" r="7" fill="#E9C766"/>` +
      `<text x="${cx + 44}" y="${chipY + chipH / 2 + 7}" font-family="Arial, Helvetica, sans-serif" font-size="${Math.round(chipH * 0.46)}" font-weight="bold" fill="#ffffff">${c}</text>`;
  });

  const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="gold" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#f8e79a"/><stop offset="0.45" stop-color="#e6c25a"/><stop offset="1" stop-color="#bd9320"/>
    </linearGradient>
    <linearGradient id="scrim" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#05070c" stop-opacity="0.82"/><stop offset="1" stop-color="#05070c" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="${W}" height="${Math.round(H * 0.30)}" fill="url(#scrim)"/>
  <text x="40" y="${Math.round(H * 0.061)}" font-family="Arial Black, Arial, sans-serif" font-size="${Math.round(H * 0.041)}" font-weight="900" fill="#E9C766" letter-spacing="3">NOVUS EPOXY</text>
  <text x="40" y="${Math.round(H * 0.105)}" font-family="Arial Black, Arial, sans-serif" font-size="${Math.round(H * 0.0375)}" font-weight="900" fill="#ffffff" letter-spacing="1">HAUT DE GAMME</text>
  <text x="42" y="${Math.round(H * 0.139)}" font-family="Arial, Helvetica, sans-serif" font-size="${Math.round(H * 0.0188)}" font-weight="bold" fill="#dfe6f0">Planchers epoxy &#183; Garage &#183; Sous-sol &#183; Commercial</text>
  <rect x="${bx}" y="${by}" width="${bw}" height="${bh}" rx="22" fill="url(#gold)" stroke="#6e520f" stroke-width="3"/>
  <text x="${bcx}" y="${by + Math.round(bh * 0.27)}" font-family="Arial, Helvetica, sans-serif" font-size="${Math.round(bh * 0.175)}" font-weight="bold" fill="#241903" letter-spacing="1" text-anchor="middle">${hasPromo ? 'OFFRE SPECIALE' : 'NOVUS EPOXY'}</text>
  <text x="${bcx}" y="${by + Math.round(bh * 0.66)}" font-family="Arial Black, Arial, sans-serif" font-size="${Math.round(bh * 0.40)}" font-weight="900" fill="#1c1402" text-anchor="middle">${badgeBig}</text>
  <text x="${bcx}" y="${by + Math.round(bh * 0.90)}" font-family="Arial, Helvetica, sans-serif" font-size="${Math.round(bh * 0.145)}" font-weight="bold" fill="#241903" text-anchor="middle">${badgeSub}</text>
  ${chipsSvg}
  <rect x="0" y="${H - bandH}" width="${W}" height="${bandH}" fill="rgb(10,14,22)" fill-opacity="0.95"/>
  <rect x="0" y="${H - bandH}" width="${W}" height="4" fill="#E9C766"/>
  <text x="${W - 30}" y="${Math.round(H - bandH * 0.52)}" font-family="Arial, Helvetica, sans-serif" font-size="${Math.round(fs * 0.72)}" font-weight="bold" fill="#ffffff" text-anchor="end">RESERVE TA SOUMISSION GRATUITE</text>
  <text x="${W - 30}" y="${Math.round(H - bandH * 0.52 + fs * 1.05)}" font-family="Arial Black, Arial, sans-serif" font-size="${fs}" font-weight="900" fill="#E9C766" text-anchor="end">${PHONE}</text>
  <text x="${W - 30}" y="${H - 22}" font-family="Arial, Helvetica, sans-serif" font-size="${Math.round(fs * 0.52)}" fill="#aeb6c2" text-anchor="end">novusepoxy.ca</text>
</svg>`;

  // Logo dans la bande du bas (gauche). public/logo.jpg vit à la racine du dashboard.
  const logoH = Math.round(bandH * 0.74);
  let logoBuffer: Buffer | null = null;
  try {
    const logoPath = path.join(process.cwd(), 'public', 'logo.jpg');
    const raw = await readFile(logoPath);
    logoBuffer = await sharp(raw).resize({ height: logoH }).toBuffer();
  } catch (err) {
    console.error('[ad-creative] logo introuvable, overlay sans logo:', err);
  }

  const composites: sharp.OverlayOptions[] = [{ input: Buffer.from(svg), top: 0, left: 0 }];
  if (logoBuffer) {
    composites.push({
      input: logoBuffer,
      top: Math.round(H - bandH + (bandH - logoH) / 2),
      left: 26,
    });
  }

  return base.composite(composites).png().toBuffer();
}

// ── Étape 3 : upload Vercel Blob ──────────────────────────────────────────────
async function uploadToBlob(buffer: Buffer, prefix: string): Promise<string> {
  const key = `ads/${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`;
  const blob = await put(key, buffer, {
    access: 'public',
    addRandomSuffix: false,
    contentType: 'image/png',
  });
  return blob.url;
}

// ── API publique ──────────────────────────────────────────────────────────────

/**
 * Génère UN créatif publicitaire complet (photo + overlay or) et l'upload sur
 * Vercel Blob. NE LANCE RIEN sur Meta.
 *
 * @returns AdCreative avec l'URL finale, ou throw si la génération photo échoue.
 */
export async function generateAdCreative(input: GenerateAdCreativeInput): Promise<AdCreative> {
  const service = String(input.service);
  const variantSeed = input.variantSeed ?? 0;
  const promoText = (input.promoText ?? '').trim();

  const prompt = buildPhotoPrompt(service, variantSeed);

  const photo = await generateBasePhoto(prompt);
  if (!photo) {
    throw new Error(`generateAdCreative: aucun modèle image n'a produit de photo pour "${service}" (vérifie OPENROUTER_API_KEY + crédits image)`);
  }

  // Upload la plate de base (debug/réutilisation), best-effort.
  let baseUrl = '';
  try {
    baseUrl = await uploadToBlob(photo.buffer, `${service}-base`);
  } catch (err) {
    console.error('[ad-creative] upload base échoué (non bloquant):', err);
  }

  const composited = await composeGoldOverlay(photo.buffer, { promoText });
  const url = await uploadToBlob(composited, `${service}-creative`);

  return {
    url,
    baseUrl: baseUrl || url,
    prompt,
    model: photo.model,
    service,
    promoText,
  };
}

/**
 * Génère N variantes du même service (angles / accroches différents) pour A/B test.
 * Chaque variante utilise un variantSeed distinct → scène/prompt différents.
 *
 * @returns liste de AdCreative réussies (les échecs individuels sont ignorés,
 *          jamais throw tant qu'au moins 1 réussit). Throw seulement si 0 réussite.
 */
export async function generateVariants(input: { service: CreativeService | string; count?: number; promoText?: string }): Promise<AdCreative[]> {
  const count = Math.max(1, Math.min(input.count ?? 3, 6)); // garde-fou: 1..6
  const results = await Promise.allSettled(
    Array.from({ length: count }, (_, i) =>
      generateAdCreative({ service: input.service, promoText: input.promoText, variantSeed: i })
    )
  );

  const creatives = results
    .filter((r): r is PromiseFulfilledResult<AdCreative> => r.status === 'fulfilled')
    .map((r) => r.value);

  if (creatives.length === 0) {
    const firstErr = results.find((r) => r.status === 'rejected') as PromiseRejectedResult | undefined;
    throw new Error(`generateVariants: 0/${count} variantes générées pour "${input.service}" — ${firstErr?.reason ?? 'cause inconnue'}`);
  }

  return creatives;
}

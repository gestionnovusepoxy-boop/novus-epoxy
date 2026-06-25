/**
 * lib/meta-pixel.ts — Pixel Meta (côté navigateur) + dédup avec la CAPI.
 *
 * Le Pixel se charge dans le navigateur (fbq) et envoie PageView/Lead. La CAPI
 * (lib/meta-capi.ts) envoie les MÊMES events côté serveur. Pour que Meta ne compte
 * pas deux fois le même event, les deux partagent un `event_id` (déduplication
 * pixel ↔ serveur). On génère cet id ici et on le passe à fbq(..., {eventID}).
 *
 * NO-OP propre si NEXT_PUBLIC_META_PIXEL_ID est absent → le snippet retourne ''
 * et le composant ne rend rien. Feature OFF par défaut tant que le pixel n'est
 * pas configuré. On ne charge JAMAIS de script tiers sans pixel id valide.
 *
 * Note env: le pixel id doit être exposé au navigateur, donc on lit d'abord
 * NEXT_PUBLIC_META_PIXEL_ID (inline-able par Next), avec fallback serveur sur
 * META_PIXEL_ID (utilisé aussi par la CAPI) pour ne configurer qu'une variable.
 */

/** Récupère le pixel id exposé au navigateur (ou côté serveur en fallback). */
export function getMetaPixelId(): string {
  const pub = (process.env.NEXT_PUBLIC_META_PIXEL_ID ?? '').trim();
  if (pub) return pub;
  return (process.env.META_PIXEL_ID ?? '').trim();
}

/**
 * Génère un event_id de déduplication (même format à passer à la CAPI via eventId).
 * Ex: `pageview_1719350400000_a1b2c3`. Stable assez pour la fenêtre de dédup Meta.
 */
export function makeEventId(prefix = 'evt'): string {
  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${ts}_${rand}`;
}

/**
 * Construit le snippet JS du Pixel Meta (à injecter dans une balise <script>).
 * Charge fbq, init le pixel, et envoie un PageView avec un eventID pour la dédup.
 * Retourne '' si aucun pixel id n'est configuré (rien à injecter).
 *
 * @param pixelId  Pixel id (défaut: getMetaPixelId()).
 * @param eventId  event_id de dédup pour le PageView (défaut: généré).
 */
export function buildMetaPixelSnippet(pixelId?: string, eventId?: string): string {
  const id = (pixelId ?? getMetaPixelId()).trim();
  if (!id) return '';

  // Validation stricte: un pixel id Meta est numérique (15-17 chiffres typiques).
  // On refuse tout id non numérique pour ne jamais injecter de valeur douteuse.
  if (!/^[0-9]{8,20}$/.test(id)) return '';

  const evId = (eventId ?? makeEventId('pageview')).replace(/[^a-zA-Z0-9_]/g, '');

  return [
    '!function(f,b,e,v,n,t,s)',
    '{if(f.fbq)return;n=f.fbq=function(){n.callMethod?',
    'n.callMethod.apply(n,arguments):n.queue.push(arguments)};',
    "if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';",
    "n.queue=[];t=b.createElement(e);t.async=!0;",
    "t.src=v;s=b.getElementsByTagName(e)[0];",
    "s.parentNode.insertBefore(t,s)}(window,document,'script',",
    "'https://connect.facebook.net/en_US/fbevents.js');",
    `fbq('init','${id}');`,
    `fbq('track','PageView',{},{eventID:'${evId}'});`,
  ].join('');
}

/** <noscript> de repli (image pixel) pour le tracking sans JS. '' si pas d'id. */
export function buildMetaPixelNoscript(pixelId?: string): string {
  const id = (pixelId ?? getMetaPixelId()).trim();
  if (!id || !/^[0-9]{8,20}$/.test(id)) return '';
  return `<img height="1" width="1" style="display:none" alt="" src="https://www.facebook.com/tr?id=${id}&ev=PageView&noscript=1"/>`;
}

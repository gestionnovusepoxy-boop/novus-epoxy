/**
 * components/meta-pixel.tsx — Injecte le Pixel Meta dans le layout.
 *
 * Server component: lit le pixel id côté serveur (env) et rend le snippet fbq
 * + un <noscript> de repli. Rend `null` si aucun pixel id n'est configuré
 * (NEXT_PUBLIC_META_PIXEL_ID / META_PIXEL_ID absent) → feature OFF par défaut,
 * aucun script tiers chargé. Le snippet inclut un eventID pour la dédup avec
 * la Conversions API (lib/meta-capi.ts).
 */

import { buildMetaPixelSnippet, buildMetaPixelNoscript } from '@/lib/meta-pixel';

export default function MetaPixel() {
  const snippet = buildMetaPixelSnippet();
  if (!snippet) return null;

  const noscript = buildMetaPixelNoscript();

  return (
    <>
      <script
        id="meta-pixel"
        dangerouslySetInnerHTML={{ __html: snippet }}
      />
      {noscript ? (
        <noscript dangerouslySetInnerHTML={{ __html: noscript }} />
      ) : null}
    </>
  );
}

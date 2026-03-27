import { NextResponse } from 'next/server';
import { query as db } from '@/lib/db';

// Public endpoint — serves featured portfolio videos for site gallery
// Only returns featured videos (quality 9-10/10) for the public site
export async function GET() {
  const rows = await db(
    `SELECT id, titre, type_service, couleur, videos
     FROM portfolio
     WHERE array_length(videos, 1) > 0 AND featured = true
     ORDER BY created_at DESC`,
  );

  const videos = rows.map(r => ({
    id: r.id,
    titre: r.titre,
    type: r.type_service,
    couleur: r.couleur,
    url: (r.videos as string[])[0],
  }));

  return NextResponse.json(videos, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
    },
  });
}

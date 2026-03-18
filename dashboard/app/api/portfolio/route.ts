import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query as db } from '@/lib/db';

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const rows = await db('SELECT * FROM portfolio ORDER BY created_at DESC');
  return NextResponse.json({ data: rows });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const body = await req.json();
  const { titre, description, type_service, superficie, couleur, ville, photos, featured } = body;

  if (!titre) {
    return NextResponse.json({ error: 'Titre requis' }, { status: 400 });
  }

  const validTypes = ['flake', 'metallique', 'commercial'];
  const typeVal = validTypes.includes(type_service) ? type_service : 'flake';

  const photosArr = Array.isArray(photos) ? photos.filter((u: string) => typeof u === 'string' && u.trim()) : [];

  const rows = await db(
    `INSERT INTO portfolio (titre, description, type_service, superficie, couleur, ville, photos, featured)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      titre.slice(0, 200),
      description ?? null,
      typeVal,
      superficie ? parseInt(superficie, 10) : null,
      couleur ?? null,
      ville ?? null,
      photosArr,
      featured === true,
    ],
  );

  return NextResponse.json(rows[0], { status: 201 });
}

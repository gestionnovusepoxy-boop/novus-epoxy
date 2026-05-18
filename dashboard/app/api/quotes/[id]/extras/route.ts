import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { auth } from '@/lib/auth';

// PUT /api/quotes/[id]/extras — replace all extras for a quote
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const { id } = await params;
  const quoteId = parseInt(id);
  if (isNaN(quoteId)) return NextResponse.json({ error: 'ID invalide' }, { status: 400 });

  const extras = await req.json().catch(() => []);
  if (!Array.isArray(extras)) return NextResponse.json({ error: 'Format invalide' }, { status: 400 });

  // Delete existing extras
  await query(`DELETE FROM quote_extras WHERE quote_id = $1`, [quoteId]);

  // Insert new extras
  for (const ex of extras) {
    if (!ex.description?.trim()) continue;
    await query(
      `INSERT INTO quote_extras (quote_id, description, quantite, prix_unitaire, sous_total, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [quoteId, String(ex.description).slice(0, 255), Number(ex.quantite) || 1, Number(ex.prix_unitaire) || 0, Number(ex.sous_total) || 0, Number(ex.sort_order) || 0]
    );
  }

  return NextResponse.json({ ok: true });
}

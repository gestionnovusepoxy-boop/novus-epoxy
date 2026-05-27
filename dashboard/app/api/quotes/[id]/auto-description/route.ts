import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query } from '@/lib/db';
import { generateAutoDescription } from '@/lib/auto-description';

/**
 * POST /api/quotes/[id]/auto-description
 * Body optionnel: { save: true } — sinon retourne juste le preview.
 * Génère une description des travaux personnalisée à partir du service + extras.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const { id } = await params;
  const quoteId = parseInt(id);
  if (isNaN(quoteId)) return NextResponse.json({ error: 'ID invalide' }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const save = !!body.save;

  const rows = await query(
    `SELECT type_service, superficie, couleur_flake, etat_plancher FROM quotes WHERE id = $1`,
    [quoteId]
  );
  if (!rows[0]) return NextResponse.json({ error: 'Devis introuvable' }, { status: 404 });
  const q = rows[0];

  const extras = await query(
    `SELECT description, sous_total FROM quote_extras WHERE quote_id = $1 ORDER BY sort_order, id`,
    [quoteId]
  ).catch(() => []);

  const description = generateAutoDescription({
    type_service: q.type_service as string,
    superficie: q.superficie ? Number(q.superficie) : null,
    couleur_flake: q.couleur_flake as string | null,
    etat_plancher: q.etat_plancher as string | null,
    extras: extras.map(e => ({
      description: String(e.description ?? ''),
      sous_total: Number(e.sous_total ?? 0),
    })),
  });

  if (save) {
    await query(`UPDATE quotes SET description_travaux = $1 WHERE id = $2`, [description, quoteId]);
  }

  return NextResponse.json({ ok: true, description, saved: save });
}

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query } from '@/lib/db';

/**
 * Ventes manuelles — ventes conclues HORS du systeme de devis.
 * Luca: "beaucoup de ventes ne sont pas dans le systeme". On les logge ici pour
 * que le cerveau pub (lib/ad-brain.ts) apprenne sur des donnees COMPLETES.
 *
 * Admin-gated: session NextAuth OU header x-api-key=ADMIN_API_KEY (pour le bot/cron).
 *
 * POST { client_nom?, service, montant, source?, date_vente?, notes? } → ajoute une vente
 * GET  ?limit=50 → liste les ventes manuelles recentes + total
 */

const VALID_SERVICES = [
  'flake', 'metallique', 'couleur_unie', 'quartz',
  'antiderapant', 'commercial', 'meulage', 'vinyl_click',
];

async function isAuthorized(req: NextRequest): Promise<boolean> {
  const apiKey = req.headers.get('x-api-key');
  if (apiKey && apiKey === process.env.ADMIN_API_KEY) return true;
  const session = await auth();
  return !!session;
}

export async function POST(req: NextRequest) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const service = String(body.service ?? '').trim().toLowerCase();
  const montant = Number(body.montant);

  if (!VALID_SERVICES.includes(service)) {
    return NextResponse.json(
      { error: `service requis (${VALID_SERVICES.join('|')})` },
      { status: 400 },
    );
  }
  if (!Number.isFinite(montant) || montant <= 0) {
    return NextResponse.json({ error: 'montant invalide (doit être > 0)' }, { status: 400 });
  }

  const clientNom = body.client_nom ? String(body.client_nom).slice(0, 160) : null;
  const source = body.source ? String(body.source).slice(0, 60) : 'manuel';
  const notes = body.notes ? String(body.notes).slice(0, 2000) : null;
  // Accepte YYYY-MM-DD, sinon defaut DB (CURRENT_DATE).
  const dateVente = typeof body.date_vente === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.date_vente)
    ? body.date_vente
    : null;

  const rows = await query(
    `INSERT INTO manual_sales (client_nom, service, montant, source, date_vente, notes)
     VALUES ($1, $2, $3, $4, COALESCE($5::date, CURRENT_DATE), $6)
     RETURNING id, client_nom, service, montant, source, date_vente, created_at`,
    [clientNom, service, montant, source, dateVente, notes],
  );

  return NextResponse.json({ ok: true, vente: rows[0] }, { status: 201 });
}

export async function GET(req: NextRequest) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  }

  const limit = Math.min(Number(req.nextUrl.searchParams.get('limit')) || 50, 200);
  const rows = await query(
    `SELECT id, client_nom, service, montant, source, date_vente, notes, created_at
     FROM manual_sales ORDER BY date_vente DESC, id DESC LIMIT $1`,
    [limit],
  );
  const totalRow = await query(
    `SELECT COALESCE(SUM(montant), 0)::numeric AS total, COUNT(*)::int AS n FROM manual_sales`,
  );

  return NextResponse.json({
    ventes: rows,
    total: Number(totalRow[0]?.total ?? 0),
    count: Number(totalRow[0]?.n ?? 0),
  });
}

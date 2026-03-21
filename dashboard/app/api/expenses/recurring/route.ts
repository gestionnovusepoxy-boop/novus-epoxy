import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query } from '@/lib/db';

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Non autorise' }, { status: 401 });

  const rows = await query('SELECT * FROM recurring_expenses ORDER BY fournisseur');
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Non autorise' }, { status: 401 });

  const body = await req.json();
  const { fournisseur, description, categorie, montant_ht, tps, tvq, methode, frequence, jour_du_mois } = body;

  if (!fournisseur || !categorie || !montant_ht) {
    return NextResponse.json({ error: 'Champs requis manquants' }, { status: 400 });
  }

  const ht = parseFloat(montant_ht);
  const tpsVal = parseFloat(tps ?? '0');
  const tvqVal = parseFloat(tvq ?? '0');
  const ttc = Math.round((ht + tpsVal + tvqVal) * 100) / 100;

  const rows = await query(
    `INSERT INTO recurring_expenses (fournisseur, description, categorie, montant_ht, tps, tvq, montant_ttc, methode, frequence, jour_du_mois)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [fournisseur.slice(0, 120), description || null, categorie, ht, tpsVal, tvqVal, ttc, methode || null, frequence || 'mensuel', jour_du_mois || 1]
  );

  return NextResponse.json(rows[0], { status: 201 });
}

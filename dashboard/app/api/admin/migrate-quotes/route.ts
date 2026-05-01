import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query } from '@/lib/db';

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const results: string[] = [];

  try {
    await query(`ALTER TABLE quotes ADD COLUMN IF NOT EXISTS description_travaux TEXT`);
    results.push('description_travaux: OK');
  } catch (e) {
    results.push(`description_travaux: ERREUR — ${e}`);
  }

  try {
    await query(`ALTER TABLE quotes ADD COLUMN IF NOT EXISTS couleur_flake TEXT`);
    results.push('couleur_flake: OK');
  } catch (e) {
    results.push(`couleur_flake: ERREUR — ${e}`);
  }

  return NextResponse.json({ ok: true, results });
}

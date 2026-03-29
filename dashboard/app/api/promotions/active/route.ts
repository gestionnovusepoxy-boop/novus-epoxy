import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

// Public endpoint — no auth required
// Returns currently active promotions
export async function GET() {
  const rows = await query(
    `SELECT id, nom, description, rabais_pct, date_debut, date_fin, services
     FROM promotions
     WHERE actif = true AND date_debut <= CURRENT_DATE AND date_fin >= CURRENT_DATE
     ORDER BY rabais_pct DESC`
  );

  return NextResponse.json(rows);
}

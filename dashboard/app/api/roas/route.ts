import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getRoasReport } from '@/lib/roas';

// Tableau ROAS / Rendement par source de lead — lecture seule.
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const periode = req.nextUrl.searchParams.get('periode') ?? 'all';
  const sinceDays =
    periode === '30d' ? 30 :
    periode === '90d' ? 90 :
    periode === '365d' ? 365 :
    undefined; // 'all' → tout l'historique

  try {
    const report = await getRoasReport(sinceDays);
    return NextResponse.json(report);
  } catch (err) {
    console.error('[roas] erreur:', err);
    return NextResponse.json({ error: 'Erreur lors du calcul du ROAS' }, { status: 500 });
  }
}

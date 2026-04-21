import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query as db } from '@/lib/db';

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization') ?? '';
  const token = authHeader.replace('Bearer ', '');
  const adminKey = process.env.ADMIN_API_KEY ?? '';

  if (!token || token !== adminKey) {
    const session = await auth();
    if (!session) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
    }
  }

  const [leadsRow, contactesRow, devisRow, signesRow, completesRow] = await Promise.all([
    db(
      `SELECT COUNT(*)::int AS count FROM crm_leads WHERE statut NOT IN ('ferme','perdu')`,
      []
    ),
    db(
      `SELECT COUNT(*)::int AS count FROM crm_leads WHERE statut IN ('contacte','interesse')`,
      []
    ),
    db(
      `SELECT COUNT(*)::int AS count FROM quotes WHERE statut != 'brouillon'`,
      []
    ),
    db(
      `SELECT COUNT(*)::int AS count FROM quotes WHERE statut IN ('contrat_signe','depot_paye','planifie','complete')`,
      []
    ),
    db(
      `SELECT COUNT(*)::int AS count FROM quotes WHERE statut = 'complete'`,
      []
    ),
  ]);

  const leads = (leadsRow[0] as { count: number }).count;
  const contactes = (contactesRow[0] as { count: number }).count;
  const devis = (devisRow[0] as { count: number }).count;
  const signes = (signesRow[0] as { count: number }).count;
  const completes = (completesRow[0] as { count: number }).count;

  function pct(num: number, den: number): number {
    if (den === 0) return 0;
    return Math.round((num / den) * 1000) / 10;
  }

  return NextResponse.json({
    leads,
    contactes,
    devis,
    signes,
    completes,
    taux_contact: pct(contactes, leads),
    taux_devis: pct(devis, contactes),
    taux_signature: pct(signes, devis),
    taux_completion: pct(completes, signes),
  });
}

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query } from '@/lib/db';

function escapeCsv(val: string | number | null | undefined): string {
  if (val == null) return '';
  const s = String(val);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const year = parseInt(searchParams.get('year') ?? String(new Date().getFullYear()));

  const rows = await query(
    `SELECT inv.*, c.nom AS client_nom, c.email AS client_email, c.telephone AS client_tel
     FROM invoices inv JOIN clients c ON c.id = inv.client_id
     WHERE inv.date_emission BETWEEN $1 AND $2
     ORDER BY inv.numero ASC`,
    [`${year}-01-01`, `${year}-12-31`],
  );

  const headers = [
    'Numero', 'Date emission', 'Client', 'Email', 'Telephone',
    'Service', 'Superficie (pi2)', 'Prix/pi2', 'Sous-total', 'TPS', 'TVQ', 'Total',
    'Depot montant', 'Depot paye', 'Depot date', 'Depot methode',
    'Solde montant', 'Solde paye', 'Solde date', 'Solde methode',
    'Statut',
  ];

  let csv = headers.join(',') + '\n';

  for (const r of rows) {
    csv += [
      escapeCsv(r.numero as string),
      escapeCsv(r.date_emission as string),
      escapeCsv(r.client_nom as string),
      escapeCsv(r.client_email as string),
      escapeCsv(r.client_tel as string),
      escapeCsv(r.type_service as string),
      escapeCsv(r.superficie as number),
      escapeCsv(r.prix_pied_carre as number),
      escapeCsv(r.sous_total as number),
      escapeCsv(r.tps as number),
      escapeCsv(r.tvq as number),
      escapeCsv(r.total as number),
      escapeCsv(r.depot_montant as number),
      escapeCsv(r.depot_paye ? 'Oui' : 'Non'),
      escapeCsv(r.depot_paye_at as string),
      escapeCsv(r.depot_methode as string),
      escapeCsv(r.final_montant as number),
      escapeCsv(r.final_paye ? 'Oui' : 'Non'),
      escapeCsv(r.final_paye_at as string),
      escapeCsv(r.final_methode as string),
      escapeCsv(r.statut as string),
    ].join(',') + '\n';
  }

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename=novus-epoxy-factures-${year}.csv`,
    },
  });
}

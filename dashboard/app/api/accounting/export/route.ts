import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query } from '@/lib/db';

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Non autorise' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const year = parseInt(searchParams.get('year') ?? String(new Date().getFullYear()));
  const start = `${year}-01-01`;
  const end = `${year}-12-31`;

  // Fetch expenses
  const expenses = await query(
    `SELECT date_depense, fournisseur, description, categorie, montant_ht, tps, tvq, montant_ttc, methode, reference, reconciled
     FROM expenses WHERE date_depense BETWEEN $1 AND $2 ORDER BY date_depense`,
    [start, end]
  );

  // Fetch invoices (revenue) — join clients for name
  const invoices = await query(
    `SELECT i.date_emission, COALESCE(c.nom, 'Client #' || i.client_id) AS client_nom, i.type_service, i.sous_total, i.tps, i.tvq, i.total, i.statut
     FROM invoices i LEFT JOIN clients c ON i.client_id = c.id
     WHERE i.date_emission BETWEEN $1 AND $2 ORDER BY i.date_emission`,
    [start, end]
  );

  // Totals
  const totalRevenu = invoices.filter((i: Record<string, unknown>) => i.statut === 'completee').reduce((s: number, i: Record<string, unknown>) => s + Number(i.total ?? 0), 0);
  const tpsPercu = invoices.filter((i: Record<string, unknown>) => i.statut === 'completee').reduce((s: number, i: Record<string, unknown>) => s + Number(i.tps ?? 0), 0);
  const tvqPercu = invoices.filter((i: Record<string, unknown>) => i.statut === 'completee').reduce((s: number, i: Record<string, unknown>) => s + Number(i.tvq ?? 0), 0);
  const totalDepenses = expenses.reduce((s: number, e: Record<string, unknown>) => s + Number(e.montant_ttc ?? 0), 0);
  const tpsPaye = expenses.reduce((s: number, e: Record<string, unknown>) => s + Number(e.tps ?? 0), 0);
  const tvqPaye = expenses.reduce((s: number, e: Record<string, unknown>) => s + Number(e.tvq ?? 0), 0);

  const catLabel: Record<string, string> = {
    materiaux: 'Materiaux', sous_traitance: 'Sous-traitance', transport: 'Transport',
    equipement: 'Equipement', marketing: 'Marketing', loyer: 'Loyer',
    assurance: 'Assurance', admin: 'Administration', autre: 'Autre',
  };

  function csvEscape(val: unknown): string {
    const s = String(val ?? '');
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  }

  const lines: string[] = [];

  // Section: Depenses
  lines.push('=== DEPENSES ===');
  lines.push('Date,Fournisseur,Description,Categorie,Montant HT,TPS,TVQ,Montant TTC,Methode,Reference,Reconcilie');
  for (const e of expenses) {
    lines.push([
      String(e.date_depense ?? '').slice(0, 10),
      csvEscape(e.fournisseur),
      csvEscape(e.description),
      catLabel[String(e.categorie)] ?? e.categorie,
      Number(e.montant_ht ?? 0).toFixed(2),
      Number(e.tps ?? 0).toFixed(2),
      Number(e.tvq ?? 0).toFixed(2),
      Number(e.montant_ttc ?? 0).toFixed(2),
      e.methode ?? '',
      e.reference ?? '',
      e.reconciled ? 'Oui' : 'Non',
    ].join(','));
  }

  lines.push('');
  lines.push('=== REVENUS (FACTURES) ===');
  lines.push('Date,Client,Service,Sous-total,TPS,TVQ,Total,Statut');
  for (const i of invoices) {
    lines.push([
      String(i.date_emission ?? '').slice(0, 10),
      csvEscape(i.client_nom),
      i.type_service ?? '',
      Number(i.sous_total ?? 0).toFixed(2),
      Number(i.tps ?? 0).toFixed(2),
      Number(i.tvq ?? 0).toFixed(2),
      Number(i.total ?? 0).toFixed(2),
      i.statut ?? '',
    ].join(','));
  }

  lines.push('');
  lines.push('=== RESUME ===');
  lines.push(`Total revenus,${totalRevenu.toFixed(2)}`);
  lines.push(`Total depenses,${totalDepenses.toFixed(2)}`);
  lines.push(`Profit net,${(totalRevenu - totalDepenses).toFixed(2)}`);
  lines.push('');
  lines.push(`TPS percu,${tpsPercu.toFixed(2)}`);
  lines.push(`TPS paye (depenses),${tpsPaye.toFixed(2)}`);
  lines.push(`TPS a remettre,${(tpsPercu - tpsPaye).toFixed(2)}`);
  lines.push('');
  lines.push(`TVQ percu,${tvqPercu.toFixed(2)}`);
  lines.push(`TVQ paye (depenses),${tvqPaye.toFixed(2)}`);
  lines.push(`TVQ a remettre,${(tvqPercu - tvqPaye).toFixed(2)}`);

  const csv = '\uFEFF' + lines.join('\r\n');

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="comptabilite-${year}.csv"`,
    },
  });
}

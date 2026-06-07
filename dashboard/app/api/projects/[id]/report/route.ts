import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query } from '@/lib/db';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const { id } = await params;
  const quoteId = parseInt(id);

  // Quote info
  const quotes = await query('SELECT * FROM quotes WHERE id = $1', [quoteId]);
  if (quotes.length === 0) {
    return NextResponse.json({ error: 'Projet non trouvé' }, { status: 404 });
  }
  const quote = quotes[0];

  // Invoices
  const invoices = await query('SELECT * FROM invoices WHERE quote_id = $1', [quoteId]);

  // Payments linked to those invoices
  const invoiceIds = invoices.map((inv) => inv.id as number);
  let payments: Record<string, unknown>[] = [];
  if (invoiceIds.length > 0) {
    const placeholders = invoiceIds.map((_, i) => `$${i + 1}`).join(',');
    payments = await query(
      `SELECT * FROM payments WHERE invoice_id IN (${placeholders})`,
      invoiceIds,
    );
  }

  const totalRevenue = payments.reduce(
    (sum, p) => sum + parseFloat(String(p.montant ?? 0)),
    0,
  );

  // Expenses linked to project
  const expenses = await query('SELECT * FROM expenses WHERE quote_id = $1', [quoteId]);
  const totalExpenses = expenses.reduce(
    (sum, e) => sum + parseFloat(String(e.montant_ttc ?? e.montant_ht ?? 0)),
    0,
  );

  // Labor: time entries with employee info
  const labor = await query(
    `SELECT te.*, e.nom, e.taux_horaire
     FROM time_entries te
     JOIN employees e ON te.employee_id = e.id
     WHERE te.quote_id = $1
     ORDER BY te.date_travail`,
    [quoteId],
  );

  // Aggregate labor by employee
  const laborByEmployee: Record<number, { nom: string; heures: number; cout: number }> = {};
  let totalLaborHours = 0;
  let totalLaborCost  = 0;

  for (const entry of labor) {
    const empId = entry.employee_id as number;
    const heures = parseFloat(String(entry.heures ?? 0));
    const taux   = parseFloat(String(entry.taux_horaire ?? 0));
    const cout   = Math.round(heures * taux * 100) / 100;

    if (!laborByEmployee[empId]) {
      laborByEmployee[empId] = { nom: entry.nom as string, heures: 0, cout: 0 };
    }
    laborByEmployee[empId].heures += heures;
    laborByEmployee[empId].cout   += cout;
    totalLaborHours += heures;
    totalLaborCost  += cout;
  }

  // Round totals
  totalLaborCost = Math.round(totalLaborCost * 100) / 100;
  const totalExpensesRounded = Math.round(totalExpenses * 100) / 100;
  const profit = Math.round((totalRevenue - totalExpensesRounded - totalLaborCost) * 100) / 100;
  const margin = totalRevenue > 0
    ? Math.round((profit / totalRevenue) * 10000) / 100
    : 0;

  return NextResponse.json({
    quote: {
      id: quote.id,
      client_nom: quote.client_nom,
      service: quote.type_service,
      superficie: quote.superficie,
      total: quote.total,
      statut: quote.statut,
    },
    revenue: {
      invoices,
      payments,
      total: Math.round(totalRevenue * 100) / 100,
    },
    expenses: {
      items: expenses,
      total: totalExpensesRounded,
    },
    labor: {
      entries: labor,
      by_employee: Object.values(laborByEmployee),
      total_hours: Math.round(totalLaborHours * 100) / 100,
      total_cost: totalLaborCost,
    },
    profit,
    margin,
  });
}

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query } from '@/lib/db';

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const employeeId = searchParams.get('employee_id');
  const quoteId    = searchParams.get('quote_id');
  const dateFrom   = searchParams.get('date_from');
  const dateTo     = searchParams.get('date_to');

  let where = 'WHERE 1=1';
  const params: unknown[] = [];
  let i = 1;

  if (employeeId) {
    where += ` AND te.employee_id = $${i++}`;
    params.push(parseInt(employeeId));
  }
  if (quoteId) {
    where += ` AND te.quote_id = $${i++}`;
    params.push(parseInt(quoteId));
  }
  if (dateFrom) {
    where += ` AND te.date_travail >= $${i++}`;
    params.push(dateFrom);
  }
  if (dateTo) {
    where += ` AND te.date_travail <= $${i++}`;
    params.push(dateTo);
  }

  const rows = await query(
    `SELECT te.*,
            e.nom AS employee_nom,
            e.taux_horaire,
            q.client_nom AS projet_nom,
            COALESCE(te.heures, 0) * COALESCE(e.taux_horaire, 0) AS montant
     FROM time_entries te
     JOIN employees e ON te.employee_id = e.id
     LEFT JOIN quotes q ON te.quote_id = q.id
     ${where}
     ORDER BY te.date_travail DESC, te.heure_debut DESC NULLS LAST`,
    params,
  );

  // Build summary by employee
  const summaryMap: Record<number, { employee_id: number; employee_nom: string; taux_horaire: number; total_heures: number; total_montant: number }> = {};
  let grandTotalHeures = 0;
  let grandTotalMontant = 0;

  for (const row of rows) {
    const eid = row.employee_id as number;
    const heures = parseFloat(String(row.heures ?? 0));
    const montant = parseFloat(String(row.montant ?? 0));

    if (!summaryMap[eid]) {
      summaryMap[eid] = {
        employee_id: eid,
        employee_nom: row.employee_nom as string,
        taux_horaire: parseFloat(String(row.taux_horaire ?? 0)),
        total_heures: 0,
        total_montant: 0,
      };
    }
    summaryMap[eid].total_heures += heures;
    summaryMap[eid].total_montant += montant;
    grandTotalHeures += heures;
    grandTotalMontant += montant;
  }

  return NextResponse.json({
    data: rows,
    summary: Object.values(summaryMap),
    totals: {
      heures: Math.round(grandTotalHeures * 100) / 100,
      montant: Math.round(grandTotalMontant * 100) / 100,
    },
  });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const body = await req.json();
  const { employee_id, quote_id, date_travail, heure_debut, heure_fin, heures, type, notes } = body;

  if (!employee_id || !date_travail) {
    return NextResponse.json({ error: 'employee_id et date_travail requis' }, { status: 400 });
  }

  let calculatedHeures = heures ? parseFloat(heures) : null;
  if (heure_debut && heure_fin && !calculatedHeures) {
    const [sh, sm] = heure_debut.split(':').map(Number);
    const [eh, em] = heure_fin.split(':').map(Number);
    const startMin = sh * 60 + sm;
    const endMin   = eh * 60 + em;
    calculatedHeures = Math.round(((endMin - startMin) / 60) * 100) / 100;
    if (calculatedHeures <= 0) {
      return NextResponse.json({ error: 'heure_fin doit être après heure_debut' }, { status: 400 });
    }
  }

  const rows = await query(
    `INSERT INTO time_entries (employee_id, quote_id, date_travail, heure_debut, heure_fin, heures, type, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [
      parseInt(employee_id),
      quote_id ? parseInt(quote_id) : null,
      date_travail,
      heure_debut ?? null,
      heure_fin ?? null,
      calculatedHeures,
      type ?? 'travail',
      notes ?? null,
    ],
  );

  return NextResponse.json(rows[0], { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id requis' }, { status: 400 });

  const rows = await query('DELETE FROM time_entries WHERE id = $1 RETURNING id', [parseInt(id)]);
  if (rows.length === 0) {
    return NextResponse.json({ error: 'Entrée non trouvée' }, { status: 404 });
  }

  return NextResponse.json({ success: true, deleted: rows[0] });
}

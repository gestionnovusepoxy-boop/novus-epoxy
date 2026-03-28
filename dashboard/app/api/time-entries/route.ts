import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query } from '@/lib/db';

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const quoteId    = searchParams.get('quote_id');
  const employeeId = searchParams.get('employee_id');
  const from       = searchParams.get('from');
  const to         = searchParams.get('to');

  let where = 'WHERE 1=1';
  const params: unknown[] = [];
  let i = 1;

  if (quoteId) {
    where += ` AND te.quote_id = $${i++}`;
    params.push(parseInt(quoteId));
  }
  if (employeeId) {
    where += ` AND te.employee_id = $${i++}`;
    params.push(parseInt(employeeId));
  }
  if (from) {
    where += ` AND te.date_travail >= $${i++}`;
    params.push(from);
  }
  if (to) {
    where += ` AND te.date_travail <= $${i++}`;
    params.push(to);
  }

  const rows = await query(
    `SELECT te.*, e.nom AS employee_nom
     FROM time_entries te
     JOIN employees e ON te.employee_id = e.id
     ${where}
     ORDER BY te.date_travail DESC, te.heure_debut DESC`,
    params,
  );

  return NextResponse.json({ data: rows });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const body = await req.json();
  const { employee_id, quote_id, date_travail, heure_debut, heure_fin, heures, type, notes } = body;

  if (!employee_id || !date_travail) {
    return NextResponse.json({ error: 'employee_id et date_travail requis' }, { status: 400 });
  }

  // Auto-calculate hours from start/end times if both provided
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

  if (!id) {
    return NextResponse.json({ error: 'id requis' }, { status: 400 });
  }

  const rows = await query('DELETE FROM time_entries WHERE id = $1 RETURNING id', [parseInt(id)]);

  if (rows.length === 0) {
    return NextResponse.json({ error: 'Entrée non trouvée' }, { status: 404 });
  }

  return NextResponse.json({ success: true, deleted: rows[0] });
}

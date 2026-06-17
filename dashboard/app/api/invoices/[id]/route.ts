import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query } from '@/lib/db';
import { headers } from 'next/headers';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const { id } = await params;
  const rows = await query(
    `SELECT inv.*, c.nom AS client_nom, c.email AS client_email, c.telephone AS client_tel, c.adresse AS client_adresse,
            q.contrat_signe_at, q.contrat_signature_nom, q.contrat_signature_image, q.secret_token AS quote_token
     FROM invoices inv
     JOIN clients c ON c.id = inv.client_id
     LEFT JOIN quotes q ON q.id = inv.quote_id
     WHERE inv.id = $1`,
    [parseInt(id)],
  );
  if (!rows[0]) return NextResponse.json({ error: 'Facture introuvable' }, { status: 404 });

  // Verify ownership: user must own the invoice or be the admin
  const invoice = rows[0];
  const userEmail = session.user?.email?.toLowerCase().trim();
  const isOwner = (invoice.client_email as string | undefined)?.toLowerCase().trim() === userEmail;
  const isAdmin = userEmail === process.env.ADMIN_EMAIL?.toLowerCase().trim();
  if (!isOwner && !isAdmin) {
    return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
  }

  const payments = await query(
    'SELECT * FROM payments WHERE invoice_id = $1 ORDER BY paid_at DESC',
    [parseInt(id)],
  );

  return NextResponse.json({ ...rows[0], payments });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const { id } = await params;

  // Verify ownership before processing
  const existing = await query(
    'SELECT client_id FROM invoices WHERE id = $1',
    [parseInt(id)]
  );
  if (!existing[0]) return NextResponse.json({ error: 'Facture introuvable' }, { status: 404 });

  const client = await query('SELECT email FROM clients WHERE id = $1', [existing[0].client_id]);
  const userEmail = session.user?.email?.toLowerCase().trim();
  const isOwner = (client[0]?.email as string | undefined)?.toLowerCase().trim() === userEmail;
  const isAdmin = userEmail === process.env.ADMIN_EMAIL?.toLowerCase().trim();
  if (!isOwner && !isAdmin) {
    return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
  }

  const body = await req.json();
  const allowed = ['statut', 'notes', 'date_echeance'];

  const sets: string[] = [];
  const values: unknown[] = [];
  let i = 1;

  for (const key of allowed) {
    if (key in body) {
      sets.push(`${key} = $${i++}`);
      values.push(body[key]);
    }
  }

  if (sets.length === 0) return NextResponse.json({ error: 'Rien à mettre à jour' }, { status: 400 });

  values.push(parseInt(id));
  const rows = await query(
    `UPDATE invoices SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
    values,
  );

  if (!rows[0]) return NextResponse.json({ error: 'Facture introuvable' }, { status: 404 });

  // Auto-send invoice (email + SMS) when job is marked complete
  if (body.statut === 'completee') {
    const apiKey = process.env.ADMIN_API_KEY ?? '';
    const hdrs = await headers();
    const origin = hdrs.get('origin') ?? 'https://novus-epoxy.vercel.app';
    fetch(`${origin}/api/invoices/${id}/send`, {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }).catch(() => {});
  }

  return NextResponse.json(rows[0]);
}

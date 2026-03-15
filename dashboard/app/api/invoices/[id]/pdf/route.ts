import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query } from '@/lib/db';
import { generateInvoiceHtml } from '@/lib/invoice-pdf';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const { id } = await params;
  const rows = await query(
    `SELECT inv.*, c.nom AS client_nom, c.email AS client_email, c.telephone AS client_tel, c.adresse AS client_adresse
     FROM invoices inv JOIN clients c ON c.id = inv.client_id WHERE inv.id = $1`,
    [parseInt(id)],
  );

  if (!rows[0]) return NextResponse.json({ error: 'Facture introuvable' }, { status: 404 });

  const inv = rows[0];
  const html = generateInvoiceHtml(
    {
      numero: inv.numero as string,
      date_emission: inv.date_emission as string,
      date_echeance: inv.date_echeance as string | null,
      type_service: inv.type_service as string,
      superficie: Number(inv.superficie),
      prix_pied_carre: Number(inv.prix_pied_carre),
      sous_total: Number(inv.sous_total),
      tps: Number(inv.tps),
      tvq: Number(inv.tvq),
      total: Number(inv.total),
      depot_montant: Number(inv.depot_montant),
      depot_paye: inv.depot_paye as boolean,
      depot_paye_at: inv.depot_paye_at as string | null,
      final_montant: Number(inv.final_montant),
      final_paye: inv.final_paye as boolean,
      final_paye_at: inv.final_paye_at as string | null,
      notes: inv.notes as string | null,
      statut: inv.statut as string,
    },
    {
      nom: inv.client_nom as string,
      email: inv.client_email as string,
      telephone: inv.client_tel as string | null,
      adresse: inv.client_adresse as string | null,
    },
  );

  return new NextResponse(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query } from '@/lib/db';
import { generateInvoiceHtml } from '@/lib/invoice-pdf';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const { id } = await params;
  // Pull invoice + client + linked quote (work address, color) + booking (dates if scheduled)
  const rows = await query(
    `SELECT inv.*,
            c.nom AS client_nom, c.email AS client_email, c.telephone AS client_tel, c.adresse AS client_adresse,
            q.client_adresse AS work_address, q.couleur_flake AS couleur, q.description_travaux AS quote_description,
            b.jour1_date, b.jour1_slot, b.jour2_date, b.jour2_slot
       FROM invoices inv
       JOIN clients c ON c.id = inv.client_id
       LEFT JOIN quotes q ON q.id = inv.quote_id
       LEFT JOIN bookings b ON b.quote_id = inv.quote_id
      WHERE inv.id = $1`,
    [parseInt(id)],
  );

  if (!rows[0]) return NextResponse.json({ error: 'Facture introuvable' }, { status: 404 });

  const inv = rows[0];

  // Pull quote_items + quote_extras + ALL payments for full invoice display
  const [itemRows, extraRows, paymentRows] = await Promise.all([
    inv.quote_id ? query(
      `SELECT type_service, superficie, prix_pied_carre, sous_total, description FROM quote_items WHERE quote_id = $1 ORDER BY sort_order, id`,
      [inv.quote_id]
    ).catch(() => []) : Promise.resolve([]),
    inv.quote_id ? query(
      `SELECT description, quantite, prix_unitaire, sous_total FROM quote_extras WHERE quote_id = $1 ORDER BY sort_order, id`,
      [inv.quote_id]
    ).catch(() => []) : Promise.resolve([]),
    query(
      `SELECT type, montant, methode, paid_at, notes FROM payments WHERE invoice_id = $1 ORDER BY paid_at`,
      [parseInt(id)]
    ).catch(() => []),
  ]);
  const formatDateStr = (d: unknown): string | null => {
    if (!d) return null;
    if (d instanceof Date) return d.toISOString().split('T')[0];
    return String(d).split('T')[0];
  };

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
      work_address: (inv.work_address as string | null) ?? null,
      couleur: (inv.couleur as string | null) ?? null,
      jour1_date: formatDateStr(inv.jour1_date),
      jour1_slot: (inv.jour1_slot as string | null) ?? null,
      jour2_date: formatDateStr(inv.jour2_date),
      jour2_slot: (inv.jour2_slot as string | null) ?? null,
      items: itemRows.map(r => ({
        type_service: String(r.type_service ?? ''),
        superficie: Number(r.superficie ?? 0),
        prix_pied_carre: Number(r.prix_pied_carre ?? 0),
        sous_total: Number(r.sous_total ?? 0),
        description: (r.description as string | null) ?? null,
      })),
      extras: extraRows.map(r => ({
        description: String(r.description ?? ''),
        quantite: Number(r.quantite ?? 0),
        prix_unitaire: Number(r.prix_unitaire ?? 0),
        sous_total: Number(r.sous_total ?? 0),
      })),
      payments: paymentRows.map(r => ({
        type: String(r.type ?? ''),
        montant: Number(r.montant ?? 0),
        methode: String(r.methode ?? ''),
        paid_at: r.paid_at instanceof Date ? r.paid_at.toISOString() : String(r.paid_at ?? ''),
      })),
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

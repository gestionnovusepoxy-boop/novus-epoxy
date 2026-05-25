import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query } from '@/lib/db';
import { runAction } from '@/lib/composio';

export const maxDuration = 60;

/**
 * POST /api/composio/sheets-report
 * body: { type: 'crm' | 'revenue' | 'hours' }
 *
 * Generates a Google Sheets report and returns the spreadsheet URL.
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const { type = 'crm' } = await req.json() as { type?: string };

  const today = new Date().toISOString().slice(0, 10);

  if (type === 'crm') {
    // Pull CRM stats
    const [leads, byStatus, byTemp, recent] = await Promise.all([
      query(`SELECT COUNT(*)::int AS total, source FROM crm_leads GROUP BY source ORDER BY total DESC`),
      query(`SELECT statut, COUNT(*)::int AS total FROM crm_leads GROUP BY statut ORDER BY total DESC`),
      query(`SELECT temperature, COUNT(*)::int AS total FROM crm_leads GROUP BY temperature`),
      query(`SELECT nom, telephone, email, service, superficie, ville, statut, temperature, source, created_at::date::text AS date FROM crm_leads ORDER BY created_at DESC LIMIT 200`),
    ]);

    const title = `CRM Novus Epoxy — ${today}`;

    // Sheet 1: Summary
    const summaryRows: string[][] = [
      ['Novus Epoxy — Rapport CRM', today],
      [],
      ['PAR SOURCE', 'TOTAL'],
      ...leads.map((r: Record<string, unknown>) => [String(r.source ?? 'inconnu'), String(r.total)]),
      [],
      ['PAR STATUT', 'TOTAL'],
      ...byStatus.map((r: Record<string, unknown>) => [String(r.statut), String(r.total)]),
      [],
      ['PAR TEMPÉRATURE', 'TOTAL'],
      ...byTemp.map((r: Record<string, unknown>) => [String(r.temperature ?? '-'), String(r.total)]),
    ];

    // Sheet 2: Last 200 leads
    const leadRows: string[][] = [
      ['Nom', 'Téléphone', 'Email', 'Service', 'Superficie', 'Ville', 'Statut', 'Température', 'Source', 'Date'],
      ...(recent as Record<string, unknown>[]).map(r => [
        String(r.nom ?? ''),
        String(r.telephone ?? ''),
        String(r.email ?? ''),
        String(r.service ?? ''),
        String(r.superficie ?? ''),
        String(r.ville ?? ''),
        String(r.statut ?? ''),
        String(r.temperature ?? ''),
        String(r.source ?? ''),
        String(r.date ?? ''),
      ]),
    ];

    // Create spreadsheet
    const createResult = await runAction('GOOGLESHEETS_CREATE_SPREADSHEET', { title });
    if (!createResult.ok) {
      return NextResponse.json({ error: `Création sheet échouée: ${createResult.error}` }, { status: 500 });
    }

    const sheetData = createResult.data as { spreadsheetId?: string; spreadsheetUrl?: string };
    const spreadsheetId = sheetData?.spreadsheetId;
    if (!spreadsheetId) {
      return NextResponse.json({ error: 'spreadsheetId manquant' }, { status: 500 });
    }

    // Write summary data
    await runAction('GOOGLESHEETS_BATCH_UPDATE', {
      spreadsheet_id: spreadsheetId,
      ranges: ['Sheet1!A1'],
      value_input_option: 'USER_ENTERED',
      data: [{ range: 'Sheet1!A1', values: summaryRows }],
    });

    // Add second sheet for leads detail
    await runAction('GOOGLESHEETS_ADD_SHEET', {
      spreadsheet_id: spreadsheetId,
      title: 'Leads Détail',
    });
    await runAction('GOOGLESHEETS_BATCH_UPDATE', {
      spreadsheet_id: spreadsheetId,
      ranges: ['Leads Détail!A1'],
      value_input_option: 'USER_ENTERED',
      data: [{ range: 'Leads Détail!A1', values: leadRows }],
    });

    const url = sheetData?.spreadsheetUrl ?? `https://docs.google.com/spreadsheets/d/${spreadsheetId}`;
    return NextResponse.json({ ok: true, url, spreadsheetId, title });
  }

  if (type === 'revenue') {
    const rows = await query(
      `SELECT to_char(created_at, 'YYYY-MM') AS mois,
              COUNT(*)::int AS nb_devis,
              SUM(total)::numeric(10,2) AS revenus_bruts,
              SUM(depot_requis)::numeric(10,2) AS depots_total,
              SUM(CASE WHEN statut IN ('depot_paye','planifie','complete') THEN depot_requis ELSE 0 END)::numeric(10,2) AS depots_encaisses
       FROM quotes
       WHERE statut NOT IN ('annule','brouillon')
       GROUP BY mois ORDER BY mois DESC LIMIT 24`
    );

    const title = `Revenus Novus Epoxy — ${today}`;
    const sheetRows: string[][] = [
      ['Novus Epoxy — Rapport Revenus', today],
      [],
      ['Mois', 'Nb Devis', 'Revenus Bruts ($)', 'Dépôts Demandés ($)', 'Dépôts Encaissés ($)'],
      ...(rows as Record<string, unknown>[]).map(r => [
        String(r.mois), String(r.nb_devis), String(r.revenus_bruts), String(r.depots_total), String(r.depots_encaisses),
      ]),
    ];

    const createResult = await runAction('GOOGLESHEETS_CREATE_SPREADSHEET', { title });
    if (!createResult.ok) return NextResponse.json({ error: createResult.error }, { status: 500 });

    const sheetData = createResult.data as { spreadsheetId?: string; spreadsheetUrl?: string };
    const spreadsheetId = sheetData?.spreadsheetId;
    if (!spreadsheetId) return NextResponse.json({ error: 'spreadsheetId manquant' }, { status: 500 });

    await runAction('GOOGLESHEETS_BATCH_UPDATE', {
      spreadsheet_id: spreadsheetId,
      ranges: ['Sheet1!A1'],
      value_input_option: 'USER_ENTERED',
      data: [{ range: 'Sheet1!A1', values: sheetRows }],
    });

    const url = sheetData?.spreadsheetUrl ?? `https://docs.google.com/spreadsheets/d/${spreadsheetId}`;
    return NextResponse.json({ ok: true, url, spreadsheetId, title });
  }

  return NextResponse.json({ error: 'type invalide: crm | revenue | hours' }, { status: 400 });
}

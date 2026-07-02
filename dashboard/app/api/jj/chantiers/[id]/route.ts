import { NextRequest, NextResponse } from 'next/server';
import { requireJJ } from '@/lib/auth';
import { query } from '@/lib/db';
import { sendSMS } from '@/lib/sms';

function num(v: unknown, fallback = 0): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  const gate = await requireJJ(req);
  if (gate instanceof NextResponse) return gate;

  const { id } = await params;
  const chantierId = parseInt(id, 10);
  if (!Number.isFinite(chantierId)) {
    return NextResponse.json({ error: 'id invalide' }, { status: 400 });
  }

  const rows = await query(`SELECT * FROM jj_chantiers WHERE id = $1`, [chantierId]);
  if (rows.length === 0) return NextResponse.json({ error: 'Chantier introuvable' }, { status: 404 });
  const c = rows[0];

  const [planning, produits, heures, depenses] = await Promise.all([
    query(`SELECT * FROM jj_planning WHERE chantier_id = $1 ORDER BY date ASC`, [chantierId]),
    query(`SELECT * FROM jj_produits WHERE chantier_id = $1`, [chantierId]),
    query(
      `SELECT SUM(heures * taux_horaire) AS cout FROM jj_heures WHERE chantier_id = $1`,
      [chantierId],
    ),
    query(`SELECT * FROM jj_depenses WHERE chantier_id = $1 ORDER BY created_at DESC`, [chantierId]),
  ]);

  const duRembourser = (depenses as Array<Record<string, unknown>>)
    .filter(d => !d.rembourse)
    .reduce((s, d) => s + num(d.sous_total), 0);

  const coutMO = num(heures[0]?.cout);
  const coutMat = (produits as Array<Record<string, unknown>>).reduce(
    (s, p) => s + num(p.quantite) * num(p.cout_unitaire),
    0,
  );
  const montantContrat = num(c.montant_contrat);
  const splitPct = num(c.split_pct, 50);
  const partNovus = montantContrat * (splitPct / 100);
  const partJj = montantContrat * (1 - splitPct / 100);

  return NextResponse.json({
    data: {
      ...c,
      montant_contrat: montantContrat,
      montant_main_oeuvre: num(c.montant_main_oeuvre),
      montant_materiel: num(c.montant_materiel),
      depot_montant: num(c.depot_montant),
      equipe: c.equipe != null ? Number(c.equipe) : null,
      split_pct: splitPct,
      planning,
      produits,
      depenses: (depenses as Array<Record<string, unknown>>).map(d => ({ ...d, sous_total: num(d.sous_total) })),
      du_rembourser: round2(duRembourser),
      cout_main_oeuvre: round2(coutMO),
      cout_materiel: round2(coutMat),
      part_novus: round2(partNovus),
      part_jj: round2(partJj),
      marge_novus: round2(partNovus - coutMO),
      marge_jj: round2(partJj - coutMat),
      profit: num(c.montant_main_oeuvre) - coutMO,
    },
  });
}

const ALLOWED_PATCH = [
  'client_nom', 'client_tel', 'adresse', 'ville', 'service', 'superficie',
  'montant_contrat', 'montant_main_oeuvre', 'montant_materiel',
  'depot_recu', 'depot_montant', 'equipe', 'couleur', 'split_pct', 'statut', 'paye', 'date_paye', 'notes',
] as const;

export async function PATCH(req: NextRequest, { params }: Params) {
  const gate = await requireJJ(req);
  if (gate instanceof NextResponse) return gate;

  const { id } = await params;
  const chantierId = parseInt(id, 10);
  if (!Number.isFinite(chantierId)) {
    return NextResponse.json({ error: 'id invalide' }, { status: 400 });
  }

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Corps invalide' }, { status: 400 });

  // Détecte la transition vers 'complete' pour aviser le boss de JJ par texto.
  let wasComplete = false;
  if (body.statut === 'complete') {
    const prev = await query(`SELECT statut FROM jj_chantiers WHERE id = $1`, [chantierId]).catch(() => []);
    wasComplete = prev[0]?.statut === 'complete';
  }

  const setClauses: string[] = ['updated_at = NOW()'];
  const vals: unknown[] = [];

  for (const key of ALLOWED_PATCH) {
    if (body[key] !== undefined) {
      vals.push(body[key]);
      setClauses.push(`${key} = $${vals.length}`);
    }
  }

  if (setClauses.length === 1) {
    return NextResponse.json({ error: 'Aucun champ valide fourni' }, { status: 400 });
  }

  vals.push(chantierId);
  const rows = await query(
    `UPDATE jj_chantiers SET ${setClauses.join(', ')} WHERE id = $${vals.length} RETURNING *`,
    vals,
  );

  if (rows.length === 0) return NextResponse.json({ error: 'Chantier introuvable' }, { status: 404 });

  // Job marqué terminé → texto au boss de JJ (numéro dans JJ_BOSS_PHONE).
  if (body.statut === 'complete' && !wasComplete) {
    const c = rows[0] as Record<string, unknown>;
    // Raphaël, boss de JJ — défaut, surchargeable via JJ_BOSS_PHONE.
    const bossPhone = process.env.JJ_BOSS_PHONE || '+14189992226';
    if (bossPhone) {
      const ville = c.ville ? ` à ${c.ville}` : '';
      const fmt = (p?: string) => (p ?? '').replace(/^\+1/, '').replace(/(\d{3})(\d{3})(\d{4})/, '$1-$2-$3');
      const luca = fmt(process.env.ADMIN_PHONE) || '581-307-5983';
      const jason = fmt(process.env.JASON_PHONE) || '581-307-2678';
      const msg = `Salut Raphaël! ✅ Job #${chantierId} terminé — le chantier de ${c.client_nom}${ville} est complété par l'équipe Novus.\nPour plus d'info: Luca ${luca} ou Jason ${jason}. — Novus Epoxy`;
      sendSMS(bossPhone, msg).catch(() => {});
    }
  }

  return NextResponse.json(rows[0]);
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const gate = await requireJJ(req);
  if (gate instanceof NextResponse) return gate;

  const { id } = await params;
  const chantierId = parseInt(id, 10);
  if (!Number.isFinite(chantierId)) {
    return NextResponse.json({ error: 'id invalide' }, { status: 400 });
  }

  const rows = await query(
    `DELETE FROM jj_chantiers WHERE id = $1 RETURNING id`,
    [chantierId],
  );

  if (rows.length === 0) return NextResponse.json({ error: 'Chantier introuvable' }, { status: 404 });
  return NextResponse.json({ success: true });
}

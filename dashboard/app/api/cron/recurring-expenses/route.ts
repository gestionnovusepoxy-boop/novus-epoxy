import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getQuebecDate, getQuebecDayOfMonth, getQuebecDay, getQuebecNow } from '@/lib/timezone';

export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')?.replace('Bearer ', '') ?? '';
  const cronSecret = process.env.CRON_SECRET ?? '';
  const adminKey = process.env.ADMIN_API_KEY ?? '';
  if (!authHeader || (authHeader !== cronSecret && authHeader !== adminKey)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const today = getQuebecDate();
  const dayOfMonth = getQuebecDayOfMonth();

  // Get all active recurring expenses that should fire today
  const recurring = await query(
    `SELECT * FROM recurring_expenses WHERE actif = true AND (derniere_creation IS NULL OR derniere_creation < $1)`,
    [today]
  );

  let created = 0;
  for (const r of recurring) {
    const freq = r.frequence as string;
    const targetDay = Number(r.jour_du_mois ?? 1);

    // Check if today is the right day
    let shouldCreate = false;
    if (freq === 'mensuel' && dayOfMonth === targetDay) {
      // Garde anti-doublon: ne pas re-créer si une dépense a déjà été créée ce mois-ci.
      const dc = r.derniere_creation ? new Date(r.derniere_creation as string) : null;
      const nowQc = getQuebecNow();
      const alreadyThisMonth = !!dc && dc.getMonth() === nowQc.getMonth() && dc.getFullYear() === nowQc.getFullYear();
      shouldCreate = !alreadyThisMonth;
    } else if (freq === 'hebdomadaire') {
      // Create every week on the same weekday as jour_du_mois (1=Monday...7=Sunday)
      const todayWeekday = getQuebecDay() || 7; // Convert 0 (Sunday) to 7
      shouldCreate = todayWeekday === targetDay;
    } else if (freq === 'annuel') {
      // jour_du_mois stores the month (1-12), create on 1st of that month
      const currentMonth = getQuebecNow().getMonth() + 1;
      shouldCreate = currentMonth === targetDay && dayOfMonth === 1;
    }

    if (!shouldCreate) continue;

    // Create the expense
    await query(
      `INSERT INTO expenses (date_depense, fournisseur, description, categorie, montant_ht, tps, tvq, montant_ttc, methode)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [today, r.fournisseur, r.description, r.categorie, r.montant_ht, r.tps, r.tvq, r.montant_ttc, r.methode]
    );

    // Update last creation date
    await query('UPDATE recurring_expenses SET derniere_creation = $1 WHERE id = $2', [today, r.id]);
    created++;
  }

  return NextResponse.json({ ok: true, date: today, created });
}

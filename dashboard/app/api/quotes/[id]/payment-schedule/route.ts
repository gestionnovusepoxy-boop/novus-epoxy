import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query } from '@/lib/db';

type ScheduleItem = {
  label: string;
  amount_cents?: number | null;
  pct?: number | null;
  due?: string;
  status?: 'pending' | 'paid' | 'cancelled';
};

function normalizeSchedule(raw: unknown): ScheduleItem[] {
  if (!Array.isArray(raw)) return [];
  const out: ScheduleItem[] = [];
  for (const it of raw) {
    if (!it || typeof it !== 'object') continue;
    const o = it as Record<string, unknown>;
    const label = String(o.label ?? '').slice(0, 100);
    if (!label.trim()) continue;
    const amount_cents = o.amount_cents != null ? Math.max(0, Math.round(Number(o.amount_cents))) : null;
    const pct = o.pct != null ? Math.max(0, Math.min(100, Number(o.pct))) : null;
    const due = String(o.due ?? 'on_signature').slice(0, 50);
    const rawStatus = String(o.status ?? 'pending');
    const status: ScheduleItem['status'] = ['pending', 'paid', 'cancelled'].includes(rawStatus)
      ? (rawStatus as ScheduleItem['status'])
      : 'pending';
    out.push({ label, amount_cents, pct, due, status });
  }
  return out;
}

// GET — return current schedule (or default 30/70 if empty)
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const { id } = await params;
  const rows = await query(`SELECT payment_schedule, total FROM quotes WHERE id = $1`, [parseInt(id)]);
  if (!rows[0]) return NextResponse.json({ error: 'Devis introuvable' }, { status: 404 });

  const schedule = Array.isArray(rows[0].payment_schedule) && rows[0].payment_schedule.length > 0
    ? rows[0].payment_schedule
    : [
        { label: 'Dépôt', pct: 30, due: 'on_signature', status: 'pending' },
        { label: 'Solde', pct: 70, due: 'on_completion', status: 'pending' },
      ];
  return NextResponse.json({ schedule, total: Number(rows[0].total), is_default: !Array.isArray(rows[0].payment_schedule) || rows[0].payment_schedule.length === 0 });
}

// PUT — replace schedule. Validates that pct sums to 100 OR fixed amounts equal total.
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!body || !Array.isArray(body.schedule)) return NextResponse.json({ error: 'schedule[] requis' }, { status: 400 });

  const schedule = normalizeSchedule(body.schedule);
  if (schedule.length === 0) return NextResponse.json({ error: 'Au moins une étape requise' }, { status: 400 });

  // Validate: sum of pct = 100 OR fixed_amounts cover the total.
  const sumPct = schedule.reduce((s, it) => s + (it.pct ?? 0), 0);
  const sumFixed = schedule.reduce((s, it) => s + (it.amount_cents ?? 0), 0);
  const qRows = await query(`SELECT total FROM quotes WHERE id = $1`, [parseInt(id)]);
  if (!qRows[0]) return NextResponse.json({ error: 'Devis introuvable' }, { status: 404 });
  const totalCents = Math.round(Number(qRows[0].total) * 100);

  // Either all pct (sum 100) or all fixed (sum = total) — mixed allowed if fixed + (remaining via pct) covers total
  const totalCoverage = sumFixed + Math.round((totalCents - sumFixed) * sumPct / 100);
  if (Math.abs(totalCoverage - totalCents) > 100) { // tolerance 1$
    return NextResponse.json({
      error: `Le schedule ne couvre pas le total. Fixed: ${sumFixed/100}, Pct: ${sumPct}%, attendu: ${totalCents/100}`,
    }, { status: 400 });
  }

  await query(`UPDATE quotes SET payment_schedule = $1::jsonb WHERE id = $2`, [JSON.stringify(schedule), parseInt(id)]);
  return NextResponse.json({ ok: true, schedule });
}

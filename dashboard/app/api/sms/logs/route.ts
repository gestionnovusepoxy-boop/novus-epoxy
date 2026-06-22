import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query } from '@/lib/db';
import { sendSMS } from '@/lib/sms';

// POST — répondre à un client par SMS directement depuis la page Textos.
// sendSMS gère heures calmes, opt-out, validation, et log dans sms_logs.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  const body = await req.json().catch(() => null);
  const to = String(body?.to || '').trim();
  const message = String(body?.message || '').trim().slice(0, 600);
  if (!to || !message) return NextResponse.json({ error: 'Numéro et message requis' }, { status: 400 });
  const ok = await sendSMS(to, message);
  if (ok) return NextResponse.json({ ok: true, delivered: 'SMS' });
  return NextResponse.json({ ok: false, deliveryError: 'SMS bloqué (heures calmes, opt-out, ou numéro invalide)' });
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1'));
  const limit = Math.min(100, parseInt(searchParams.get('limit') ?? '50'));
  const direction = searchParams.get('direction') ?? '';
  const search = searchParams.get('search') ?? '';
  const phone = searchParams.get('phone') ?? '';
  const offset = (page - 1) * limit;

  let where = 'WHERE 1=1';
  const params: unknown[] = [];
  let i = 1;

  if (direction) {
    where += ` AND direction = $${i++}`;
    params.push(direction);
  }
  if (search) {
    where += ` AND (message ILIKE $${i} OR client_nom ILIKE $${i} OR from_number ILIKE $${i} OR to_number ILIKE $${i})`;
    params.push(`%${search}%`);
    i++;
  }
  if (phone) {
    where += ` AND (from_number LIKE '%' || $${i} OR to_number LIKE '%' || $${i})`;
    params.push(phone.replace(/\D/g, '').slice(-10));
    i++;
  }

  const countRows = await query(`SELECT COUNT(*)::int AS count FROM sms_logs ${where}`, params);
  const total = (countRows[0]?.count as number) ?? 0;

  const rows = await query(
    `SELECT * FROM sms_logs ${where} ORDER BY created_at DESC LIMIT $${i++} OFFSET $${i}`,
    [...params, limit, offset],
  );

  // Group messages by phone number for conversation view
  const conversations: Record<string, typeof rows> = {};
  for (const row of rows) {
    const phone = row.direction === 'inbound' ? row.from_number : row.to_number;
    const key = String(phone).replace(/\D/g, '').slice(-10);
    if (!conversations[key]) conversations[key] = [];
    conversations[key].push(row);
  }

  return NextResponse.json({ data: rows, conversations, total, page, limit });
}

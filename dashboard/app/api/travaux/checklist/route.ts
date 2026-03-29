import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query } from '@/lib/db';

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Non autorise' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const quoteId = searchParams.get('quoteId');
  if (!quoteId) return NextResponse.json({ error: 'quoteId requis' }, { status: 400 });

  const key = `checklist_${quoteId}`;
  const rows = await query(
    `SELECT value FROM kv_store WHERE key = $1`,
    [key]
  );

  if (rows.length === 0) {
    return NextResponse.json({ checklist: [] });
  }

  try {
    const checklist = JSON.parse(rows[0].value as string);
    return NextResponse.json({ checklist });
  } catch {
    return NextResponse.json({ checklist: [] });
  }
}

export async function PUT(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Non autorise' }, { status: 401 });

  const body = await req.json();
  const { quoteId, checklist } = body;

  if (!quoteId || !Array.isArray(checklist)) {
    return NextResponse.json({ error: 'quoteId et checklist requis' }, { status: 400 });
  }

  const key = `checklist_${quoteId}`;
  const value = JSON.stringify(checklist);

  await query(
    `INSERT INTO kv_store (key, value, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
    [key, value]
  );

  return NextResponse.json({ success: true });
}

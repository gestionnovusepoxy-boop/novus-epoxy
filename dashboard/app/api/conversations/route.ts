import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query } from '@/lib/db';

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const page    = Math.max(1, parseInt(searchParams.get('page') ?? '1'));
  const limit   = Math.min(100, parseInt(searchParams.get('limit') ?? '25'));
  const channel = searchParams.get('channel') ?? '';
  const status  = searchParams.get('status') ?? '';
  const offset  = (page - 1) * limit;

  let where = 'WHERE 1=1';
  const params: unknown[] = [];
  let i = 1;

  if (channel) { where += ` AND c.channel = $${i++}`; params.push(channel); }
  if (status) { where += ` AND c.status = $${i++}`; params.push(status); }

  const countRows = await query(
    `SELECT COUNT(*)::int AS count FROM conversations c ${where}`, params
  );
  const total = (countRows[0]?.count as number) ?? 0;

  const rows = await query(
    `SELECT c.*,
       (SELECT COUNT(*)::int FROM messages WHERE conversation_id = c.id) AS nb_messages,
       (SELECT content FROM messages WHERE conversation_id = c.id AND role = 'user' ORDER BY created_at DESC LIMIT 1) AS last_message
     FROM conversations c ${where}
     ORDER BY c.updated_at DESC
     LIMIT $${i++} OFFSET $${i}`,
    [...params, limit, offset]
  );

  return NextResponse.json({ data: rows, total, page, limit });
}

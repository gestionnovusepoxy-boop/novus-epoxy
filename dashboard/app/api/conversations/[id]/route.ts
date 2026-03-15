import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query } from '@/lib/db';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const { id } = await params;
  const convId = parseInt(id);

  const convRows = await query(`SELECT * FROM conversations WHERE id = $1`, [convId]);
  if (convRows.length === 0) return NextResponse.json({ error: 'Conversation introuvable' }, { status: 404 });

  const messages = await query(
    `SELECT id, role, content, created_at FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC`,
    [convId]
  );

  return NextResponse.json({ conversation: convRows[0], messages });
}

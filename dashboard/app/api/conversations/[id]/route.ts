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

// POST — Admin sends a reply to the client in the chat
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const { id } = await params;
  const convId = parseInt(id);
  const body = await req.json().catch(() => null);
  const message = body?.message?.slice(0, 5000);

  if (!message) return NextResponse.json({ error: 'Message requis' }, { status: 400 });

  // Verify conversation exists
  const convRows = await query(`SELECT id, status FROM conversations WHERE id = $1`, [convId]);
  if (convRows.length === 0) return NextResponse.json({ error: 'Conversation introuvable' }, { status: 404 });

  // Save admin message as 'assistant' so it appears in the chat widget
  await query(
    `INSERT INTO messages (conversation_id, role, content) VALUES ($1, 'assistant', $2)`,
    [convId, message]
  );

  // If conversation was in handoff, move back to active
  if (convRows[0].status === 'handoff') {
    await query(`UPDATE conversations SET status = 'active' WHERE id = $1`, [convId]);
  }

  return NextResponse.json({ ok: true });
}

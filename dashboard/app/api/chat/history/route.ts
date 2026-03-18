import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

// Public — get chat history for a visitor
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const visitorId = searchParams.get('visitor_id');

  if (!visitorId) {
    return NextResponse.json({ messages: [] });
  }

  const convRows = await query(
    `SELECT id FROM conversations WHERE visitor_id = $1 AND channel = 'web' AND status IN ('active', 'handoff') ORDER BY created_at DESC LIMIT 1`,
    [visitorId]
  );

  if (convRows.length === 0) {
    return NextResponse.json({ messages: [] });
  }

  const messages = await query(
    `SELECT role, content, created_at FROM messages WHERE conversation_id = $1 AND role != 'system' ORDER BY created_at ASC LIMIT 50`,
    [convRows[0].id]
  );

  return NextResponse.json({ messages, conversation_id: convRows[0].id });
}

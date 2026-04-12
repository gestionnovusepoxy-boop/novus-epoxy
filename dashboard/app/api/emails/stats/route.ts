import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query as db } from '@/lib/db';

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const [rows] = await Promise.all([
    db(`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE statut = 'delivered' OR statut = 'opened' OR statut = 'clicked')::int AS delivered,
        COUNT(*) FILTER (WHERE statut IN ('opened', 'clicked'))::int AS opened,
        COUNT(*) FILTER (WHERE statut = 'bounced')::int AS bounced,
        COUNT(DISTINCT destinataire)::int AS conversations
      FROM email_logs
    `),
  ]);

  const stats = rows[0] as {
    total: number;
    delivered: number;
    opened: number;
    bounced: number;
    conversations: number;
  };

  return NextResponse.json(stats);
}

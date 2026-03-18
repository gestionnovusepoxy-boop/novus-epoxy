import { NextResponse } from 'next/server';
import { query as db } from '@/lib/db';
import { auth } from '@/lib/auth';

export async function GET() {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const leadsResult = await db(
    `SELECT id, nom, coalesce(telephone, email, '') as contact
     FROM submissions
     WHERE statut = 'nouveau'
       AND created_at > NOW() - INTERVAL '2 minutes'
     ORDER BY created_at DESC
     LIMIT 10`
  );

  const handoffsResult = await db(
    `SELECT id, status
     FROM conversations
     WHERE status = 'handoff'
       AND updated_at > NOW() - INTERVAL '2 minutes'
     ORDER BY updated_at DESC
     LIMIT 10`
  );

  const leads = Array.isArray(leadsResult) ? leadsResult : [];
  const handoffs = Array.isArray(handoffsResult) ? handoffsResult : [];

  const items: { type: string; title: string; body: string }[] = [];

  for (const lead of leads) {
    items.push({
      type: 'lead',
      title: `Nouvelle soumission de ${lead.nom || 'Inconnu'}`,
      body: lead.contact
        ? `Contact: ${lead.contact}`
        : 'Nouvelle demande reçue',
    });
  }

  for (const handoff of handoffs) {
    items.push({
      type: 'handoff',
      title: `Handoff demandé - Conv #${handoff.id}`,
      body: 'Un client demande à parler à un humain',
    });
  }

  return NextResponse.json({
    new_leads: leads.length,
    new_handoffs: handoffs.length,
    items,
  });
}

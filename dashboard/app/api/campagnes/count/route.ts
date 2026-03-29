import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query } from '@/lib/db';

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const audience = searchParams.get('audience') ?? '';

  let count = 0;

  switch (audience) {
    case 'tous_leads': {
      const rows = await query(
        `SELECT COUNT(DISTINCT email) as c FROM (
           SELECT visitor_email as email FROM conversations WHERE visitor_email IS NOT NULL AND visitor_email != ''
           UNION
           SELECT email FROM submissions WHERE email IS NOT NULL AND email != ''
         ) t`
      );
      count = Number(rows[0]?.c ?? 0);
      break;
    }
    case 'leads_tiedes': {
      const rows = await query(
        `SELECT COUNT(DISTINCT visitor_email) as c FROM conversations
         WHERE visitor_email IS NOT NULL AND visitor_email != '' AND lead_temp = 'warm'`
      );
      count = Number(rows[0]?.c ?? 0);
      break;
    }
    case 'leads_chauds': {
      const rows = await query(
        `SELECT COUNT(DISTINCT visitor_email) as c FROM conversations
         WHERE visitor_email IS NOT NULL AND visitor_email != '' AND lead_temp = 'hot'`
      );
      count = Number(rows[0]?.c ?? 0);
      break;
    }
    case 'anciens_clients': {
      const rows = await query(
        `SELECT COUNT(DISTINCT email) as c FROM clients WHERE email IS NOT NULL AND email != ''`
      );
      count = Number(rows[0]?.c ?? 0);
      break;
    }
    case 'leads_sans_reponse': {
      const rows = await query(
        `SELECT COUNT(DISTINCT email) as c FROM (
           SELECT visitor_email as email FROM conversations
           WHERE visitor_email IS NOT NULL AND visitor_email != ''
             AND status = 'active'
             AND id NOT IN (SELECT conversation_id FROM messages WHERE role = 'assistant' AND conversation_id IS NOT NULL)
           UNION
           SELECT email FROM submissions WHERE email IS NOT NULL AND email != '' AND statut = 'nouveau'
         ) t`
      );
      count = Number(rows[0]?.c ?? 0);
      break;
    }
    default:
      return NextResponse.json({ count: 0 });
  }

  return NextResponse.json({ count });
}

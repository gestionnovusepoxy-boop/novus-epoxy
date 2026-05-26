import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query } from '@/lib/db';

// GET /api/crm/leads/[id] — lead detail with related quotes/sms/emails/submissions
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const { id } = await params;
  const leadId = parseInt(id, 10);
  if (isNaN(leadId)) return NextResponse.json({ error: 'ID invalide' }, { status: 400 });

  const [leadRows, quotes, sms, emails, submissions] = await Promise.all([
    query(`SELECT * FROM crm_leads WHERE id = $1`, [leadId]),
    query(
      `SELECT id, type_service, superficie, total, statut, created_at, sent_at, first_view_at, deposit_paid_at
         FROM quotes
        WHERE (client_tel IS NOT NULL AND client_tel = (SELECT telephone FROM crm_leads WHERE id = $1))
           OR (client_email IS NOT NULL AND client_email = (SELECT email FROM crm_leads WHERE id = $1))
        ORDER BY created_at DESC LIMIT 20`,
      [leadId]
    ).catch(() => []),
    query(
      `SELECT id, direction, from_number, to_number, message, statut, created_at
         FROM sms_logs WHERE lead_id = $1 ORDER BY created_at DESC LIMIT 30`,
      [leadId]
    ).catch(() => []),
    query(
      `SELECT id, sujet, destinataire, statut, created_at, direction
         FROM email_logs
        WHERE destinataire = (SELECT email FROM crm_leads WHERE id = $1)
           OR submission_id = ANY(SELECT id FROM submissions WHERE telephone = (SELECT telephone FROM crm_leads WHERE id = $1))
        ORDER BY created_at DESC LIMIT 30`,
      [leadId]
    ).catch(() => []),
    query(
      `SELECT s.id, s.created_at, s.statut, s.service, s.message
         FROM submissions s
        WHERE s.telephone = (SELECT telephone FROM crm_leads WHERE id = $1)
           OR s.email = (SELECT email FROM crm_leads WHERE id = $1)
        ORDER BY s.created_at DESC LIMIT 10`,
      [leadId]
    ).catch(() => []),
  ]);

  if (!leadRows.length) return NextResponse.json({ error: 'Lead introuvable' }, { status: 404 });

  return NextResponse.json({
    lead: leadRows[0],
    quotes,
    sms,
    emails,
    submissions,
  });
}

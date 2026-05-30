/**
 * Unified conversation timeline for a CRM lead.
 *
 * Merges en ordre chronologique :
 *   - 📧 emails entrants/sortants (email_logs)
 *   - 📱 SMS entrants/sortants (sms_logs)
 *   - 🤖 conversations chatbot widget (conversations + messages)
 *   - 📋 devis envoyés et événements (quotes)
 *
 * Matching strategy:
 *   - email = crm_leads.email (case-insensitive)
 *   - phone = crm_leads.telephone (last 10 digits)
 *   - lead_id direct quand stocké (sms_logs.lead_id, etc.)
 */
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query } from '@/lib/db';

export interface TimelineEvent {
  ts: string;               // ISO timestamp
  type: 'email_in' | 'email_out' | 'sms_in' | 'sms_out' | 'chat' | 'quote' | 'note';
  title: string;            // 1-line summary
  body?: string;            // full content (truncated)
  meta?: Record<string, unknown>;
  source_id?: number | string;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const apiKey = req.headers.get('x-api-key') ?? '';
  const validKey = (process.env.ADMIN_API_KEY ?? '').trim();
  if (!session && (!validKey || apiKey.trim() !== validKey)) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  }

  const { id } = await params;
  const leadId = parseInt(id);
  if (!Number.isFinite(leadId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  const leadRows = await query(
    `SELECT id, nom, email, telephone, statut, temperature, source, notes, created_at
     FROM crm_leads WHERE id = $1`,
    [leadId]
  ) as Array<{ id: number; nom: string; email: string | null; telephone: string | null; statut: string; temperature: string; source: string | null; notes: string | null; created_at: Date }>;
  if (!leadRows[0]) return NextResponse.json({ error: 'Lead introuvable' }, { status: 404 });
  const lead = leadRows[0];

  const emailLower = (lead.email ?? '').toLowerCase().trim();
  const phoneDigits = (lead.telephone ?? '').replace(/\D/g, '').slice(-10);

  const events: TimelineEvent[] = [];

  // 1. emails — match destinataire OR reply_body recipient
  if (emailLower) {
    const emails = await query(
      `SELECT id, destinataire, sujet, statut, direction, html_body, reply_body, created_at, opened_at, clicked_at
       FROM email_logs
       WHERE LOWER(destinataire) = $1
       ORDER BY created_at DESC LIMIT 200`,
      [emailLower]
    ) as Array<{ id: number; destinataire: string; sujet: string; statut: string; direction: string | null; html_body: string | null; reply_body: string | null; created_at: Date; opened_at: Date | null; clicked_at: Date | null }>;
    for (const e of emails) {
      const isInbound = e.direction === 'inbound';
      events.push({
        ts: e.created_at.toISOString(),
        type: isInbound ? 'email_in' : 'email_out',
        title: e.sujet || '(sans sujet)',
        body: isInbound ? (e.reply_body ?? '').slice(0, 4000) : (e.html_body ?? '').slice(0, 4000),
        meta: {
          email_id: e.id,
          to: e.destinataire,
          statut: e.statut,
          opened: !!e.opened_at,
          clicked: !!e.clicked_at,
        },
        source_id: e.id,
      });
    }
  }

  // 2. SMS — match lead_id OR phone match (in either direction)
  const smsRows = await query(
    `SELECT id, direction, from_number, to_number, message, statut, created_at
     FROM sms_logs
     WHERE lead_id = $1
        OR ($2 != '' AND (regexp_replace(COALESCE(from_number,''), '[^0-9]', '', 'g') LIKE '%' || $2
                       OR regexp_replace(COALESCE(to_number,''),   '[^0-9]', '', 'g') LIKE '%' || $2))
     ORDER BY created_at DESC LIMIT 300`,
    [leadId, phoneDigits]
  ) as Array<{ id: number; direction: string; from_number: string | null; to_number: string | null; message: string; statut: string | null; created_at: Date }>;
  for (const s of smsRows) {
    const isInbound = s.direction === 'inbound';
    events.push({
      ts: s.created_at.toISOString(),
      type: isInbound ? 'sms_in' : 'sms_out',
      title: isInbound ? `📱 SMS reçu de ${s.from_number}` : `📱 SMS envoyé à ${s.to_number}`,
      body: s.message,
      meta: { sms_id: s.id, statut: s.statut },
      source_id: s.id,
    });
  }

  // 3. chatbot widget conversations (match by email or phone)
  if (emailLower || phoneDigits) {
    const convos = await query(
      `SELECT c.id, c.channel, c.created_at, c.status, m.role, m.content, m.created_at AS msg_at
       FROM conversations c
       JOIN messages m ON m.conversation_id = c.id
       WHERE ($1 != '' AND LOWER(c.visitor_email) = $1)
          OR ($2 != '' AND regexp_replace(COALESCE(c.visitor_tel,''), '[^0-9]', '', 'g') LIKE '%' || $2)
       ORDER BY m.created_at DESC LIMIT 300`,
      [emailLower, phoneDigits]
    ) as Array<{ id: number; channel: string; created_at: Date; status: string; role: string; content: string; msg_at: Date }>;
    for (const m of convos) {
      events.push({
        ts: m.msg_at.toISOString(),
        type: 'chat',
        title: m.role === 'user' ? `🤖 Client (widget) — conv #${m.id}` : `🤖 Aria (widget)`,
        body: (m.content ?? '').slice(0, 4000),
        meta: { conversation_id: m.id, channel: m.channel, role: m.role },
      });
    }
  }

  // 4. quotes
  const quoteRows = await query(
    `SELECT id, type_service, total, statut, created_at, sent_at
     FROM quotes
     WHERE ($1 != '' AND LOWER(client_email) = $1)
        OR ($2 != '' AND regexp_replace(COALESCE(client_tel,''), '[^0-9]', '', 'g') LIKE '%' || $2)
     ORDER BY created_at DESC LIMIT 50`,
    [emailLower, phoneDigits]
  ) as Array<{ id: number; type_service: string; total: number; statut: string; created_at: Date; sent_at: Date | null }>;
  for (const q of quoteRows) {
    events.push({
      ts: (q.sent_at ?? q.created_at).toISOString(),
      type: 'quote',
      title: `📋 Devis #${q.id} — ${q.type_service} — ${q.total}$`,
      body: `Statut: ${q.statut}`,
      meta: { quote_id: q.id, statut: q.statut, total: q.total },
      source_id: q.id,
    });
  }

  // 5. lead notes (single event at lead creation)
  if (lead.notes) {
    events.push({
      ts: lead.created_at.toISOString(),
      type: 'note',
      title: `📝 Notes lead (source: ${lead.source ?? 'inconnu'})`,
      body: lead.notes,
    });
  }

  // Sort DESC by timestamp (most recent first)
  events.sort((a, b) => b.ts.localeCompare(a.ts));

  return NextResponse.json({
    lead: {
      id: lead.id,
      nom: lead.nom,
      email: lead.email,
      telephone: lead.telephone,
      statut: lead.statut,
      temperature: lead.temperature,
      source: lead.source,
    },
    events,
    counts: {
      total: events.length,
      email_in: events.filter(e => e.type === 'email_in').length,
      email_out: events.filter(e => e.type === 'email_out').length,
      sms_in: events.filter(e => e.type === 'sms_in').length,
      sms_out: events.filter(e => e.type === 'sms_out').length,
      chat: events.filter(e => e.type === 'chat').length,
      quotes: events.filter(e => e.type === 'quote').length,
    },
  });
}

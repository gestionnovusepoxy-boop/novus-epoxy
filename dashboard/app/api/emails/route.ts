import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query as db } from '@/lib/db';

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const page   = Math.max(1, parseInt(searchParams.get('page')  ?? '1'));
  const limit  = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') ?? '25')));
  const offset = (page - 1) * limit;

  
  const [countRow, rows] = await Promise.all([
    db(`SELECT COUNT(*)::int AS total FROM email_logs`),
    db(
      `SELECT id, resend_id, destinataire, sujet, statut, opened_at, clicked_at, created_at
       FROM email_logs ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset]
    ),
  ]);

  return NextResponse.json({
    data:  rows,
    total: (countRow[0] as { total: number }).total,
    page,
    limit,
  });
}

// Webhook Resend
export async function POST(req: NextRequest) {
  const webhookSecret = process.env.RESEND_WEBHOOK_SECRET ?? '';
  const body          = await req.text();

  // Vérification signature Svix
  if (webhookSecret) {
    const svixId        = req.headers.get('svix-id')        ?? '';
    const svixTimestamp = req.headers.get('svix-timestamp') ?? '';
    const svixSignature = req.headers.get('svix-signature') ?? '';

    const signedContent = `${svixId}.${svixTimestamp}.${body}`;
    const secretBytes   = Uint8Array.from(atob(webhookSecret.replace('whsec_', '')), c => c.charCodeAt(0));
    const key           = await crypto.subtle.importKey('raw', secretBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig           = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signedContent));
    const expected      = 'v1,' + btoa(String.fromCharCode(...new Uint8Array(sig)));

    const valid = svixSignature.split(' ').some(s => s === expected);
    if (!valid) return new NextResponse('Signature invalide', { status: 401 });
  }

  const event = JSON.parse(body);
  if (!event?.type || !event?.data) return new NextResponse(null, { status: 204 });

  const statutMap: Record<string, string> = {
    'email.sent':       'sent',
    'email.delivered':  'delivered',
    'email.opened':     'opened',
    'email.clicked':    'clicked',
    'email.bounced':    'bounced',
    'email.complained': 'complained',
  };

  const statut    = statutMap[event.type];
  const resendId  = event.data.email_id;
  if (!statut || !resendId) return new NextResponse(null, { status: 204 });

  
  const now = new Date().toISOString();

  if (statut === 'sent') {
    await db(
      `INSERT INTO email_logs (resend_id, destinataire, sujet, statut)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (resend_id) DO NOTHING`,
      [resendId, event.data.to?.[0] ?? '', event.data.subject?.slice(0, 500) ?? '', statut]
    );
  } else {
    const extra = statut === 'opened'
      ? `, opened_at = COALESCE(opened_at, $3)`
      : statut === 'clicked'
      ? `, clicked_at = COALESCE(clicked_at, $3)`
      : '';

    const params = extra
      ? [statut, resendId, now]
      : [statut, resendId];

    await db(
      `UPDATE email_logs SET statut = $1${extra} WHERE resend_id = $2`,
      params
    );
  }

  return new NextResponse(null, { status: 204 });
}

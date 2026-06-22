import { NextRequest, NextResponse } from 'next/server';
import { google } from 'googleapis';
import { query } from '@/lib/db';
import { ensureLabels, LABELS } from '@/lib/gmail-labels';

export const maxDuration = 60;

async function getGmailClient() {
  let clientId = (process.env.GOOGLE_WEB_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || '');
  let clientSecret = (process.env.GOOGLE_WEB_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET || '');
  let refreshToken = process.env.GOOGLE_REFRESH_TOKEN ?? '';
  try {
    const rows = await query(`SELECT key, value FROM kv_store WHERE key IN ('google_client_id','google_client_secret','google_refresh_token')`);
    for (const row of (rows ?? [])) {
      if (row.key === 'google_client_id' && row.value) clientId = row.value as string;
      if (row.key === 'google_client_secret' && row.value) clientSecret = row.value as string;
      if (row.key === 'google_refresh_token' && row.value) refreshToken = row.value as string;
    }
  } catch { /* ignore */ }
  if (!clientId || !clientSecret || !refreshToken) return null;
  const oauth2 = new google.auth.OAuth2(clientId, clientSecret);
  oauth2.setCredentials({ refresh_token: refreshToken });
  return google.gmail({ version: 'v1', auth: oauth2 });
}

// POST /api/gmail/labels — crée les 7 labels Novus/… s'ils n'existent pas (idempotent).
export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization')?.replace('Bearer ', '') ?? '';
  const cronSecret = process.env.CRON_SECRET ?? '';
  const adminKey = process.env.ADMIN_API_KEY ?? '';
  if (!authHeader || (authHeader !== cronSecret && authHeader !== adminKey)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const gmail = await getGmailClient();
  if (!gmail) return NextResponse.json({ error: 'Gmail not configured' }, { status: 500 });

  const map = await ensureLabels(gmail);
  return NextResponse.json({
    ok: true,
    labels: Object.values(LABELS).map(name => ({ name, id: map.get(name) ?? null, exists: map.has(name) })),
  });
}

export const GET = POST;

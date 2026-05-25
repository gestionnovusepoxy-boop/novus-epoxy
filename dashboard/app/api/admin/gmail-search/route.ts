import { NextRequest, NextResponse } from 'next/server';
import { google } from 'googleapis';
import { query } from '@/lib/db';

export async function GET(req: NextRequest) {
  const apiKey = req.headers.get('x-api-key') ?? req.nextUrl.searchParams.get('key') ?? '';
  const adminKey = process.env.ADMIN_API_KEY ?? '';
  if (!apiKey || apiKey !== adminKey) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const q = req.nextUrl.searchParams.get('q') ?? '';
  if (!q) return NextResponse.json({ error: 'q parameter required' }, { status: 400 });

  let clientId = process.env.GOOGLE_CLIENT_ID ?? '';
  let clientSecret = process.env.GOOGLE_CLIENT_SECRET ?? '';
  let refreshToken = process.env.GOOGLE_REFRESH_TOKEN ?? '';
  try {
    const rows = await query(`SELECT key, value FROM kv_store WHERE key IN ('google_client_id','google_client_secret','google_refresh_token')`);
    for (const row of (rows ?? [])) {
      if (row.key === 'google_client_id' && row.value) clientId = row.value as string;
      if (row.key === 'google_client_secret' && row.value) clientSecret = row.value as string;
      if (row.key === 'google_refresh_token' && row.value) refreshToken = row.value as string;
    }
  } catch { /* ignore */ }
  if (!clientId || !clientSecret || !refreshToken) {
    return NextResponse.json({ error: 'Gmail not configured' }, { status: 500 });
  }

  const oauth2 = new google.auth.OAuth2(clientId, clientSecret);
  oauth2.setCredentials({ refresh_token: refreshToken });
  const gmail = google.gmail({ version: 'v1', auth: oauth2 });

  const res = await gmail.users.messages.list({ userId: 'me', q, maxResults: 15 });
  const messages = res.data.messages ?? [];

  const results = [];
  for (const msg of messages) {
    const full = await gmail.users.messages.get({
      userId: 'me', id: msg.id!, format: 'metadata',
      metadataHeaders: ['To', 'From', 'Subject', 'Date'],
    });
    const h = full.data.payload?.headers ?? [];
    results.push({
      id: msg.id,
      to: h.find(x => x.name === 'To')?.value ?? '',
      from: h.find(x => x.name === 'From')?.value ?? '',
      subject: h.find(x => x.name === 'Subject')?.value ?? '',
      date: h.find(x => x.name === 'Date')?.value ?? '',
    });
  }

  return NextResponse.json({ count: results.length, results });
}

import { NextRequest, NextResponse } from 'next/server';
import { google } from 'googleapis';
import { query } from '@/lib/db';
import { handleGmailAuthError } from '@/lib/send-email';

// Registers Gmail push notifications via users.watch()
// Must be called once to start, then every ~6 days to renew (expires after 7 days).
// Add to Vercel cron or call manually via: POST /api/gmail/watch

export const maxDuration = 60;

const TOPIC_NAME = 'projects/true-orb-491120-j5/topics/gmail-notifications';

async function getGmailClient() {
  let clientId = (process.env.GOOGLE_WEB_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || '');
  let clientSecret = (process.env.GOOGLE_WEB_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET || '');
  let refreshToken = process.env.GOOGLE_REFRESH_TOKEN ?? '';

  try {
    const rows = await query(
      `SELECT key, value FROM kv_store WHERE key IN ('google_client_id','google_client_secret','google_refresh_token')`
    );
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

export async function POST(req: NextRequest) {
  // Auth — accept CRON_SECRET or ADMIN_API_KEY
  const authHeader = req.headers.get('authorization') ?? '';
  const token = authHeader.replace('Bearer ', '');
  const cronSecret = process.env.CRON_SECRET ?? '';
  const adminKey = process.env.ADMIN_API_KEY ?? '';
  if (!token || (token !== cronSecret && token !== adminKey)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const gmail = await getGmailClient();
  if (!gmail) {
    return NextResponse.json(
      { error: 'Gmail not configured (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN)' },
      { status: 500 },
    );
  }

  try {
    const res = await gmail.users.watch({
      userId: 'me',
      requestBody: {
        topicName: TOPIC_NAME,
        labelIds: ['INBOX'],
      },
    });

    const expiration = res.data.expiration
      ? new Date(Number(res.data.expiration)).toISOString()
      : 'unknown';

    console.log(`[Gmail Watch] Registered. historyId: ${res.data.historyId}, expires: ${expiration}`);

    return NextResponse.json({
      ok: true,
      historyId: res.data.historyId,
      expiration,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[Gmail Watch] Failed:', message);
    void handleGmailAuthError(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// GET alias for easy testing / Vercel cron
export async function GET(req: NextRequest) {
  return POST(req);
}

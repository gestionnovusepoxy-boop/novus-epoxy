import { NextRequest, NextResponse } from 'next/server';
import { google } from 'googleapis';

// Registers Gmail push notifications via users.watch()
// Must be called once to start, then every ~6 days to renew (expires after 7 days).
// Add to Vercel cron or call manually via: POST /api/gmail/watch

const TOPIC_NAME = 'projects/novus-epoxy/topics/gmail-notifications';

function getGmailClient() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) return null;

  const oauth2 = new google.auth.OAuth2(clientId, clientSecret);
  oauth2.setCredentials({ refresh_token: refreshToken });
  return google.gmail({ version: 'v1', auth: oauth2 });
}

export async function POST(req: NextRequest) {
  // Auth — accept CRON_SECRET or ADMIN_API_KEY
  const authHeader = req.headers.get('authorization') ?? '';
  const token = authHeader.replace('Bearer ', '');
  const secret = process.env.CRON_SECRET ?? '';
  const adminKey = process.env.ADMIN_API_KEY ?? '';
  if (secret && token !== secret && token !== adminKey) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const gmail = getGmailClient();
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
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// GET alias for easy testing / Vercel cron
export async function GET(req: NextRequest) {
  return POST(req);
}

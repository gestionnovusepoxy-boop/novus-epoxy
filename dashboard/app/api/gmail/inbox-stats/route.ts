import { NextRequest, NextResponse } from 'next/server';
import { google } from 'googleapis';

export const maxDuration = 30;

function getGmailClient() {
  const oauth2 = new google.auth.OAuth2(
    process.env.GOOGLE_WEB_CLIENT_ID || process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_WEB_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET,
  );
  oauth2.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  return google.gmail({ version: 'v1', auth: oauth2 });
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization') ?? '';
  const token = authHeader.replace('Bearer ', '');
  if (token !== (process.env.ADMIN_API_KEY ?? '') && token !== (process.env.CRON_SECRET ?? '')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const gmail = getGmailClient();

  const queries: [string, string][] = [
    ['total_inbox', 'in:inbox'],
    ['unread', 'in:inbox is:unread'],
    ['promotions', 'category:promotions'],
    ['social', 'category:social'],
    ['updates', 'category:updates'],
    ['from_sq', 'in:inbox from:registre@servicesquebec.gouv.qc.ca'],
    ['subject_RE_Novus', 'in:inbox subject:"RE: Novus Epoxy"'],
    ['subject_Re_Novus', 'in:inbox subject:novus'],
    ['spam_flag', 'in:inbox subject:SPAM'],
    ['from_shop', 'in:inbox from:info@novusepoxy.shop'],
    ['older_30d', 'in:inbox older_than:30d'],
    ['all_in_primary', 'in:inbox category:primary'],
  ];

  const counts: Record<string, number> = {};
  for (const [label, q] of queries) {
    try {
      const res = await gmail.users.messages.list({ userId: 'me', q, maxResults: 1 });
      counts[label] = res.data.resultSizeEstimate ?? 0;
    } catch { counts[label] = -1; }
  }

  // Sample 8 most recent inbox emails
  const sample: { from: string; subject: string; date: string }[] = [];
  try {
    const res = await gmail.users.messages.list({ userId: 'me', q: 'in:inbox', maxResults: 8 });
    for (const m of res.data.messages ?? []) {
      const msg = await gmail.users.messages.get({ userId: 'me', id: m.id!, format: 'metadata', metadataHeaders: ['From', 'Subject', 'Date'] });
      const h = msg.data.payload?.headers ?? [];
      sample.push({
        from: h.find(x => x.name === 'From')?.value ?? '',
        subject: h.find(x => x.name === 'Subject')?.value ?? '',
        date: h.find(x => x.name === 'Date')?.value ?? '',
      });
    }
  } catch {}

  return NextResponse.json({ counts, sample });
}

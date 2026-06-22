import { NextRequest, NextResponse } from 'next/server';
import { google } from 'googleapis';
import { query } from '@/lib/db';
import { ensureLabels, decideLabels, lookupContact, isFactureSubject, isSystemSender, LABELS } from '@/lib/gmail-labels';

export const maxDuration = 120;

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

function headerVal(headers: { name?: string | null; value?: string | null }[], name: string): string {
  return headers.find(h => h.name?.toLowerCase() === name.toLowerCase())?.value ?? '';
}
function extractEmail(from: string): string {
  const m = from.match(/<([^>]+)>/);
  return (m ? m[1] : from).toLowerCase().trim();
}

// GET/POST /api/gmail/organize — range la boîte par labels. DRY-RUN par défaut.
// ?dryRun=false&max=N pour appliquer par lots. JAMAIS de suppression.
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')?.replace('Bearer ', '') ?? '';
  const cronSecret = process.env.CRON_SECRET ?? '';
  const adminKey = process.env.ADMIN_API_KEY ?? '';
  if (!authHeader || (authHeader !== cronSecret && authHeader !== adminKey)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const dryRun = searchParams.get('dryRun') !== 'false'; // défaut = true (sécurité)
  const max = Math.min(Number(searchParams.get('max') ?? '100'), 400);

  const gmail = await getGmailClient();
  if (!gmail) return NextResponse.json({ error: 'Gmail not configured' }, { status: 500 });

  const labelMap = await ensureLabels(gmail);

  // Récupère les messages de la boîte de réception
  const ids: string[] = [];
  let pageToken: string | undefined;
  do {
    const res = await gmail.users.messages.list({ userId: 'me', q: 'in:inbox', maxResults: 100, pageToken });
    for (const m of (res.data.messages ?? [])) { if (m.id) ids.push(m.id); if (ids.length >= max) break; }
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken && ids.length < max);

  const counts: Record<string, number> = {};
  let applied = 0;
  let trashed = 0; // doit TOUJOURS rester 0 — on ne supprime jamais ici.

  for (const id of ids) {
    let full;
    try {
      full = await gmail.users.messages.get({ userId: 'me', id, format: 'full' });
    } catch { continue; }

    const headers = full.data.payload?.headers ?? [];
    const fromEmail = extractEmail(headerVal(headers, 'From'));
    const subject = headerVal(headers, 'Subject');
    const hasAttachment = (full.data.payload?.parts ?? []).some(p => !!p.filename && p.filename.length > 0);

    const contact = await lookupContact(fromEmail);
    const isFacture = isFactureSubject(subject);
    const isSystem = isSystemSender(fromEmail);

    const { labels, archive } = decideLabels({ hasAttachment, contact, isFacture, isFournisseur: false, isSystem });

    for (const name of labels) counts[name] = (counts[name] ?? 0) + 1;

    if (!dryRun) {
      const labelIds = labels.map(n => labelMap.get(n)).filter((x): x is string => !!x);
      if (labelIds.length > 0) {
        try {
          await gmail.users.messages.modify({
            userId: 'me',
            id,
            requestBody: { addLabelIds: labelIds, ...(archive ? { removeLabelIds: ['INBOX'] } : {}) },
          });
          applied++;
        } catch { /* skip */ }
      }
    }
  }

  return NextResponse.json({
    ok: true,
    dryRun,
    scanned: ids.length,
    applied,
    trashed, // garantie: 0
    counts,
    note: dryRun ? 'DRY-RUN — rien modifié. Ajoute ?dryRun=false&max=50 pour appliquer par lots.' : 'Labels appliqués (aucune suppression).',
  });
}

export const POST = GET;

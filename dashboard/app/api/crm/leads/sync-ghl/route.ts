import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const maxDuration = 60;

const OWNER_EMAILS = [
  'gestionnovusepoxy@gmail.com',
  'lanthierj6@gmail.com',
];

const GHL_BASE = 'https://services.leadconnectorhq.com';
const LOCATION_ID = '003PAOSBcNe5Dxdi42Kh';

function scoreTemperature(lead: { email?: string; phone?: string; source?: string }): 'chaud' | 'tiede' | 'froid' {
  let score = 0;
  if (lead.email) score += 2;
  if (lead.phone) score += 2;
  if (lead.source?.toLowerCase().includes('facebook')) score += 2;
  if (score >= 5) return 'chaud';
  if (score >= 3) return 'tiede';
  return 'froid';
}

async function notifyTelegram(text: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatIds = (process.env.TELEGRAM_ADMIN_CHAT_IDS ?? '').split(',').filter(Boolean);
  if (!token) return;
  for (const id of chatIds) {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: id.trim(), text, parse_mode: 'HTML' }),
    }).catch(() => {});
  }
}

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization')?.replace('Bearer ', '') ?? '';
  const adminKey = process.env.ADMIN_API_KEY ?? '';
  const cronSecret = process.env.CRON_SECRET ?? '';
  if (!authHeader || (authHeader !== adminKey && authHeader !== cronSecret)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const ghlToken = process.env.GHL_API_KEY;
  if (!ghlToken) {
    return NextResponse.json({ error: 'GHL_API_KEY missing' }, { status: 500 });
  }

  // Get last sync time — only fetch contacts created after this
  const lastSyncRows = await query(`SELECT value FROM kv_store WHERE key = 'last_ghl_sync'`).catch(() => []);
  const lastSync = lastSyncRows.length > 0 ? lastSyncRows[0].value as string : null;

  let imported = 0;
  let skipped = 0;
  const newLeads: string[] = [];

  // Fetch recent contacts sorted by dateAdded desc
  const res = await fetch(`${GHL_BASE}/contacts/?locationId=${LOCATION_ID}&limit=100&sortBy=date_added&order=desc`, {
    headers: {
      'Authorization': `Bearer ${ghlToken}`,
      'Version': '2021-07-28',
      'Accept': 'application/json',
    },
  });

  if (!res.ok) {
    return NextResponse.json({ error: `GHL API error: ${res.status}` }, { status: 500 });
  }

  const data = await res.json();
  const contacts = data.contacts ?? [];

  for (const c of contacts) {
    // Skip contacts older than last sync
    if (lastSync && c.dateAdded && new Date(c.dateAdded) <= new Date(lastSync)) {
      skipped++;
      continue;
    }

    const nom = `${(c.firstName ?? '')} ${(c.lastName ?? '')}`.trim() || 'Inconnu';
    const email = (c.email ?? '').trim().toLowerCase();
    const phone = (c.phone ?? '').trim();
    const city = (c.city ?? '').trim();
    const source = (c.source ?? 'ghl').trim();

    // Skip owners
    if (OWNER_EMAILS.includes(email)) { skipped++; continue; }
    // Skip no contact info
    if (!email && !phone) { skipped++; continue; }

    const temp = scoreTemperature({ email, phone, source });

    try {
      const result = await query(
        `INSERT INTO crm_leads (nom, telephone, email, ville, source, statut, temperature, notes)
         VALUES ($1, $2, $3, $4, $5, 'nouveau', $6, $7)
         ON CONFLICT (email) DO NOTHING
         RETURNING id`,
        [nom, phone, email || null, city, `ghl-${source}`, temp, `GHL sync ${new Date().toISOString().slice(0, 10)}`]
      );
      if (result.length > 0) {
        imported++;
        newLeads.push(`${nom} (${email || phone})`);

        // Immediately trigger Aria prospect for this lead
        const leadId = result[0].id;
        const base = process.env.NEXTAUTH_URL ?? 'https://novus-epoxy.vercel.app';
        await fetch(`${base}/api/leads/jason/prospect`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ADMIN_API_KEY ?? '' },
          body: JSON.stringify({ leadIds: [leadId] }),
        }).catch(() => {});
      } else {
        skipped++;
      }
    } catch {
      skipped++;
    }
  }

  // Update last sync time
  await query(
    `INSERT INTO kv_store (key, value) VALUES ('last_ghl_sync', $1) ON CONFLICT (key) DO UPDATE SET value = $1`,
    [new Date().toISOString()]
  ).catch(() => {});

  // Notify if new leads imported
  if (imported > 0) {
    await notifyTelegram(
      `📥 <b>Aria — ${imported} nouveau${imported > 1 ? 'x' : ''} lead${imported > 1 ? 's' : ''} GHL/Facebook</b>\n\n` +
      newLeads.map(l => `• ${l}`).join('\n') +
      `\n\n🚀 Pris en charge automatiquement par Aria.`
    );
  }

  return NextResponse.json({ ok: true, imported, skipped, total: imported + skipped });
}

// Also support GET for cron-job.org
export async function GET(req: NextRequest) {
  return POST(req);
}

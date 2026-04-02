import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const maxDuration = 60;

const OWNER_EMAILS = [
  'gestionnovusepoxy@gmail.com',
  'lanthierj6@gmail.com',
];

const GHL_BASE = 'https://services.leadconnectorhq.com';

function scoreTemperature(lead: { email?: string; phone?: string; source?: string }): 'chaud' | 'tiede' | 'froid' {
  let score = 0;
  if (lead.email) score += 2;
  if (lead.phone) score += 2;
  if (lead.source?.toLowerCase().includes('facebook')) score += 2;
  if (score >= 5) return 'chaud';
  if (score >= 3) return 'tiede';
  return 'froid';
}

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization')?.replace('Bearer ', '') ?? '';
  const adminKey = process.env.ADMIN_API_KEY ?? '';
  const cronSecret = process.env.CRON_SECRET ?? '';
  if (!authHeader || (authHeader !== adminKey && authHeader !== cronSecret)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const ghlToken = process.env.GHL_API_KEY;
  const locationId = '003PAOSBcNe5Dxdi42Kh';
  if (!ghlToken) {
    return NextResponse.json({ error: 'GHL_API_KEY missing' }, { status: 500 });
  }

  let imported = 0;
  let skipped = 0;
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const res = await fetch(`${GHL_BASE}/contacts/search`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${ghlToken}`,
        'Version': '2021-07-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ locationId, page, pageLimit: 100 }),
    });

    if (!res.ok) {
      return NextResponse.json({ error: `GHL API error: ${res.status}`, imported, skipped }, { status: 500 });
    }

    const data = await res.json();
    const contacts = data.contacts ?? [];

    for (const c of contacts) {
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
          [nom, phone, email || null, city, `ghl-${source}`, temp, `GHL sync ${new Date().toISOString().slice(0,10)}`]
        );
        if (result.length > 0) imported++;
        else skipped++;
      } catch {
        skipped++;
      }
    }

    hasMore = contacts.length === 100;
    page++;
  }

  return NextResponse.json({ ok: true, imported, skipped, total: imported + skipped });
}

import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

// GHL webhook — receives new contacts from GoHighLevel/Champfields
// Setup in GHL: Settings > Integrations > Webhooks > Add webhook
// URL: https://novus-epoxy.vercel.app/api/webhooks/ghl
// Events: ContactCreate

const OWNER_EMAILS = [
  'gestionnovusepoxy@gmail.com',
  'lanthierj6@gmail.com',
];

function scoreTemperature(lead: { email?: string; phone?: string; source?: string }): 'chaud' | 'tiede' | 'froid' {
  let score = 0;
  if (lead.email) score += 2;
  if (lead.phone) score += 2;
  if (lead.source === 'Facebook') score += 2; // Facebook leads = intent
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
  // Verify GHL webhook secret
  const ghlSecret = process.env.GHL_WEBHOOK_SECRET;
  const headerSecret = req.headers.get('x-webhook-secret') ?? req.nextUrl.searchParams.get('secret') ?? '';
  if (!ghlSecret || headerSecret !== ghlSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const type = body.type;

    // Only handle contact creation
    if (type !== 'ContactCreate') {
      return NextResponse.json({ ok: true, skipped: true, reason: `Event ${type} ignored` });
    }

    const firstName = (body.firstName ?? '').trim();
    const lastName = (body.lastName ?? '').trim();
    const nom = `${firstName} ${lastName}`.trim() || 'Inconnu';
    const email = (body.email ?? '').trim().toLowerCase();
    const phone = (body.phone ?? '').trim();
    const city = (body.city ?? '').trim();
    const source = (body.source ?? 'ghl').trim();
    const ghlId = body.id ?? '';

    // Skip owners
    if (OWNER_EMAILS.includes(email)) {
      return NextResponse.json({ ok: true, skipped: true, reason: 'owner' });
    }

    // Skip if no contact info
    if (!email && !phone) {
      return NextResponse.json({ ok: true, skipped: true, reason: 'no contact info' });
    }

    // Check duplicate by email
    if (email) {
      const existing = await query(
        `SELECT id FROM crm_leads WHERE email = $1 LIMIT 1`,
        [email]
      );
      if (existing.length > 0) {
        return NextResponse.json({ ok: true, skipped: true, reason: 'duplicate email' });
      }
    }

    const temp = scoreTemperature({ email, phone, source });

    await query(
      `INSERT INTO crm_leads (nom, telephone, email, ville, source, statut, temperature, notes)
       VALUES ($1, $2, $3, $4, $5, 'nouveau', $6, $7)
       ON CONFLICT (email) DO NOTHING`,
      [nom, phone, email, city, `ghl-${source}`, temp, `GHL ID: ${ghlId}`]
    );

    // Notify admins
    await notifyTelegram(
      `🔔 <b>Nouveau lead GHL</b>\n` +
      `👤 ${nom}\n` +
      `📧 ${email || 'N/A'}\n` +
      `📱 ${phone || 'N/A'}\n` +
      `📍 ${city || 'N/A'}\n` +
      `🏷 Source: ${source} | Temp: ${temp}\n` +
      `\nAria va le contacter automatiquement.`
    );

    return NextResponse.json({ ok: true, created: true, nom, temp });
  } catch (err) {
    console.error('GHL webhook error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// GHL also sends GET for webhook verification
export async function GET() {
  return NextResponse.json({ ok: true, service: 'novus-epoxy-ghl-webhook' });
}

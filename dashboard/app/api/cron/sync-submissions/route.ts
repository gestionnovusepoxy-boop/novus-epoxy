import { NextRequest, NextResponse } from 'next/server';
import { getAdminChatIds } from '@/lib/telegram-utils';
import { query } from '@/lib/db';
import { getQuebecHour } from '@/lib/timezone';

export const maxDuration = 30;

// Blacklisted emails — never sync these to CRM
const EMAIL_BLACKLIST = [
  'gestionnovusepoxy@gmail.com',
  'lanthierj6@gmail.com',
  'luca.hayes1994@gmail.com',
];

async function sendTelegram(text: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = getAdminChatIds()[0];
  if (!token || !chatId) return;
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
  }).catch(() => {});
}

function scoreTemperature(row: { email: string | null; telephone: string | null; service: string | null; surface_estimee: string | null }): string {
  const hasEmail = !!row.email;
  const hasPhone = !!row.telephone;
  const hasService = !!row.service;
  const hasSurface = !!row.surface_estimee;

  if (hasEmail && hasPhone && hasService && hasSurface) return 'chaud';
  return 'tiede';
}

export async function GET(req: NextRequest) {
  // Auth — same pattern as aria-prospect
  const authHeader = req.headers.get('authorization') ?? '';
  const token = authHeader.replace('Bearer ', '');
  const cronSecret = process.env.CRON_SECRET ?? '';
  const adminKey = process.env.ADMIN_API_KEY ?? '';
  if (!token || (token !== cronSecret && token !== adminKey)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Business hours only: 8h-20h Quebec (auto DST)
  const quebecHour = getQuebecHour();
  if (quebecHour < 8 || quebecHour >= 20) {
    return NextResponse.json({ ok: true, message: `Hors heures (${quebecHour}h). Prochain sync a 8h.` });
  }

  // Find unsynced submissions from the last 7 days
  const submissions = await query(
    `SELECT id, nom, email, telephone, service, message, surface_estimee
     FROM submissions
     WHERE statut = 'nouveau'
       AND created_at > NOW() - INTERVAL '7 days'
       AND email IS NOT NULL
       AND email != ''
     ORDER BY created_at ASC`
  );

  if (submissions.length === 0) {
    return NextResponse.json({ ok: true, message: 'Aucune soumission a synchroniser', synced: 0 });
  }

  let synced = 0;
  const syncedIds: number[] = [];

  for (const row of submissions) {
    const r = row as { id: number; nom: string; email: string; telephone: string | null; service: string | null; message: string | null; surface_estimee: string | null };

    // Skip blacklisted emails
    if (EMAIL_BLACKLIST.includes(r.email.toLowerCase().trim())) {
      continue;
    }

    // Check if email already exists in crm_leads
    const existing = await query(
      `SELECT id FROM crm_leads WHERE LOWER(email) = LOWER($1) LIMIT 1`,
      [r.email.trim()]
    );
    if (existing.length > 0) {
      // Mark as en_traitement so we don't re-check next run
      await query(`UPDATE submissions SET statut = 'en_traitement' WHERE id = $1`, [r.id]);
      continue;
    }

    const temperature = scoreTemperature(r);
    const noteParts = ['Formulaire site web'];
    if (r.service) noteParts.push(`Service: ${r.service}`);
    if (r.message) noteParts.push(`Message: ${r.message}`);
    const notes = noteParts.join(' — ');

    // Insert into crm_leads
    await query(
      `INSERT INTO crm_leads (nom, email, telephone, source, statut, temperature, notes, type)
       VALUES ($1, $2, $3, 'site-web', 'nouveau', $4, $5, 'residentiel')`,
      [
        r.nom,
        r.email.trim(),
        r.telephone ?? null,
        temperature,
        notes,
      ]
    );

    // Mark submission as synced
    await query(`UPDATE submissions SET statut = 'en_traitement' WHERE id = $1`, [r.id]);

    syncedIds.push(r.id);
    synced++;
  }

  // Notify Telegram if any were synced
  if (synced > 0) {
    await sendTelegram(
      `\ud83d\udccb <b>${synced} soumission${synced > 1 ? 's' : ''} site web synchronisee${synced > 1 ? 's' : ''} vers CRM</b>\n\n` +
      `Aria va les contacter automatiquement.`
    );
  }

  return NextResponse.json({ ok: true, synced, ids: syncedIds });
}

export async function POST(req: NextRequest) {
  return GET(req);
}

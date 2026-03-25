import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query as db } from '@/lib/db';

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const page   = Math.max(1, parseInt(searchParams.get('page')  ?? '1'));
  const limit  = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') ?? '25')));
  const offset = (page - 1) * limit;
  const statut = searchParams.get('statut');
  const search = searchParams.get('search');

  

  const conditions: string[] = [];
  const params: unknown[]    = [];
  let   idx                  = 1;

  if (statut && ['nouveau','lu','en_traitement','ferme'].includes(statut)) {
    conditions.push(`statut = $${idx++}`);
    params.push(statut);
  }
  if (search) {
    conditions.push(`(nom ILIKE $${idx} OR email ILIKE $${idx})`);
    params.push(`%${search}%`);
    idx++;
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const [countRow, rows] = await Promise.all([
    db(`SELECT COUNT(*)::int AS total FROM submissions ${where}`, params),
    db(
      `SELECT id, nom, email, telephone, service, message, ville, adresse, surface_estimee, type_projet, statut, created_at, updated_at
       FROM submissions ${where}
       ORDER BY created_at DESC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, limit, offset]
    ),
  ]);

  return NextResponse.json({
    data:  rows,
    total: (countRow[0] as { total: number }).total,
    page,
    limit,
  });
}

export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const id     = parseInt(new URL(req.url).searchParams.get('id') ?? '0');
  const body   = await req.json().catch(() => ({}));
  const statut = body.statut as string;

  if (!id || !['nouveau','lu','en_traitement','ferme'].includes(statut)) {
    return NextResponse.json({ error: 'Paramètres invalides' }, { status: 400 });
  }

  
  await db(`UPDATE submissions SET statut = $1 WHERE id = $2`, [statut, id]);

  return NextResponse.json({ ok: true });
}

async function notifyAdmins(nom: string, service: string, typeProjet: string, ville: string) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatIds = (process.env.TELEGRAM_ADMIN_CHAT_IDS ?? '').split(',').filter(Boolean);
  if (!botToken || chatIds.length === 0) return;

  const msg = `📋 *Nouvelle soumission!*\n\nClient: ${nom}\nService: ${service}\nType: ${typeProjet}\nVille: ${ville}\n\n[Voir les soumissions](https://novus-epoxy.vercel.app/dashboard/soumissions)`;
  await Promise.all(chatIds.map(chatId =>
    fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId.trim(), text: msg, parse_mode: 'Markdown' }),
    }).catch(() => {})
  ));
}

// Endpoint public pour recevoir les soumissions du formulaire de contact
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body?.nom || !body?.email) {
    return NextResponse.json({ error: 'Champs requis manquants' }, { status: 400 });
  }

  const ip     = req.headers.get('x-forwarded-for')?.split(',')[0] ?? '';
  const ua     = req.headers.get('user-agent') ?? '';
  const ipHash = await sha256(`${ip}${ua}${new Date().toISOString().slice(0, 10)}`);

  await db(
    `INSERT INTO submissions (nom, email, telephone, service, type_projet, adresse, surface_estimee, ville, ip_hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      body.nom.slice(0, 120),
      body.email.slice(0, 255),
      body.telephone?.slice(0, 30) ?? null,
      body.service?.slice(0, 80) ?? null,
      body.type_projet?.slice(0, 80) ?? null,
      body.adresse?.slice(0, 500) ?? null,
      body.surface_estimee?.slice(0, 50) ?? null,
      body.ville?.slice(0, 120) ?? null,
      ipHash,
    ]
  );

  // Notify admins via Telegram
  await notifyAdmins(
    body.nom,
    body.service ?? 'Non spécifié',
    body.type_projet ?? 'Non spécifié',
    body.ville ?? 'Non spécifié'
  );

  return NextResponse.json({ ok: true }, { status: 201 });
}

async function sha256(str: string): Promise<string> {
  const buf    = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

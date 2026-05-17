import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { escapeHtml } from '@/lib/utils';

// POST /api/admin/fb-leads-renotify
// Re-envoie les notifications Telegram pour les leads FB des X derniers jours
// Usage: POST avec header x-api-key + body { days: 7 }

export async function POST(req: NextRequest) {
  const apiKey = req.headers.get('x-api-key') ?? req.headers.get('authorization')?.replace('Bearer ', '');
  const expected = process.env.ADMIN_API_KEY;
  if (!expected || apiKey !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let days = 7;
  try {
    const body = await req.json();
    if (body.days) days = Number(body.days);
  } catch { /* default 7 days */ }

  // Récupère tous les leads FB des X derniers jours
  const leads = await query(
    `SELECT id, nom, email, telephone, service, superficie, ville, adresse, notes, created_at
     FROM crm_leads
     WHERE source IN ('facebook-zapier', 'facebook-leadad')
       AND created_at >= NOW() - INTERVAL '${days} days'
     ORDER BY created_at DESC`,
  );

  if (leads.length === 0) {
    return NextResponse.json({ ok: true, notified: 0, message: 'Aucun lead FB trouvé dans cette période' });
  }

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const groupId = (process.env.TELEGRAM_GROUP_CHAT_ID ?? '').trim();
  const adminIds = (process.env.TELEGRAM_ADMIN_CHAT_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean);
  const chatIds = groupId ? [groupId] : adminIds;

  if (!botToken || chatIds.length === 0) {
    return NextResponse.json({ error: 'Telegram non configuré' }, { status: 500 });
  }

  // Envoie d'abord un message d'intro
  const intro = [
    `📣 <b>Leads Facebook manqués — ${days} derniers jours</b>`,
    ``,
    `${leads.length} lead${leads.length > 1 ? 's' : ''} retrouvé${leads.length > 1 ? 's' : ''} dans la base de données.`,
    `<i>Ces leads sont déjà dans ton CRM — contacts à faire!</i>`,
  ].join('\n');

  for (const chatId of chatIds) {
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: intro, parse_mode: 'HTML' }),
    }).catch(() => {});
  }

  // Envoie chaque lead individuellement
  let notified = 0;
  for (const lead of leads) {
    const d = new Date(String(lead.created_at));
    const dateStr = d.toLocaleDateString('fr-CA', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

    const SERVICE_LABELS: Record<string, string> = {
      flake: 'Flocon (Flake)', metallique: 'Métallique', couleur_unie: 'Couleur unie',
      quartz: 'Quartz', commercial: 'Commercial', antiderapant: 'Antidérapant',
      meulage: 'Meulage', vinyl_click: 'Vinyl Click',
    };
    const serviceLabel = lead.service ? (SERVICE_LABELS[lead.service as string] ?? String(lead.service)) : null;

    const lines = [
      `🔥 <b>LEAD FACEBOOK — ${escapeHtml(dateStr)}</b>`,
      ``,
      `👤 <b>${escapeHtml(String(lead.nom))}</b>`,
      lead.telephone ? `📞 <a href="tel:${escapeHtml(String(lead.telephone))}">${escapeHtml(String(lead.telephone))}</a>` : '',
      lead.email ? `📧 ${escapeHtml(String(lead.email))}` : '',
      serviceLabel ? `🔧 ${escapeHtml(serviceLabel)}` : '',
      lead.superficie ? `📐 ${escapeHtml(String(lead.superficie))} pi²` : '',
      lead.ville ? `🏠 ${escapeHtml(String(lead.ville))}` : '',
      lead.adresse ? `📍 ${escapeHtml(String(lead.adresse))}` : '',
      ``,
      `⚠️ <i>Lead déjà dans CRM — contacte-le!</i>`,
    ].filter(Boolean);

    for (const chatId of chatIds) {
      await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: lines.join('\n'),
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [[
              { text: '📋 Voir dans CRM', url: 'https://novus-epoxy.vercel.app/dashboard/crm' },
            ]],
          },
        }),
      }).catch(() => {});
    }
    notified++;
    // Petit délai pour éviter rate limit Telegram
    await new Promise(r => setTimeout(r, 300));
  }

  // Diagnostic du problème
  const metaToken = process.env.META_PAGE_TOKEN;
  let metaStatus = 'META_PAGE_TOKEN manquant';
  if (metaToken) {
    try {
      const r = await fetch(`https://graph.facebook.com/v25.0/me?access_token=${metaToken}`);
      const d = await r.json();
      metaStatus = d.error ? `❌ Token expiré: ${d.error.message}` : `✅ Token valide (${d.name ?? d.id})`;
    } catch {
      metaStatus = '❌ Erreur réseau Meta API';
    }
  }

  return NextResponse.json({
    ok: true,
    notified,
    leads_found: leads.length,
    days,
    meta_token_status: metaStatus,
  });
}

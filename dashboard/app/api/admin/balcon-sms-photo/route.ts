import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { sendSMS } from '@/lib/sms';
import { escapeHtml } from '@/lib/utils';

// POST /api/admin/balcon-sms-photo
// Trouve tous les leads FB avec espace balcon/patio/escalier sans devis
// Envoie SMS demande de photo + notifie Telegram groupe

export async function POST(req: NextRequest) {
  const apiKey = req.headers.get('x-api-key') ?? req.headers.get('authorization')?.replace('Bearer ', '');
  if (!process.env.ADMIN_API_KEY || apiKey !== process.env.ADMIN_API_KEY) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let days = 30;
  try { const b = await req.json(); if (b.days) days = Number(b.days); } catch { /* default */ }

  // Leads avec espace balcon/patio/escalier OU service antiderapant, sans devis envoyé
  const leads = await query(
    `SELECT l.id, l.nom, l.telephone, l.email, l.service, l.superficie, l.adresse, l.ville, l.notes, l.source, l.created_at
     FROM crm_leads l
     WHERE l.source IN ('facebook-leadad', 'facebook-zapier')
       AND l.statut NOT IN ('devis_envoye', 'ferme', 'complete')
       AND l.created_at >= NOW() - INTERVAL '${days} days'
       AND l.telephone IS NOT NULL
       AND (
         l.notes ILIKE '%balcon%' OR l.notes ILIKE '%patio%' OR l.notes ILIKE '%escalier%' OR l.notes ILIKE '%marche%'
         OR l.service = 'antiderapant'
         OR l.adresse ILIKE '%balcon%'
       )
     ORDER BY l.created_at DESC`
  );

  if (leads.length === 0) {
    return NextResponse.json({ ok: true, message: 'Aucun lead balcon/patio trouvé', found: 0 });
  }

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const groupId = (process.env.TELEGRAM_GROUP_CHAT_ID ?? '').trim();
  const adminIds = (process.env.TELEGRAM_ADMIN_CHAT_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean);
  const chatIds = groupId ? [groupId] : adminIds;

  let smsSent = 0;
  let telegramSent = 0;

  for (const lead of leads) {
    const nom = String(lead.nom ?? 'Client');
    const prenom = nom.split(' ')[0];
    const tel = String(lead.telephone ?? '');

    // SMS au client demandant une photo
    const smsMsg = `Salut ${prenom}! C'est Luca de Novus Epoxy. Pour te préparer une soumission précise pour ton projet, pourrais-tu m'envoyer quelques photos de l'espace? Réponds à ce texto ou envoie-les au 581-307-5983. Merci!`;

    const sent = await sendSMS(tel, smsMsg).catch(() => false);
    if (sent) smsSent++;

    // Notifier sur Telegram groupe
    if (botToken && chatIds.length) {
      const d = new Date(String(lead.created_at));
      const dateStr = d.toLocaleDateString('fr-CA', { weekday: 'short', day: 'numeric', month: 'short' });

      const lines = [
        `📸 <b>BALCON/PATIO — Photo demandée</b>`,
        ``,
        `👤 <b>${escapeHtml(nom)}</b> — ${escapeHtml(dateStr)}`,
        `📞 <a href="tel:${escapeHtml(tel)}">${escapeHtml(tel)}</a>`,
        lead.email ? `📧 ${escapeHtml(String(lead.email))}` : '',
        lead.adresse ? `📍 ${escapeHtml(String(lead.adresse))}` : lead.ville ? `🏠 ${escapeHtml(String(lead.ville))}` : '',
        ``,
        sent ? `✅ SMS envoyé — en attente de la photo` : `⚠️ SMS échoué — appelle manuellement`,
        `<i>Quand tu reçois la photo, dis-moi le prix et je crée le devis.</i>`,
      ].filter(Boolean);

      await Promise.all(chatIds.map(id =>
        fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: id,
            text: lines.join('\n'),
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [[
                { text: '📋 Voir CRM', url: `https://novus-epoxy.vercel.app/dashboard/crm` },
              ]],
            },
          }),
        }).catch(() => {})
      ));
      telegramSent++;
      await new Promise(r => setTimeout(r, 300));
    }

    // Marquer comme contacté dans CRM
    await query(
      `UPDATE crm_leads SET statut = 'contacte', updated_at = NOW() WHERE id = $1`,
      [lead.id]
    ).catch(() => {});
  }

  return NextResponse.json({ ok: true, found: leads.length, sms_sent: smsSent, telegram_sent: telegramSent });
}

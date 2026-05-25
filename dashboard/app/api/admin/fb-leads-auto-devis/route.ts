import { NextRequest, NextResponse } from 'next/server';
import { getAdminChatIds } from '@/lib/telegram-utils';
import { query } from '@/lib/db';
import { calculateQuote, formatMoney, type ServiceType } from '@/lib/pricing';
import { escapeHtml } from '@/lib/utils';

// POST /api/admin/fb-leads-auto-devis
// 1. Trouve tous les leads FB sans devis (statut != devis_envoye/ferme/complete)
// 2. Crée un devis brouillon pour ceux qui ont service + superficie
// 3. Envoie tout sur Telegram groupe pour approbation rapide

export async function POST(req: NextRequest) {
  const apiKey = req.headers.get('x-api-key') ?? req.headers.get('authorization')?.replace('Bearer ', '');
  if (!process.env.ADMIN_API_KEY || apiKey !== process.env.ADMIN_API_KEY) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let days = 30;
  try { const b = await req.json(); if (b.days) { days = Number(b.days); if (isNaN(days) || days < 1 || days > 365) days = 30; } } catch { /* default */ }

  // Leads FB sans devis envoyé
  const leads = await query(
    `SELECT l.id, l.nom, l.email, l.telephone, l.service, l.superficie, l.ville, l.adresse, l.notes, l.source, l.created_at
     FROM crm_leads l
     WHERE l.source IN ('facebook-leadad', 'facebook-zapier')
       AND l.statut NOT IN ('devis_envoye', 'ferme', 'complete')
       AND l.created_at >= NOW() - INTERVAL '${days} days'
     ORDER BY l.created_at DESC`
  );

  if (leads.length === 0) {
    return NextResponse.json({ ok: true, message: 'Aucun lead FB sans devis', leads_found: 0 });
  }

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const groupId = (process.env.TELEGRAM_GROUP_CHAT_ID ?? '').trim();
  const adminIds = getAdminChatIds();
  const chatIds = groupId ? [groupId] : adminIds;

  const VALID_SERVICES: ServiceType[] = ['flake', 'metallique', 'couleur_unie', 'quartz', 'commercial', 'antiderapant', 'meulage', 'vinyl_click'];
  const SERVICE_LABELS: Record<string, string> = {
    flake: 'Flocon (Flake)', metallique: 'Métallique', couleur_unie: 'Couleur unie',
    quartz: 'Quartz', commercial: 'Commercial', antiderapant: 'Antidérapant',
    meulage: 'Meulage', vinyl_click: 'Vinyl Click',
  };

  let devisCreated = 0;
  let telegramSent = 0;

  // Intro
  if (botToken && chatIds.length) {
    await Promise.all(chatIds.map(id =>
      fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: id,
          text: `📋 <b>${leads.length} leads Facebook sans devis</b>\n\nJe te prépare les devis — approuve ou refuse chaque fiche.`,
          parse_mode: 'HTML',
        }),
      }).catch(() => {})
    ));
  }

  for (const lead of leads) {
    const nom = String(lead.nom ?? 'Client');
    const email = String(lead.email ?? '');
    const tel = String(lead.telephone ?? '');
    const service = String(lead.service ?? '');
    const superficieRaw = String(lead.superficie ?? '');
    const surf = parseFloat(superficieRaw);
    const adresse = String(lead.adresse ?? '');
    const ville = String(lead.ville ?? '');
    const serviceLabel = SERVICE_LABELS[service] ?? service;

    let quoteId: number | null = null;
    let quoteTotal: number | null = null;

    // Créer devis si service valide + superficie connue + aucun devis existant pour ce lead
    if (VALID_SERVICES.includes(service as ServiceType) && !isNaN(surf) && surf > 0) {
      try {
        // Vérifier si un devis existe déjà pour ce lead (par email ou par notes contenant le lead ID)
        const existingQuote = await query(
          `SELECT id FROM quotes WHERE notes LIKE $1 OR (client_email = $2 AND client_email IS NOT NULL AND client_email != '') LIMIT 1`,
          [`%Lead Facebook #${lead.id}%`, email || 'NOEMAIL']
        );
        if (existingQuote.length > 0) {
          quoteId = existingQuote[0].id as number;
          quoteTotal = null; // already exists, don't show total
          telegramSent++; // still notify
          continue; // skip creation
        }

        const calc = calculateQuote(service as ServiceType, surf);
        const rows = await query(
          `INSERT INTO quotes (client_nom, client_email, client_tel, client_adresse, type_service, superficie,
           prix_pied_carre, sous_total, tps, tvq, total, depot_requis, statut, notes)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'brouillon',$13) RETURNING id`,
          [
            nom, email || null, tel || null, adresse || null,
            service, surf, calc.prix_pied_carre,
            calc.sous_total, calc.tps, calc.tvq, calc.total, calc.depot_requis,
            `Lead Facebook #${lead.id} — ${lead.source}`,
          ]
        );
        quoteId = (rows[0] as { id: number })?.id ?? null;
        quoteTotal = calc.total;
        if (quoteId) {
          await query(`UPDATE crm_leads SET statut = 'interesse', updated_at = NOW() WHERE id = $1`, [lead.id]);
          devisCreated++;
        }
      } catch { /* skip if quote creation fails */ }
    }

    // Envoyer sur Telegram
    if (botToken && chatIds.length) {
      const d = new Date(String(lead.created_at));
      const dateStr = d.toLocaleDateString('fr-CA', { weekday: 'short', day: 'numeric', month: 'short' });

      const lines = [
        `🔥 <b>${escapeHtml(nom)}</b> — ${escapeHtml(dateStr)}`,
        tel ? `📞 <a href="tel:${escapeHtml(tel)}">${escapeHtml(tel)}</a>` : '',
        email ? `📧 ${escapeHtml(email)}` : '',
        serviceLabel ? `🔧 ${escapeHtml(serviceLabel)}` : '',
        !isNaN(surf) && surf > 0 ? `📐 ${surf} pi²` : '📐 Superficie inconnue',
        adresse ? `📍 ${escapeHtml(adresse)}` : ville ? `🏠 ${escapeHtml(ville)}` : '',
        quoteId && quoteTotal
          ? `\n💰 <b>Devis #${quoteId} créé — ${formatMoney(quoteTotal)}</b>`
          : '\n⚠️ <i>Superficie/service manquant — devis manuel requis</i>',
      ].filter(Boolean);

      const buttons: Record<string, unknown>[] = [];
      if (quoteId) {
        buttons.push({ text: '✅ Approuver & Envoyer', url: `https://novus-epoxy.vercel.app/dashboard/devis/${quoteId}` });
      }
      buttons.push({ text: '📋 Voir CRM', url: `https://novus-epoxy.vercel.app/dashboard/crm` });

      await Promise.all(chatIds.map(id =>
        fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: id,
            text: lines.join('\n'),
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: [buttons] },
          }),
        }).catch(() => {})
      ));
      telegramSent++;
      await new Promise(r => setTimeout(r, 300));
    }
  }

  return NextResponse.json({
    ok: true,
    leads_found: leads.length,
    devis_created: devisCreated,
    telegram_sent: telegramSent,
  });
}

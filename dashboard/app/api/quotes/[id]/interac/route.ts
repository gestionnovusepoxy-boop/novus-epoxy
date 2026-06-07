import { getAdminChatIds } from '@/lib/telegram-utils';
import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { formatMoney } from '@/lib/pricing';
import { escapeHtml } from '@/lib/utils';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const token = req.nextUrl.searchParams.get('token');
  if (!token) return NextResponse.json({ error: 'Token requis' }, { status: 403 });

  const quoteId = parseInt(id);
  const rows = await query('SELECT * FROM quotes WHERE id = $1 AND secret_token = $2', [quoteId, token]);
  const quote = rows[0];
  if (!quote) return NextResponse.json({ error: 'Devis introuvable' }, { status: 404 });

  const allowedStatuts = ['contrat_signe', 'depot_paye', 'planifie', 'complete'];
  if (!allowedStatuts.includes(quote.statut as string)) {
    return NextResponse.json({ error: 'Le contrat doit etre signe avant de payer' }, { status: 400 });
  }

  const depotAmount = formatMoney(Number(quote.depot_requis));
  const clientNom = escapeHtml(quote.client_nom as string);

  // Notify admins on Telegram — UNE SEULE FOIS par jour (les liens sont prefetch/refresh par les
  // clients et webmails, ce qui spammait le groupe + risquait des "Confirmer dépôt" accidentels).
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const groupId = (process.env.TELEGRAM_GROUP_CHAT_ID ?? '').trim();
  const adminIds = getAdminChatIds();
  const chatIds = groupId ? [groupId] : adminIds;
  const today = new Date().toISOString().split('T')[0];
  const alertKey = `interac_alert_${quoteId}`;
  const lastAlert = await query(`SELECT value FROM kv_store WHERE key = $1`, [alertKey]).catch(() => []);
  const alreadyAlerted = lastAlert.length > 0 && String(lastAlert[0].value ?? '').includes(today);
  if (botToken && !alreadyAlerted) {
    await query(
      `INSERT INTO kv_store (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2`,
      [alertKey, JSON.stringify({ alerted_at: today })]
    ).catch(() => {});
    const tgMsg = [
      `💸 <b>Virement Interac en route!</b>`,
      ``,
      `👤 ${clientNom} (${escapeHtml(quote.client_email as string)})`,
      `💰 Montant attendu: <b>${depotAmount}</b> (depot 30%)`,
      `📋 Devis #${quoteId}`,
      ``,
      `⚠️ Restez attentif — un virement Interac va arriver a gestionnovusepoxy@gmail.com`,
    ].join('\n');

    const buttons = {
      inline_keyboard: [
        [{ text: '✅ Paiement recu — Confirmer', callback_data: `confirm_deposit_${quoteId}` }],
        [{ text: '📋 Voir le devis', url: `https://novus-epoxy.vercel.app/dashboard/devis` }],
      ],
    };

    await Promise.all(chatIds.map(chatId =>
      fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId.trim(), text: tgMsg, parse_mode: 'HTML', reply_markup: buttons }),
      }).catch(() => {})
    ));
  }

  // Return a nice confirmation page to the client
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Virement Interac — Novus Epoxy</title></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:sans-serif;">
<div style="max-width:500px;margin:40px auto;padding:24px;">
<div style="text-align:center;margin-bottom:24px;">
<img src="https://novus-epoxy.vercel.app/logo-email.jpg" alt="Novus Epoxy" width="80" height="80" style="border-radius:8px;" />
</div>
<div style="background:white;border-radius:12px;padding:32px;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
<div style="text-align:center;margin-bottom:20px;">
<div style="background:#f0fdf4;border-radius:50%;width:64px;height:64px;display:inline-flex;align-items:center;justify-content:center;font-size:32px;">✅</div>
</div>
<h1 style="text-align:center;color:#1e293b;font-size:22px;margin:0 0 8px;">Merci, ${clientNom}!</h1>
<p style="text-align:center;color:#64748b;margin:0 0 24px;">Notre equipe a ete notifiee de votre virement.</p>
<div style="background:#fffbeb;border:1px solid #f59e0b;border-radius:8px;padding:20px;margin-bottom:20px;">
<p style="margin:0 0 8px;color:#92400e;font-weight:700;font-size:16px;">Instructions de virement :</p>
<p style="margin:0 0 6px;color:#1e293b;">Envoyez <strong>${depotAmount}</strong> par virement Interac a :</p>
<p style="margin:0;background:white;padding:12px;border-radius:6px;text-align:center;font-weight:700;font-size:16px;color:#0f172a;letter-spacing:0.5px;">gestionnovusepoxy@gmail.com</p>
</div>
<div style="background:#f1f5f9;border-radius:8px;padding:16px;">
<p style="margin:0 0 4px;color:#475569;font-size:13px;">📋 Reference: <strong>Devis #${quoteId}</strong></p>
<p style="margin:0 0 4px;color:#475569;font-size:13px;">💰 Montant: <strong>${depotAmount}</strong></p>
<p style="margin:0;color:#475569;font-size:13px;">⏳ Vos dates seront confirmees des reception du paiement</p>
</div>
</div>
<div style="text-align:center;margin-top:20px;color:#94a3b8;font-size:12px;">
<p>Questions? Appelez-nous :</p>
<p><strong>Luca</strong> (facturation) : <a href="tel:5813075983" style="color:#f59e0b;">581-307-5983</a></p>
<p><strong>Jason</strong> (chantier) : <a href="tel:5813072678" style="color:#f59e0b;">581-307-2678</a></p>
</div>
</div></body></html>`;

  return new NextResponse(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

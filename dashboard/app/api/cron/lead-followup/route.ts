import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { sendEmail } from '@/lib/send-email';

const ANTHROPIC_KEY = () => process.env.ANTHROPIC_API_KEY ?? '';
const BOT_TOKEN = () => process.env.TELEGRAM_BOT_TOKEN ?? '';
const ADMIN_CHAT_IDS = () =>
  (process.env.TELEGRAM_ADMIN_CHAT_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean);

async function sendTelegram(chatId: string, text: string) {
  const token = BOT_TOKEN();
  if (!token) return;
  const chunks = text.match(/[\s\S]{1,4000}/g) ?? [text];
  for (const chunk of chunks) {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: chunk, parse_mode: 'HTML' }),
    });
  }
}

export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization') ?? '';
  const token = authHeader.replace('Bearer ', '');
  const cronSecret = process.env.CRON_SECRET ?? '';
  const adminKey = process.env.ADMIN_API_KEY ?? '';
  if (!token || (token !== cronSecret && token !== adminKey)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // 1. Find leads ready for follow-up
  const leads = await query(
    `SELECT id, nom, email, service, superficie
     FROM crm_leads
     WHERE statut = 'contacte'
       AND email IS NOT NULL
       AND TRIM(email) != ''
       AND last_agent_reply_at < NOW() - INTERVAL '4 days'
       AND COALESCE(followup_count, 0) < 2`
  );

  let sent = 0;
  let marquesFroid = 0;

  for (const lead of leads as Array<{ id: number; nom: string; email: string; service: string | null; superficie: string | null }>) {
    try {
      // 2. Generate warm follow-up email with Claude Haiku
      const haikuRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': ANTHROPIC_KEY(),
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 400,
          messages: [{
            role: 'user',
            content: `Génère un email de suivi chaleureux en français (max 120 mots) pour un lead qui n'a pas répondu depuis 4 jours. Nom: ${lead.nom}. Service d'intérêt: ${lead.service || 'plancher époxy'}. Rappelle qu'on est disponibles pour un estimé gratuit. Offre: formulaire novusepoxy.ca/#contact, appeler Luca 581-307-5983 ou Jason 581-307-2678. Signe: L'équipe Novus Epoxy. Réponds avec juste le texte de l'email, pas de JSON.`,
          }],
        }),
      });

      if (!haikuRes.ok) continue;

      const haikuData = await haikuRes.json();
      const followupText = (haikuData.content?.[0]?.text ?? '').trim();
      if (!followupText) continue;

      // 3. Send via Gmail
      const followupHtml =`<div style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;max-width:600px;margin:0 auto;background:#ffffff;">
        <div style="background:#0f172a;padding:24px;text-align:center;border-radius:8px 8px 0 0;">
          <img src="https://novus-epoxy.vercel.app/logo-email.jpg" alt="Novus Epoxy" width="80" height="80" style="border-radius:12px;" />
          <h1 style="color:#f59e0b;margin:12px 0 0;font-size:22px;font-weight:700;">Novus Epoxy</h1>
          <p style="color:#94a3b8;margin:4px 0 0;font-size:13px;">Planchers époxy haut de gamme — Québec</p>
        </div>
        <div style="padding:24px;">
          <p style="color:#1e293b;line-height:1.6;">${followupText.replace(/\n/g, '<br/>')}</p>
          <div style="text-align:center;margin:20px 0;">
            <a href="https://novusepoxy.ca/#contact" style="display:inline-block;background:#f59e0b;color:#0f172a;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:700;">Obtenir mon estimé gratuit</a>
          </div>
          <div style="border-top:1px solid #e2e8f0;padding:16px 0 0;margin-top:20px;">
            <p style="color:#1e293b;font-weight:700;font-size:13px;margin:0 0 6px;">Une question? On est là pour vous.</p>
            <p style="color:#475569;font-size:13px;margin:0 0 2px;"><strong>Luca</strong> — Facturation / Soumission — <a href="tel:5813075983" style="color:#2563eb;">581-307-5983</a></p>
            <p style="color:#475569;font-size:13px;margin:0;"><strong>Jason</strong> — Chantier / Soumission — <a href="tel:5813072678" style="color:#2563eb;">581-307-2678</a></p>
          </div>
        </div>
        <div style="background:#f1f5f9;padding:12px 24px;text-align:center;border-radius:0 0 8px 8px;">
          <p style="color:#94a3b8;font-size:11px;margin:0;">Novus Epoxy — 44 rue de la Polyvalente, Québec, G2N 1G8</p>
        </div>
      </div>`;

      try {
        await sendEmail({ to: lead.email as string, subject: `On pense à vous — Novus Epoxy`, html: followupHtml });
      } catch { continue; }

      // 4. Update followup_count and last_agent_reply_at
      const newCount = await query(
        `UPDATE crm_leads
         SET followup_count = COALESCE(followup_count, 0) + 1,
             last_agent_reply_at = NOW(),
             updated_at = NOW()
         WHERE id = $1
         RETURNING followup_count`,
        [lead.id]
      );

      sent++;

      // 5. Mark as froid if followup_count >= 2
      const updatedCount = (newCount[0] as { followup_count: number }).followup_count;
      if (updatedCount >= 2) {
        await query(
          `UPDATE crm_leads SET statut = 'froid', updated_at = NOW() WHERE id = $1`,
          [lead.id]
        );
        marquesFroid++;
      }
    } catch {
      continue;
    }
  }

  // Notify admins if anything happened
  if (sent > 0) {
    for (const chatId of ADMIN_CHAT_IDS()) {
      await sendTelegram(chatId, [
        `📬 <b>Suivi automatique leads CRM</b>`,
        ``,
        `✅ Emails envoyes: ${sent}`,
        marquesFroid > 0 ? `❄️ Passes en froid: ${marquesFroid}` : '',
        ``,
        `https://novus-epoxy.vercel.app/dashboard/crm`,
      ].filter(Boolean).join('\n')).catch(() => {});
    }
  }

  return NextResponse.json({ sent, marques_froid: marquesFroid });
}

export async function POST(req: NextRequest) {
  return GET(req);
}

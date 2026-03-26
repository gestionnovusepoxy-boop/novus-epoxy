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

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization') ?? '';
  const token = authHeader.replace('Bearer ', '');
  const cronSecret = process.env.CRON_SECRET ?? '';
  const adminKey = process.env.ADMIN_API_KEY ?? '';
  if ((cronSecret || adminKey) && token !== cronSecret && token !== adminKey) {
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
            content: `Genere un email de suivi chaleureux en francais (max 120 mots) pour un lead qui n'a pas repondu depuis 4 jours. Nom: ${lead.nom}. Service d'interet: ${lead.service || 'plancher epoxy'}. Rappelle qu'on est disponibles pour un estimé gratuit. Offre: formulaire novusepoxy.ca/#contact, appeler Luca 581-307-5983 ou Jason 581-307-2678. Signe: L'equipe Novus Epoxy. Reponds avec juste le texte de l'email, pas de JSON.`,
          }],
        }),
      });

      if (!haikuRes.ok) continue;

      const haikuData = await haikuRes.json();
      const followupText = (haikuData.content?.[0]?.text ?? '').trim();
      if (!followupText) continue;

      // 3. Send via Gmail
      const followupHtml =`<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:0;">
        <div style="background:#0f172a;padding:16px 24px;border-radius:8px 8px 0 0;">
          <img src="https://novus-epoxy.vercel.app/logo.jpg" alt="Novus Epoxy" style="height:40px;" />
        </div>
        <div style="padding:24px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px;">
          <p style="color:#1e293b;line-height:1.6;">${followupText.replace(/\n/g, '<br/>')}</p>
          <div style="text-align:center;margin:20px 0;">
            <a href="https://novusepoxy.ca/#contact" style="display:inline-block;background:#f59e0b;color:#0f172a;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:700;">Obtenir mon estimé gratuit</a>
          </div>
          <hr style="border:none;border-top:1px solid #e2e8f0;margin:20px 0;" />
          <p style="color:#64748b;font-size:12px;margin:0;">
            Novus Epoxy — Planchers epoxy haut de gamme<br/>
            RBQ 5861-8471-01 | Garantie 10 ans | 15 ans d'experience<br/>
            581-307-5983 (Luca) | 581-307-2678 (Jason) | <a href="https://novusepoxy.ca" style="color:#f59e0b;">novusepoxy.ca</a>
          </p>
        </div>
      </div>`;

      try {
        await sendEmail({ to: lead.email as string, subject: `On pense a vous — Novus Epoxy`, html: followupHtml });
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

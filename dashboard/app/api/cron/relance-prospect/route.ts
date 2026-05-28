import { getQuebecHour } from '@/lib/timezone';
import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { sendProspectEmail } from '@/lib/send-prospect-email';
import pLimit from 'p-limit';

// Bumped from 60 → 300 to absorb sequential LLM/email calls on busy days.
// Vercel Pro plan supports up to 300s; on Hobby this silently caps at 60s but never fails the deploy.
export const maxDuration = 300;

// Hard cap per run so we never blow past Gmail's daily sending limit (~500 free / 2000 Workspace).
// Remaining prospects roll over to the next run.
const MAX_PER_RUN = 80;

async function alertOnce(key: string, text: string) {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const dedupKey = `${key}_${today}`;
    const existing = (await query('SELECT 1 FROM kv_store WHERE key = $1', [dedupKey])) as unknown[];
    if (existing.length > 0) return;
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chat = process.env.TELEGRAM_GROUP_CHAT_ID;
    if (token && chat) {
      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chat, text, parse_mode: 'HTML' }),
      }).catch(() => {});
    }
    await query(
      `INSERT INTO kv_store (key, value) VALUES ($1, $2::jsonb) ON CONFLICT (key) DO NOTHING`,
      [dedupKey, JSON.stringify({ at: new Date().toISOString() })]
    );
  } catch { /* never block the cron on alert delivery */ }
}

// Aria follow-up on Hunter prospect emails
// Relance 1: 48h after prospect sent
// Relance 2: 5 days after prospect sent
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')?.replace('Bearer ', '') ?? '';
  const cronSecret = process.env.CRON_SECRET ?? '';
  const adminKey = process.env.ADMIN_API_KEY ?? '';
  if (!authHeader || (authHeader !== cronSecret && authHeader !== adminKey)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Only run during business hours (8h-20h Quebec)
  const _h = getQuebecHour();
  if (_h < 8 || _h >= 20) return NextResponse.json({ skipped: "outside business hours" });

  // Short-circuit if Gmail OAuth is known-broken — sending would throw 3510x silently.
  // Alert Luca once per day so he re-auths instead of prospects going dark.
  const oauthBroken = (await query(
    `SELECT value FROM kv_store WHERE key = 'gmail_oauth_broken'`
  )) as Array<{ value: unknown }>;
  if (oauthBroken[0] && String(oauthBroken[0].value).includes('true')) {
    await alertOnce(
      'relance_prospect_oauth',
      '🚨 relance-prospect SKIP — Gmail OAuth invalide. Aucune relance envoyée. Re-auth requis (/api/auth/google).'
    );
    return NextResponse.json({ skipped: 'gmail_oauth_broken' });
  }

  // Relance 1: prospect sent 48h+ ago, still nouveau/contacte, no relance_1
  const r1 = await query(
    `SELECT id, nom, email, notes, service, type FROM crm_leads
     WHERE prospect_sent_at IS NOT NULL
       AND prospect_sent_at <= NOW() - INTERVAL '48 hours'
       AND prospect_relance_1_at IS NULL
       AND statut IN ('nouveau', 'contacte', 'offre_envoyee')
       AND email IS NOT NULL AND email != ''
       AND NOT EXISTS (
         SELECT 1 FROM email_logs
         WHERE destinataire = crm_leads.email
           AND created_at > NOW() - INTERVAL '48 hours'
       )`,
    [],
  );

  // Relance 2: prospect sent 5d+ ago, relance_1 done, no relance_2
  const r2 = await query(
    `SELECT id, nom, email, notes, service, type FROM crm_leads
     WHERE prospect_sent_at IS NOT NULL
       AND prospect_relance_1_at <= NOW() - INTERVAL '5 days'
       AND prospect_relance_1_at IS NOT NULL
       AND prospect_relance_2_at IS NULL
       AND statut IN ('nouveau', 'contacte', 'offre_envoyee')
       AND email IS NOT NULL AND email != ''
       AND NOT EXISTS (
         SELECT 1 FROM email_logs
         WHERE destinataire = crm_leads.email
           AND created_at > NOW() - INTERVAL '48 hours'
       )`,
    [],
  );

  let sent1 = 0, sent2 = 0, errors = 0;

  // Cap total sends this run to respect Gmail limits. Relance 1 has priority over relance 2.
  const r1capped = r1.slice(0, MAX_PER_RUN);
  const r2capped = r2.slice(0, Math.max(0, MAX_PER_RUN - r1capped.length));

  // Concurrency cap = 5 so we don't hammer the LLM/email provider but still finish under maxDuration.
  const limit = pLimit(5);

  await Promise.all(r1capped.map((lead) => limit(async () => {
    const prenom = (lead.nom as string).split(' ')[0];
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:0;background:#f8fafc;">
<div style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;max-width:600px;margin:0 auto;background:#ffffff;">
<div style="background:#0f172a;padding:24px;text-align:center;border-radius:8px 8px 0 0;">
  <img src="https://novus-epoxy.vercel.app/logo-email.jpg" alt="Novus Epoxy" width="80" height="80" style="border-radius:12px;" />
  <h1 style="color:#f59e0b;margin:12px 0 0;font-size:22px;font-weight:700;">Novus Epoxy</h1>
  <p style="color:#94a3b8;margin:4px 0 0;font-size:13px;">Planchers époxy haut de gamme — Québec</p>
</div>
<div style="padding:24px;">
<p>Bonjour ${prenom},</p>
<p>On vous a envoyé une présentation de nos services de planchers époxy récemment. On voulait s'assurer que vous l'avez bien reçue!</p>
<p>Si vous avez des questions sur votre projet ou si vous aimeriez une soumission gratuite, on peut vous en préparer une <strong>en moins d'une heure</strong>.</p>
<p>Répondez simplement à ce courriel ou appelez-nous:</p>
<div style="border-top:1px solid #e2e8f0;padding:16px 0 0;margin-top:20px;">
  <p style="color:#1e293b;font-weight:700;font-size:13px;margin:0 0 6px;">Une question? On est là pour vous.</p>
  <p style="color:#475569;font-size:13px;margin:0 0 2px;"><strong>Luca</strong> — Facturation / Soumission — <a href="tel:5813075983" style="color:#2563eb;">581-307-5983</a></p>
  <p style="color:#475569;font-size:13px;margin:0;"><strong>Jason</strong> — Chantier / Soumission — <a href="tel:5813072678" style="color:#2563eb;">581-307-2678</a></p>
</div>
<p>Bonne journée!<br/><strong>L'équipe Novus Epoxy</strong></p>
</div>
<div style="background:#f1f5f9;padding:12px 24px;text-align:center;border-radius:0 0 8px 8px;">
  <p style="color:#94a3b8;font-size:11px;margin:0;">Novus Epoxy — 44 rue de la Polyvalente, Québec, G2N 1G8</p>
</div>
<div style="text-align:center;padding:12px;background:#f8fafc;">
  <p style="color:#94a3b8;font-size:11px;margin:0;">Pour ne plus recevoir nos communications: <a href="mailto:gestionnovusepoxy@gmail.com?subject=Désabonnement" style="color:#94a3b8;">cliquez ici</a></p>
</div>
</div></body></html>`;

    try {
      await sendProspectEmail({ to: lead.email as string, subject: `${prenom}, on peut vous aider avec votre projet?`, html });
      await query(`UPDATE crm_leads SET prospect_relance_1_at = NOW(), updated_at = NOW() WHERE id = $1`, [lead.id]);
      sent1++;
    } catch (err) {
      errors++;
      console.error('Prospect relance 1 error:', err);
    }
  })));

  await Promise.all(r2capped.map((lead) => limit(async () => {
    const prenom = (lead.nom as string).split(' ')[0];
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:0;background:#f8fafc;">
<div style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;max-width:600px;margin:0 auto;background:#ffffff;">
<div style="background:#0f172a;padding:24px;text-align:center;border-radius:8px 8px 0 0;">
  <img src="https://novus-epoxy.vercel.app/logo-email.jpg" alt="Novus Epoxy" width="80" height="80" style="border-radius:12px;" />
  <h1 style="color:#f59e0b;margin:12px 0 0;font-size:22px;font-weight:700;">Novus Epoxy</h1>
  <p style="color:#94a3b8;margin:4px 0 0;font-size:13px;">Planchers époxy haut de gamme — Québec</p>
</div>
<div style="padding:24px;">
<p>Bonjour ${prenom},</p>
<p>C'est un dernier petit suivi de notre part. Notre calendrier se remplit vite pour les prochaines semaines!</p>
<p>Si votre projet est toujours d'actualité, on serait ravis de vous accompagner. Soumission gratuite, sans obligation.</p>
<div style="text-align:center;margin:20px 0;">
<a href="https://novusepoxy.ca/#contact" style="display:inline-block;background:#f59e0b;color:#0f172a;padding:12px 30px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px;">Demander ma soumission gratuite</a>
</div>
<div style="border-top:1px solid #e2e8f0;padding:16px 0 0;margin-top:20px;">
  <p style="color:#1e293b;font-weight:700;font-size:13px;margin:0 0 6px;">Une question? On est là pour vous.</p>
  <p style="color:#475569;font-size:13px;margin:0 0 2px;"><strong>Luca</strong> — Facturation / Soumission — <a href="tel:5813075983" style="color:#2563eb;">581-307-5983</a></p>
  <p style="color:#475569;font-size:13px;margin:0;"><strong>Jason</strong> — Chantier / Soumission — <a href="tel:5813072678" style="color:#2563eb;">581-307-2678</a></p>
</div>
<p>Au plaisir,<br/><strong>L'équipe Novus Epoxy</strong></p>
</div>
<div style="background:#f1f5f9;padding:12px 24px;text-align:center;border-radius:0 0 8px 8px;">
  <p style="color:#94a3b8;font-size:11px;margin:0;">Novus Epoxy — 44 rue de la Polyvalente, Québec, G2N 1G8</p>
</div>
<div style="text-align:center;padding:12px;background:#f8fafc;">
  <p style="color:#94a3b8;font-size:11px;margin:0;">Pour ne plus recevoir nos communications: <a href="mailto:gestionnovusepoxy@gmail.com?subject=Désabonnement" style="color:#94a3b8;">cliquez ici</a></p>
</div>
</div></body></html>`;

    try {
      await sendProspectEmail({ to: lead.email as string, subject: `${prenom} — Dernière chance soumission gratuite`, html });
      await query(`UPDATE crm_leads SET prospect_relance_2_at = NOW(), updated_at = NOW() WHERE id = $1`, [lead.id]);
      sent2++;
    } catch (err) {
      errors++;
      console.error('Prospect relance 2 error:', err);
    }
  })));

  const totalFound = r1.length + r2.length;
  const totalSent = sent1 + sent2;
  // If we found prospects but sent NONE while errors piled up, something is systemically broken
  // (OAuth, quota, provider down). Surface it instead of silently shipping zeros.
  if (totalSent === 0 && errors > 0 && totalFound > 20) {
    await alertOnce(
      'relance_prospect_zero',
      `🚨 relance-prospect: 0 envoyés sur ${totalFound} trouvés (${errors} erreurs). Vérifier OAuth Gmail / quota d'envoi.`
    );
  }

  return NextResponse.json({
    ok: true,
    relance_1: { found: r1.length, sent: sent1 },
    relance_2: { found: r2.length, sent: sent2 },
    errors,
    capped_at: MAX_PER_RUN,
  });
}

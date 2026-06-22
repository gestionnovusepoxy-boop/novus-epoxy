import { NextRequest, NextResponse } from 'next/server';
import { getAdminChatIds } from '@/lib/telegram-utils';
import { query } from '@/lib/db';
import { formatMoney } from '@/lib/pricing';
import { sendSMS, OPT_OUT_SUFFIX } from '@/lib/sms';
import { escapeHtml } from '@/lib/utils';
import { sendEmail } from '@/lib/send-email';
import { isBlocked } from '@/lib/lead-blocklist';
import { getQuebecHour } from '@/lib/timezone';

export const maxDuration = 60;

// Relances LONGUES des devis dormants (statut='envoye', sans réponse).
// Cible les devis vieux qui dorment encore: J+10, J+21, J+35 après created_at.
// Ton court et humain ("on garde ton prix bloqué", "dernière chance").
//
// GARDE-FOUS:
//   - OFF par défaut: ne s'active QUE si RELANCE_LONGUE_ENABLED === 'true'.
//   - MAX 20 envois par run (RELANCE_LONGUE_MAX override possible, plafonné à 20).
//   - Flag par devis+stage via kv_store (relance_longue_<quoteId>_<stage>) → jamais 2x.
//   - Respect blocklist (lib/lead-blocklist) avant tout contact.
//   - SMS: sendSMS gère heures calmes (8h–21h), opt-out, dedup, limite quotidienne.
//   - Alerte Telegram pour les devis 2000$+ (Luca appelle lui-même).
//
// PAS dans vercel.json — déclenchement manuel/externe (Bearer CRON_SECRET/ADMIN_API_KEY).

interface Stage {
  key: string;        // identifiant kv_store
  days: number;       // âge minimal (created_at) en jours
  subject: (prenom: string) => string;
  emailBody: (prenom: string, quoteId: number, total: number, quoteUrl: string) => string;
  smsBody: (prenom: string, quoteId: number, lucaPhone: string) => string;
}

const LUCA_PHONE = '581-307-5983';

function emailShell(inner: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:0;background:#f8fafc;">
<div style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;max-width:600px;margin:0 auto;background:#ffffff;">
<div style="background:#0f172a;padding:24px;text-align:center;border-radius:8px 8px 0 0;">
  <img src="https://novus-epoxy.vercel.app/logo-email.jpg" alt="Novus Epoxy" width="80" height="80" style="border-radius:12px;" />
  <h1 style="color:#f59e0b;margin:12px 0 0;font-size:22px;font-weight:700;">Novus Epoxy</h1>
  <p style="color:#94a3b8;margin:4px 0 0;font-size:13px;">Planchers époxy haut de gamme — Québec</p>
</div>
<div style="padding:28px 24px;">
${inner}
  <div style="border-top:1px solid #e2e8f0;padding-top:20px;margin-top:8px;">
    <p style="color:#1e293b;font-weight:700;font-size:13px;margin:0 0 8px;">On est là pour toi:</p>
    <p style="color:#475569;font-size:13px;margin:0 0 4px;"><strong>Luca</strong> — Soumissions &amp; facturation — <a href="tel:5813075983" style="color:#2563eb;">581-307-5983</a></p>
    <p style="color:#475569;font-size:13px;margin:0;"><strong>Jason</strong> — Chantier &amp; soumissions — <a href="tel:5813072678" style="color:#2563eb;">581-307-2678</a></p>
  </div>
  <p style="color:#475569;margin-top:20px;">À bientôt!<br/><strong>L'équipe Novus Epoxy</strong></p>
</div>
<div style="background:#f1f5f9;padding:12px 24px;text-align:center;border-radius:0 0 8px 8px;">
  <p style="color:#94a3b8;font-size:11px;margin:0;">Novus Epoxy — 44 rue de la Polyvalente, Québec, G2N 1G8 | novusepoxy.ca</p>
</div>
</div></body></html>`;
}

function cta(quoteUrl: string, label: string): string {
  return `  <div style="text-align:center;margin:28px 0;">
    <a href="${quoteUrl}" style="display:inline-block;background:#f59e0b;color:#0f172a;padding:14px 36px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px;">${label}</a>
  </div>`;
}

const STAGES: Stage[] = [
  {
    key: 'j10',
    days: 10,
    subject: (p) => `${p}, on garde ton prix bloqué`,
    emailBody: (p, id, total, url) => emailShell(
      `  <p style="font-size:16px;color:#1e293b;">Salut ${escapeHtml(p)},</p>
  <p style="color:#475569;line-height:1.7;">Petit suivi sur ta soumission <strong>#${id}</strong> de <strong>${formatMoney(total)}</strong>. On la garde bien au chaud — et <strong>ton prix reste bloqué</strong>, même si nos tarifs bougent.</p>
  <p style="color:#475569;line-height:1.7;">Si t'as une question ou tu veux ajuster un détail, réponds-moi ici ou appelle-moi, je m'en occupe.</p>` +
      cta(url, 'Voir ma soumission →')
    ),
    smsBody: (p, id) => `Salut ${p}! C'est Luca de Novus Epoxy. Ta soumission #${id} t'attend, je garde ton prix bloqué. Une question? Appelle-moi au ${LUCA_PHONE}.${OPT_OUT_SUFFIX}`,
  },
  {
    key: 'j21',
    days: 21,
    subject: (p) => `${p}, ton projet époxy — encore le temps`,
    emailBody: (p, id, total, url) => emailShell(
      `  <p style="font-size:16px;color:#1e293b;">Salut ${escapeHtml(p)},</p>
  <p style="color:#475569;line-height:1.7;">Ça fait un bout qu'on t'a envoyé ta soumission <strong>#${id}</strong> de <strong>${formatMoney(total)}</strong>. Pas de pression — je voulais juste m'assurer qu'elle ne s'est pas perdue.</p>
  <p style="color:#475569;line-height:1.7;">Le prix tient toujours et on peut encore te trouver une bonne date. Si le moment n'est pas idéal, dis-moi simplement quand te recontacter.</p>` +
      cta(url, 'Reprendre mon projet →')
    ),
    smsBody: (p, id) => `Salut ${p}, c'est Luca de Novus Epoxy. Ta soumission #${id} tient toujours, le prix est garanti. Veux-tu qu'on en reparle? ${LUCA_PHONE}.${OPT_OUT_SUFFIX}`,
  },
  {
    key: 'j35',
    days: 35,
    subject: (p) => `${p}, dernière chance pour ton prix garanti`,
    emailBody: (p, id, total, url) => emailShell(
      `  <p style="font-size:16px;color:#1e293b;">Salut ${escapeHtml(p)},</p>
  <p style="color:#475569;line-height:1.7;">C'est mon dernier suivi pour ta soumission <strong>#${id}</strong> de <strong>${formatMoney(total)}</strong>. Après ça je te laisse tranquille, promis.</p>
  <p style="color:#475569;line-height:1.7;">Si tu veux profiter de <strong>ton prix garanti</strong> avant qu'on le réajuste, c'est le moment. Un seul clic et on s'organise.</p>` +
      cta(url, 'Garder mon prix →')
    ),
    smsBody: (p, id) => `Salut ${p}, c'est Luca de Novus Epoxy. Dernier suivi pour ta soumission #${id}: ton prix garanti reste dispo encore un peu. Interesse? ${LUCA_PHONE}.${OPT_OUT_SUFFIX}`,
  },
];

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')?.replace('Bearer ', '') ?? '';
  const cronSecret = process.env.CRON_SECRET ?? '';
  const adminKey = process.env.ADMIN_API_KEY ?? '';
  if (!authHeader || (authHeader !== cronSecret && authHeader !== adminKey)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // GARDE-FOU #1 — OFF par défaut. Ne fait RIEN sauf si explicitement activé.
  if (process.env.RELANCE_LONGUE_ENABLED !== 'true') {
    return NextResponse.json({
      ok: true,
      enabled: false,
      skipped: 'RELANCE_LONGUE_ENABLED !== "true" — feature OFF par défaut',
    });
  }

  // Heures business (8h–20h) — coupe net si lancé la nuit (sendSMS recouvre aussi).
  const h = getQuebecHour();
  if (h < 8 || h >= 20) {
    return NextResponse.json({ ok: true, enabled: true, skipped: 'outside business hours' });
  }

  // GARDE-FOU #2 — plafond dur de 20 envois/run.
  const MAX_SENDS = Math.min(20, Math.max(1, Number(process.env.RELANCE_LONGUE_MAX ?? 20) || 20));
  const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'https://novus-epoxy.vercel.app';

  let sent = 0;
  const results: Array<{ id: number; stage: string; email: boolean; sms: boolean }> = [];
  const bigQuotes: Array<{ id: number; nom: string; tel: string | null; email: string | null; total: number; stage: string }> = [];

  // On parcourt les stages du plus ancien au plus récent (J+35 prioritaire — plus à risque).
  const ordered = [...STAGES].sort((a, b) => b.days - a.days);

  outer:
  for (const stage of ordered) {
    if (sent >= MAX_SENDS) break;

    // Devis envoyés, assez vieux pour ce stage, mais PAS encore assez pour un stage plus ancien
    // déjà traité dans cette boucle (chaque devis ne reçoit qu'un seul stage par run).
    const rows = await query(
      `SELECT id, client_nom, client_email, client_tel, total, secret_token
         FROM quotes
        WHERE statut = 'envoye'
          AND created_at <= NOW() - ($1 || ' days')::interval
        ORDER BY created_at ASC
        LIMIT 200`,
      [String(stage.days)]
    ) as Array<{
      id: number; client_nom: string; client_email: string | null;
      client_tel: string | null; total: string | number; secret_token: string | null;
    }>;

    for (const q of rows) {
      if (sent >= MAX_SENDS) break outer;

      const flagKey = `relance_longue_${q.id}_${stage.key}`;

      // GARDE-FOU #3 — déjà fait ce stage pour ce devis? on skip.
      const already = await query(`SELECT 1 FROM kv_store WHERE key = $1`, [flagKey]);
      if (already.length > 0) continue;

      // Un seul stage par devis par run: si un stage plus ancien a déjà été flaggé
      // dans une exécution précédente, ce devis a déjà reçu sa relance la plus avancée
      // → on le saute pour les stages plus jeunes (évite de régresser dans le ton).
      const olderFlags = ordered
        .filter(s => s.days > stage.days)
        .map(s => `relance_longue_${q.id}_${s.key}`);
      if (olderFlags.length > 0) {
        const olderDone = await query(
          `SELECT 1 FROM kv_store WHERE key = ANY($1::text[]) LIMIT 1`,
          [olderFlags]
        );
        if (olderDone.length > 0) continue;
      }

      // GARDE-FOU #4 — blocklist (complaint/bounce/unsub/spam/manual).
      const blocked = await isBlocked({ email: q.client_email, phone: q.client_tel });
      if (blocked) {
        // On flag quand même pour ne pas re-checker indéfiniment ce devis à ce stage.
        await query(
          `INSERT INTO kv_store (key, value, updated_at) VALUES ($1, $2, NOW())
             ON CONFLICT (key) DO NOTHING`,
          [flagKey, JSON.stringify({ skipped: 'blocked', reason: blocked.reason, at: new Date().toISOString() })]
        ).catch(() => {});
        continue;
      }

      const prenom = String(q.client_nom || '').split(' ')[0] || 'là';
      const total = Number(q.total) || 0;
      const quoteUrl = `${BASE_URL}/paiement/${q.id}?token=${encodeURIComponent(q.secret_token ?? '')}`;

      let emailOk = false;
      let smsOk = false;

      // Email
      if (q.client_email) {
        try {
          await sendEmail({
            to: q.client_email,
            subject: stage.subject(prenom),
            html: stage.emailBody(prenom, q.id, total, quoteUrl),
          });
          emailOk = true;
        } catch (err) {
          console.error(`[relance-longue] email error quote ${q.id} (${stage.key}):`, err);
        }
      }

      // SMS — sendSMS gère heures calmes / opt-out / dedup / limite quotidienne.
      if (q.client_tel) {
        smsOk = await sendSMS(q.client_tel, stage.smsBody(prenom, q.id, LUCA_PHONE))
          .catch((err) => { console.error(`[relance-longue] sms error quote ${q.id}:`, err); return false; });
      }

      // On ne flag (et compte) que si au moins un canal a été tenté avec succès.
      if (emailOk || smsOk) {
        await query(
          `INSERT INTO kv_store (key, value, updated_at) VALUES ($1, $2, NOW())
             ON CONFLICT (key) DO NOTHING`,
          [flagKey, JSON.stringify({ email: emailOk, sms: smsOk, at: new Date().toISOString() })]
        ).catch(() => {});
        sent++;
        results.push({ id: q.id, stage: stage.key, email: emailOk, sms: smsOk });

        // Devis 2000$+ → on signale à Luca pour appel perso.
        if (total >= 2000) {
          bigQuotes.push({ id: q.id, nom: String(q.client_nom || ''), tel: q.client_tel, email: q.client_email, total, stage: stage.key });
        }
      }
    }
  }

  // ALERTE Telegram — devis 2000$+ relancés (Luca appelle lui-même) + résumé.
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatIds = getAdminChatIds();
  if (botToken && chatIds.length && (sent > 0 || bigQuotes.length > 0)) {
    const dashUrl = process.env.NEXTAUTH_URL ?? 'https://novus-epoxy.vercel.app';

    if (bigQuotes.length > 0) {
      for (const b of bigQuotes) {
        const msg = [
          `💰 <b>Devis dormant 2000$+ relancé</b>`,
          ``,
          `Client: ${escapeHtml(b.nom)}`,
          `Total: ${formatMoney(b.total)}`,
          b.tel ? `📞 ${escapeHtml(b.tel)}` : '',
          b.email ? `📧 ${escapeHtml(b.email)}` : '',
          `Stage: ${b.stage}`,
          ``,
          `<b>Gros montant — appelle-le toi-même!</b>`,
        ].filter(Boolean).join('\n');
        await Promise.all(chatIds.map(id =>
          fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: id.trim(),
              text: msg,
              parse_mode: 'HTML',
              reply_markup: {
                inline_keyboard: [[
                  { text: '📋 Voir devis', url: `${dashUrl}/dashboard/devis/${b.id}` },
                ]],
              },
            }),
          }).catch(() => {})
        ));
      }
    }

    const summary = [
      `📨 <b>Relances longues (devis dormants)</b>`,
      ``,
      `Total relancé: ${sent}`,
      `Gros devis (2000$+): ${bigQuotes.length}`,
    ].join('\n');
    await Promise.all(chatIds.map(id =>
      fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: id.trim(), text: summary, parse_mode: 'HTML' }),
      }).catch(() => {})
    ));
  }

  return NextResponse.json({
    ok: true,
    enabled: true,
    max_per_run: MAX_SENDS,
    sent,
    big_quotes_alerted: bigQuotes.length,
    results,
  });
}

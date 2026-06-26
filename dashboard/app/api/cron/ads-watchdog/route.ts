import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getMetaToken } from '@/lib/meta-token';

export const maxDuration = 60;

const V = 'v25.0';
const ACCT = (process.env.META_AD_ACCOUNT_ID ?? '250180039560083').replace(/^act_/, '');

/**
 * Chien de garde des pubs — tourne souvent (aux ~3h). Surveille la MACHINE À LEADS
 * et crie INSTANTANÉMENT (Telegram) quand quelque chose plante:
 *   1. Token Meta mort (= leads coupés, comme juin 2026)
 *   2. Une pub REJETÉE / avec problème par Meta (DISAPPROVED / WITH_ISSUES)
 *   3. La machine est ÉTEINTE (aucune campagne de leads active qui livre)
 *
 * Auto-règle ce qui est SÛR (rien de destructif), alerte avec bouton 1-clic pour
 * le reste (regen token, appel d'une pub refusée — ça exige un humain, on force pas
 * pour pas brûler le budget ni enfreindre les règles Meta).
 *
 * Anti-spam: n'alerte QUE quand l'ensemble des problèmes CHANGE (hash dans kv_store).
 */
export async function GET(req: NextRequest) {
  const secret = req.headers.get('authorization')?.replace('Bearer ', '') ?? '';
  if (!secret || (secret !== (process.env.CRON_SECRET ?? '') && secret !== (process.env.ADMIN_API_KEY ?? ''))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const botToken = process.env.TELEGRAM_BOT_TOKEN ?? '';
  const chat = (process.env.TELEGRAM_GROUP_CHAT_ID ?? '').trim();
  const send = async (text: string, buttons?: unknown) => {
    if (!botToken || !chat) return;
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text: text.slice(0, 4000), parse_mode: 'HTML', ...(buttons ? { reply_markup: { inline_keyboard: buttons } } : {}) }),
    }).catch(() => {});
  };

  const problems: string[] = []; // signatures courtes pour le hash anti-spam
  const messages: string[] = []; // texte humain
  let buttons: unknown[] | undefined;

  const token = await getMetaToken();
  if (!token) return NextResponse.json({ ok: true, skipped: 'no token' });

  // ── 1. Token vivant? ────────────────────────────────────────────────
  let tokenDead = false;
  try {
    const r = await fetch(`https://graph.facebook.com/${V}/debug_token?input_token=${encodeURIComponent(token)}&access_token=${encodeURIComponent(token)}`);
    const j = await r.json();
    if (j?.error || j?.data?.is_valid === false) {
      tokenDead = true;
      problems.push('token_dead');
      messages.push(`🚨 <b>Token Meta MORT</b> — leads + pubs coupés.\nRaison: ${j?.error?.message ?? j?.data?.error?.message ?? 'is_valid=false'}`);
      buttons = [[{ text: '🔑 Mettre à jour le token', url: 'https://novus-epoxy.vercel.app/dashboard/settings' }]];
    }
  } catch {
    // réseau transitoire — on ne crie pas au loup, on sort propre.
    return NextResponse.json({ ok: true, checked: false, transient: true });
  }

  if (!tokenDead) {
    // ── 1b. Webhook leadgen abonné? AUTO-RÉPARE si tombé ──────────────
    // Un abonnement leadgen qui retombe = leads Facebook perdus en silence
    // (c'est arrivé: page abonnée à 0 champ, 26 juin). Réabonner est sûr et
    // idempotent → on le fait automatiquement, puis on signale.
    const PAGE_ID = '636757822863288';
    try {
      const ptRes = await fetch(`https://graph.facebook.com/${V}/${PAGE_ID}?fields=access_token&access_token=${encodeURIComponent(token)}`);
      const ptJson = await ptRes.json();
      const pageToken = ptJson?.access_token as string | undefined;
      if (pageToken) {
        const subRes = await fetch(`https://graph.facebook.com/${V}/${PAGE_ID}/subscribed_apps?fields=subscribed_fields&access_token=${encodeURIComponent(pageToken)}`);
        const subJson = await subRes.json();
        const fields: string[] = subJson?.data?.[0]?.subscribed_fields ?? [];
        if (!fields.includes('leadgen')) {
          // AUTO-RÉPARE
          const fixRes = await fetch(`https://graph.facebook.com/${V}/${PAGE_ID}/subscribed_apps`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ subscribed_fields: 'leadgen,feed,messages,messaging_postbacks', access_token: pageToken }),
          });
          const fixJson = await fixRes.json();
          problems.push('leadgen_unsubscribed');
          messages.push(fixJson?.success
            ? `🔧 <b>Webhook leadgen était tombé</b> — réparé automatiquement. Les leads FB rentrent à nouveau en temps réel.`
            : `🚨 <b>Webhook leadgen TOMBÉ</b> — leads FB perdus, et la réparation auto a échoué. Reconnecte l'app à la page.`);
        }
      }
    } catch (e) {
      console.log('[ads-watchdog] webhook check failed:', String(e).slice(0, 120));
    }

    // ── 2. Pubs rejetées / avec problème ──────────────────────────────
    try {
      const r = await fetch(`https://graph.facebook.com/${V}/act_${ACCT}/ads?fields=name,effective_status,ad_review_feedback,campaign{name,effective_status,objective}&limit=200&access_token=${encodeURIComponent(token)}`);
      const j = await r.json();
      const ads = Array.isArray(j.data) ? j.data : [];
      const BAD = new Set(['DISAPPROVED', 'WITH_ISSUES', 'ADSET_PAUSED', 'CAMPAIGN_PAUSED']);
      // Une pub refusée n'est URGENTE que si sa campagne tourne (pas pausée/archivée).
      // Un refus dans une vieille campagne pausée ne livre pas → on l'ignore (pas de spam).
      const rejected = ads.filter((a: Record<string, unknown>) => {
        const isRejected = a.effective_status === 'DISAPPROVED' || a.effective_status === 'WITH_ISSUES';
        const camp = a.campaign as Record<string, unknown> | undefined;
        const campLive = camp && camp.effective_status !== 'PAUSED' && camp.effective_status !== 'ARCHIVED' && camp.effective_status !== 'DELETED';
        return isRejected && campLive;
      });
      for (const a of rejected) {
        const ad = a as Record<string, unknown>;
        const fb = ad.ad_review_feedback as { global?: Record<string, string> } | undefined;
        const reason = fb?.global ? Object.values(fb.global).join('; ') : 'voir Ads Manager';
        problems.push(`rejected:${ad.name}`);
        messages.push(`⛔ <b>Pub refusée:</b> ${ad.name}\nStatut: ${ad.effective_status} · Raison: ${String(reason).slice(0, 200)}`);
      }
      // Garde BAD utilisé pour clarté future (statuts surveillés)
      void BAD;

      // ── 3. Machine à leads éteinte? ─────────────────────────────────
      const leadCamps = ads
        .map((a: Record<string, unknown>) => a.campaign as Record<string, unknown> | undefined)
        .filter((c: Record<string, unknown> | undefined): c is Record<string, unknown> => !!c && c.objective === 'OUTCOME_LEADS');
      const anyLeadActive = leadCamps.some((c: Record<string, unknown>) => c.effective_status === 'ACTIVE');
      if (leadCamps.length > 0 && !anyLeadActive) {
        problems.push('machine_off');
        messages.push(`🛑 <b>Machine à leads ÉTEINTE</b> — aucune campagne de leads active ne livre. Zéro lead va rentrer.`);
        if (!buttons) buttons = [[{ text: '🔎 Voir Ads Manager', url: `https://business.facebook.com/adsmanager/manage/campaigns?act=${ACCT}` }]];
      }
    } catch (e) {
      // Erreur de lecture des pubs — log seulement, pas d'alerte spam.
      console.log('[ads-watchdog] ads fetch failed:', String(e).slice(0, 120));
    }
  }

  // ── Anti-spam: n'alerte que si l'ensemble des problèmes a CHANGÉ ────
  const sig = problems.sort().join('|');
  let prevSig = '';
  try {
    const rows = (await query(`SELECT value FROM kv_store WHERE key = 'ads_watchdog_state'`)) as Array<{ value: unknown }>;
    if (rows[0]) prevSig = String(rows[0].value ?? '');
  } catch { /* ignore */ }

  const changed = sig !== prevSig;
  try {
    await query(
      `INSERT INTO kv_store (key, value, updated_at) VALUES ('ads_watchdog_state', $1, NOW()) ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
      [sig],
    );
  } catch { /* ignore */ }

  if (problems.length > 0 && changed) {
    await send(['🐕 <b>Chien de garde Pub</b>', '', ...messages].join('\n'), buttons);
  } else if (problems.length === 0 && prevSig !== '') {
    // Tout était cassé, maintenant c'est réglé → ping rassurant.
    await send('✅ <b>Chien de garde Pub</b> — tout est revenu à la normale. La machine à leads roule.');
  }

  return NextResponse.json({ ok: true, problems, alerted: problems.length > 0 && changed });
}

export const POST = GET;

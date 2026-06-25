import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';

/**
 * POST /api/meta/rules — A7 AUTO-PAUSE DES PUBS PERDANTES
 *
 * Crée une règle NATIVE Meta (côté Meta, pas un cron maison) qui met en PAUSE
 * automatiquement un ad set quand son coût par lead (cost_per_result) dépasse
 * un seuil sur N jours. La règle vit dans Ads Manager → Règles automatisées,
 * Meta l'évalue lui-même (semi-horaire) — aucun risque de double-pause par notre code.
 *
 * SÉCURITÉ / OFF PAR DÉFAUT:
 *   - Désactivé sauf si META_RULES_ENABLED === 'true'. Sinon no-op (HTTP 200, ok:false).
 *   - Admin-gated: session NextAuth OU x-api-key === ADMIN_API_KEY (cron).
 *   - Lit META_AD_ACCOUNT_ID (défaut 250180039560083) + META_PAGE_TOKEN.
 *
 * Body (tous optionnels):
 *   {
 *     cplThresholdUsd?: number,  // seuil CPL en $ (défaut 60). Au-dessus → pause.
 *     windowDays?: 1|3|7|14|30,  // fenêtre d'évaluation (défaut 3 jours).
 *     name?: string,             // nom de la règle (défaut "Auto-pause CPL > $X").
 *     adAccountId?: string,      // override (sinon META_AD_ACCOUNT_ID).
 *   }
 *
 * Le token doit porter ads_management. META_PAGE_TOKEN porte pages_manage_ads;
 * si la création échoue (#200), régénère un System User token avec ads_management.
 */

const META_API_VERSION = 'v25.0';
const DEFAULT_AD_ACCOUNT_ID = '250180039560083';

// KILL-SWITCH: OFF par défaut. Une règle native qui pause des ad sets touche le
// budget live — on n'arme jamais ça sans flag explicite.
const META_RULES_ENABLED = process.env.META_RULES_ENABLED === 'true';

// Fenêtres d'évaluation supportées par Meta (time_preset des règles).
const WINDOW_PRESETS: Record<number, string> = {
  1: 'LAST_1_DAY',
  3: 'LAST_3_DAYS',
  7: 'LAST_7_DAYS',
  14: 'LAST_14_DAYS',
  30: 'LAST_30_DAYS',
};

export async function POST(req: NextRequest) {
  // --- Admin gating (même pattern que /api/ads/propose) ---
  const session = await auth();
  const apiKey = req.headers.get('x-api-key');
  if (!session && apiKey !== process.env.ADMIN_API_KEY) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  }

  // --- OFF par défaut: no-op tant que le flag n'est pas armé ---
  if (!META_RULES_ENABLED) {
    return NextResponse.json({
      ok: false,
      enabled: false,
      message:
        "Auto-pause Meta DÉSACTIVÉ (OFF par défaut). Active META_RULES_ENABLED=true dans Vercel pour armer la règle native.",
    });
  }

  const body = await req.json().catch(() => ({}));

  // Seuil CPL: $60 par défaut, borné 10–500 $ pour éviter une règle absurde.
  const cplThresholdUsd = Math.min(
    Math.max(Number(body.cplThresholdUsd ?? 60), 10),
    500
  );

  // Fenêtre d'évaluation: 3 jours par défaut.
  const windowDaysRaw = Number(body.windowDays ?? 3);
  const windowDays = WINDOW_PRESETS[windowDaysRaw] ? windowDaysRaw : 3;
  const timePreset = WINDOW_PRESETS[windowDays];

  const token = (process.env.META_PAGE_TOKEN ?? '').trim();
  if (!token) {
    return NextResponse.json({ error: 'META_PAGE_TOKEN manquant' }, { status: 500 });
  }

  const adAccountId = (
    (typeof body.adAccountId === 'string' && body.adAccountId) ||
    process.env.META_AD_ACCOUNT_ID ||
    DEFAULT_AD_ACCOUNT_ID
  )
    .trim()
    .replace(/^act_/, '');

  const name =
    typeof body.name === 'string' && body.name.trim()
      ? body.name.trim().slice(0, 100)
      : `Auto-pause CPL > $${cplThresholdUsd} (${windowDays}j)`;

  // Meta veut le coût en cents (entier).
  const thresholdCents = Math.round(cplThresholdUsd * 100);

  // --- Schéma de règle native Meta (adrules_library) ---
  // evaluation_spec: déclencheur — cost_per_result strictement > seuil.
  // execution_spec : action — PAUSE de l'entité (ad set).
  // entity_type ADSET → la règle balaye tous les ad sets actifs du compte.
  const evaluationSpec = {
    evaluation_type: 'SCHEDULE',
    filters: [
      { field: 'entity_type', value: 'ADSET', operator: 'EQUAL' },
      { field: 'time_preset', value: timePreset, operator: 'EQUAL' },
      // cost_per_result en cents — au-dessus du seuil = pub perdante.
      { field: 'cost_per_result', value: thresholdCents, operator: 'GREATER_THAN' },
    ],
  };

  const executionSpec = {
    execution_type: 'PAUSE',
    execution_options: [
      // N'agir que sur ce qui tourne (ne touche pas les ad sets déjà en pause).
      { field: 'user_attribution', value: 'ATTRIBUTED', operator: 'IN' },
    ],
  };

  // Cadence d'évaluation: aux 30 min (standard pour les règles "garde-fou budget").
  const scheduleSpec = { schedule_type: 'SEMI_HOURLY' };

  try {
    const res = await fetch(
      `https://graph.facebook.com/${META_API_VERSION}/act_${adAccountId}/adrules_library`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          evaluation_spec: JSON.stringify(evaluationSpec),
          execution_spec: JSON.stringify(executionSpec),
          schedule_spec: JSON.stringify(scheduleSpec),
          status: 'ENABLED',
          access_token: token,
        }),
      }
    );

    const json = (await res.json().catch(() => ({}))) as {
      id?: string;
      error?: { message?: string; code?: number };
    };

    if (!res.ok || json.error) {
      const errMsg = json.error?.message ?? `HTTP ${res.status}`;
      return NextResponse.json(
        {
          ok: false,
          error: `Création de la règle Meta échouée: ${errMsg}`,
          code: json.error?.code,
          hint:
            json.error?.code === 200
              ? "Le token n'a pas ads_management — régénère un System User token avec ce scope."
              : undefined,
        },
        { status: 502 }
      );
    }

    return NextResponse.json({
      ok: true,
      enabled: true,
      rule_id: json.id,
      name,
      ad_account_id: `act_${adAccountId}`,
      cpl_threshold_usd: cplThresholdUsd,
      window_days: windowDays,
      action: 'PAUSE',
      entity: 'ADSET',
      message: `Règle native Meta créée: pause auto des ad sets dont le CPL dépasse $${cplThresholdUsd} sur ${windowDays} jour(s).`,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

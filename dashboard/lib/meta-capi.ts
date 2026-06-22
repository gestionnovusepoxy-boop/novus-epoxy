/**
 * lib/meta-capi.ts — Meta Conversions API (CAPI).
 *
 * Envoie des events serveur-à-serveur à Meta (graph.facebook.com/{PIXEL_ID}/events)
 * pour donner à l'algo la VRAIE valeur des leads (ex: un devis passé à depot_paye =
 * event "Purchase" avec la valeur du contrat). Meta optimise alors la livraison vers
 * les gens qui rapportent vraiment, pas juste qui remplit un formulaire.
 *
 * NO-OP propre si META_PIXEL_ID est absent (feature OFF par défaut tant que le pixel
 * n'est pas configuré). On NE casse jamais un flux existant.
 *
 * Sécurité PII: email/téléphone sont hashés SHA-256 (normalisés) comme Meta l'exige —
 * on n'envoie jamais de données en clair.
 */

import { createHash } from 'crypto';

const META_API_VERSION = 'v25.0';

export interface ConversionEventInput {
  /** Standard event name, ex: 'Purchase', 'Lead'. */
  eventName: string;
  /** Valeur monétaire de l'event (ex: total du contrat). */
  value?: number;
  /** Devise (défaut CAD — Québec). */
  currency?: string;
  /** Email du client (en clair — sera hashé ici). */
  email?: string | null;
  /** Téléphone du client (en clair — sera hashé ici). */
  phone?: string | null;
  /** Timestamp de l'event (Date ou ISO string). Défaut: maintenant. */
  eventTime?: Date | string | null;
  /** ID de déduplication côté Meta (ex: `quote_<id>`). */
  eventId?: string | null;
}

export interface ConversionEventResult {
  ok: boolean;
  skipped?: string;
  error?: string;
  eventsReceived?: number;
}

/** SHA-256 hex d'une valeur normalisée (trim + lowercase). Retourne null si vide. */
function hashField(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const normalized = String(raw).trim().toLowerCase();
  if (!normalized) return null;
  return createHash('sha256').update(normalized).digest('hex');
}

/** Normalise un téléphone pour le hash: chiffres seulement, +indicatif pays QC si manquant. */
function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let digits = String(raw).replace(/[^0-9]/g, '');
  if (!digits) return null;
  // Numéro NANP local (10 chiffres) → préfixe 1 (Amérique du Nord)
  if (digits.length === 10) digits = `1${digits}`;
  return digits;
}

/** SHA-256 d'un téléphone normalisé. */
function hashPhone(raw: string | null | undefined): string | null {
  const normalized = normalizePhone(raw);
  if (!normalized) return null;
  return createHash('sha256').update(normalized).digest('hex');
}

/**
 * Envoie un event de conversion à Meta. NO-OP propre si META_PIXEL_ID absent.
 * action_source = 'system' (event généré côté serveur, pas un clic navigateur).
 */
export async function sendConversionEvent(input: ConversionEventInput): Promise<ConversionEventResult> {
  const pixelId = (process.env.META_PIXEL_ID ?? '').trim();
  if (!pixelId) {
    // Feature OFF tant que le pixel n'est pas configuré — pas une erreur.
    console.log('[meta-capi] META_PIXEL_ID absent — skip event', input.eventName);
    return { ok: true, skipped: 'META_PIXEL_ID absent' };
  }

  const token = (process.env.META_PAGE_TOKEN ?? '').trim();
  if (!token) {
    console.log('[meta-capi] META_PAGE_TOKEN absent — skip');
    return { ok: false, error: 'META_PAGE_TOKEN absent' };
  }

  // event_time en secondes Unix (Meta exige des secondes, pas des ms).
  const eventDate = input.eventTime
    ? new Date(input.eventTime)
    : new Date();
  const eventTimeSec = Math.floor(eventDate.getTime() / 1000);

  const userData: Record<string, string> = {};
  const em = hashField(input.email);
  const ph = hashPhone(input.phone);
  if (em) userData.em = em;
  if (ph) userData.ph = ph;

  const customData: Record<string, unknown> = {};
  if (typeof input.value === 'number' && input.value > 0) {
    customData.value = Number(input.value.toFixed(2));
    customData.currency = (input.currency ?? 'CAD').toUpperCase();
  }

  const eventPayload: Record<string, unknown> = {
    event_name: input.eventName,
    event_time: eventTimeSec,
    action_source: 'system',
    user_data: userData,
    custom_data: customData,
  };
  if (input.eventId) eventPayload.event_id = String(input.eventId);

  const body: Record<string, unknown> = {
    data: [eventPayload],
    access_token: token,
  };
  // Test event code optionnel (events apparaissent dans l'onglet Test Events de Meta).
  const testCode = (process.env.META_CAPI_TEST_CODE ?? '').trim();
  if (testCode) body.test_event_code = testCode;

  try {
    const res = await fetch(`https://graph.facebook.com/${META_API_VERSION}/${pixelId}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = (data as Record<string, { message?: string }>)?.error?.message
        ?? `HTTP ${res.status}`;
      console.error('[meta-capi] event failed:', msg);
      return { ok: false, error: msg };
    }
    return {
      ok: true,
      eventsReceived: Number((data as { events_received?: number }).events_received ?? 0),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[meta-capi] fetch error:', msg);
    return { ok: false, error: msg };
  }
}

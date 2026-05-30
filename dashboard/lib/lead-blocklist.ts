/**
 * Lead blocklist — empêche TOUT contact auto vers un lead "mauvais contact".
 *
 * Stocké dans kv_store sous des clés:
 *   - lead_block_email_<email_normalized>
 *   - lead_block_phone_<phone_10digits>
 *
 * Le check est rapide (un SELECT par clé) et s'utilise avant CHAQUE send
 * dans: relance-prospect, lead-followup, Aria reply, SMS auto-reply.
 *
 * Raisons gérées:
 *   - 'complaint'      — le client a dit "harcèlement / arrêtez / spam / pourriel / stop"
 *   - 'bounce'         — email rejeté par le serveur destinataire (bad address)
 *   - 'unsubscribed'   — désabonnement explicite (STOP SMS)
 *   - 'spam_report'    — Resend `email.complained` (le client a marqué notre email comme spam)
 *   - 'manual'         — Luca a bloqué manuellement depuis le dashboard
 */
import { query } from '@/lib/db';

export type BlockReason = 'complaint' | 'bounce' | 'unsubscribed' | 'spam_report' | 'manual';

function normalizeEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const e = email.toLowerCase().trim();
  return e || null;
}

function normalizePhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '').slice(-10);
  return digits.length === 10 ? digits : null;
}

export interface BlockInfo {
  reason: BlockReason;
  at: string;
  detail?: string;
}

/**
 * Returns the block info if the email OR phone is blocked, null otherwise.
 * Use this BEFORE any auto-contact (email, SMS) to a lead.
 */
export async function isBlocked(opts: { email?: string | null; phone?: string | null }): Promise<BlockInfo | null> {
  const email = normalizeEmail(opts.email);
  const phone = normalizePhone(opts.phone);
  const keys: string[] = [];
  if (email) keys.push(`lead_block_email_${email}`);
  if (phone) keys.push(`lead_block_phone_${phone}`);
  if (keys.length === 0) return null;
  try {
    const rows = await query(
      `SELECT key, value FROM kv_store WHERE key = ANY($1::text[]) LIMIT 1`,
      [keys]
    ) as Array<{ key: string; value: unknown }>;
    if (rows.length === 0) return null;
    const raw = rows[0].value;
    if (typeof raw === 'string') {
      try { return JSON.parse(raw) as BlockInfo; } catch { return { reason: 'manual', at: new Date().toISOString() }; }
    }
    return raw as BlockInfo;
  } catch {
    return null; // never block on lookup failure — let the send happen
  }
}

/**
 * Block a lead by email AND/OR phone, with a reason. Idempotent.
 * Also updates crm_leads (statut, temperature, notes) for the matching lead(s).
 */
export async function blockLead(opts: {
  email?: string | null;
  phone?: string | null;
  reason: BlockReason;
  detail?: string;
}): Promise<{ blocked: boolean; matched_lead_ids: number[] }> {
  const email = normalizeEmail(opts.email);
  const phone = normalizePhone(opts.phone);
  if (!email && !phone) return { blocked: false, matched_lead_ids: [] };

  const info: BlockInfo = {
    reason: opts.reason,
    at: new Date().toISOString(),
    detail: opts.detail,
  };
  const value = JSON.stringify(info);

  try {
    if (email) {
      await query(
        `INSERT INTO kv_store (key, value) VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [`lead_block_email_${email}`, value]
      );
    }
    if (phone) {
      await query(
        `INSERT INTO kv_store (key, value) VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [`lead_block_phone_${phone}`, value]
      );
    }
  } catch { /* never throw on blocklist write */ }

  // Update crm_leads matching this email/phone
  let matched: Array<{ id: number }> = [];
  try {
    const noteSuffix = ` [BLOQUÉ ${new Date().toISOString().slice(0, 10)} — ${opts.reason}${opts.detail ? ': ' + opts.detail.slice(0, 100) : ''}]`;
    matched = (await query(
      `UPDATE crm_leads
       SET statut = 'mauvais_contact',
           temperature = 'froid',
           notes = COALESCE(notes, '') || $3,
           updated_at = NOW()
       WHERE (email IS NOT NULL AND email != '' AND LOWER(email) = $1)
          OR (telephone IS NOT NULL AND telephone != '' AND regexp_replace(telephone, '[^0-9]', '', 'g') = $2)
       RETURNING id`,
      [email ?? '', phone ?? '', noteSuffix]
    )) as Array<{ id: number }>;
  } catch { /* leads_table not critical */ }

  return { blocked: true, matched_lead_ids: matched.map(r => r.id) };
}

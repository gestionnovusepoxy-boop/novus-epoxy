// Twilio SMS integration for Novus Epoxy
// Sends notifications to admin and follow-ups to clients
import { getQuebecHour } from '@/lib/timezone';
import { createHash } from 'crypto';

const TWILIO_SID = () => process.env.TWILIO_ACCOUNT_SID ?? '';
const TWILIO_TOKEN = () => process.env.TWILIO_AUTH_TOKEN ?? '';
const TWILIO_FROM = () => process.env.TWILIO_PHONE_NUMBER ?? '';

export async function sendSMS(to: string, body: string, fromOverride?: string, skipQuietHours = false): Promise<boolean> {
  // Quiet hours: JAMAIS de SMS avant 8h ou après 21h Eastern — ordre du patron, non négociable
  if (!skipQuietHours) {
    const hour = getQuebecHour();
    if (hour < 8 || hour >= 21) {
      console.log(`[SMS] BLOQUE — heures calmes (${hour}h ET) — SMS non envoye a ${to}`);
      return false;
    }
  }

  const sid = TWILIO_SID();
  const token = TWILIO_TOKEN();
  const from = fromOverride ?? TWILIO_FROM();

  if (!sid || !token || !from) {
    console.error('Twilio not configured — missing TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, or TWILIO_PHONE_NUMBER');
    return false;
  }

  // Normalize Quebec phone number
  const cleaned = to.replace(/[^0-9+]/g, '');
  const phone = cleaned.startsWith('+') ? cleaned : cleaned.startsWith('1') ? `+${cleaned}` : `+1${cleaned}`;

  // Validate phone number — must be 10 or 11 digits with valid QC area code
  const digitsOnly = phone.replace(/\D/g, '');
  const validAreaCodes = ['418', '581', '819', '450', '438', '514', '579', '873', '367'];
  const areaCode = digitsOnly.length === 11 ? digitsOnly.substring(1, 4) : digitsOnly.substring(0, 3);
  if (digitsOnly.length < 10 || digitsOnly.length > 11 || !validAreaCodes.includes(areaCode)) {
    console.log(`[SMS] BLOQUE — numero invalide (${to}) — area code ${areaCode} non reconnu`);
    return false;
  }

  // SMS opt-out check
  try {
    const { query } = await import('@/lib/db');
    const optout = await query(`SELECT 1 FROM kv_store WHERE key = $1`, ['sms_optout_' + phone]);
    if (optout.length > 0) {
      console.log(`[SMS] BLOQUE — ${to} est desabonne (opt-out)`);
      return false;
    }
  } catch { /* DB check failed — proceed with send */ }

  // Daily limit check — max 100 SMS per day
  try {
    const { query: limitQ } = await import('@/lib/db');
    const countResult = await limitQ(
      `SELECT COUNT(*)::int AS cnt FROM sms_logs WHERE direction = 'outbound' AND created_at >= CURRENT_DATE`
    );
    const todayCount = Number((countResult[0] as Record<string, unknown>)?.cnt ?? 0);
    if (todayCount >= 100) {
      console.warn(`[SMS] BLOQUE — limite quotidienne atteinte (${todayCount}/100) — SMS non envoye a ${to}`);
      return false;
    }
  } catch { /* daily limit check failed — proceed */ }

  // Dedup check — prevent sending same SMS to same number within 6 hours
  // Hash du body COMPLET — sinon deux messages qui partagent le même préfixe ("Salut {prenom}...")
  // collisionnent et le 2e (ex: rappel jour-2) est silencieusement supprimé.
  const dedupeKey = `sms_dedup_${phone}_${createHash('sha1').update(body).digest('hex').slice(0, 24)}`;
  try {
    const { query: dbQ } = await import('@/lib/db');
    const existing = await dbQ(
      `SELECT 1 FROM kv_store WHERE key = $1 AND updated_at > NOW() - INTERVAL '6 hours'`,
      [dedupeKey]
    );
    if (existing.length > 0) {
      console.log(`[SMS] BLOQUE — dedup (meme SMS envoye dans les 6 dernieres heures a ${to})`);
      return false;
    }
    // Mark as sent
    await dbQ(
      `INSERT INTO kv_store (key, value, updated_at) VALUES ($1, $2, NOW()) ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
      [dedupeKey, JSON.stringify({ to: phone, sent_at: new Date().toISOString() })]
    );
  } catch { /* dedup check failed — proceed */ }

  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ To: phone, From: from, Body: body }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error('Twilio SMS error:', err);
      return false;
    }

    // Log SMS to database with lead_id lookup by phone number (ULTRAPLAN-V2 P1-5)
    try {
      const { query: dbQuery } = await import('@/lib/db');
      // Lookup crm_leads.id by phone (last 10 digits match)
      const cleanPhone = String(phone).replace(/\D/g, '').slice(-10);
      const leadRows = cleanPhone.length === 10
        ? await dbQuery(
            `SELECT id FROM crm_leads WHERE telephone = $1 OR RIGHT(REGEXP_REPLACE(telephone, '\\D', '', 'g'), 10) = $1 ORDER BY created_at DESC LIMIT 1`,
            [cleanPhone]
          ).catch(() => [])
        : [];
      const leadId = leadRows[0]?.id ?? null;
      await dbQuery(
        `INSERT INTO sms_logs (direction, from_number, to_number, message, statut, lead_id) VALUES ('outbound', $1, $2, $3, 'sent', $4)`,
        [from, phone, body, leadId]
      );
    } catch { /* log failed — don't block send */ }

    return true;
  } catch (err) {
    console.error('Failed to send SMS:', err);
    return false;
  }
}

// Notify admins of new quote (Luca + Jason)
export async function notifyAdminSMS(quoteId: number, clientName: string) {
  const phones = [process.env.ADMIN_PHONE, process.env.JASON_PHONE].filter(Boolean) as string[];
  if (phones.length === 0) return;

  const msg = `Novus Epoxy: Nouveau devis #${quoteId} de ${clientName} a approuver. https://novus-epoxy.vercel.app/dashboard/devis/${quoteId}`;
  await Promise.all(phones.map(phone => sendSMS(phone, msg)));
}

// Luca's number — always use this for client-facing SMS
const LUCA_PHONE = '581-307-5983';

// CASL/CRTC: tout message commercial (marketing/prospection) doit inclure un mécanisme
// de désabonnement clair et bilingue. Les transactionnels (confirmation de dépôt, etc.)
// en sont exemptés. Suffixe court à coller aux messages marketing.
export const OPT_OUT_SUFFIX = ' Texto ARRET pour arreter.';

// Send follow-up SMS to client (single relance after 5 days, no earlier SMS)
export async function sendFollowUpSMS(clientPhone: string, clientName: string, quoteId: number) {
  if (!clientPhone) return false;
  const prenom = clientName.split(' ')[0];

  const msg = `Salut ${prenom}! C'est Luca de Novus Epoxy. T'as recu ta soumission #${quoteId}? Si t'as des questions, appelle-moi au ${LUCA_PHONE}, je m'en occupe!`;
  return sendSMS(clientPhone, msg);
}

// SMS confirmation when deposit is received
export async function sendDepositConfirmationSMS(clientPhone: string, clientName: string, jour1Date?: string, jour2Date?: string) {
  if (!clientPhone) return false;
  const prenom = clientName.split(' ')[0];

  const datesInfo = jour1Date && jour2Date
    ? ` Tes dates du ${jour1Date} et ${jour2Date} sont confirmees.`
    : '';

  const msg = `${prenom}, c'est Luca de Novus Epoxy. Depot bien recu, merci!${datesInfo} On te recontacte pour les details. Questions? ${LUCA_PHONE}`;
  return sendSMS(clientPhone, msg);
}

// SMS referral request 6 months after completed work
export async function sendReferralSMS(clientPhone: string, clientName: string) {
  if (!clientPhone) return false;
  const prenom = clientName.split(' ')[0];

  const msg = `Salut ${prenom}! C'est Luca de Novus Epoxy. Tu connais quelqu'un qui veut un plancher epoxy? On donne 100$ de rabais par reference. Passe le mot au ${LUCA_PHONE}!${OPT_OUT_SUFFIX}`;
  return sendSMS(clientPhone, msg);
}

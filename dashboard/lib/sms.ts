// Twilio SMS integration for Novus Epoxy
// Sends notifications to admin and follow-ups to clients

const TWILIO_SID = () => process.env.TWILIO_ACCOUNT_SID ?? '';
const TWILIO_TOKEN = () => process.env.TWILIO_AUTH_TOKEN ?? '';
const TWILIO_FROM = () => process.env.TWILIO_PHONE_NUMBER ?? '';

export async function sendSMS(to: string, body: string, fromOverride?: string, _skipQuietHours = true): Promise<boolean> {
  // Quiet hours: JAMAIS de SMS avant 8h ou après 21h Eastern — ordre du patron, non négociable
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Toronto' }));
  const hour = now.getHours();
  if (hour < 8 || hour >= 21) {
    console.log(`[SMS] BLOQUE — heures calmes (${hour}h ET) — SMS non envoye a ${to}`);
    return false;
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

  // SMS opt-out check
  try {
    const { query } = await import('@/lib/db');
    const optout = await query(`SELECT 1 FROM kv_store WHERE key = $1`, ['sms_optout_' + phone]);
    if (optout.length > 0) {
      console.log(`[SMS] BLOQUE — ${to} est desabonne (opt-out)`);
      return false;
    }
  } catch { /* DB check failed — proceed with send */ }

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

    // Log SMS to database
    try {
      const { query: dbQuery } = await import('@/lib/db');
      await dbQuery(
        `INSERT INTO sms_logs (direction, from_number, to_number, message, statut) VALUES ('outbound', $1, $2, $3, 'sent')`,
        [from, phone, body]
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

// Send follow-up SMS to client (single relance after 5 days, no earlier SMS)
export async function sendFollowUpSMS(clientPhone: string, clientName: string, quoteId: number) {
  if (!clientPhone) return false;
  const prenom = clientName.split(' ')[0];

  const msg = `Salut ${prenom}! C'est Luca de Novus Epoxy. Je voulais m'assurer que t'avais bien recu notre soumission #${quoteId}. Si t'as des questions ou tu veux qu'on en discute, n'hesite pas a m'appeler au ${LUCA_PHONE}. Bonne journee!`;
  return sendSMS(clientPhone, msg);
}

// SMS confirmation when deposit is received
export async function sendDepositConfirmationSMS(clientPhone: string, clientName: string, jour1Date?: string, jour2Date?: string) {
  if (!clientPhone) return false;
  const prenom = clientName.split(' ')[0];

  const datesInfo = jour1Date && jour2Date
    ? ` Tes dates du ${jour1Date} et ${jour2Date} sont confirmees.`
    : '';

  const msg = `${prenom}, c'est Luca de Novus Epoxy! Depot bien recu, merci!${datesInfo} On a hate de transformer ton plancher! Questions? ${LUCA_PHONE}`;
  return sendSMS(clientPhone, msg);
}

// SMS referral request 6 months after completed work
export async function sendReferralSMS(clientPhone: string, clientName: string) {
  if (!clientPhone) return false;
  const prenom = clientName.split(' ')[0];

  const msg = `Salut ${prenom}! C'est Luca de Novus Epoxy. Ca fait deja quelques mois qu'on a fait ton plancher — j'espere que t'en profites! Si tu connais quelqu'un qui voudrait la meme chose, on offre 100$ de rabais pour chaque reference. Passe le mot! ${LUCA_PHONE}`;
  return sendSMS(clientPhone, msg);
}

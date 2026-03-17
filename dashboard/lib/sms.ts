// Twilio SMS integration for Novus Epoxy
// Sends notifications to admin and follow-ups to clients

const TWILIO_SID = () => process.env.TWILIO_ACCOUNT_SID ?? '';
const TWILIO_TOKEN = () => process.env.TWILIO_AUTH_TOKEN ?? '';
const TWILIO_FROM = () => process.env.TWILIO_PHONE_NUMBER ?? '';

export async function sendSMS(to: string, body: string): Promise<boolean> {
  const sid = TWILIO_SID();
  const token = TWILIO_TOKEN();
  const from = TWILIO_FROM();

  if (!sid || !token || !from) {
    console.error('Twilio not configured — missing TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, or TWILIO_PHONE_NUMBER');
    return false;
  }

  // Normalize Quebec phone number
  const cleaned = to.replace(/[^0-9+]/g, '');
  const phone = cleaned.startsWith('+') ? cleaned : cleaned.startsWith('1') ? `+${cleaned}` : `+1${cleaned}`;

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

// Send follow-up SMS to client
export async function sendFollowUpSMS(clientPhone: string, clientName: string, quoteId: number, attempt: number) {
  if (!clientPhone) return false;

  const messages: Record<number, string> = {
    1: `Bonjour ${clientName}! C'est Novus Epoxy. On vous a envoye une soumission #${quoteId} par email. Avez-vous eu la chance d'y jeter un coup d'oeil? N'hesitez pas a nous ecrire si vous avez des questions!`,
    2: `Bonjour ${clientName}, petit rappel de Novus Epoxy! Votre soumission #${quoteId} est toujours valide. On serait ravis de planifier vos travaux. Repondez a ce message ou appelez-nous au 581-307-2678.`,
  };

  const msg = messages[attempt] ?? messages[2];
  return sendSMS(clientPhone, msg);
}

/**
 * Sends prospect/outreach emails via Resend API.
 * Display name: "Novus Epoxy"
 * Reply-To: gestionnovusepoxy@gmail.com (Aria catches replies)
 *
 * Uses Resend instead of Gmail API to avoid Gmail rate limits/blocks.
 * Resend free tier: 3000 emails/month, 100/day.
 */
export async function sendProspectEmail({
  to,
  subject,
  html,
  replyTo,
}: {
  to: string;
  subject: string;
  html: string;
  replyTo?: string;
}): Promise<{ id: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error('RESEND_API_KEY missing');

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'Novus Epoxy <jason@novusepoxy.shop>',
      to,
      subject,
      html,
      reply_to: replyTo ?? 'gestionnovusepoxy@gmail.com',
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Resend error ${res.status}: ${err}`);
  }

  const data = await res.json();
  return { id: data.id ?? `resend-${Date.now()}` };
}

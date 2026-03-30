/**
 * Sends prospect/outreach emails via Resend API.
 * Display name: "Novus Epoxy"
 * Reply-To: gestionnovusepoxy@gmail.com (Aria catches replies)
 *
 * Features:
 * - Idempotency-Key header prevents duplicate sends on retry/timeout
 * - Optional scheduled_at for staggered delivery (avoids Gmail Promotions)
 * - BCC to admin for monitoring
 */
export async function sendProspectEmail({
  to,
  subject,
  html,
  text,
  replyTo,
  idempotencyKey,
  scheduledAt,
}: {
  to: string;
  subject: string;
  html?: string;
  text?: string;
  replyTo?: string;
  idempotencyKey?: string;
  scheduledAt?: string; // ISO date string — Resend delivers at this time
}): Promise<{ id: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error('RESEND_API_KEY missing');

  const headers: Record<string, string> = {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };
  if (idempotencyKey) {
    headers['Idempotency-Key'] = idempotencyKey;
  }

  const body: Record<string, unknown> = {
    from: 'Novus Epoxy <jason@novusepoxy.shop>',
    to,
    subject,
    reply_to: replyTo ?? 'gestionnovusepoxy@gmail.com',
    bcc: ['gestionnovusepoxy@gmail.com'],
  };
  if (text) body.text = text;
  if (html) body.html = html;
  if (scheduledAt) body.scheduled_at = scheduledAt;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Resend error ${res.status}: ${err}`);
  }

  const data = await res.json();
  return { id: data.id ?? `resend-${Date.now()}` };
}

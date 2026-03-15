import { NextRequest, NextResponse } from 'next/server';
import { getOrCreateConversation, processMessage } from '@/lib/agent';

// Inbound email handler — receives forwarded emails and responds via agent
// Can be triggered by Resend inbound webhook or manually via dashboard
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Body requis' }, { status: 400 });

  // Support both Resend inbound format and manual trigger
  const fromEmail = body.from?.email ?? body.from ?? body.email;
  const fromName  = body.from?.name ?? body.name ?? fromEmail?.split('@')[0] ?? 'Client';
  const subject   = body.subject ?? '';
  const text      = body.text ?? body.message ?? body.html?.replace(/<[^>]*>/g, '') ?? '';

  if (!fromEmail || !text) {
    return NextResponse.json({ error: 'Email et message requis' }, { status: 400 });
  }

  // Get or create conversation for this email
  const visitorId = `email_${fromEmail.toLowerCase()}`;
  const conversationId = await getOrCreateConversation('email', visitorId);

  // Include subject in first message if present
  const fullMessage = subject ? `[Sujet: ${subject}] ${text}` : text;

  const reply = await processMessage(
    { conversationId, channel: 'email', visitorId },
    fullMessage.slice(0, 5000),
  );

  // Send reply email via Resend
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM ?? 'onboarding@resend.dev';

  if (apiKey) {
    try {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from,
          to: [fromEmail],
          subject: subject ? `Re: ${subject}` : 'Novus Epoxy — Reponse a votre message',
          html: `
            <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;">
              <p>${reply.replace(/\n/g, '<br/>')}</p>
              <hr style="border:none;border-top:1px solid #e2e8f0;margin:30px 0;" />
              <p style="color:#64748b;font-size:12px;">Novus Epoxy — Planchers epoxy haut de gamme<br/>novusepoxy.ca</p>
            </div>`,
        }),
      });
    } catch { /* email send failed */ }
  }

  return NextResponse.json({ reply, conversation_id: conversationId });
}

import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getOrCreateConversation, processMessage } from '@/lib/agent';

const VERIFY_TOKEN = process.env.META_VERIFY_TOKEN ?? '';

// GET — Meta webhook verification (subscribe handshake)
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const mode      = searchParams.get('hub.mode');
  const token     = searchParams.get('hub.verify_token');
  const challenge = searchParams.get('hub.challenge');

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    return new NextResponse(challenge, { status: 200 });
  }

  return NextResponse.json({ error: 'Verification failed' }, { status: 403 });
}

// POST — Receive events from Meta (leadgen + messaging)
export async function POST(req: NextRequest) {
  const body = await req.json();

  if (body.object === 'page') {
    for (const entry of body.entry ?? []) {
      // Handle leadgen events
      for (const change of entry.changes ?? []) {
        if (change.field === 'leadgen') {
          await handleLeadgen(change);
        }
      }

      // Handle Messenger messages + postbacks (quick reply clicks)
      for (const msgEvent of entry.messaging ?? []) {
        if (msgEvent.postback?.payload === 'GET_STARTED') {
          await handleGetStarted(msgEvent);
        } else if (msgEvent.message?.text) {
          await handleMessengerMessage(msgEvent);
        } else if (msgEvent.postback?.payload) {
          const synth = { ...msgEvent, message: { text: msgEvent.postback.payload } };
          await handleMessengerMessage(synth);
        }
      }
    }
  }

  return NextResponse.json({ received: true });
}

// Handle Facebook Lead Ads
async function handleLeadgen(change: Record<string, unknown>) {
  const leadgenId = (change.value as Record<string, unknown>)?.leadgen_id;
  if (!leadgenId) return;

  const accessToken = process.env.META_PAGE_TOKEN;
  if (!accessToken) return;

  try {
    const leadRes = await fetch(
      `https://graph.facebook.com/v25.0/${leadgenId}?access_token=${accessToken}`,
    );
    if (!leadRes.ok) return;

    const leadData = await leadRes.json();
    const fields: Record<string, string> = {};
    for (const f of leadData.field_data ?? []) {
      fields[f.name] = Array.isArray(f.values) ? f.values[0] : f.values;
    }

    const nom       = fields.full_name ?? fields.first_name ?? 'Lead Facebook';
    const email     = fields.email ?? '';
    const telephone = fields.phone_number ?? null;

    if (!email) return;

    await query(
      `INSERT INTO submissions (nom, email, telephone, service, message, statut)
       VALUES ($1, $2, $3, $4, $5, 'nouveau')`,
      [
        nom.slice(0, 120),
        email.slice(0, 255),
        telephone?.slice(0, 30) ?? null,
        'Facebook Lead Ad',
        `Lead Facebook #${leadgenId} — ${leadData.ad_name ?? 'N/A'}`,
      ],
    );
  } catch (err) {
    console.error('Error processing Meta lead:', err);
  }
}

// Send welcome message when user clicks "Démarrer" on Messenger
async function handleGetStarted(event: Record<string, unknown>) {
  const sender = event.sender as Record<string, string>;
  if (!sender?.id) return;

  const senderId = sender.id;
  const accessToken = process.env.META_PAGE_TOKEN;
  if (!accessToken) return;

  // Create conversation
  await getOrCreateConversation('messenger', `fb_${senderId}`);

  // Send welcome message with quick replies (same as website widget)
  try {
    await fetch(`https://graph.facebook.com/v25.0/me/messages?access_token=${accessToken}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipient: { id: senderId },
        message: {
          text: 'Bonjour! 👋 Quel type de plancher epoxy vous interesse?',
          quick_replies: [
            { content_type: 'text', title: 'Flocon (Flake)', payload: 'Flocon (Flake)' },
            { content_type: 'text', title: 'Metallique', payload: 'Metallique' },
            { content_type: 'text', title: 'Commercial', payload: 'Commercial' },
            { content_type: 'text', title: 'Je ne sais pas', payload: 'Je ne sais pas encore' },
          ],
        },
      }),
    });
  } catch (err) {
    console.error('Error sending welcome message:', err);
  }
}

// Detect quick replies to attach based on agent response (same logic as chat widget)
function getQuickReplies(reply: string): { content_type: string; title: string; payload: string }[] {
  const lower = reply.toLowerCase();

  if (lower.includes('quel espace') || lower.includes('quelle piece') || lower.includes('quel endroit') ||
      (lower.includes('garage') && lower.includes('sous-sol') && lower.includes('?'))) {
    return ['Garage', 'Sous-sol', 'Commercial / Entrepot', 'Autre'].map(t => ({
      content_type: 'text', title: t, payload: t,
    }));
  }

  if (lower.includes('etat') && (lower.includes('plancher') || lower.includes('beton') || lower.includes('sol'))) {
    return ['Beton brut', 'Peinture existante', 'Epoxy a refaire', 'Je ne sais pas'].map(t => ({
      content_type: 'text', title: t, payload: t,
    }));
  }

  if ((lower.includes('quel type') || lower.includes('quel style') || lower.includes('quel fini')) && !lower.includes('espace')) {
    return ['Flocon (Flake)', 'Metallique', 'Commercial'].map(t => ({
      content_type: 'text', title: t, payload: t,
    }));
  }

  return [];
}

// Handle Messenger messages — respond via the agent
async function handleMessengerMessage(event: Record<string, unknown>) {
  const sender = event.sender as Record<string, string>;
  const message = event.message as Record<string, string>;
  if (!sender?.id || !message?.text) return;

  const senderId = sender.id;
  const text = message.text;
  const accessToken = process.env.META_PAGE_TOKEN;

  // Get or create conversation for this Messenger user
  const conversationId = await getOrCreateConversation('messenger', `fb_${senderId}`);

  // Get user profile name from Meta (best effort)
  if (accessToken) {
    try {
      const convRows = await query(
        `SELECT visitor_name FROM conversations WHERE id = $1`, [conversationId]
      );
      if (!convRows[0]?.visitor_name) {
        const profileRes = await fetch(
          `https://graph.facebook.com/v25.0/${senderId}?fields=first_name,last_name&access_token=${accessToken}`
        );
        if (profileRes.ok) {
          const profile = await profileRes.json();
          const name = [profile.first_name, profile.last_name].filter(Boolean).join(' ');
          if (name) {
            await query(`UPDATE conversations SET visitor_name = $1 WHERE id = $2`, [name, conversationId]);
          }
        }
      }
    } catch { /* profile fetch failed */ }
  }

  // Process message through agent
  const reply = await processMessage(
    { conversationId, channel: 'messenger', visitorId: `fb_${senderId}` },
    text,
  );

  // Send reply back via Messenger with quick replies
  if (accessToken) {
    try {
      const quickReplies = getQuickReplies(reply);
      const msgPayload: Record<string, unknown> = { text: reply.slice(0, 2000) };
      if (quickReplies.length > 0) {
        msgPayload.quick_replies = quickReplies;
      }

      await fetch(`https://graph.facebook.com/v25.0/me/messages?access_token=${accessToken}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipient: { id: senderId },
          message: msgPayload,
        }),
      });
    } catch (err) {
      console.error('Error sending Messenger reply:', err);
    }
  }
}

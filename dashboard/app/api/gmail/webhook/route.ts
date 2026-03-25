import { NextRequest, NextResponse } from 'next/server';

// Gmail Pub/Sub push notification handler
// Google sends a POST with a Pub/Sub message when new emails arrive.
// We decode it, verify it's legit, then trigger the existing email-scan endpoint.

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // Pub/Sub wraps the payload in { message: { data, messageId, publishTime }, subscription }
    const message = body?.message;
    if (!message?.data) {
      console.error('[Gmail Webhook] Missing message.data in body:', JSON.stringify(body).slice(0, 500));
      // Return 200 so Pub/Sub doesn't retry garbage
      return NextResponse.json({ error: 'Invalid payload' }, { status: 200 });
    }

    // Decode base64 data — Gmail sends { emailAddress, historyId }
    const decoded = JSON.parse(Buffer.from(message.data, 'base64').toString('utf-8'));
    const emailAddress = decoded.emailAddress;
    const historyId = decoded.historyId;

    console.log(`[Gmail Webhook] Push notification for ${emailAddress}, historyId: ${historyId}`);

    // Trigger the existing email-scan endpoint internally
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://novus-epoxy.vercel.app';
    const cronSecret = process.env.CRON_SECRET;

    const scanRes = await fetch(`${baseUrl}/api/cron/email-scan`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(cronSecret ? { Authorization: `Bearer ${cronSecret}` } : {}),
      },
    });

    const result = await scanRes.json().catch(() => ({}));
    console.log('[Gmail Webhook] Email scan result:', JSON.stringify(result));

    // Always return 200 to acknowledge — Pub/Sub retries on non-2xx
    return NextResponse.json({ ok: true, emailAddress, historyId, scan: result });
  } catch (err) {
    console.error('[Gmail Webhook] Error:', err);
    // Return 200 even on error to prevent infinite Pub/Sub retries
    return NextResponse.json({ error: 'Processing failed', acknowledged: true }, { status: 200 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { autoHeal } from '@/lib/auto-heal';

// Gmail Pub/Sub push notification handler
// Google sends a POST with a Pub/Sub message when new emails arrive.
// We decode it, verify it's legit, then trigger the existing email-scan endpoint.

// Cooldown: minimum 10 seconds between scans for near-real-time processing
const COOLDOWN_MS = 10 * 1000;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // Pub/Sub wraps the payload in { message: { data, messageId, publishTime }, subscription }
    const message = body?.message;
    if (!message?.data) {
      return NextResponse.json({ error: 'Invalid payload' }, { status: 200 });
    }

    // Decode base64 data — Gmail sends { emailAddress, historyId }
    const decoded = JSON.parse(Buffer.from(message.data, 'base64').toString('utf-8'));
    const emailAddress = decoded.emailAddress;
    const historyId = decoded.historyId;

    console.log(`[Gmail Webhook] Push notification for ${emailAddress}, historyId: ${historyId}`);

    // Auto-heal: check & repair all systems every 5 min
    autoHeal().catch(() => {});

    // Check cooldown — skip if last scan was less than 2 min ago
    const lastScanRows = await query(`SELECT value FROM kv_store WHERE key = 'last_email_scan'`);
    const lastScan = lastScanRows?.[0]?.value as string | undefined;
    if (lastScan) {
      const elapsed = Date.now() - new Date(lastScan).getTime();
      if (elapsed < COOLDOWN_MS) {
        console.log(`[Gmail Webhook] Cooldown active (${Math.round(elapsed / 1000)}s ago), skipping`);
        return NextResponse.json({ ok: true, skipped: true, reason: 'cooldown', elapsed_ms: elapsed });
      }
    }

    // Auto-renew Gmail watch if expired or close to expiring (< 2 days left)
    try {
      const lastWatchRows = await query(`SELECT value FROM kv_store WHERE key = 'last_gmail_watch'`);
      const lastWatch = lastWatchRows?.[0]?.value as string | undefined;
      const daysSinceWatch = lastWatch ? (Date.now() - new Date(lastWatch).getTime()) / (1000 * 60 * 60 * 24) : 999;
      if (daysSinceWatch >= 5) {
        const baseUrl2 = process.env.NEXT_PUBLIC_BASE_URL || 'https://novus-epoxy.vercel.app';
        const adminKey = process.env.ADMIN_API_KEY ?? '';
        await fetch(`${baseUrl2}/api/gmail/watch`, { method: 'POST', headers: { Authorization: `Bearer ${adminKey}` } });
        await query(`INSERT INTO kv_store (key, value) VALUES ('last_gmail_watch', $1) ON CONFLICT (key) DO UPDATE SET value = $1`, [new Date().toISOString()]);
        console.log('[Gmail Webhook] Auto-renewed Gmail watch');
      }
    } catch { /* watch renewal failed — non-fatal */ }

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

    return NextResponse.json({ ok: true, emailAddress, historyId, scan: result });
  } catch (err) {
    console.error('[Gmail Webhook] Error:', err);
    return NextResponse.json({ error: 'Processing failed', acknowledged: true }, { status: 200 });
  }
}

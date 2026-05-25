import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getComposio, COMPOSIO_USER_ID } from '@/lib/composio';

/**
 * GET /api/composio/connect?toolkit=GMAIL
 * Returns a redirect URL for the admin to connect a toolkit.
 *
 * GET /api/composio/connect/status
 * Returns which toolkits are connected.
 */

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const { searchParams } = req.nextUrl;
  const toolkit = searchParams.get('toolkit');
  const action = searchParams.get('action') ?? 'link';

  const composio = getComposio();

  // List connected accounts (status check)
  if (action === 'status' || !toolkit) {
    try {
      const accounts = await (composio as unknown as {
        connectedAccounts: { list: (opts: unknown) => Promise<{ items: unknown[] }>}
      }).connectedAccounts.list({ userId: COMPOSIO_USER_ID });
      return NextResponse.json({ connected: accounts?.items ?? [] });
    } catch (err) {
      return NextResponse.json({ connected: [], error: String(err) });
    }
  }

  // Whitelist allowed toolkits
  const ALLOWED_TOOLKITS = ['GOOGLESHEETS', 'GMAIL', 'GOOGLECALENDAR', 'SLACK', 'GOOGLEDRIVE', 'FACEBOOK', 'META_ADS', 'FACEBOOK_LEAD_ADS', 'INSTAGRAM'];
  if (!ALLOWED_TOOLKITS.includes(toolkit.toUpperCase())) {
    return NextResponse.json({ error: 'Toolkit non autorisé' }, { status: 400 });
  }

  // Generate connect URL for a toolkit
  const base = process.env.NEXTAUTH_URL ?? 'https://novus-epoxy.srv1478812.hstgr.cloud';
  try {
    const connection = await (composio as unknown as {
      connectedAccounts: {
        link: (userId: string, toolkit: string, opts: unknown) => Promise<{ redirectUrl: string }>
      }
    }).connectedAccounts.link(COMPOSIO_USER_ID, toolkit.toUpperCase(), {
      callbackUrl: `${base}/dashboard/settings?composio=connected&toolkit=${toolkit}`,
    });
    return NextResponse.json({ url: connection.redirectUrl, toolkit });
  } catch (err) {
    // Fallback: try initiate method (older API)
    try {
      const connection = await (composio as unknown as {
        connectedAccounts: {
          initiate: (userId: string, toolkit: string, opts: unknown) => Promise<{ redirectUrl: string }>
        }
      }).connectedAccounts.initiate(COMPOSIO_USER_ID, toolkit.toUpperCase(), {
        callbackUrl: `${base}/dashboard/settings?composio=connected&toolkit=${toolkit}`,
      });
      return NextResponse.json({ url: connection.redirectUrl, toolkit });
    } catch (err2) {
      return NextResponse.json({ error: String(err2) }, { status: 500 });
    }
  }
}

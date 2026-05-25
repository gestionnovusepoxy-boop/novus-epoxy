import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token');
  const adminKey = process.env.ADMIN_API_KEY ?? '';
  if (!token || token !== adminKey) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json({ error: 'GOOGLE_CLIENT_ID manquant' }, { status: 500 });
  }

  // Use Vercel URL — already registered in Google Cloud Console
  const redirectUri = 'https://novus-epoxy.vercel.app/api/auth/google/callback';

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'https://mail.google.com/',
    access_type: 'offline',
    prompt: 'consent',
    state: adminKey,
  });

  return NextResponse.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
}

import { NextRequest, NextResponse } from 'next/server';
import { google } from 'googleapis';
import { auth } from '@/lib/auth';

export async function GET(req: NextRequest) {
  // REQUIRE admin auth — this page shows sensitive tokens
  const session = await auth();
  if (!session) return new NextResponse('<h1>Non autorisé</h1>', { status: 401, headers: { 'Content-Type': 'text/html' } });

  const { searchParams } = new URL(req.url);
  const code = searchParams.get('code');

  if (!code) {
    return new NextResponse('<h1>Erreur: pas de code Google</h1>', { headers: { 'Content-Type': 'text/html' } });
  }

  const oauth2 = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    'https://novus-epoxy.vercel.app/api/auth/google/callback'
  );

  try {
    const { tokens } = await oauth2.getToken(code);
    const refreshToken = tokens.refresh_token;

    if (!refreshToken) {
      return new NextResponse(
        '<h1>Erreur: pas de refresh token</h1><p>Essaie de nouveau avec prompt=consent</p>',
        { headers: { 'Content-Type': 'text/html' } }
      );
    }

    // Show the token so we can update Vercel env var
    return new NextResponse(
      `<!DOCTYPE html><html><body style="font-family:sans-serif;max-width:600px;margin:50px auto;padding:20px;">
        <h1 style="color:green;">Google reconnecte!</h1>
        <p>Nouveau refresh token:</p>
        <textarea style="width:100%;height:80px;font-family:monospace;font-size:12px;" readonly onclick="this.select()">${refreshToken}</textarea>
        <p style="color:red;font-weight:bold;">Copie ce token et donne-le a Claude pour mettre a jour Vercel.</p>
        <p>Access token: ${tokens.access_token?.slice(0, 30)}...</p>
        <p>Expiry: ${tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : 'N/A'}</p>
      </body></html>`,
      { headers: { 'Content-Type': 'text/html' } }
    );
  } catch (err) {
    return new NextResponse(
      `<h1>Erreur OAuth</h1><pre>${err instanceof Error ? err.message : String(err)}</pre>`,
      { headers: { 'Content-Type': 'text/html' } }
    );
  }
}

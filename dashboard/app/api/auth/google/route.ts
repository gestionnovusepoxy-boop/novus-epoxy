import { NextResponse } from 'next/server';
import { google } from 'googleapis';

/**
 * Google OAuth init — redirects to the consent screen so Luca can re-authorize.
 * On success, /api/auth/google/callback stores the new refresh_token in kv_store
 * + Vercel env and clears the gmail_oauth_broken flag.
 *
 * Just visit: https://novus-epoxy.vercel.app/api/auth/google
 *
 * access_type=offline + prompt=consent are REQUIRED to receive a refresh_token
 * (Google only returns it on first consent OR when forced via prompt=consent).
 */
const SCOPES = [
  'https://www.googleapis.com/auth/gmail.modify', // read + label + trash (covers cleanup + scan)
  'https://www.googleapis.com/auth/gmail.send',   // send emails as gestionnovusepoxy@gmail.com
  'https://www.googleapis.com/auth/drive.readonly', // Sage portfolio scan
];

export async function GET() {
  const clientId = process.env.GOOGLE_WEB_CLIENT_ID || process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_WEB_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return new NextResponse(
      '<h1>Erreur: GOOGLE_WEB_CLIENT_ID / SECRET manquant dans les env vars Vercel</h1>',
      { status: 500, headers: { 'Content-Type': 'text/html' } }
    );
  }

  const oauth2 = new google.auth.OAuth2(
    clientId,
    clientSecret,
    'https://novus-epoxy.vercel.app/api/auth/google/callback'
  );

  const url = oauth2.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent', // force refresh_token even on re-auth
    scope: SCOPES,
  });

  return NextResponse.redirect(url);
}

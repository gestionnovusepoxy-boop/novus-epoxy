import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const token = process.env.META_PAGE_TOKEN;
  if (!token) return NextResponse.json({ error: 'META_PAGE_TOKEN manquant' }, { status: 500 });

  // Get page ID from token
  const meRes = await fetch(`https://graph.facebook.com/v25.0/me?access_token=${token}`);
  const me = await meRes.json();
  if (!meRes.ok || !me.id) {
    return NextResponse.json({ error: 'Token invalide ou expiré', detail: me }, { status: 500 });
  }

  const pageId = me.id;

  // Check current subscriptions
  const checkRes = await fetch(`https://graph.facebook.com/v25.0/${pageId}/subscribed_apps?access_token=${token}`);
  const checkData = await checkRes.json();

  // Subscribe page to leadgen events
  const subRes = await fetch(`https://graph.facebook.com/v25.0/${pageId}/subscribed_apps`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      subscribed_fields: ['leadgen'],
      access_token: token,
    }),
  });
  const subData = await subRes.json();

  return NextResponse.json({
    page_id: pageId,
    page_name: me.name,
    existing_subscriptions: checkData,
    subscribe_result: subData,
    ok: subData.success === true,
  });
}

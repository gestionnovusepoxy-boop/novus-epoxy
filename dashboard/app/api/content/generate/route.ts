import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query } from '@/lib/db';

const CONTENT_PROMPT = `Tu es le gestionnaire marketing de Novus Epoxy, specialiste en planchers epoxy haut de gamme au Quebec.

Genere un post pour les reseaux sociaux (Facebook/Instagram) en francais quebecois.

REGLES:
- Ton decontracte mais professionnel
- Utilise des emojis avec moderation (2-3 max)
- Inclus un appel a l'action (CTA)
- Mentionne novusepoxy.ca quand pertinent
- Maximum 280 caracteres pour le post principal
- Ajoute 5-8 hashtags pertinents separes
- Le post doit donner envie aux gens de nous contacter

TYPES DE POSTS:
1. "projet" — met en valeur un projet recent (utilise les details fournis)
2. "conseil" — donne un conseil utile sur l'entretien ou le choix d'epoxy
3. "promo" — annonce une promotion ou offre speciale
4. "temoignage" — simule un temoignage client satisfait
5. "educatif" — explique un aspect technique de facon simple

Reponds en JSON: {"post": "texte du post", "hashtags": "#tag1 #tag2 ...", "type": "le type", "image_suggestion": "description de l'image ideale a accompagner"}`;

// POST — Generate social media content
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Non autorise' }, { status: 401 });

  const body = await req.json().catch(() => null);
  const contentType = body?.type ?? 'conseil';
  const details = body?.details ?? '';

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'ANTHROPIC_API_KEY manquant' }, { status: 500 });

  // Get recent completed projects for context
  const recentProjects = await query(
    `SELECT type_service, superficie, couleur_flake, client_adresse
     FROM quotes WHERE statut IN ('complete', 'planifie')
     ORDER BY created_at DESC LIMIT 5`,
    []
  );

  const projectContext = recentProjects.length > 0
    ? `\n\nPROJETS RECENTS:\n${recentProjects.map(p =>
        `- ${p.type_service} ${p.superficie}pi²${p.couleur_flake ? ` couleur ${p.couleur_flake}` : ''}${p.client_adresse ? ` a ${(p.client_adresse as string).split(',')[0]}` : ''}`
      ).join('\n')}`
    : '';

  const userPrompt = `Genere un post de type "${contentType}".${details ? `\nDetails: ${details}` : ''}${projectContext}\n\nReponds en JSON uniquement.`;

  const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 500,
      system: CONTENT_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });

  if (!claudeRes.ok) return NextResponse.json({ error: 'Erreur API Claude' }, { status: 500 });

  const claudeData = await claudeRes.json();
  const text = claudeData.content?.[0]?.text ?? '';

  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    const content = jsonMatch ? JSON.parse(jsonMatch[0]) : { post: text, hashtags: '', type: contentType };
    return NextResponse.json({ ok: true, content });
  } catch {
    return NextResponse.json({ ok: true, content: { post: text, hashtags: '', type: contentType, image_suggestion: '' } });
  }
}

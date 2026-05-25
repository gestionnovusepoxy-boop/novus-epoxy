import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query } from '@/lib/db';
import { callLLM } from '@/lib/llm';

const SYSTEM_PROMPT = `Tu es l'agent Lead Hunter de Novus Epoxy, une entreprise de planchers époxy haut de gamme au Québec.

Ton rôle est de générer des stratégies de prospection et des messages d'outreach personnalisés pour trouver de nouveaux clients.

Services offerts:
- Plancher époxy flocon (flake): 8.50$/pi² — garages, sous-sols
- Plancher époxy métallique: 12.75$/pi² — haut de gamme, résidentiel
- Plancher époxy commercial: 15.00$/pi² — entrepôts, commerces

Zone de service: Gatineau, Ottawa, Outaouais, Est ontarien
Site web: novusepoxy.ca

Tes messages doivent être:
- En français québécois naturel (pas trop formel)
- Courts et directs pour SMS, plus détaillés pour email
- Inclure un appel à l'action clair (soumission gratuite, lien vers le site)
- Mentionner des éléments spécifiques au quartier/type de client quand possible`;

const ACTION_PROMPTS: Record<string, string> = {
  prospection:
    'Génère des messages de prospection personnalisés (SMS, email et message Facebook) pour le client/cible suivant. Adapte le ton à chaque canal.',
  campagne:
    'Crée une stratégie complète de campagne d\'outreach avec : calendrier, canaux recommandés, suggestions de budget, et exemples de messages.',
  analyse:
    'Analyse le marché/zone cible ci-dessous et suggère les meilleures approches de prospection, les types de clients à prioriser et le potentiel estimé.',
};

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  }

  const body = await req.json();
  const { action, details } = body as { action?: string; details?: string };

  if (!action || !details) {
    return NextResponse.json(
      { error: 'Les champs action et details sont requis' },
      { status: 400 },
    );
  }

  const actionPrompt = ACTION_PROMPTS[action];
  if (!actionPrompt) {
    return NextResponse.json(
      { error: `Action invalide. Actions permises: ${Object.keys(ACTION_PROMPTS).join(', ')}` },
      { status: 400 },
    );
  }

  let result: string;
  try {
    result = await callLLM({
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: `${actionPrompt}\n\nDétails:\n${details}` }],
      maxTokens: 2048,
      tier: 'smart',
    });
  } catch (err) {
    console.error('LLM error:', err);
    return NextResponse.json({ error: 'Erreur lors de la génération AI' }, { status: 502 });
  }

  // Save to database
  await query(
    'INSERT INTO lead_campaigns (action, details, result) VALUES ($1, $2, $3)',
    [action, details, result],
  );

  return NextResponse.json({ result });
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  }

  const rows = await query(
    'SELECT * FROM lead_campaigns ORDER BY created_at DESC LIMIT 20',
    [],
  );

  return NextResponse.json({ data: rows });
}

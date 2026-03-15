import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query } from '@/lib/db';

async function scanOneReceipt(apiKey: string, file: File) {
  const bytes = await file.arrayBuffer();
  const base64 = Buffer.from(bytes).toString('base64');
  const mediaType = file.type || 'image/jpeg';

  const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: mediaType, data: base64 },
            },
            {
              type: 'text',
              text: `Analyse cette photo de facture/reçu et extrais les informations suivantes en JSON strict (pas de markdown, juste le JSON):

{
  "fournisseur": "nom du commerce/fournisseur",
  "date_depense": "YYYY-MM-DD",
  "description": "description courte des items achetés",
  "montant_ht": nombre (montant avant taxes),
  "tps": nombre (TPS 5%, ou 0 si pas visible),
  "tvq": nombre (TVQ 9.975%, ou 0 si pas visible),
  "montant_ttc": nombre (total avec taxes),
  "categorie": "une parmi: materiaux, sous_traitance, transport, equipement, marketing, loyer, assurance, admin, autre",
  "reference": "numéro de facture si visible, sinon null"
}

Si le montant HT n'est pas visible mais le total TTC l'est, calcule le HT à partir du TTC.
Si les taxes ne sont pas détaillées, mets tps et tvq à 0 et montant_ht = montant_ttc.
Pour la catégorie, devine en fonction du fournisseur et des items (ex: quincaillerie = materiaux, station essence = transport, etc).
Réponds UNIQUEMENT avec le JSON, rien d'autre.`,
            },
          ],
        },
      ],
    }),
  });

  if (!claudeRes.ok) {
    const err = await claudeRes.text();
    throw new Error(`Erreur Claude: ${err}`);
  }

  const claudeData = await claudeRes.json();
  const text = claudeData.content?.[0]?.text ?? '';
  const jsonStr = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  return JSON.parse(jsonStr);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'ANTHROPIC_API_KEY manquant' }, { status: 500 });

  const formData = await req.formData();
  const files = formData.getAll('photos') as File[];

  // Fallback: single photo field (backward compat)
  if (files.length === 0) {
    const single = formData.get('photo') as File | null;
    if (single) files.push(single);
  }

  if (files.length === 0) {
    return NextResponse.json({ error: 'Au moins une photo requise' }, { status: 400 });
  }

  if (files.length > 15) {
    return NextResponse.json({ error: 'Maximum 15 photos a la fois' }, { status: 400 });
  }

  // Load existing expenses for duplicate detection
  const existingExpenses = await query(
    `SELECT fournisseur, date_depense, montant_ttc, reference FROM expenses`
  );

  function isDuplicate(parsed: { fournisseur?: string; date_depense?: string; montant_ttc?: number; reference?: string | null }) {
    return existingExpenses.some((exp) => {
      const fournisseur = String(exp.fournisseur ?? '');
      const dateDep = String(exp.date_depense ?? '');
      const montantTtc = Number(exp.montant_ttc ?? 0);
      const reference = exp.reference ? String(exp.reference) : null;

      // Match by reference number if both have one
      if (parsed.reference && reference && parsed.reference === reference) {
        return true;
      }
      // Match by fournisseur + date + montant
      const sameSupplier = fournisseur.toLowerCase().trim() === (parsed.fournisseur ?? '').toLowerCase().trim();
      const sameDate = dateDep.slice(0, 10) === parsed.date_depense;
      const sameAmount = Math.abs(montantTtc - Number(parsed.montant_ttc ?? 0)) < 0.02;
      return sameSupplier && sameDate && sameAmount;
    });
  }

  // Process all photos in parallel (max 5 concurrent to avoid rate limits)
  const results: { file: string; data?: Record<string, unknown>; error?: string; duplicate?: boolean }[] = [];

  const batchSize = 5;
  for (let i = 0; i < files.length; i += batchSize) {
    const batch = files.slice(i, i + batchSize);
    const batchResults = await Promise.allSettled(
      batch.map(async (file, idx) => {
        try {
          const parsed = await scanOneReceipt(apiKey, file);
          const dup = isDuplicate(parsed);
          return { file: file.name || `Photo ${i + idx + 1}`, data: parsed, duplicate: dup };
        } catch (err) {
          return { file: file.name || `Photo ${i + idx + 1}`, error: err instanceof Error ? err.message : 'Erreur inconnue' };
        }
      })
    );
    for (const r of batchResults) {
      if (r.status === 'fulfilled') results.push(r.value);
      else results.push({ file: `Photo`, error: 'Erreur de traitement' });
    }
  }

  return NextResponse.json({ results });
}

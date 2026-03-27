import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query } from '@/lib/db';

export const maxDuration = 60;

interface ParsedLead {
  nom: string;
  telephone: string;
  email: string;
  service: string;
  superficie: string;
  ville: string;
  notes: string;
}

// Auto-score temperature based on data completeness + keywords
function scoreTemperature(lead: ParsedLead): 'chaud' | 'tiede' | 'froid' {
  let score = 0;
  if (lead.email) score += 2;
  if (lead.telephone) score += 2;
  if (lead.service) score += 1;
  if (lead.superficie) score += 1;
  if (lead.ville) score += 1;
  const text = `${lead.notes} ${lead.service}`.toLowerCase();
  if (text.includes('urgent') || text.includes('bientot') || text.includes('cette semaine')) score += 3;
  if (text.includes('intéressé') || text.includes('interesse') || text.includes('soumission')) score += 2;
  if (score >= 6) return 'chaud';
  if (score >= 3) return 'tiede';
  return 'froid';
}

// Parse CSV text into leads using Claude Haiku (fast + cheap)
async function parseWithClaude(rawText: string): Promise<ParsedLead[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY manquant');

  // Split into chunks of ~6000 chars to avoid context limits
  const chunks: string[] = [];
  const lines = rawText.split('\n').filter(l => l.trim());
  let current = '';
  for (const line of lines) {
    if (current.length + line.length > 6000) {
      chunks.push(current);
      current = '';
    }
    current += line + '\n';
  }
  if (current.trim()) chunks.push(current);

  const allLeads: ParsedLead[] = [];

  for (const chunk of chunks) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 4000,
        messages: [{
          role: 'user',
          content: `Parse cette liste de leads pour une entreprise de planchers epoxy au Quebec. Extrait chaque personne.\n\nLISTE:\n${chunk}\n\nReponds UNIQUEMENT avec un JSON array (pas de texte avant ou apres):\n[{"nom":"Prenom Nom","telephone":"10 chiffres ou vide","email":"email ou vide","service":"flake|metallique|commercial|quartz|couleur_unie ou vide","superficie":"nombre ou vide","ville":"ville ou vide","notes":"autres infos ou vide"}]`,
        }],
      }),
    });

    if (!res.ok) continue;
    const data = await res.json();
    const rawJson = (data.content?.[0]?.text ?? '')
      .replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    try {
      const parsed = JSON.parse(rawJson);
      if (Array.isArray(parsed)) allLeads.push(...parsed);
    } catch { /* skip bad chunk */ }
  }

  return allLeads;
}

// Try to parse structured CSV without AI (faster, no cost)
function tryParseCSV(text: string): ParsedLead[] | null {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) return null;

  const header = lines[0].toLowerCase();
  // Detect if first line is a header
  const isHeader = header.includes('nom') || header.includes('name') || header.includes('prenom')
    || header.includes('telephone') || header.includes('phone') || header.includes('email');
  if (!isHeader) return null;

  const sep = header.includes('\t') ? '\t' : header.includes(';') ? ';' : ',';
  const cols = header.split(sep).map(c => c.trim().toLowerCase().replace(/"/g, ''));

  // Map column indices
  const nameIdx = cols.findIndex(c => c.includes('nom') || c.includes('name') || c.includes('prenom'));
  const phoneIdx = cols.findIndex(c => c.includes('tel') || c.includes('phone') || c.includes('cell'));
  const emailIdx = cols.findIndex(c => c.includes('email') || c.includes('courriel') || c.includes('mail'));
  const villeIdx = cols.findIndex(c => c.includes('ville') || c.includes('city') || c.includes('address') || c.includes('adresse'));
  const serviceIdx = cols.findIndex(c => c.includes('service') || c.includes('type') || c.includes('produit'));
  const superficieIdx = cols.findIndex(c => c.includes('superficie') || c.includes('sqft') || c.includes('pi2') || c.includes('area'));
  const notesIdx = cols.findIndex(c => c.includes('note') || c.includes('comment') || c.includes('message'));

  if (nameIdx === -1) return null;

  const leads: ParsedLead[] = [];
  for (let i = 1; i < lines.length; i++) {
    const vals = lines[i].split(sep).map(v => v.trim().replace(/^"|"$/g, ''));
    const nom = vals[nameIdx] ?? '';
    if (!nom || nom.length < 2) continue;
    leads.push({
      nom,
      telephone: phoneIdx >= 0 ? (vals[phoneIdx] ?? '') : '',
      email: emailIdx >= 0 ? (vals[emailIdx] ?? '') : '',
      service: serviceIdx >= 0 ? (vals[serviceIdx] ?? '') : '',
      superficie: superficieIdx >= 0 ? (vals[superficieIdx] ?? '') : '',
      ville: villeIdx >= 0 ? (vals[villeIdx] ?? '') : '',
      notes: notesIdx >= 0 ? (vals[notesIdx] ?? '') : '',
    });
  }

  return leads.length > 0 ? leads : null;
}

// POST — preview or import
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const body = await req.json() as {
    action: 'parse' | 'import';
    text?: string;
    leads?: ParsedLead[];
    source?: string;
  };

  // PARSE — return preview
  if (body.action === 'parse') {
    const text = (body.text ?? '').trim();
    if (!text) return NextResponse.json({ error: 'Texte vide' }, { status: 400 });

    // Try CSV parse first (instant, free)
    const csvLeads = tryParseCSV(text);
    if (csvLeads) {
      return NextResponse.json({
        leads: csvLeads.map(l => ({ ...l, temperature: scoreTemperature(l) })),
        method: 'csv',
        total: csvLeads.length,
      });
    }

    // Fallback to Claude parsing
    const aiLeads = await parseWithClaude(text);
    return NextResponse.json({
      leads: aiLeads.map(l => ({ ...l, temperature: scoreTemperature(l) })),
      method: 'ai',
      total: aiLeads.length,
    });
  }

  // IMPORT — bulk insert
  if (body.action === 'import') {
    const leads = body.leads ?? [];
    const source = body.source ?? 'jason';
    if (!leads.length) return NextResponse.json({ error: 'Aucun lead' }, { status: 400 });

    // Batch insert — 50 at a time
    let imported = 0;
    let skipped = 0;
    const batchSize = 50;

    for (let i = 0; i < leads.length; i += batchSize) {
      const batch = leads.slice(i, i + batchSize);
      const values: string[] = [];
      const params: (string | null)[] = [];
      let paramIdx = 1;

      for (const lead of batch) {
        if (!lead.nom || lead.nom.trim().length < 2) { skipped++; continue; }
        const temp = scoreTemperature(lead);
        values.push(`($${paramIdx},$${paramIdx + 1},$${paramIdx + 2},$${paramIdx + 3},$${paramIdx + 4},$${paramIdx + 5},$${paramIdx + 6},$${paramIdx + 7},'nouveau',$${paramIdx + 8})`);
        params.push(
          lead.nom.trim().slice(0, 120),
          (lead.telephone || '').replace(/\D/g, '').slice(-10) || null,
          (lead.email || '').slice(0, 255) || null,
          lead.service || null,
          lead.superficie || null,
          (lead.ville || '').slice(0, 120) || null,
          lead.notes || null,
          source,
          temp,
        );
        paramIdx += 9;
      }

      if (values.length > 0) {
        await query(
          `INSERT INTO crm_leads (nom, telephone, email, service, superficie, ville, notes, source, statut, temperature) VALUES ${values.join(',')}`,
          params,
        );
        imported += values.length;
      }
    }

    return NextResponse.json({
      ok: true,
      importes: imported,
      ignores: skipped,
      total: leads.length,
      source,
    });
  }

  return NextResponse.json({ error: 'Action invalide' }, { status: 400 });
}

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query } from '@/lib/db';
import { callLLM } from '@/lib/llm';

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

// --- Lead quality validation ---
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/;
const BLOCKED_EMAIL_DOMAINS = ['example.com', 'test.com', 'domain.com', 'mailinator.com', 'guerrillamail.com', 'tempmail.com'];
const VALID_QC_AREA_CODES = ['418', '581', '819', '450', '438', '514', '579', '873', '367'];
const GARBAGE_NAME_PATTERNS = ['http', 'www', '.com', 'recipe', 'streaming', 'stock', 'valuation', 'warehouse', 'fire engulf'];

function isValidEmail(email: string): boolean {
  if (!email) return false;
  const e = email.toLowerCase().trim();
  if (!EMAIL_REGEX.test(e)) return false;
  const domain = e.split('@')[1];
  if (BLOCKED_EMAIL_DOMAINS.includes(domain)) return false;
  return true;
}

function isValidQCPhone(phone: string): boolean {
  const digits = phone.replace(/\D/g, '');
  const last10 = digits.slice(-10);
  if (last10.length !== 10) return false;
  const areaCode = last10.slice(0, 3);
  return VALID_QC_AREA_CODES.includes(areaCode);
}

function isGarbageName(name: string): boolean {
  if (!name) return true;
  if (name.length > 60) return true;
  const lower = name.toLowerCase();
  return GARBAGE_NAME_PATTERNS.some(p => lower.includes(p));
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

// Parse CSV text into leads using OpenRouter bulk tier (fast + cheap)
async function parseWithClaude(rawText: string): Promise<ParsedLead[]> {
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
    try {
      const rawJson = await callLLM({
        messages: [{
          role: 'user',
          content: `Parse cette liste de leads pour une entreprise de planchers epoxy au Quebec. Extrait chaque personne.\n\nLISTE:\n${chunk}\n\nReponds UNIQUEMENT avec un JSON array (pas de texte avant ou apres):\n[{"nom":"Prenom Nom","telephone":"10 chiffres ou vide","email":"email ou vide","service":"flake|metallique|commercial|quartz|couleur_unie ou vide","superficie":"nombre ou vide","ville":"ville ou vide","notes":"autres infos ou vide"}]`,
        }],
        maxTokens: 4000,
        tier: 'bulk',
      });
      const parsed = JSON.parse(rawJson.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim());
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
    autoProspect?: boolean;
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

    // Anti-doublon: check existing leads by phone or email
    const existingPhones = new Set<string>();
    const existingEmails = new Set<string>();
    const phonesToCheck = leads.map((l: { telephone?: string }) => (l.telephone || '').replace(/\D/g, '').slice(-10)).filter((p: string) => p.length === 10);
    const emailsToCheck = leads.map((l: { email?: string }) => (l.email || '').toLowerCase().trim()).filter((e: string) => e.includes('@'));

    if (phonesToCheck.length > 0) {
      const phPlaceholders = phonesToCheck.map((_: string, i: number) => `$${i + 1}`).join(',');
      const phRows = await query(`SELECT telephone FROM crm_leads WHERE telephone IN (${phPlaceholders})`, phonesToCheck);
      phRows.forEach((r: Record<string, unknown>) => existingPhones.add(r.telephone as string));
    }
    if (emailsToCheck.length > 0) {
      const emPlaceholders = emailsToCheck.map((_: string, i: number) => `$${i + 1}`).join(',');
      const emRows = await query(`SELECT LOWER(email) as email FROM crm_leads WHERE LOWER(email) IN (${emPlaceholders})`, emailsToCheck);
      emRows.forEach((r: Record<string, unknown>) => existingEmails.add(r.email as string));
    }

    // Batch insert — 50 at a time, skip duplicates
    let imported = 0;
    let skipped = 0;
    const insertedIds: number[] = [];
    const batchSize = 50;

    for (let i = 0; i < leads.length; i += batchSize) {
      const batch = leads.slice(i, i + batchSize);
      const values: string[] = [];
      const params: (string | null)[] = [];
      let paramIdx = 1;

      for (const lead of batch) {
        if (!lead.nom || lead.nom.trim().length < 2) { skipped++; continue; }
        // Filter garbage names
        if (isGarbageName(lead.nom)) { skipped++; continue; }
        const phone = (lead.telephone || '').replace(/\D/g, '').slice(-10);
        const email = (lead.email || '').toLowerCase().trim();
        // Validate email + phone quality — skip if BOTH are invalid
        const emailValid = isValidEmail(email);
        const phoneValid = isValidQCPhone(lead.telephone || '');
        if (!emailValid && !phoneValid) { skipped++; continue; }
        if (phone.length === 10 && existingPhones.has(phone)) { skipped++; continue; }
        if (email.includes('@') && existingEmails.has(email)) { skipped++; continue; }
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
        const insertedRows = await query(
          `INSERT INTO crm_leads (nom, telephone, email, service, superficie, ville, notes, source, statut, temperature) VALUES ${values.join(',')} RETURNING id`,
          params,
        );
        imported += values.length;
        insertedIds.push(...insertedRows.map(r => (r as { id: number }).id));
      }
    }

    // Auto-prospect: send emails + SMS to all imported leads with email
    let prospectResult = null;
    if (body.autoProspect && insertedIds.length > 0) {
      try {
        const base = process.env.NEXTAUTH_URL ?? 'https://novus-epoxy.vercel.app';
        const res = await fetch(`${base}/api/leads/jason/prospect`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': process.env.ADMIN_API_KEY ?? '',
          },
          body: JSON.stringify({ leadIds: insertedIds }),
        });
        if (res.ok) prospectResult = await res.json();
      } catch (err) {
        console.error('[Import] Auto-prospect failed:', err);
      }
    }

    return NextResponse.json({
      ok: true,
      importes: imported,
      ignores: skipped,
      total: leads.length,
      source,
      prospect: prospectResult,
    });
  }

  return NextResponse.json({ error: 'Action invalide' }, { status: 400 });
}

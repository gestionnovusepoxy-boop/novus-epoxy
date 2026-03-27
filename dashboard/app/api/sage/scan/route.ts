import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query as db } from '@/lib/db';
import { put, del } from '@vercel/blob';
import { google } from 'googleapis';
import { generateText } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';

// ─── Google Drive client ────────────────────────────────────────────────────

const DRIVE_FOLDER_ID = '1UFKHCQhlbfrSNfORap6D3u-X4vpNCmFe';

// Seuil minimum pour rentrer au portfolio (sur 10)
const MIN_QUALITY = 7;
// Max photos à ajouter par scan (évite spam)
const MAX_ADD_PER_SCAN = 15;

function getDriveClient() {
  const oauth2 = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
  );
  oauth2.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  return google.drive({ version: 'v3', auth: oauth2 });
}

// ─── Classification via Claude Vision ───────────────────────────────────────

interface PhotoClassification {
  titre: string;
  description: string;
  type_service: 'flake' | 'metallique' | 'commercial' | 'couleur_unie' | 'quartz';
  superficie: number | null;
  couleur: string;
  ville: string;
  tags: string[];
  quality_score: number; // 1-10
  portfolio_worthy: boolean;
  reject_reason: string | null;
  marketing_value: string; // "excellent" | "bon" | "moyen" | "faible"
}

async function classifyPhoto(imageUrl: string, fileName: string): Promise<PhotoClassification> {
  const { text } = await generateText({
    model: anthropic('claude-sonnet-4-6'),
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            image: imageUrl,
          },
          {
            type: 'text',
            text: `Tu es Sage, l'agent Content & Portfolio de Novus Epoxy (planchers époxy haut de gamme au Québec).

Tu dois FILTRER sévèrement les photos. Seulement les MEILLEURES rentrent au portfolio.

Analyse cette photo et retourne un JSON STRICT (pas de markdown, pas de backticks):

{
  "titre": "Titre descriptif en français (ex: Plancher époxy flake bleu garage double)",
  "description": "Description marketing 1-2 phrases",
  "type_service": "flake | metallique | commercial | couleur_unie | quartz",
  "superficie": null ou estimation en pi²,
  "couleur": "couleur dominante",
  "ville": "Québec",
  "tags": ["garage", "sous-sol", "escalier", "balcon", "commercial", "résidentiel", "intérieur", "extérieur", "haut_de_gamme", "metallique", "flake", "quartz"],
  "quality_score": 1 à 10,
  "portfolio_worthy": true ou false,
  "reject_reason": null ou "raison du rejet",
  "marketing_value": "excellent | bon | moyen | faible"
}

Nom du fichier: ${fileName}

CRITÈRES DE SÉLECTION STRICTS:
- portfolio_worthy = true SEULEMENT si TOUS ces critères sont remplis:
  1. C'est une VRAIE photo d'un plancher époxy terminé (pas en cours, pas de matériaux bruts)
  2. Bonne qualité d'image (pas floue, pas sombre, pas de doigts sur la lentille)
  3. Bon angle qui montre le fini et la brillance du plancher
  4. Le résultat est beau et vendeur (un client verrait ça et voudrait la même chose)
  5. quality_score >= 7

REJETER AUTOMATIQUEMENT (portfolio_worthy = false):
- Photos de chantier en cours, matériaux, outils, équipement
- Screenshots, texte, logos, memes, photos personnelles
- Photos trop sombres, floues, mal cadrées
- Photos qui montrent des défauts ou du travail inachevé
- Doublons visuels (même projet, même angle — garder la meilleure)
- Photos de véhicules, personnes, animaux, nourriture
- Photos de devanture/enseigne/bureau (sauf si plancher époxy visible)
- Selfies, photos de groupe

marketing_value:
- "excellent" = WOW factor, cette photo vend toute seule (quality >= 9)
- "bon" = belle photo pro qui enrichit le portfolio (quality 7-8)
- "moyen" = acceptable mais pas impressionnante (quality 5-6)
- "faible" = ne devrait pas être au portfolio (quality < 5)`,
          },
        ],
      },
    ],
    maxTokens: 500,
  });

  try {
    const cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    return JSON.parse(cleaned) as PhotoClassification;
  } catch {
    return {
      titre: fileName.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' '),
      description: '',
      type_service: 'flake',
      superficie: null,
      couleur: 'inconnu',
      ville: 'Québec',
      tags: [],
      quality_score: 3,
      portfolio_worthy: false,
      reject_reason: 'Erreur de classification',
      marketing_value: 'faible',
    };
  }
}

// ─── Main scan endpoint ─────────────────────────────────────────────────────

export async function POST(req: Request) {
  const session = await auth();
  const apiKey = req.headers.get('x-api-key');
  const isAuthed = session || apiKey === process.env.ADMIN_API_KEY;
  if (!isAuthed) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const drive = getDriveClient();

  // 1) List all image files in the folder
  const listRes = await drive.files.list({
    q: `'${DRIVE_FOLDER_ID}' in parents and mimeType contains 'image/' and trashed = false`,
    fields: 'files(id,name,mimeType,size,createdTime)',
    pageSize: 200,
    orderBy: 'createdTime desc',
  });

  const driveFiles = listRes.data.files ?? [];
  if (driveFiles.length === 0) {
    return NextResponse.json({ message: 'Aucune photo dans le Drive', scanned: 0, added: 0, rejected: 0 });
  }

  // 2) Get existing portfolio to check duplicates + understand what we have already
  const existing = await db('SELECT description, type_service FROM portfolio');
  const existingDescs = existing.map(r => String(r.description ?? ''));
  const typeCounts: Record<string, number> = {};
  for (const r of existing) {
    const t = String(r.type_service ?? 'flake');
    typeCounts[t] = (typeCounts[t] ?? 0) + 1;
  }

  const results: { name: string; status: string; titre?: string; quality?: number; reason?: string }[] = [];
  let added = 0;
  let rejected = 0;
  let alreadyImported = 0;

  for (const file of driveFiles) {
    // Stop si on a atteint le max par scan
    if (added >= MAX_ADD_PER_SCAN) {
      results.push({ name: file.name ?? '', status: 'limite atteinte — prochain scan' });
      continue;
    }

    const fileId = file.id!;
    const fileName = file.name ?? 'unknown.jpg';
    const driveMarker = `[drive:${fileId}]`;

    // Skip duplicates
    if (existingDescs.some(d => d.includes(driveMarker))) {
      alreadyImported++;
      continue;
    }

    try {
      // 3) Download from Drive
      const downloadRes = await drive.files.get(
        { fileId, alt: 'media' },
        { responseType: 'arraybuffer' },
      );
      const buffer = Buffer.from(downloadRes.data as ArrayBuffer);

      // Size filters
      if (buffer.length < 20_000) {
        results.push({ name: fileName, status: 'rejeté', reason: 'trop petit (< 20KB — probablement icône/thumbnail)' });
        rejected++;
        continue;
      }
      if (buffer.length > 20 * 1024 * 1024) {
        results.push({ name: fileName, status: 'rejeté', reason: 'trop gros (> 20MB)' });
        rejected++;
        continue;
      }

      // 4) Upload temporairement pour classification Vision
      const ext = fileName.split('.').pop() ?? 'jpg';
      const blobName = `portfolio/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const blob = await put(blobName, buffer, {
        access: 'public',
        addRandomSuffix: false,
        contentType: file.mimeType ?? 'image/jpeg',
      });

      // 5) Classification stricte avec Claude Vision
      const c = await classifyPhoto(blob.url, fileName);

      // 6) FILTRE SÉVÈRE — seulement les portfolio_worthy avec score >= MIN_QUALITY
      if (!c.portfolio_worthy || c.quality_score < MIN_QUALITY) {
        // Supprimer le blob — on gaspille pas de storage pour les rejets
        try { await del(blob.url); } catch { /* noop */ }

        results.push({
          name: fileName,
          status: 'rejeté',
          quality: c.quality_score,
          reason: c.reject_reason ?? `Score ${c.quality_score}/10 — sous le seuil de ${MIN_QUALITY}`,
        });
        rejected++;
        continue;
      }

      // 7) Vérifier si on a déjà trop de ce type (diversité du portfolio)
      const currentCount = typeCounts[c.type_service] ?? 0;
      if (currentCount >= 20) {
        try { await del(blob.url); } catch { /* noop */ }
        results.push({
          name: fileName,
          status: 'rejeté',
          quality: c.quality_score,
          reason: `Déjà ${currentCount} photos de type ${c.type_service} — portfolio saturé pour ce type`,
        });
        rejected++;
        continue;
      }

      // 8) Sauvegarder au portfolio
      const descWithMarker = c.description
        ? `${c.description} ${driveMarker}`
        : driveMarker;

      await db(
        `INSERT INTO portfolio (titre, description, type_service, superficie, couleur, ville, photos, featured)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          c.titre,
          descWithMarker,
          c.type_service,
          c.superficie,
          c.couleur,
          c.ville ?? 'Québec',
          [blob.url],
          c.quality_score >= 9, // featured seulement pour les 9-10
        ],
      );

      typeCounts[c.type_service] = currentCount + 1;
      existingDescs.push(descWithMarker);

      results.push({
        name: fileName,
        status: c.quality_score >= 9 ? '⭐ ajouté (featured)' : '✅ ajouté',
        titre: c.titre,
        quality: c.quality_score,
      });
      added++;

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({ name: fileName, status: 'erreur', reason: msg });
      rejected++;
    }
  }

  return NextResponse.json({
    message: `Sage a analysé ${driveFiles.length} photos: ${added} sélectionnées, ${rejected} rejetées, ${alreadyImported} déjà importées`,
    scanned: driveFiles.length,
    added,
    rejected,
    already_imported: alreadyImported,
    seuil_qualite: `${MIN_QUALITY}/10 minimum`,
    results,
  });
}

// ─── GET: Preview what's in Drive without importing ─────────────────────────

export async function GET(req: Request) {
  const session = await auth();
  const apiKey = req.headers.get('x-api-key');
  const isAuthed = session || apiKey === process.env.ADMIN_API_KEY;
  if (!isAuthed) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const drive = getDriveClient();

  const listRes = await drive.files.list({
    q: `'${DRIVE_FOLDER_ID}' in parents and mimeType contains 'image/' and trashed = false`,
    fields: 'files(id,name,mimeType,size,createdTime,thumbnailLink)',
    pageSize: 200,
    orderBy: 'createdTime desc',
  });

  const driveFiles = listRes.data.files ?? [];

  const existing = await db('SELECT description FROM portfolio');
  const existingDescs = existing.map(r => String(r.description ?? ''));

  const preview = driveFiles.map(f => ({
    id: f.id,
    name: f.name,
    size: f.size ? `${(Number(f.size) / 1024).toFixed(0)} KB` : 'unknown',
    date: f.createdTime,
    thumbnail: f.thumbnailLink,
    already_imported: existingDescs.some(d => d.includes(`[drive:${f.id}]`)),
  }));

  return NextResponse.json({
    folder_id: DRIVE_FOLDER_ID,
    total: driveFiles.length,
    already_imported: preview.filter(p => p.already_imported).length,
    new: preview.filter(p => !p.already_imported).length,
    seuil_qualite: `${MIN_QUALITY}/10 minimum — seules les meilleures photos sont acceptées`,
    files: preview,
  });
}

import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query as db } from '@/lib/db';
import { put } from '@vercel/blob';
import { google } from 'googleapis';
import { generateText } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';

// ─── Google Drive client ────────────────────────────────────────────────────

const DRIVE_FOLDER_ID = '1UFKHCQhlbfrSNfORap6D3u-X4vpNCmFe';

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
  skip_reason: string | null;
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
            text: `Tu es Sage, l'agent Content Creator de Novus Epoxy (planchers époxy haut de gamme au Québec).

Analyse cette photo de projet. Retourne un JSON STRICT (pas de markdown, pas de backticks) avec:

{
  "titre": "Titre descriptif en français (ex: Plancher époxy flake bleu garage double)",
  "description": "Description de 1-2 phrases décrivant le projet, le fini et l'ambiance",
  "type_service": "flake | metallique | commercial | couleur_unie | quartz",
  "superficie": null ou estimation en pieds carrés si visible,
  "couleur": "couleur dominante (ex: bleu, gris, noir, or, rouge)",
  "ville": "Québec",
  "tags": ["garage", "sous-sol", "escalier", "balcon", "commercial", "résidentiel", "intérieur", "extérieur", "haut_de_gamme", "metallique", "flake", "quartz"],
  "quality_score": 1 à 10 (10 = photo parfaite pour portfolio marketing, 1 = floue/inutile),
  "skip_reason": null si on garde la photo, ou "raison" si quality_score < 5
}

Nom du fichier: ${fileName}

IMPORTANT:
- quality_score >= 7 = photo de qualité portfolio (bonne lumière, bon angle, fini visible)
- quality_score 5-6 = acceptable
- quality_score < 5 = skip (floue, mal cadrée, pas époxy, screenshot, texte, etc.)
- Seulement les tags pertinents à la photo
- type_service DOIT être un des 5 choix exacts`,
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
      description: 'Photo de projet époxy',
      type_service: 'flake',
      superficie: null,
      couleur: 'inconnu',
      ville: 'Québec',
      tags: [],
      quality_score: 5,
      skip_reason: null,
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
    fields: 'files(id,name,mimeType,size,createdTime,thumbnailLink,webContentLink)',
    pageSize: 200,
    orderBy: 'createdTime desc',
  });

  const driveFiles = listRes.data.files ?? [];
  if (driveFiles.length === 0) {
    return NextResponse.json({ message: 'Aucune photo trouvée dans le dossier Google Drive', scanned: 0, added: 0, skipped: 0 });
  }

  // 2) Get existing portfolio photos to avoid duplicates (match by Drive file name)
  const existing = await db('SELECT titre, photos FROM portfolio');
  const existingTitles = new Set(existing.map(r => String(r.titre).toLowerCase()));
  // Also track Drive file IDs already processed via description field
  const existingDescriptions = new Set(existing.map(r => String(r.description ?? '')));

  const results: { name: string; status: string; titre?: string; quality?: number }[] = [];
  let added = 0;
  let skipped = 0;

  for (const file of driveFiles) {
    const fileId = file.id!;
    const fileName = file.name ?? 'unknown.jpg';

    // Skip if we already have this file (check by drive_id marker in description)
    const driveMarker = `[drive:${fileId}]`;
    if (existingDescriptions.has(driveMarker) || Array.from(existingDescriptions).some(d => d.includes(driveMarker))) {
      results.push({ name: fileName, status: 'déjà importé' });
      skipped++;
      continue;
    }

    try {
      // 3) Download the file from Drive
      const downloadRes = await drive.files.get(
        { fileId, alt: 'media' },
        { responseType: 'arraybuffer' },
      );
      const buffer = Buffer.from(downloadRes.data as ArrayBuffer);

      // Skip files too small (likely thumbnails) or too large
      if (buffer.length < 10_000) {
        results.push({ name: fileName, status: 'trop petit (< 10KB)' });
        skipped++;
        continue;
      }
      if (buffer.length > 20 * 1024 * 1024) {
        results.push({ name: fileName, status: 'trop gros (> 20MB)' });
        skipped++;
        continue;
      }

      // 4) Upload to Vercel Blob (temporary for classification)
      const ext = fileName.split('.').pop() ?? 'jpg';
      const blobName = `portfolio/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const blob = await put(blobName, buffer, {
        access: 'public',
        addRandomSuffix: false,
        contentType: file.mimeType ?? 'image/jpeg',
      });

      // 5) Classify with Claude Vision
      const classification = await classifyPhoto(blob.url, fileName);

      // 6) Skip low quality photos
      if (classification.quality_score < 5) {
        results.push({
          name: fileName,
          status: `skip: ${classification.skip_reason ?? 'qualité insuffisante'} (${classification.quality_score}/10)`,
          quality: classification.quality_score,
        });
        skipped++;
        // Note: blob is already uploaded but we skip DB entry.
        // Could delete blob here but Vercel Blob is cheap storage.
        continue;
      }

      // 7) Save to portfolio DB
      const descWithMarker = classification.description
        ? `${classification.description} ${driveMarker}`
        : driveMarker;

      await db(
        `INSERT INTO portfolio (titre, description, type_service, superficie, couleur, ville, photos, featured)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          classification.titre,
          descWithMarker,
          classification.type_service,
          classification.superficie,
          classification.couleur,
          classification.ville ?? 'Québec',
          [blob.url],
          classification.quality_score >= 8,
        ],
      );

      results.push({
        name: fileName,
        status: 'ajouté',
        titre: classification.titre,
        quality: classification.quality_score,
      });
      added++;

      // Update tracking sets
      existingDescriptions.add(descWithMarker);

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({ name: fileName, status: `erreur: ${msg}` });
      skipped++;
    }
  }

  return NextResponse.json({
    message: `Sage a scanné ${driveFiles.length} photos: ${added} ajoutées, ${skipped} ignorées`,
    scanned: driveFiles.length,
    added,
    skipped,
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

  // Check which are already imported
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
    files: preview,
  });
}

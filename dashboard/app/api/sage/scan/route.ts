import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query as db } from '@/lib/db';
import { put, del } from '@vercel/blob';
import { google } from 'googleapis';
import { generateText } from 'ai';
import { getStreamingModel } from '@/lib/llm';

export const maxDuration = 300; // 5 min max on Vercel Pro

// ─── Config ─────────────────────────────────────────────────────────────────

const DRIVE_FOLDER_ID = '1UFKHCQhlbfrSNfORap6D3u-X4vpNCmFe';
const MIN_QUALITY = 7;
const MAX_ADD_PER_SCAN = 15;
const MAX_VIDEO_SIZE = 100 * 1024 * 1024; // 100MB max pour vidéos
const MAX_PHOTO_SIZE = 20 * 1024 * 1024;  // 20MB max pour photos

function getDriveClient() {
  const oauth2 = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
  );
  oauth2.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  return google.drive({ version: 'v3', auth: oauth2 });
}

// ─── Classification via Claude Vision ───────────────────────────────────────

interface Classification {
  titre: string;
  description: string;
  type_service: 'flake' | 'metallique' | 'commercial' | 'couleur_unie' | 'quartz';
  superficie: number | null;
  couleur: string;
  ville: string;
  tags: string[];
  quality_score: number;
  portfolio_worthy: boolean;
  reject_reason: string | null;
  marketing_value: string;
}

async function classifyMedia(imageUrl: string, fileName: string, isVideo: boolean): Promise<Classification> {
  const mediaContext = isVideo
    ? `C'est un THUMBNAIL extrait d'une VIDÉO. Juge la qualité du projet montré, pas la qualité du thumbnail lui-même. Les vidéos de projets finis avec un bon plancher visible sont TRÈS valorisées car elles montrent le rendu réel.`
    : `C'est une PHOTO. Juge la qualité de l'image ET du projet montré.`;

  const { text } = await generateText({
    model: getStreamingModel('smart'),
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', image: imageUrl },
          {
            type: 'text',
            text: `Tu es Sage, l'agent Content & Portfolio de Novus Epoxy (planchers époxy haut de gamme au Québec).

${mediaContext}

Tu dois FILTRER sévèrement. Seulement les MEILLEURES rentrent au portfolio.

Retourne un JSON STRICT (pas de markdown, pas de backticks):

{
  "titre": "Titre descriptif en français",
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

CRITÈRES STRICTS — portfolio_worthy = true SEULEMENT si:
1. Plancher époxy TERMINÉ visible (pas en cours, pas matériaux bruts)
2. ${isVideo ? 'Le thumbnail montre clairement un beau résultat' : 'Bonne qualité image (pas floue, pas sombre)'}
3. Bon angle montrant le fini et la brillance
4. Résultat beau et vendeur
5. quality_score >= 7

REJETER (portfolio_worthy = false):
- Chantier en cours, outils, matériaux, équipement
- Screenshots, texte, logos, memes, selfies, photos personnelles
- Trop sombre, flou, mal cadré, défauts visibles
- Véhicules, personnes, animaux (sauf si plancher époxy en vedette)
- Travail inachevé`,
          },
        ],
      },
    ],
    maxTokens: 500,
  });

  try {
    const cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    return JSON.parse(cleaned) as Classification;
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

// ─── Helpers ────────────────────────────────────────────────────────────────

function isImageMime(mime: string) {
  return mime.startsWith('image/');
}

function isVideoMime(mime: string) {
  return mime.startsWith('video/') || mime === 'application/mp4';
}

type DriveFile = { id?: string | null; name?: string | null; mimeType?: string | null; size?: string | null; createdTime?: string | null; thumbnailLink?: string | null };

// ─── POST: Full scan (photos + videos) ─────────────────────────────────────

export async function POST(req: Request) {
  const session = await auth();
  const apiKey = req.headers.get('x-api-key');
  const isAuthed = session || apiKey === process.env.ADMIN_API_KEY;
  if (!isAuthed) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const drive = getDriveClient();

  // 1) List ALL media files (images + videos) in the folder
  const listRes = await drive.files.list({
    q: `'${DRIVE_FOLDER_ID}' in parents and (mimeType contains 'image/' or mimeType contains 'video/') and trashed = false`,
    fields: 'files(id,name,mimeType,size,createdTime,thumbnailLink)',
    pageSize: 200,
    orderBy: 'createdTime desc',
  });

  const driveFiles = (listRes.data.files ?? []) as DriveFile[];
  if (driveFiles.length === 0) {
    return NextResponse.json({ message: 'Aucun média dans le Drive', scanned: 0, photos_added: 0, videos_added: 0, rejected: 0 });
  }

  // 2) Existing portfolio for dedup + diversity
  const existing = await db('SELECT description, type_service FROM portfolio');
  const existingDescs = existing.map(r => String(r.description ?? ''));
  const typeCounts: Record<string, number> = {};
  for (const r of existing) {
    const t = String(r.type_service ?? 'flake');
    typeCounts[t] = (typeCounts[t] ?? 0) + 1;
  }

  const results: { name: string; type: string; status: string; titre?: string; quality?: number; reason?: string }[] = [];
  let photosAdded = 0;
  let videosAdded = 0;
  let rejected = 0;
  let alreadyImported = 0;
  let totalAdded = 0;

  for (const file of driveFiles) {
    if (totalAdded >= MAX_ADD_PER_SCAN) {
      results.push({ name: file.name ?? '', type: 'limit', status: 'limite atteinte — prochain scan' });
      continue;
    }

    const fileId = file.id!;
    const fileName = file.name ?? 'unknown';
    const mime = file.mimeType ?? '';
    const isVideo = isVideoMime(mime);
    const isImage = isImageMime(mime);
    const mediaType = isVideo ? 'video' : 'photo';
    const driveMarker = `[drive:${fileId}]`;

    if (!isImage && !isVideo) continue;

    // Skip duplicates
    if (existingDescs.some(d => d.includes(driveMarker))) {
      alreadyImported++;
      continue;
    }

    const fileSize = Number(file.size ?? 0);
    const maxSize = isVideo ? MAX_VIDEO_SIZE : MAX_PHOTO_SIZE;

    // Pre-check size from metadata (avoid downloading huge files)
    if (fileSize > 0 && fileSize > maxSize) {
      results.push({ name: fileName, type: mediaType, status: 'rejeté', reason: `trop gros (${(fileSize / 1024 / 1024).toFixed(0)}MB > ${maxSize / 1024 / 1024}MB max)` });
      rejected++;
      continue;
    }

    try {
      // ── For VIDEOS: classify using Drive thumbnail, then download if worthy ──
      if (isVideo) {
        // Google Drive génère des thumbnails pour les vidéos
        // On utilise ça pour classifier sans télécharger la vidéo entière
        let thumbnailUrl = file.thumbnailLink;

        if (!thumbnailUrl) {
          // Fallback: get file metadata with thumbnail
          const meta = await drive.files.get({
            fileId,
            fields: 'thumbnailLink',
          });
          thumbnailUrl = meta.data.thumbnailLink;
        }

        if (!thumbnailUrl) {
          results.push({ name: fileName, type: 'video', status: 'rejeté', reason: 'pas de thumbnail disponible pour classifier' });
          rejected++;
          continue;
        }

        // Enlarge thumbnail for better Vision classification (s220 -> s800)
        const bigThumb = thumbnailUrl.replace(/=s\d+/, '=s800');

        // Classify via the thumbnail
        const c = await classifyMedia(bigThumb, fileName, true);

        if (!c.portfolio_worthy || c.quality_score < MIN_QUALITY) {
          results.push({ name: fileName, type: 'video', status: 'rejeté', quality: c.quality_score, reason: c.reject_reason ?? `Score ${c.quality_score}/10` });
          rejected++;
          continue;
        }

        // Diversity check
        const count = typeCounts[c.type_service] ?? 0;
        if (count >= 20) {
          results.push({ name: fileName, type: 'video', status: 'rejeté', quality: c.quality_score, reason: `Portfolio saturé en ${c.type_service}` });
          rejected++;
          continue;
        }

        // Worthy! Download the video
        const downloadRes = await drive.files.get(
          { fileId, alt: 'media' },
          { responseType: 'arraybuffer' },
        );
        const buffer = Buffer.from(downloadRes.data as ArrayBuffer);

        if (buffer.length > MAX_VIDEO_SIZE) {
          results.push({ name: fileName, type: 'video', status: 'rejeté', reason: `vidéo trop grosse après download (${(buffer.length / 1024 / 1024).toFixed(0)}MB)` });
          rejected++;
          continue;
        }

        if (buffer.length < 50_000) {
          results.push({ name: fileName, type: 'video', status: 'rejeté', reason: 'fichier trop petit — probablement corrompu' });
          rejected++;
          continue;
        }

        // Upload video to Vercel Blob
        const ext = fileName.split('.').pop() ?? 'mp4';
        const blobName = `portfolio/video/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const blob = await put(blobName, buffer, {
          access: 'public',
          addRandomSuffix: false,
          contentType: mime || 'video/mp4',
        });

        // Save — vidéo va dans la colonne videos[], pas photos[]
        const descWithMarker = c.description ? `${c.description} ${driveMarker}` : driveMarker;

        await db(
          `INSERT INTO portfolio (titre, description, type_service, superficie, couleur, ville, videos, featured)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [c.titre, descWithMarker, c.type_service, c.superficie, c.couleur, c.ville ?? 'Québec', [blob.url], c.quality_score >= 9],
        );

        typeCounts[c.type_service] = count + 1;
        existingDescs.push(descWithMarker);
        videosAdded++;
        totalAdded++;

        results.push({
          name: fileName,
          type: 'video',
          status: c.quality_score >= 9 ? '⭐ vidéo ajoutée (featured)' : '🎬 vidéo ajoutée',
          titre: c.titre,
          quality: c.quality_score,
        });

      } else {
        // ── PHOTOS: download, upload, classify, filter ──
        const downloadRes = await drive.files.get(
          { fileId, alt: 'media' },
          { responseType: 'arraybuffer' },
        );
        const buffer = Buffer.from(downloadRes.data as ArrayBuffer);

        if (buffer.length < 20_000) {
          results.push({ name: fileName, type: 'photo', status: 'rejeté', reason: 'trop petit (< 20KB)' });
          rejected++;
          continue;
        }
        if (buffer.length > MAX_PHOTO_SIZE) {
          results.push({ name: fileName, type: 'photo', status: 'rejeté', reason: `trop gros (${(buffer.length / 1024 / 1024).toFixed(0)}MB)` });
          rejected++;
          continue;
        }

        const ext = fileName.split('.').pop() ?? 'jpg';
        const blobName = `portfolio/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const blob = await put(blobName, buffer, {
          access: 'public',
          addRandomSuffix: false,
          contentType: mime || 'image/jpeg',
        });

        const c = await classifyMedia(blob.url, fileName, false);

        if (!c.portfolio_worthy || c.quality_score < MIN_QUALITY) {
          try { await del(blob.url); } catch { /* noop */ }
          results.push({ name: fileName, type: 'photo', status: 'rejeté', quality: c.quality_score, reason: c.reject_reason ?? `Score ${c.quality_score}/10` });
          rejected++;
          continue;
        }

        const count = typeCounts[c.type_service] ?? 0;
        if (count >= 20) {
          try { await del(blob.url); } catch { /* noop */ }
          results.push({ name: fileName, type: 'photo', status: 'rejeté', quality: c.quality_score, reason: `Portfolio saturé en ${c.type_service}` });
          rejected++;
          continue;
        }

        const descWithMarker = c.description ? `${c.description} ${driveMarker}` : driveMarker;

        await db(
          `INSERT INTO portfolio (titre, description, type_service, superficie, couleur, ville, photos, featured)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [c.titre, descWithMarker, c.type_service, c.superficie, c.couleur, c.ville ?? 'Québec', [blob.url], c.quality_score >= 9],
        );

        typeCounts[c.type_service] = count + 1;
        existingDescs.push(descWithMarker);
        photosAdded++;
        totalAdded++;

        results.push({
          name: fileName,
          type: 'photo',
          status: c.quality_score >= 9 ? '⭐ ajoutée (featured)' : '✅ ajoutée',
          titre: c.titre,
          quality: c.quality_score,
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({ name: fileName, type: mediaType, status: 'erreur', reason: msg });
      rejected++;
    }
  }

  const totalMedia = driveFiles.length;
  const totalPhotos = driveFiles.filter(f => isImageMime(f.mimeType ?? '')).length;
  const totalVideos = driveFiles.filter(f => isVideoMime(f.mimeType ?? '')).length;

  return NextResponse.json({
    message: `Sage a analysé ${totalMedia} médias (${totalPhotos} photos, ${totalVideos} vidéos): ${photosAdded} photos + ${videosAdded} vidéos sélectionnées, ${rejected} rejetés, ${alreadyImported} déjà importés`,
    scanned: { total: totalMedia, photos: totalPhotos, videos: totalVideos },
    added: { photos: photosAdded, videos: videosAdded, total: totalAdded },
    rejected,
    already_imported: alreadyImported,
    seuil_qualite: `${MIN_QUALITY}/10 minimum`,
    results,
  });
}

// ─── GET: Preview all media in Drive ────────────────────────────────────────

export async function GET(req: Request) {
  const session = await auth();
  const apiKey = req.headers.get('x-api-key');
  const isAuthed = session || apiKey === process.env.ADMIN_API_KEY;
  if (!isAuthed) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const drive = getDriveClient();

  const listRes = await drive.files.list({
    q: `'${DRIVE_FOLDER_ID}' in parents and (mimeType contains 'image/' or mimeType contains 'video/') and trashed = false`,
    fields: 'files(id,name,mimeType,size,createdTime,thumbnailLink)',
    pageSize: 200,
    orderBy: 'createdTime desc',
  });

  const driveFiles = (listRes.data.files ?? []) as DriveFile[];

  const existing = await db('SELECT description FROM portfolio');
  const existingDescs = existing.map(r => String(r.description ?? ''));

  const preview = driveFiles.map(f => ({
    id: f.id,
    name: f.name,
    type: isVideoMime(f.mimeType ?? '') ? 'video' : 'photo',
    mime: f.mimeType,
    size: f.size ? `${(Number(f.size) / 1024).toFixed(0)} KB` : 'unknown',
    date: f.createdTime,
    thumbnail: f.thumbnailLink,
    already_imported: existingDescs.some(d => d.includes(`[drive:${f.id}]`)),
  }));

  const photos = preview.filter(p => p.type === 'photo');
  const videos = preview.filter(p => p.type === 'video');

  return NextResponse.json({
    folder_id: DRIVE_FOLDER_ID,
    total: driveFiles.length,
    photos: { total: photos.length, new: photos.filter(p => !p.already_imported).length, imported: photos.filter(p => p.already_imported).length },
    videos: { total: videos.length, new: videos.filter(p => !p.already_imported).length, imported: videos.filter(p => p.already_imported).length },
    seuil_qualite: `${MIN_QUALITY}/10 minimum`,
    files: preview,
  });
}

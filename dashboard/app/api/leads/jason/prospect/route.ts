import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query } from '@/lib/db';
import { sendProspectEmail } from '@/lib/send-prospect-email';
import { sendSMS } from '@/lib/sms';

export const maxDuration = 60; // Allow up to 60s for large batches

// Jason's Twilio number for prospection SMS
// SMS sent from TWILIO_PHONE_NUMBER env var

// Portfolio photo picker (same logic as Hunter)
interface PortfolioPhoto { id: number; titre: string; type_service: string; description: string | null; photos: string[] }

const IMAGE_EXTENSIONS = /\.(jpg|jpeg|png|webp|gif|bmp|svg)$/i;

async function loadPortfolio(): Promise<PortfolioPhoto[]> {
  const rows = await query(
    `SELECT id, titre, type_service, description, photos FROM portfolio WHERE array_length(photos, 1) > 0 ORDER BY featured DESC, created_at DESC`,
    [],
  );
  // Filter photos to only include images (no .mov, .mp4, etc.)
  return (rows as unknown as PortfolioPhoto[]).map(p => ({
    ...p,
    photos: p.photos.filter(url => IMAGE_EXTENSIONS.test(url)),
  })).filter(p => p.photos.length > 0);
}

function pickPhotos(portfolio: PortfolioPhoto[], notes: string, service: string, type: string): { url: string; caption: string }[] {
  const baseUrl = process.env.NEXTAUTH_URL ?? 'https://novus-epoxy.vercel.app';

  // Dedupe by photo URL to avoid showing the same image twice
  const seen = new Set<string>();
  const unique = portfolio.filter(p => {
    const url = p.photos[0];
    if (seen.has(url)) return false;
    seen.add(url);
    return true;
  });

  // Pick diverse mix: 1 per type_service, prioritize relevance
  const byType: Record<string, PortfolioPhoto[]> = {};
  for (const p of unique) {
    const t = p.type_service || 'autre';
    if (!byType[t]) byType[t] = [];
    byType[t].push(p);
  }

  const picks: PortfolioPhoto[] = [];
  // Priority order based on lead type
  const order = type === 'commercial'
    ? ['commercial', 'metallique', 'flake', 'autre']
    : ['flake', 'metallique', 'commercial', 'autre'];

  for (const t of order) {
    if (picks.length >= 2) break;
    const items = byType[t];
    if (items?.length) {
      picks.push(items[Math.floor(Math.random() * items.length)]);
    }
  }

  return picks.map(p => {
    const raw = p.photos[0];
    const url = raw.startsWith('/') ? `${baseUrl}${raw}` : raw;
    return { url, caption: p.titre };
  });
}

function getPrenom(nom: string): string {
  return nom.split(' ')[0];
}

function buildResidentialHtml(prenom: string, project: string, photos: { url: string; caption: string }[]): string {
  const photoGrid = photos.map((p, i) => {
    const pl = i % 2 === 0 ? '0' : '4px';
    const pr = i % 2 === 0 ? '4px' : '0';
    const pb = i < 2 ? '8px' : '0';
    return `<td width="50%" style="padding:0 ${pr} ${pb} ${pl};"><img src="${p.url}" alt="${p.caption}" width="270" style="border-radius:8px;display:block;max-width:100%;" /><p style="color:#64748b;font-size:11px;margin:4px 0 0;">${p.caption}</p></td>`;
  });
  const row1 = photoGrid.slice(0, 2).join('');
  const row2 = photoGrid.slice(2, 4).join('');

  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:0;background:#f8fafc;">
<div style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;max-width:600px;margin:0 auto;background:#ffffff;">
<div style="background:#0f172a;padding:24px;text-align:center;border-radius:8px 8px 0 0;">
  <img src="https://novus-epoxy.vercel.app/logo-email.jpg" alt="Novus Epoxy" width="80" height="80" style="border-radius:12px;" />
  <h1 style="color:#f59e0b;margin:12px 0 0;font-size:22px;font-weight:700;">Novus Epoxy</h1>
  <p style="color:#94a3b8;margin:4px 0 0;font-size:13px;">Planchers époxy haut de gamme — Québec</p>
</div>
<div style="padding:24px;">
  <p style="color:#1e293b;font-size:16px;margin:0 0 6px;">Bonjour ${prenom},</p>
  <div style="background:#fef3c7;border:1px solid #f59e0b;border-radius:8px;padding:14px;margin:0 0 16px;text-align:center;">
    <p style="color:#92400e;font-weight:700;font-size:16px;margin:0 0 4px;">Promotion du mois d'avril</p>
    <p style="color:#0f172a;font-weight:800;font-size:22px;margin:0;">20% de rabais sur tous nos services!</p>
    <p style="color:#78716c;font-size:12px;margin:4px 0 0;">Offre valide jusqu'au 30 avril 2026</p>
  </div>
  <p style="color:#475569;font-size:14px;line-height:1.6;margin:0 0 16px;">
    C'est Jason de Novus Epoxy! On se spécialise en planchers époxy haut de gamme dans la région de Québec.
    ${project ? `J'ai vu que vous pourriez être intéressé par <strong>${project}</strong>.` : 'On aimerait vous montrer ce qu\'on fait.'}
    Profitez de notre rabais de 20% ce mois-ci pour transformer vos planchers!
  </p>
  <p style="color:#1e293b;font-weight:700;font-size:15px;margin:0 0 12px;">Nos réalisations :</p>
  <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;">
    <tr>${row1}</tr>
    <tr>${row2}</tr>
  </table>
  <div style="background:#f8fafc;border-radius:8px;padding:16px;margin:0 0 20px;border:1px solid #e2e8f0;">
    <p style="color:#1e293b;font-weight:700;font-size:14px;margin:0 0 8px;">Pourquoi Novus Epoxy?</p>
    <p style="color:#475569;font-size:13px;line-height:1.6;margin:0;">
      ✅ Licence RBQ 5861-8471-01 — Membre APCHQ<br/>
      ✅ Garantie sur tous nos travaux<br/>
      ✅ +1 000 projets en 15 ans d'expérience<br/>
      ✅ Soumission gratuite, sans obligation
    </p>
  </div>
  <div style="text-align:center;margin:0 0 20px;">
    <p style="color:#475569;font-size:14px;margin:0 0 12px;">On peut vous préparer une soumission gratuite en moins d'une heure.</p>
    <a href="https://novusepoxy.ca/#contact" style="display:inline-block;background:#f59e0b;color:#0f172a;padding:14px 36px;border-radius:8px;text-decoration:none;font-weight:700;font-size:16px;">Demander ma soumission gratuite</a>
  </div>
  <p style="color:#94a3b8;font-size:12px;text-align:center;margin:0 0 20px;">Paiement par virement Interac accepté — 0$ de frais</p>
  <div style="border-top:1px solid #e2e8f0;padding:16px 0 0;">
    <p style="color:#1e293b;font-weight:700;font-size:13px;margin:0 0 6px;">Une question? On est là pour vous.</p>
    <p style="color:#475569;font-size:13px;margin:0 0 2px;"><strong>Luca</strong> — Facturation / Soumission — <a href="tel:5813075983" style="color:#2563eb;">581-307-5983</a></p>
    <p style="color:#475569;font-size:13px;margin:0;"><strong>Jason</strong> — Chantier / Soumission — <a href="tel:5813072678" style="color:#2563eb;">581-307-2678</a></p>
  </div>
</div>
<div style="background:#f1f5f9;padding:12px 24px;text-align:center;border-radius:0 0 8px 8px;">
  <p style="color:#94a3b8;font-size:11px;margin:0;">Novus Epoxy — 44 rue de la Polyvalente, Québec, G2N 1G8</p>
</div>
</div></body></html>`;
}

function buildCommercialHtml(prenom: string, photos: { url: string; caption: string }[]): string {
  const photoGrid = photos.map((p, i) => {
    const pl = i % 2 === 0 ? '0' : '4px';
    const pr = i % 2 === 0 ? '4px' : '0';
    const pb = i < 2 ? '8px' : '0';
    return `<td width="50%" style="padding:0 ${pr} ${pb} ${pl};"><img src="${p.url}" alt="${p.caption}" width="270" style="border-radius:8px;display:block;max-width:100%;" /><p style="color:#64748b;font-size:11px;margin:4px 0 0;">${p.caption}</p></td>`;
  });
  const row1 = photoGrid.slice(0, 2).join('');
  const row2 = photoGrid.slice(2, 4).join('');

  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:0;background:#f8fafc;">
<div style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;max-width:600px;margin:0 auto;background:#ffffff;">
<div style="background:#0f172a;padding:24px;text-align:center;border-radius:8px 8px 0 0;">
  <img src="https://novus-epoxy.vercel.app/logo-email.jpg" alt="Novus Epoxy" width="80" height="80" style="border-radius:12px;" />
  <h1 style="color:#f59e0b;margin:12px 0 0;font-size:22px;font-weight:700;">Novus Epoxy</h1>
  <p style="color:#94a3b8;margin:4px 0 0;font-size:13px;">Planchers époxy haut de gamme — Québec</p>
</div>
<div style="padding:24px;">
  <p style="color:#1e293b;font-size:16px;margin:0 0 6px;">Bonjour ${prenom},</p>
  <p style="color:#475569;font-size:14px;line-height:1.6;margin:0 0 8px;"></p>
  <div style="background:#fef3c7;border:1px solid #f59e0b;border-radius:8px;padding:14px;margin:0 0 16px;text-align:center;">
    <p style="color:#92400e;font-weight:700;font-size:16px;margin:0 0 4px;">Promotion Avril</p>
    <p style="color:#0f172a;font-weight:800;font-size:22px;margin:0;">20% de rabais sur tous nos services!</p>
    <p style="color:#78716c;font-size:12px;margin:4px 0 0;">Offre valide jusqu'au 30 avril 2026</p>
  </div>
  <p style="color:#475569;font-size:14px;line-height:1.6;margin:0 0 16px;">
    Je me presente, <strong>Jason</strong>, de Novus Epoxy. On travaille avec plusieurs entrepreneurs dans la région de Québec et on cherche à bâtir des <strong>partenariats solides</strong>.
  </p>
  <p style="color:#1e293b;font-weight:700;font-size:15px;margin:0 0 12px;">Nos réalisations :</p>
  <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;">
    <tr>${row1}</tr>
    <tr>${row2}</tr>
  </table>
  <div style="background:#0f172a;border-radius:12px;padding:24px;margin:0 0 20px;color:#ffffff;">
    <h2 style="color:#f59e0b;font-size:18px;margin:0 0 16px;">Programme Partenaire</h2>
    <p style="margin:0 0 6px;font-size:14px;">✅ Commission sur chaque projet référé</p>
    <p style="margin:0 0 6px;font-size:14px;">✅ Prix partenaire préférentiel</p>
    <p style="margin:0 0 6px;font-size:14px;">✅ Priorité de planification pour vos chantiers</p>
    <p style="margin:0 0 6px;font-size:14px;">✅ Soumission en moins d'une heure</p>
    <p style="margin:0;font-size:14px;">✅ Service clé en main</p>
  </div>
  <div style="text-align:center;margin:0 0 20px;">
    <a href="https://novusepoxy.ca/#contact" style="display:inline-block;background:#f59e0b;color:#0f172a;padding:14px 36px;border-radius:8px;text-decoration:none;font-weight:700;font-size:16px;">Nous contacter</a>
    <p style="color:#1e293b;font-size:15px;font-weight:700;margin:12px 0 0;">ou appelez Jason : 581-307-2678</p>
  </div>
  <div style="border-top:1px solid #e2e8f0;padding:16px 0 0;">
    <p style="color:#475569;font-size:13px;margin:0 0 2px;"><strong>Luca Hayes</strong> — Copropriétaire — 581-307-5983</p>
    <p style="color:#475569;font-size:13px;margin:0;"><strong>Jason</strong> — Chantier / Opérations — 581-307-2678</p>
  </div>
</div>
<div style="background:#f1f5f9;padding:12px 24px;text-align:center;border-radius:0 0 8px 8px;">
  <p style="color:#94a3b8;font-size:11px;margin:0;">Novus Epoxy — novusepoxy.ca</p>
</div>
</div></body></html>`;
}

function buildFacebookLeadHtml(prenom: string, photos: { url: string; caption: string }[]): string {
  const photoGrid = photos.slice(0, 2).map((p, i) => {
    const pl = i % 2 === 0 ? '0' : '4px';
    const pr = i % 2 === 0 ? '4px' : '0';
    return `<td width="50%" style="padding:0 ${pr} 0 ${pl};"><img src="${p.url}" alt="${p.caption}" width="270" style="border-radius:8px;display:block;max-width:100%;" /><p style="color:#64748b;font-size:11px;margin:4px 0 0;">${p.caption}</p></td>`;
  }).join('');

  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:0;background:#f8fafc;">
<div style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;max-width:600px;margin:0 auto;background:#ffffff;">
<div style="background:#0f172a;padding:24px;text-align:center;border-radius:8px 8px 0 0;">
  <img src="https://novus-epoxy.vercel.app/logo-email.jpg" alt="Novus Epoxy" width="80" height="80" style="border-radius:12px;" />
  <h1 style="color:#f59e0b;margin:12px 0 0;font-size:22px;font-weight:700;">Novus Epoxy</h1>
  <p style="color:#94a3b8;margin:4px 0 0;font-size:13px;">Planchers époxy haut de gamme — Québec</p>
</div>
<div style="padding:24px;">
  <p style="color:#1e293b;font-size:16px;margin:0 0 6px;">Bonjour ${prenom}!</p>
  <p style="color:#475569;font-size:14px;line-height:1.6;margin:0 0 8px;"></p>
  <div style="background:#fef3c7;border:1px solid #f59e0b;border-radius:8px;padding:14px;margin:0 0 16px;text-align:center;">
    <p style="color:#92400e;font-weight:700;font-size:16px;margin:0 0 4px;">Promotion Avril</p>
    <p style="color:#0f172a;font-weight:800;font-size:22px;margin:0;">20% de rabais!</p>
    <p style="color:#78716c;font-size:12px;margin:4px 0 0;">Valide jusqu'au 30 avril 2026</p>
  </div>
  <p style="color:#475569;font-size:14px;line-height:1.6;margin:0 0 16px;">
    Merci d'avoir demandé votre <strong>soumission gratuite</strong>! On est ravis de votre intérêt. Profitez de notre rabais de 20% en avril!
    Pour préparer votre soumission personnalisée rapidement, on a besoin de quelques détails :
  </p>
  <div style="background:#fffbeb;border:2px solid #f59e0b;border-radius:12px;padding:20px;margin:0 0 20px;">
    <p style="color:#1e293b;font-weight:700;font-size:15px;margin:0 0 12px;">Répondez à ce courriel avec :</p>
    <p style="color:#475569;font-size:14px;line-height:2;margin:0;">
      1. <strong>Type d'espace</strong> — Garage, sous-sol, balcon, commercial?<br/>
      2. <strong>Superficie approximative</strong> — Combien de pieds carrés?<br/>
      3. <strong>Type de fini souhaité</strong> — Flocon, métallique, couleur unie?<br/>
      4. <strong>Etat du plancher actuel</strong> — Béton brut, peinture, époxy à refaire?<br/>
      5. <strong>Adresse des travaux</strong> — Pour calculer le déplacement
    </p>
  </div>
  <div style="background:#ecfdf5;border-radius:8px;padding:16px;margin:0 0 20px;border:1px solid #6ee7b7;">
    <p style="color:#065f46;font-weight:700;font-size:14px;margin:0 0 4px;">🎉 Spécial avril — 20% de rabais!</p>
    <p style="color:#047857;font-size:13px;margin:0;">Le rabais s'applique automatiquement a votre soumission.</p>
  </div>
  ${photoGrid ? `<p style="color:#1e293b;font-weight:700;font-size:14px;margin:0 0 8px;">Quelques-unes de nos réalisations :</p>
  <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;"><tr>${photoGrid}</tr></table>` : ''}
  <div style="background:#f8fafc;border-radius:8px;padding:16px;margin:0 0 20px;border:1px solid #e2e8f0;">
    <p style="color:#475569;font-size:13px;line-height:1.6;margin:0;">
      ✅ Licence RBQ 5861-8471-01 — Membre APCHQ<br/>
      ✅ Garantie sur tous nos travaux<br/>
      ✅ +1 000 projets en 15 ans d'expérience<br/>
      ✅ Soumission gratuite en moins d'une heure
    </p>
  </div>
  <div style="text-align:center;margin:0 0 20px;">
    <p style="color:#475569;font-size:14px;margin:0 0 12px;">Vous pouvez aussi nous appeler directement :</p>
    <a href="tel:5813072678" style="display:inline-block;background:#f59e0b;color:#0f172a;padding:14px 36px;border-radius:8px;text-decoration:none;font-weight:700;font-size:16px;">Appeler maintenant — 581-307-2678</a>
  </div>
  <p style="color:#94a3b8;font-size:12px;text-align:center;margin:0 0 20px;">Paiement par virement Interac accepté — 0$ de frais</p>
  <div style="border-top:1px solid #e2e8f0;padding:16px 0 0;">
    <p style="color:#1e293b;font-weight:700;font-size:13px;margin:0 0 6px;">Votre équipe :</p>
    <p style="color:#475569;font-size:13px;margin:0 0 2px;"><strong>Luca</strong> — Facturation / Soumission — <a href="tel:5813075983" style="color:#2563eb;">581-307-5983</a></p>
    <p style="color:#475569;font-size:13px;margin:0;"><strong>Jason</strong> — Chantier / Soumission — <a href="tel:5813072678" style="color:#2563eb;">581-307-2678</a></p>
  </div>
</div>
<div style="background:#f1f5f9;padding:12px 24px;text-align:center;border-radius:0 0 8px 8px;">
  <p style="color:#94a3b8;font-size:11px;margin:0;">Novus Epoxy — 44 rue de la Polyvalente, Québec, G2N 1G8</p>
</div>
</div></body></html>`;
}

// POST — send prospect emails + SMS for a batch of lead IDs
// Called from: import flow (auto), CRM UI, or Mission Control agent
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) {
    // Also allow internal calls with API key
    const apiKey = req.headers.get('x-api-key');
    if (apiKey !== process.env.ADMIN_API_KEY) {
      return NextResponse.json({ error: 'Non autorise' }, { status: 401 });
    }
  }

  const { leadIds } = (await req.json()) as { leadIds: number[] };
  if (!leadIds?.length) return NextResponse.json({ error: 'leadIds requis' }, { status: 400 });

  // BLACKLIST: never contact owners
  const BLACKLIST_PHONES = ['5813075983', '5813072678'];
  const BLACKLIST_EMAILS = ['gestionnovusepoxy@gmail.com', 'lanthierj6@gmail.com', 'luca.hayes1994@gmail.com'];

  // === RATE LIMITING: max 100 per call, staggered via Resend scheduled_at ===
  const MAX_BATCH = 100; // API calls are instant (just scheduling), Resend delivers spaced out

  // Respect business hours: no outreach before 8h or after 21h Quebec time
  const now = new Date();
  const quebecHour = parseInt(now.toLocaleString('en-US', { timeZone: 'America/Toronto', hour: 'numeric', hour12: false }));
  if (quebecHour < 8 || quebecHour >= 20) {
    return NextResponse.json({ ok: true, emails: 0, queued: leadIds.length, message: `Hors heures (${quebecHour}h). Prochain envoi a 8h.` });
  }

  // === DEDUP: load ALL emails ever sent ===
  const alreadySentEmails = new Set<string>();
  const existingEmails = await query(
    `SELECT DISTINCT LOWER(destinataire) as email FROM email_logs`
  );
  for (const r of existingEmails) {
    alreadySentEmails.add((r.email as string).toLowerCase());
  }
  // Also check all leads with prospect_sent_at
  const alreadyContacted = await query(
    `SELECT DISTINCT LOWER(email) as email FROM crm_leads WHERE prospect_sent_at IS NOT NULL AND email IS NOT NULL`
  );
  for (const r of alreadyContacted) {
    alreadySentEmails.add((r.email as string).toLowerCase());
  }

  // Take only MAX_BATCH leads, skip the rest for next batch
  const batchIds = leadIds.slice(0, MAX_BATCH * 3); // fetch more to account for skips
  const queued = Math.max(0, leadIds.length - batchIds.length);

  const placeholders = batchIds.map((_, i) => `$${i + 1}`).join(',');
  const leads = await query(
    `SELECT id, nom, telephone, email, service, ville, notes, type, source, prospect_sent_at FROM crm_leads WHERE id IN (${placeholders})`,
    batchIds,
  );

  const portfolio = await loadPortfolio();
  let emailsSent = 0;
  let smsSent = 0;
  let skipped = 0;

  interface LeadRow { id: number; nom: string; telephone: string | null; email: string | null; service: string; ville: string; notes: string; type: string; source: string | null; prospect_sent_at: string | null }

  for (const _lead of leads) {
    const lead = _lead as unknown as LeadRow;
    if (emailsSent >= MAX_BATCH) { skipped++; continue; }
    if (lead.prospect_sent_at) { skipped++; continue; }

    // BLACKLIST check — normalize phone to last 10 digits, compare stripped
    const rawPhone = (lead.telephone ?? '').replace(/\D/g, '');
    const phone10 = rawPhone.slice(-10);
    const emailLower = (lead.email ?? '').toLowerCase().trim();
    if (BLACKLIST_PHONES.some(bp => phone10 === bp || rawPhone === bp || rawPhone.endsWith(bp)) || BLACKLIST_EMAILS.includes(emailLower)) { skipped++; continue; }

    // === ATOMIC LOCK: claim this lead in DB FIRST, before any send ===
    // If another process already claimed it, UPDATE returns 0 rows → skip
    const claimed = await query(
      `UPDATE crm_leads SET prospect_sent_at = NOW(), statut = 'offre_envoyee', updated_at = NOW()
       WHERE id = $1 AND prospect_sent_at IS NULL
       RETURNING id`,
      [lead.id],
    );
    if (claimed.length === 0) { skipped++; continue; } // Already claimed by another process

    const prenom = getPrenom(lead.nom);
    const project = lead.service || lead.notes?.split('—')[0] || '';
    const isCommercial = lead.type === 'commercial';
    const isFacebookLead = (lead.source ?? '').toLowerCase().includes('ghl') || (lead.source ?? '').toLowerCase().includes('facebook');
    const ville = lead.ville || 'Québec';

    let contacted = false;

    // 1. Send email — conversational plain text + minimal HTML (bypasses Promotions tab)
    if (lead.email && String(lead.email).includes('@') && !alreadySentEmails.has(lead.email.toLowerCase())) {
      // Subject line variants — short, personal, no promo words
      const subjectVariants = isCommercial
        ? [
            `${prenom}, question rapide`,
            `${prenom} — planchers époxy pour ${lead.nom.split(' ').slice(-1)[0] || 'votre entreprise'}`,
            `Question pour ${lead.nom.trim().slice(0, 30)}`,
          ]
        : isFacebookLead
          ? [
            `${prenom}, merci pour votre demande`,
            `${prenom} — votre soumission Novus Epoxy`,
          ]
          : [
            `${prenom}, question rapide`,
            `${prenom} — idée pour votre espace`,
            `Question pour ${lead.nom.trim().slice(0, 30)}`,
          ];
      const subject = subjectVariants[Math.floor(Math.random() * subjectVariants.length)];

      // Plain text body — conversational, <100 words, 1 question
      const textVariants = isCommercial
        ? [
            `Bonjour ${prenom},\n\nJe suis Luca de Novus Epoxy. On fait des planchers en époxy commercial et résidentiel dans la région de ${ville}.\n\nJ'ai vu ${lead.nom.trim()} et je me demandais — est-ce que vous avez déjà considéré un plancher en époxy pour vos espaces?\n\nOn travaille avec plusieurs entrepreneurs du coin. Licence RBQ, +1000 projets.\n\nSi ça vous intéresse, répondez à ce courriel ou appelez-moi.\n\nLuca\nNovus Epoxy\n581-307-5983`,
            `Bonjour ${prenom},\n\nLuca de Novus Epoxy ici. On installe des planchers époxy haut de gamme pour les entreprises dans votre secteur.\n\nOn cherche des partenaires dans la région de ${ville} — est-ce que c'est quelque chose qui pourrait vous intéresser?\n\nPas de pression, juste curieux.\n\nLuca\n581-307-5983`,
          ]
        : isFacebookLead
          ? [
            `Bonjour ${prenom},\n\nMerci pour votre demande! Pour préparer votre soumission rapidement, j'aurais besoin de quelques infos:\n\n1. Type d'espace (garage, sous-sol, balcon)?\n2. Superficie approximative?\n3. Type de fini souhaité?\n4. Adresse des travaux?\n\nRépondez à ce courriel ou appelez-moi au 581-307-5983.\n\nLuca\nNovus Epoxy`,
          ]
          : [
            `Bonjour ${prenom},\n\nJe suis Luca de Novus Epoxy. On fait des planchers en époxy haut de gamme dans la région de ${ville}.\n\n${project ? `J'ai vu que vous pourriez être intéressé par ${project} — ` : ''}est-ce que c'est quelque chose qui vous intéresserait?\n\nOn peut préparer une soumission gratuite en moins d'une heure. Licence RBQ, +1000 projets.\n\nLuca\nNovus Epoxy\n581-307-5983`,
            `Bonjour ${prenom},\n\nLuca de Novus Epoxy. On installe des planchers époxy dans le coin de ${ville}.\n\nEst-ce que vous avez un projet de plancher en tête? On fait garage, sous-sol, balcon, commercial.\n\nSi oui, répondez ici ou appelez-moi.\n\nLuca\n581-307-5983`,
          ];
      const text = textVariants[Math.floor(Math.random() * textVariants.length)];

      // Minimal HTML — same content as plain text, just with basic formatting
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>
<div style="font-family:Arial,sans-serif;font-size:14px;color:#333;max-width:600px;">
${text.split('\n').map(line => line.trim() ? `<p style="margin:0 0 8px;">${line}</p>` : '').join('\n')}
</div></body></html>`;

      try {
        const result = await sendProspectEmail({
          to: lead.email,
          subject,
          html,
          text,
          idempotencyKey: `prospect-${lead.id}-${Date.now()}`,
        });
        await query(
          `INSERT INTO email_logs (resend_id, destinataire, sujet, statut, html_body, direction) VALUES ($1, $2, $3, 'sent', $4, 'outbound')`,
          [result.id, lead.email, subject, text],
        ).catch(() => {});
        alreadySentEmails.add(lead.email.toLowerCase());
        emailsSent++;
        contacted = true;
      } catch (err) {
        console.error(`[Prospect] FAIL ${lead.email}:`, err instanceof Error ? err.message : err);
      }
    }

    // 2. SMS — send to ALL leads with phone number (with dedup check)
    const shouldSMS = lead.telephone?.trim();
    if (shouldSMS && !BLACKLIST_PHONES.includes(phone10)) {
      // DEDUP: check sms_logs if this number was already texted
      // sms_logs stores to_number in +1XXXXXXXXXX format, so check both formats
      const smsPhone10 = lead.telephone!.replace(/\D/g, '').slice(-10);
      const smsPhoneE164 = '+1' + smsPhone10;
      const alreadyTexted = await query(
        `SELECT id FROM sms_logs WHERE to_number = $1 OR to_number = $2 OR to_number LIKE $3 LIMIT 1`,
        [smsPhoneE164, smsPhone10, '%' + smsPhone10],
      );
      if (alreadyTexted.length > 0) {
        console.log(`[Jason Prospect] SMS dedup skip: ${lead.nom} (${phone10}) already in sms_logs`);
      } else {
        try {
          const smsText = isFacebookLead
            ? `Bonjour ${prenom}! Merci pour votre demande de soumission chez Novus Epoxy. Pour la préparer, j'ai besoin de quelques infos:\n\n1. Type d'espace (garage, sous-sol, balcon)?\n2. Combien de pieds carrés?\n3. Quel fini (flocon, métallique, couleur unie)?\n4. Adresse des travaux?\n\nRépondez ici ou appelez-nous: 581-307-2678\n\n— Luca, Novus Epoxy`
            : `Bonjour ${prenom}, c'est Novus Epoxy! On fait des planchers époxy haut de gamme dans la région de Québec. Soumission gratuite, licence RBQ. Appelez-nous au 581-307-2678 ou visitez novusepoxy.ca`;
          await sendSMS(lead.telephone!, smsText);
          smsSent++;
          contacted = true;
        } catch (err) {
          console.error(`[Jason Prospect] SMS failed for ${lead.nom}:`, err);
        }
      }
    }

    // Status already set by atomic lock above — no need to update again
  }

  return NextResponse.json({ ok: true, emails: emailsSent, sms: smsSent, skipped, total: leads.length, queued, max_batch: MAX_BATCH });
}

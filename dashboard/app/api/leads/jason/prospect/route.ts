import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query } from '@/lib/db';
import { sendProspectEmail } from '@/lib/send-prospect-email';
import { sendSMS } from '@/lib/sms';
import { getActivePromo, type ActivePromo } from '@/lib/promotions';

function promoBanner(p: ActivePromo): string {
  if (!p.active) return '';
  const end = p.ends_at ? p.ends_at.toLocaleDateString('fr-CA', { day: 'numeric', month: 'long', year: 'numeric' }) : null;
  return `<div style="background:#fef3c7;border:1px solid #f59e0b;border-radius:8px;padding:14px;margin:0 0 16px;text-align:center;">
    <p style="color:#92400e;font-weight:700;font-size:16px;margin:0 0 4px;">${p.label}</p>
    <p style="color:#0f172a;font-weight:800;font-size:22px;margin:0;">${p.pct}% de rabais!</p>
    ${end ? `<p style="color:#78716c;font-size:12px;margin:4px 0 0;">Offre valide jusqu'au ${end}</p>` : ''}
  </div>`;
}

function promoTextResidential(p: ActivePromo): string {
  if (!p.active) return '';
  return ` Profitez de notre rabais de ${p.pct}% (${p.label}) pour transformer vos planchers!`;
}

function promoTextFacebookIntro(p: ActivePromo): string {
  if (!p.active) return '';
  return ` Profitez de notre rabais de ${p.pct}% (${p.label})!`;
}

function promoCalloutFacebook(p: ActivePromo): string {
  if (!p.active) return '';
  return `<div style="background:#ecfdf5;border-radius:8px;padding:16px;margin:0 0 20px;border:1px solid #6ee7b7;">
    <p style="color:#065f46;font-weight:700;font-size:14px;margin:0 0 4px;">🎉 ${p.label} — ${p.pct}% de rabais!</p>
    <p style="color:#047857;font-size:13px;margin:0;">Le rabais s'applique automatiquement a votre soumission.</p>
  </div>`;
}

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

function buildResidentialHtml(prenom: string, project: string, photos: { url: string; caption: string }[], promo: ActivePromo): string {
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
  ${promoBanner(promo)}
  <p style="color:#475569;font-size:14px;line-height:1.6;margin:0 0 16px;">
    C'est Jason de Novus Epoxy! On se spécialise en planchers époxy haut de gamme dans la région de Québec.
    ${project ? `J'ai vu que vous pourriez être intéressé par <strong>${project}</strong>.` : 'On aimerait vous montrer ce qu\'on fait.'}${promoTextResidential(promo)}
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

function buildCommercialHtml(prenom: string, photos: { url: string; caption: string }[], promo: ActivePromo): string {
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
  ${promoBanner(promo)}
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

function buildFacebookLeadHtml(prenom: string, photos: { url: string; caption: string }[], promo: ActivePromo): string {
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
  ${promoBanner(promo)}
  <p style="color:#475569;font-size:14px;line-height:1.6;margin:0 0 16px;">
    Merci d'avoir demandé votre <strong>soumission gratuite</strong>! On est ravis de votre intérêt.${promoTextFacebookIntro(promo)}
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
  ${promoCalloutFacebook(promo)}
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

    // === QUALITY GATE: skip garbage/scraped leads ===
    const nom = (lead.nom ?? '').trim();
    const emailAddr = (lead.email ?? '').toLowerCase().trim();

    // Skip if name contains non-Latin chars (Hindi, Chinese, Arabic, etc.)
    if (/[^\u0000-\u024F\u1E00-\u1EFF\u2000-\u206F\u2070-\u209F\u20A0-\u20CF\u2100-\u214F]/.test(nom)) {
      await query(`UPDATE crm_leads SET statut = 'perdu', updated_at = NOW() WHERE id = $1`, [lead.id]);
      skipped++; continue;
    }
    // Skip if name looks like a URL, filename, or scraped title (too long, has special chars)
    if (nom.length > 80 || /[<>{}|\\~`]/.test(nom) || /\.(com|org|net|ca|png|jpg|html|php)/i.test(nom)) {
      await query(`UPDATE crm_leads SET statut = 'perdu', updated_at = NOW() WHERE id = $1`, [lead.id]);
      skipped++; continue;
    }
    // Skip if name has offensive/spam content
    if (/cum|porn|xxx|sex|casino|bitcoin|crypto|lottery|viagra/i.test(nom)) {
      await query(`UPDATE crm_leads SET statut = 'perdu', updated_at = NOW() WHERE id = $1`, [lead.id]);
      skipped++; continue;
    }
    // Skip emails from obvious non-Quebec domains (international news, tech companies, etc.)
    if (emailAddr && (
      emailAddr.endsWith('.png') || emailAddr.endsWith('.jpg') ||
      emailAddr.includes('sentry.io') || emailAddr.includes('pinterest.com') ||
      emailAddr.includes('noreply') || emailAddr.includes('no-reply') ||
      emailAddr.includes('unsubscribe') || emailAddr.includes('mailer-daemon')
    )) {
      await query(`UPDATE crm_leads SET statut = 'perdu', updated_at = NOW() WHERE id = $1`, [lead.id]);
      skipped++; continue;
    }
    // Skip if name is too short (1-2 chars) or just numbers
    if (nom.length < 3 || /^\d+$/.test(nom)) {
      await query(`UPDATE crm_leads SET statut = 'perdu', updated_at = NOW() WHERE id = $1`, [lead.id]);
      skipped++; continue;
    }

    const prenom = getPrenom(lead.nom);
    const isFacebookLead = (lead.source ?? '').toLowerCase().includes('ghl') || (lead.source ?? '').toLowerCase().includes('facebook');
    const ville = lead.ville || 'Québec';

    // Determine lead category for targeted messaging
    const nomLower = (lead.nom ?? '').toLowerCase();
    const notesLower = (lead.notes ?? '').toLowerCase();
    const serviceLower = (lead.service ?? '').toLowerCase();
    const isCommercial = lead.type === 'commercial' ||
      /commercial|industriel|entrepôt|entrepot|usine|manufacture|bureau/i.test(nomLower + ' ' + notesLower);
    const isPartner = /entrepreneur|contracteur|construction|rénovation|renovation|immobilier|courtier|architecte|designer|plombier|électricien|electricien/i.test(nomLower + ' ' + notesLower);

    let contacted = false;

    // 1. Send email — 3 categories: Partenaire, Résidentiel, Commercial/Industriel
    if (lead.email && String(lead.email).includes('@') && !alreadySentEmails.has(lead.email.toLowerCase())) {

      let subject: string;
      let text: string;

      if (isFacebookLead) {
        // === FACEBOOK LEAD — réponse directe à une demande ===
        subject = `${prenom}, votre soumission gratuite`;
        text = `Bonjour ${prenom},\n\nMerci pour votre demande! Je suis Luca, propriétaire de Novus Epoxy.\n\nPour préparer votre soumission rapidement, j'ai besoin de quelques infos:\n\n1. Type d'espace? (garage, sous-sol, balcon, patio)\n2. Superficie approximative en pi²?\n3. Type de fini souhaité? (métallique, flake, uni)\n\nOn peut vous envoyer une soumission détaillée en moins de 5 minutes.\n\nAppellez-moi directement: 581-307-5983\n\nLuca Hayes\nNovus Epoxy — Licence RBQ 5861-8471-01\nnovusepoxy.ca`;

      } else if (isPartner) {
        // === PARTENAIRE — offre de collaboration B2B ===
        const subjects = [
          `${prenom} — partenariat planchers époxy`,
          `Collaboration Novus Epoxy × ${prenom}`,
        ];
        subject = subjects[Math.floor(Math.random() * subjects.length)];
        text = `Bonjour ${prenom},\n\nJe suis Luca Hayes, propriétaire de Novus Epoxy. On installe des planchers en époxy haut de gamme dans la grande région de ${ville}.\n\nJe vous contacte parce qu'on cherche des partenaires dans le domaine de la construction et de la rénovation. Voici ce qu'on peut vous offrir:\n\n• Commission de référence sur chaque projet\n• Installation rapide (2 jours max)\n• Garantie 10 ans sur tous nos travaux\n• Licence RBQ 5861-8471-01\n• Plus de 1000 projets complétés\n\nSi vous avez des clients qui cherchent un plancher de garage, sous-sol, patio ou commercial — on est la solution.\n\nIntéressé? Répondez à ce courriel ou appelez-moi.\n\nLuca Hayes — 581-307-5983\nJason Lanthier — 581-307-2678\nnovusepoxy.ca`;

      } else if (isCommercial) {
        // === COMMERCIAL/INDUSTRIEL — offre de services B2B ===
        const subjects = [
          `${prenom} — planchers époxy commerciaux`,
          `Planchers haute performance pour vos espaces`,
        ];
        subject = subjects[Math.floor(Math.random() * subjects.length)];
        text = `Bonjour ${prenom},\n\nLuca Hayes de Novus Epoxy. On installe des planchers époxy haute performance pour les espaces commerciaux et industriels dans la région de ${ville}.\n\nNos planchers commerciaux offrent:\n\n• Résistance chimique et aux impacts\n• Antidérapant certifié\n• Installation rapide — minimum de temps d'arrêt\n• Entretien facile, durée de vie 15+ ans\n• Licence RBQ 5861-8471-01\n\nEntrepôt, garage commercial, showroom, restaurant — on couvre tout.\n\nSoumission gratuite en moins de 24h. Intéressé?\n\nLuca Hayes — 581-307-5983\nJason Lanthier — 581-307-2678\nnovusepoxy.ca`;

      } else {
        // === RÉSIDENTIEL — offre pour garage, balcon, patio, sous-sol ===
        const subjects = [
          `${prenom}, idée pour votre plancher`,
          `${prenom} — soumission gratuite époxy`,
        ];
        subject = subjects[Math.floor(Math.random() * subjects.length)];
        text = `Bonjour ${prenom},\n\nJe suis Luca de Novus Epoxy. On transforme les planchers de garage, sous-sol, balcon et patio en surfaces époxy haut de gamme dans la région de ${ville}.\n\nNotre offre résidentielle:\n\n• Finis métallique, flake ou uni — au choix\n• Installation en 2 jours\n• Garantie 10 ans\n• Soumission gratuite en 5 minutes\n• Plus de 1000 projets réalisés\n\nSi vous avez un projet en tête, répondez à ce courriel ou appelez-moi au 581-307-5983.\n\nVous pouvez aussi remplir notre formulaire rapide:\nhttps://novus-epoxy.vercel.app/soumission\n\nLuca Hayes\nNovus Epoxy — Licence RBQ 5861-8471-01\nnovusepoxy.ca`;
      }

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
          idempotencyKey: `prospect-${lead.id}`,
        });
        await query(
          `INSERT INTO email_logs (resend_id, destinataire, sujet, statut, html_body, direction) VALUES ($1, $2, $3, 'sent', $4, 'outbound')`,
          [result.id, lead.email, subject, text],
        ).catch(() => {});
        alreadySentEmails.add(lead.email.toLowerCase());
        emailsSent++;
        contacted = true;
        // Anti-spam delay: 15-25 sec random between sends
        await new Promise(r => setTimeout(r, 15000 + Math.random() * 10000));
      } catch (err) {
        console.error(`[Prospect] FAIL ${lead.email}:`, err instanceof Error ? err.message : err);
      }
    }

    // 2. SMS — send ONLY to valid Quebec phone numbers (with dedup check)
    const shouldSMS = lead.telephone?.trim();
    const qcAreaCodes = ['418','581','819','450','438','514','579','873','367'];
    const smsAreaCode = phone10.substring(0, 3);
    if (shouldSMS && !BLACKLIST_PHONES.includes(phone10) && qcAreaCodes.includes(smsAreaCode)) {
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

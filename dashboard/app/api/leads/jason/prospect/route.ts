import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query } from '@/lib/db';
import { sendProspectEmail } from '@/lib/send-prospect-email';
import { sendSMS } from '@/lib/sms';

export const maxDuration = 60; // Allow up to 60s for large batches

// Jason's Twilio number for prospection SMS
const JASON_TWILIO = '+15817095940';

// Portfolio photo picker (same logic as Hunter)
interface PortfolioPhoto { id: number; titre: string; type_service: string; description: string | null; photos: string[] }

async function loadPortfolio(): Promise<PortfolioPhoto[]> {
  const rows = await query(
    `SELECT id, titre, type_service, description, photos FROM portfolio WHERE array_length(photos, 1) > 0 ORDER BY featured DESC, created_at DESC`,
    [],
  );
  return rows as unknown as PortfolioPhoto[];
}

function pickPhotos(portfolio: PortfolioPhoto[], notes: string, service: string, type: string): { url: string; caption: string }[] {
  const text = `${notes} ${service}`.toLowerCase();
  const scored = portfolio.map(p => {
    const searchable = `${p.titre} ${p.description ?? ''} ${p.type_service}`.toLowerCase();
    let score = 0;
    if (type === 'commercial' && (p.type_service === 'commercial' || p.type_service === 'metallique')) score += 3;
    if (type === 'residentiel' && p.type_service === 'flake') score += 1;
    const keywords = text.split(/[\s,\-\/]+/).filter(w => w.length > 3);
    for (const kw of keywords) { if (searchable.includes(kw)) score += 2; }
    return { ...p, score };
  });
  scored.sort((a, b) => b.score - a.score);
  let picks = scored.slice(0, 4);
  return picks.map(p => ({ url: p.photos[0], caption: p.titre }));
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
  <p style="color:#475569;font-size:14px;line-height:1.6;margin:0 0 16px;">
    C'est Jason de Novus Epoxy! On se spécialise en planchers époxy haut de gamme dans la région de Québec.
    ${project ? `J'ai vu que vous pourriez être intéressé par <strong>${project}</strong>.` : 'On aimerait vous montrer ce qu\'on fait.'}
    Voici quelques-unes de nos réalisations récentes :
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
  <p style="color:#475569;font-size:14px;line-height:1.6;margin:0 0 16px;">
    Merci d'avoir demandé votre <strong>soumission gratuite</strong>! On est ravis de votre intérêt.
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

  // Respect business hours: no outreach before 8h or after 18h Quebec time
  const now = new Date();
  const utcHour = now.getUTCHours();
  const quebecOffset = -4; // EDT
  const quebecHour = (utcHour + quebecOffset + 24) % 24;
  if (quebecHour < 8 || quebecHour >= 20) {
    return NextResponse.json({ ok: true, emails: 0, queued: leadIds.length, message: `Hors heures (8h-20h). Il est ${quebecHour}h.` });
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

    // BLACKLIST check
    const phone10 = (lead.telephone ?? '').replace(/\D/g, '').slice(-10);
    if (BLACKLIST_PHONES.includes(phone10) || BLACKLIST_EMAILS.includes((lead.email ?? '').toLowerCase())) { skipped++; continue; }

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
    const photos = portfolio.length > 0
      ? pickPhotos(portfolio, lead.notes ?? '', lead.service ?? '', lead.type ?? 'residentiel')
      : [];

    let contacted = false;

    // 1. Send email
    if (lead.email && String(lead.email).includes('@') && !alreadySentEmails.has(lead.email.toLowerCase())) {
      const nomComplet = lead.nom.trim().slice(0, 40);
      const subject = isCommercial
        ? `${nomComplet} — Partenariat planchers époxy`
        : isFacebookLead
          ? `${prenom}, votre soumission gratuite — Novus Epoxy`
          : `${nomComplet} — Votre projet en époxy`;

      const html = isCommercial
        ? buildCommercialHtml(prenom, photos)
        : isFacebookLead
          ? buildFacebookLeadHtml(prenom, photos)
          : buildResidentialHtml(prenom, project, photos);

      try {
        const result = await sendProspectEmail({ to: lead.email, subject, html });
        await query(
          `INSERT INTO email_logs (resend_id, destinataire, sujet, statut) VALUES ($1, $2, $3, 'sent')`,
          [result.id, lead.email, subject],
        ).catch(() => {});
        alreadySentEmails.add(lead.email.toLowerCase());
        emailsSent++;
        contacted = true;
      } catch (err) {
        console.error(`[Prospect] FAIL ${lead.email}:`, err instanceof Error ? err.message : err);
      }
    }

    // 2. SMS — Facebook leads: ALWAYS send (email + SMS combo). Others: only if no email.
    const shouldSMS = lead.telephone?.trim() && (isFacebookLead || !contacted);
    if (shouldSMS) {
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

    // Status already set by atomic lock above — no need to update again
  }

  return NextResponse.json({ ok: true, emails: emailsSent, sms: smsSent, skipped, total: leads.length, queued, max_batch: MAX_BATCH });
}

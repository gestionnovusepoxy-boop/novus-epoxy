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
  <p style="color:#94a3b8;margin:4px 0 0;font-size:13px;">Planchers epoxy haut de gamme — Quebec</p>
</div>
<div style="padding:24px;">
  <p style="color:#1e293b;font-size:16px;margin:0 0 6px;">Bonjour ${prenom},</p>
  <p style="color:#475569;font-size:14px;line-height:1.6;margin:0 0 16px;">
    C'est Jason de Novus Epoxy! On se specialise en planchers epoxy haut de gamme dans la region de Quebec.
    ${project ? `J'ai vu que vous pourriez etre interesse par <strong>${project}</strong>.` : 'On aimerait vous montrer ce qu\'on fait.'}
    Voici quelques-unes de nos realisations recentes :
  </p>
  <p style="color:#1e293b;font-weight:700;font-size:15px;margin:0 0 12px;">Nos realisations :</p>
  <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;">
    <tr>${row1}</tr>
    <tr>${row2}</tr>
  </table>
  <div style="background:#f8fafc;border-radius:8px;padding:16px;margin:0 0 20px;border:1px solid #e2e8f0;">
    <p style="color:#1e293b;font-weight:700;font-size:14px;margin:0 0 8px;">Pourquoi Novus Epoxy?</p>
    <p style="color:#475569;font-size:13px;line-height:1.6;margin:0;">
      ✅ Licence RBQ 5861-8471-01 — Membre APCHQ<br/>
      ✅ Garantie sur tous nos travaux<br/>
      ✅ +1 000 projets en 15 ans d'experience<br/>
      ✅ Soumission gratuite, sans obligation
    </p>
  </div>
  <div style="text-align:center;margin:0 0 20px;">
    <p style="color:#475569;font-size:14px;margin:0 0 12px;">On peut vous preparer une soumission gratuite en moins d'une heure.</p>
    <a href="https://novusepoxy.ca/#contact" style="display:inline-block;background:#f59e0b;color:#0f172a;padding:14px 36px;border-radius:8px;text-decoration:none;font-weight:700;font-size:16px;">Demander ma soumission gratuite</a>
  </div>
  <p style="color:#94a3b8;font-size:12px;text-align:center;margin:0 0 20px;">Paiement par virement Interac accepte — 0$ de frais</p>
  <div style="border-top:1px solid #e2e8f0;padding:16px 0 0;">
    <p style="color:#1e293b;font-weight:700;font-size:13px;margin:0 0 6px;">Une question? On est la pour vous.</p>
    <p style="color:#475569;font-size:13px;margin:0 0 2px;"><strong>Luca</strong> — Facturation / Soumission — <a href="tel:5813075983" style="color:#2563eb;">581-307-5983</a></p>
    <p style="color:#475569;font-size:13px;margin:0;"><strong>Jason</strong> — Chantier / Soumission — <a href="tel:5813072678" style="color:#2563eb;">581-307-2678</a></p>
  </div>
</div>
<div style="background:#f1f5f9;padding:12px 24px;text-align:center;border-radius:0 0 8px 8px;">
  <p style="color:#94a3b8;font-size:11px;margin:0;">Novus Epoxy — 44 rue de la Polyvalente, Quebec, G2N 1G8</p>
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
  <p style="color:#94a3b8;margin:4px 0 0;font-size:13px;">Planchers epoxy haut de gamme — Quebec</p>
</div>
<div style="padding:24px;">
  <p style="color:#1e293b;font-size:16px;margin:0 0 6px;">Bonjour ${prenom},</p>
  <p style="color:#475569;font-size:14px;line-height:1.6;margin:0 0 16px;">
    Je me presente, <strong>Jason</strong>, de Novus Epoxy. On travaille avec plusieurs entrepreneurs dans la region de Quebec et on cherche a batir des <strong>partenariats solides</strong>.
  </p>
  <p style="color:#1e293b;font-weight:700;font-size:15px;margin:0 0 12px;">Nos realisations :</p>
  <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;">
    <tr>${row1}</tr>
    <tr>${row2}</tr>
  </table>
  <div style="background:#0f172a;border-radius:12px;padding:24px;margin:0 0 20px;color:#ffffff;">
    <h2 style="color:#f59e0b;font-size:18px;margin:0 0 16px;">Programme Partenaire</h2>
    <p style="margin:0 0 6px;font-size:14px;">✅ Commission sur chaque projet refere</p>
    <p style="margin:0 0 6px;font-size:14px;">✅ Prix partenaire preferentiel</p>
    <p style="margin:0 0 6px;font-size:14px;">✅ Priorite de planification pour vos chantiers</p>
    <p style="margin:0 0 6px;font-size:14px;">✅ Soumission en moins d'une heure</p>
    <p style="margin:0;font-size:14px;">✅ Service cle en main</p>
  </div>
  <div style="text-align:center;margin:0 0 20px;">
    <a href="https://novusepoxy.ca/#contact" style="display:inline-block;background:#f59e0b;color:#0f172a;padding:14px 36px;border-radius:8px;text-decoration:none;font-weight:700;font-size:16px;">Nous contacter</a>
    <p style="color:#1e293b;font-size:15px;font-weight:700;margin:12px 0 0;">ou appelez Jason : 581-307-2678</p>
  </div>
  <div style="border-top:1px solid #e2e8f0;padding:16px 0 0;">
    <p style="color:#475569;font-size:13px;margin:0 0 2px;"><strong>Luca Hayes</strong> — Coproprietaire — 581-307-5983</p>
    <p style="color:#475569;font-size:13px;margin:0;"><strong>Jason</strong> — Chantier / Operations — 581-307-2678</p>
  </div>
</div>
<div style="background:#f1f5f9;padding:12px 24px;text-align:center;border-radius:0 0 8px 8px;">
  <p style="color:#94a3b8;font-size:11px;margin:0;">Novus Epoxy — novusepoxy.ca</p>
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
    `SELECT id, nom, telephone, email, service, ville, notes, type, prospect_sent_at FROM crm_leads WHERE id IN (${placeholders})`,
    batchIds,
  );

  const portfolio = await loadPortfolio();
  let emailsSent = 0;
  let smsSent = 0;
  let skipped = 0;

  interface LeadRow { id: number; nom: string; telephone: string | null; email: string | null; service: string; ville: string; notes: string; type: string; prospect_sent_at: string | null }

  for (const _lead of leads) {
    const lead = _lead as unknown as LeadRow;

    // Stop at MAX_BATCH emails actually sent
    if (emailsSent >= MAX_BATCH) { skipped++; continue; }

    // Skip already contacted (by lead flag)
    if (lead.prospect_sent_at) { skipped++; continue; }

    // Skip leads with no email
    if (!lead.email) { skipped++; continue; }

    // DEDUP: skip if email address already received ANY email from us
    if (alreadySentEmails.has(lead.email.toLowerCase())) {
      await query(
        `UPDATE crm_leads SET prospect_sent_at = NOW(), statut = CASE WHEN statut = 'nouveau' THEN 'offre_envoyee' ELSE statut END, updated_at = NOW() WHERE id = $1`,
        [lead.id],
      ).catch(() => {});
      skipped++;
      continue;
    }

    const prenom = getPrenom(lead.nom);
    const project = lead.service || lead.notes?.split('—')[0] || '';
    const isCommercial = lead.type === 'commercial';
    const photos = portfolio.length > 0
      ? pickPhotos(portfolio, lead.notes ?? '', lead.service ?? '', lead.type ?? 'residentiel')
      : [];

    let contacted = false;

    // 1. Send email with scheduled delivery (stagger 3 min apart)
    if (lead.email) {
      try {
        const subject = isCommercial
          ? `${prenom} — Partenariat planchers epoxy — Novus Epoxy`
          : `${prenom} — Votre projet en epoxy avec Novus Epoxy`;

        const html = isCommercial
          ? buildCommercialHtml(prenom, photos)
          : buildResidentialHtml(prenom, project, photos);

        // Idempotency key: lead ID + today's date — prevents ANY duplicate
        const today = new Date().toISOString().split('T')[0];
        const idempotencyKey = `prospect-${lead.id}-${today}`;

        // Schedule delivery: stagger 30sec apart to avoid bulk detection
        // 100 emails = ~50 min spread, 1000 = ~8h (fits in 1 business day)
        const delayMs = emailsSent * 30 * 1000; // 0, 30s, 60s, 90s...
        const scheduledAt = new Date(Date.now() + delayMs + 60000).toISOString(); // +1min buffer

        // LOG FIRST to prevent duplicates on retry/timeout
        await query(
          `INSERT INTO email_logs (resend_id, destinataire, sujet, statut) VALUES ($1, $2, $3, 'scheduled')`,
          [idempotencyKey, lead.email, subject],
        );
        alreadySentEmails.add(lead.email.toLowerCase());

        const result = await sendProspectEmail({
          to: lead.email,
          subject,
          html,
          idempotencyKey,
          scheduledAt,
        });

        // Update log with real resend ID
        await query(
          `UPDATE email_logs SET resend_id = $1, statut = 'sent' WHERE resend_id = $2`,
          [result.id, idempotencyKey],
        ).catch(() => {});
        emailsSent++;
        contacted = true;
      } catch (err) {
        console.error(`[Jason Prospect] Email failed for ${lead.nom}:`, err);
        await query(
          `UPDATE email_logs SET statut = 'failed' WHERE destinataire = $1 AND statut = 'scheduled' AND created_at > NOW() - INTERVAL '1 minute'`,
          [lead.email],
        ).catch(() => {});
      }
    }

    // 2. SMS only if lead has phone but NO email
    if (!lead.email && lead.telephone?.trim() && !contacted) {
      try {
        const smsText = `Bonjour ${prenom}, c'est Novus Epoxy! On fait des planchers epoxy haut de gamme dans la region de Quebec. Soumission gratuite, licence RBQ. Appelez-nous au 581-307-2678 ou visitez novusepoxy.ca`;
        await sendSMS(lead.telephone, smsText);
        smsSent++;
        contacted = true;
      } catch (err) {
        console.error(`[Jason Prospect] SMS failed for ${lead.nom}:`, err);
      }
    }

    // 3. Update lead status ONLY if at least one contact method succeeded
    if (contacted) {
      await query(
        `UPDATE crm_leads SET prospect_sent_at = NOW(), statut = CASE WHEN statut = 'nouveau' THEN 'offre_envoyee' ELSE statut END, updated_at = NOW() WHERE id = $1`,
        [lead.id],
      ).catch(err => console.error(`[Jason Prospect] Status update failed for ${lead.id}:`, err));
    }
  }

  return NextResponse.json({ ok: true, emails: emailsSent, sms: smsSent, skipped, total: leads.length, queued, max_batch: MAX_BATCH });
}

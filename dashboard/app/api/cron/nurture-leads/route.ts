import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { sendProspectEmail } from '@/lib/send-prospect-email';
import { sendSMS } from '@/lib/sms';

export const maxDuration = 60;

// BLACKLIST — never contact owners
const BLACKLIST_EMAILS = ['gestionnovusepoxy@gmail.com', 'lanthierj6@gmail.com', 'luca.hayes1994@gmail.com'];
const BLACKLIST_PHONES = ['5813075983', '5813072678'];

function isBlacklisted(email?: string | null, phone?: string | null): boolean {
  if (email && BLACKLIST_EMAILS.includes(email.toLowerCase())) return true;
  if (phone) {
    const clean = phone.replace(/\D/g, '').slice(-10);
    if (BLACKLIST_PHONES.includes(clean)) return true;
  }
  return false;
}

async function sendTelegram(text: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_GROUP_CHAT_ID ?? process.env.TELEGRAM_ADMIN_CHAT_IDS?.split(',')[0];
  if (!token || !chatId) return;
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
  }).catch(() => {});
}

function getPrenom(nom: string): string {
  return nom.split(' ')[0];
}

// ---------------------------------------------------------------------------
// Portfolio loader (same as prospect route)
// ---------------------------------------------------------------------------
interface PortfolioPhoto { id: number; titre: string; type_service: string; description: string | null; photos: string[] }

async function loadPortfolio(): Promise<PortfolioPhoto[]> {
  const rows = await query(
    `SELECT id, titre, type_service, description, photos FROM portfolio WHERE array_length(photos, 1) > 0 ORDER BY featured DESC, created_at DESC`,
    [],
  );
  return rows as unknown as PortfolioPhoto[];
}

function pickPhotos(portfolio: PortfolioPhoto[], count = 3): { url: string; caption: string }[] {
  return portfolio.slice(0, count).map(p => ({ url: p.photos[0], caption: p.titre }));
}

// ---------------------------------------------------------------------------
// HTML builders — Novus Epoxy branded (dark header, gold #f59e0b accent)
// ---------------------------------------------------------------------------

function buildNurture3Html(prenom: string, photos: { url: string; caption: string }[]): string {
  const photoGrid = photos.map((p, i) => {
    const pl = i === 0 ? '0' : '4px';
    const pr = i === photos.length - 1 ? '0' : '4px';
    return `<td style="padding:0 ${pr} 0 ${pl};"><img src="${p.url}" alt="${p.caption}" width="180" style="border-radius:8px;display:block;max-width:100%;" /><p style="color:#64748b;font-size:11px;margin:4px 0 0;">${p.caption}</p></td>`;
  }).join('');

  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:0;background:#f8fafc;">
<div style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;max-width:600px;margin:0 auto;background:#ffffff;">
<div style="background:#0f172a;padding:24px;text-align:center;border-radius:8px 8px 0 0;">
  <img src="https://novus-epoxy.vercel.app/logo-email.jpg" alt="Novus Epoxy" width="80" height="80" style="border-radius:12px;" />
  <h1 style="color:#f59e0b;margin:12px 0 0;font-size:22px;font-weight:700;">Novus Epoxy</h1>
  <p style="color:#94a3b8;margin:4px 0 0;font-size:13px;">Planchers époxy haut de gamme — Québec</p>
</div>
<div style="padding:24px;">
  <p style="color:#1e293b;font-size:16px;margin:0 0 6px;">Bonjour ${prenom},</p>
  <p style="color:#475569;font-size:14px;line-height:1.6;margin:0 0 20px;">
    Avant de choisir un installateur pour votre plancher époxy, voici <strong>3 erreurs courantes</strong> à éviter :
  </p>

  <div style="background:#fff7ed;border-left:4px solid #f59e0b;border-radius:0 8px 8px 0;padding:16px;margin:0 0 12px;">
    <p style="color:#1e293b;font-weight:700;font-size:14px;margin:0 0 4px;">1. Choisir un installateur sans licence RBQ</p>
    <p style="color:#475569;font-size:13px;line-height:1.5;margin:0;">
      Sans licence, vous n'avez aucune garantie légale. En cas de problème, aucun recours possible.
      Novus Epoxy détient la licence RBQ 5861-8471-01 et est membre de l'APCHQ.
    </p>
  </div>

  <div style="background:#fff7ed;border-left:4px solid #f59e0b;border-radius:0 8px 8px 0;padding:16px;margin:0 0 12px;">
    <p style="color:#1e293b;font-weight:700;font-size:14px;margin:0 0 4px;">2. Négliger la préparation du béton</p>
    <p style="color:#475569;font-size:13px;line-height:1.5;margin:0;">
      Un meulage diamant professionnel est essentiel pour que l'époxy adhère correctement.
      Sans ca, le revêtement peut décoller en quelques mois. On ne saute jamais cette étape.
    </p>
  </div>

  <div style="background:#fff7ed;border-left:4px solid #f59e0b;border-radius:0 8px 8px 0;padding:16px;margin:0 0 20px;">
    <p style="color:#1e293b;font-weight:700;font-size:14px;margin:0 0 4px;">3. Choisir le mauvais type d'époxy</p>
    <p style="color:#475569;font-size:13px;line-height:1.5;margin:0;">
      Garage, sous-sol, commercial — chaque usage demande un produit différent.
      On vous guide vers le bon choix selon votre projet et votre budget.
    </p>
  </div>

  ${photoGrid ? `<p style="color:#1e293b;font-weight:700;font-size:14px;margin:0 0 8px;">Quelques-unes de nos réalisations :</p>
  <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;"><tr>${photoGrid}</tr></table>` : ''}

  <div style="background:#ecfdf5;border-radius:8px;padding:16px;margin:0 0 20px;border:1px solid #6ee7b7;">
    <p style="color:#065f46;font-weight:700;font-size:14px;margin:0 0 4px;">Spécial avril — 20% de rabais!</p>
    <p style="color:#047857;font-size:13px;margin:0;">Le rabais s'applique automatiquement à votre soumission.</p>
  </div>

  <p style="color:#475569;font-size:14px;line-height:1.6;margin:0 0 16px;">
    On peut vous aider à faire le bon choix — <strong>répondez à ce courriel</strong> ou appelez-nous directement.
  </p>

  <div style="border-top:1px solid #e2e8f0;padding:16px 0 0;">
    <p style="color:#1e293b;font-weight:700;font-size:13px;margin:0 0 6px;">Votre équipe :</p>
    <p style="color:#475569;font-size:13px;margin:0 0 2px;"><strong>Luca</strong> — Facturation / Soumission — <a href="tel:5813075983" style="color:#2563eb;">581-307-5983</a></p>
    <p style="color:#475569;font-size:13px;margin:0;"><strong>Jason</strong> — Chantier / Soumission — <a href="tel:5813072678" style="color:#2563eb;">581-307-2678</a></p>
  </div>
</div>
<div style="background:#f1f5f9;padding:12px 24px;text-align:center;border-radius:0 0 8px 8px;">
  <p style="color:#94a3b8;font-size:11px;margin:0;">Novus Epoxy — 44 rue de la Polyvalente, Québec, G2N 1G8 | novusepoxy.ca</p>
</div>
</div></body></html>`;
}

function buildNurture5Html(prenom: string): string {
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
    C'est un dernier message de notre part. On ne veut pas vous importuner, mais on voulait vous informer de deux choses :
  </p>

  <div style="background:#fef2f2;border:2px solid #ef4444;border-radius:12px;padding:20px;margin:0 0 20px;text-align:center;">
    <p style="color:#dc2626;font-weight:700;font-size:18px;margin:0 0 8px;">Le rabais de 20% se termine bientôt</p>
    <p style="color:#475569;font-size:14px;margin:0;">Profitez-en avant la fin du mois d'avril!</p>
  </div>

  <div style="background:#f0fdf4;border-radius:8px;padding:16px;margin:0 0 20px;border:1px solid #86efac;">
    <p style="color:#166534;font-size:14px;margin:0;">
      On a une <strong>ouverture dans notre calendrier</strong> la semaine prochaine.
      Répondez <strong>OUI</strong> et on vous prépare une soumission en moins d'une heure.
    </p>
  </div>

  <div style="text-align:center;margin:0 0 24px;">
    <a href="https://novusepoxy.ca/#contact" style="display:inline-block;background:#f59e0b;color:#0f172a;padding:16px 48px;border-radius:8px;text-decoration:none;font-weight:700;font-size:18px;">Je veux ma soumission</a>
  </div>

  <p style="color:#94a3b8;font-size:12px;text-align:center;margin:0 0 20px;">Paiement par virement Interac accepté — 0$ de frais</p>

  <div style="border-top:1px solid #e2e8f0;padding:16px 0 0;">
    <p style="color:#1e293b;font-weight:700;font-size:13px;margin:0 0 6px;">Votre équipe :</p>
    <p style="color:#475569;font-size:13px;margin:0 0 2px;"><strong>Luca</strong> — Facturation / Soumission — <a href="tel:5813075983" style="color:#2563eb;">581-307-5983</a></p>
    <p style="color:#475569;font-size:13px;margin:0;"><strong>Jason</strong> — Chantier / Soumission — <a href="tel:5813072678" style="color:#2563eb;">581-307-2678</a></p>
  </div>
</div>
<div style="background:#f1f5f9;padding:12px 24px;text-align:center;border-radius:0 0 8px 8px;">
  <p style="color:#94a3b8;font-size:11px;margin:0;">Novus Epoxy — 44 rue de la Polyvalente, Québec, G2N 1G8 | novusepoxy.ca</p>
</div>
</div></body></html>`;
}

// ---------------------------------------------------------------------------
// Main cron handler — processes Touch 3, 4, 5
// ---------------------------------------------------------------------------

interface LeadRow {
  id: number;
  nom: string;
  email: string | null;
  telephone: string | null;
  notes: string | null;
  statut: string;
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization') ?? '';
  const token = authHeader.replace('Bearer ', '');
  const cronSecret = process.env.CRON_SECRET ?? '';
  const adminKey = process.env.ADMIN_API_KEY ?? '';
  if (!token || (token !== cronSecret && token !== adminKey)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Business hours only: 8h-20h Quebec (EDT = UTC-4)
  const now = new Date();
  const quebecHour = (now.getUTCHours() - 4 + 24) % 24;
  if (quebecHour < 8 || quebecHour >= 20) {
    return NextResponse.json({ ok: true, message: `Hors heures (${quebecHour}h). Aucun envoi.` });
  }

  const today = now.toISOString().slice(0, 10);
  const portfolio = await loadPortfolio();
  const photos = pickPhotos(portfolio, 3);

  let touch3Sent = 0;
  let touch4Sent = 0;
  let touch5Sent = 0;
  let markedLost = 0;
  const errors: string[] = [];

  // =========================================================================
  // TOUCH 3 — Day ~10: Value-add email (2+ days after relance 2)
  // =========================================================================
  try {
    const touch3Leads = await query(
      `SELECT id, nom, email, telephone, notes, statut FROM crm_leads
       WHERE prospect_relance_2_at IS NOT NULL
         AND prospect_relance_2_at < NOW() - INTERVAL '2 days'
         AND statut NOT IN ('contacte', 'converti', 'ferme', 'perdu')
         AND email IS NOT NULL AND email != ''
         AND (notes IS NULL OR notes NOT LIKE '%Nurture-3%')
       ORDER BY prospect_relance_2_at ASC
       LIMIT 20`,
      [],
    );

    for (const _lead of touch3Leads) {
      const lead = _lead as unknown as LeadRow;
      if (isBlacklisted(lead.email, lead.telephone)) continue;

      const prenom = getPrenom(lead.nom);
      const html = buildNurture3Html(prenom, photos);
      const subject = `${prenom}, 3 erreurs à éviter avant de faire poser un plancher époxy`;

      try {
        await sendProspectEmail({ to: lead.email!, subject, html });
        const newNotes = ((lead.notes ?? '') + ` [Nurture-3 envoye ${today}]`).trim();
        await query(
          `UPDATE crm_leads SET notes = $1, updated_at = NOW() WHERE id = $2`,
          [newNotes, lead.id],
        );
        touch3Sent++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`Touch3 ${lead.id}: ${msg}`);
        console.error(`[Nurture] Touch 3 fail lead ${lead.id}:`, err);
      }
    }
  } catch (err) {
    console.error('[Nurture] Touch 3 query error:', err);
  }

  // =========================================================================
  // TOUCH 4 — Day ~17: SMS reminder (7+ days after Touch 3)
  // =========================================================================
  try {
    const touch4Leads = await query(
      `SELECT id, nom, email, telephone, notes, statut FROM crm_leads
       WHERE notes LIKE '%Nurture-3 envoye%'
         AND statut NOT IN ('contacte', 'converti', 'ferme', 'perdu')
         AND telephone IS NOT NULL AND telephone != ''
         AND (notes IS NULL OR notes NOT LIKE '%Nurture-4%')
       ORDER BY updated_at ASC
       LIMIT 20`,
      [],
    );

    for (const _lead of touch4Leads) {
      const lead = _lead as unknown as LeadRow;
      if (isBlacklisted(lead.email, lead.telephone)) continue;

      // Check if Touch 3 was sent 7+ days ago
      const nurture3Match = (lead.notes ?? '').match(/\[Nurture-3 envoye (\d{4}-\d{2}-\d{2})\]/);
      if (!nurture3Match) continue;
      const nurture3Date = new Date(nurture3Match[1]);
      const daysSince = (now.getTime() - nurture3Date.getTime()) / (1000 * 60 * 60 * 24);
      if (daysSince < 7) continue;

      const prenom = getPrenom(lead.nom);
      const smsText = `Bonjour ${prenom}! C'est Luca de Novus Epoxy. Notre rabais de 20% en avril se termine bientôt. Si vous avez des questions sur votre projet, je suis disponible au 581-307-5983. Bonne journée!`;

      try {
        const sent = await sendSMS(lead.telephone!, smsText);
        if (sent) {
          const newNotes = ((lead.notes ?? '') + ` [Nurture-4 SMS ${today}]`).trim();
          await query(
            `UPDATE crm_leads SET notes = $1, updated_at = NOW() WHERE id = $2`,
            [newNotes, lead.id],
          );
          touch4Sent++;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`Touch4 ${lead.id}: ${msg}`);
        console.error(`[Nurture] Touch 4 fail lead ${lead.id}:`, err);
      }
    }
  } catch (err) {
    console.error('[Nurture] Touch 4 query error:', err);
  }

  // =========================================================================
  // TOUCH 5 — Day ~25: Last chance email (8+ days after Touch 4)
  // =========================================================================
  try {
    const touch5Leads = await query(
      `SELECT id, nom, email, telephone, notes, statut FROM crm_leads
       WHERE notes LIKE '%Nurture-4 SMS%'
         AND statut NOT IN ('contacte', 'converti', 'ferme', 'perdu')
         AND email IS NOT NULL AND email != ''
         AND (notes IS NULL OR notes NOT LIKE '%Nurture-5%')
       ORDER BY updated_at ASC
       LIMIT 20`,
      [],
    );

    for (const _lead of touch5Leads) {
      const lead = _lead as unknown as LeadRow;
      if (isBlacklisted(lead.email, lead.telephone)) continue;

      // Check if Touch 4 was sent 8+ days ago
      const nurture4Match = (lead.notes ?? '').match(/\[Nurture-4 SMS (\d{4}-\d{2}-\d{2})\]/);
      if (!nurture4Match) continue;
      const nurture4Date = new Date(nurture4Match[1]);
      const daysSince = (now.getTime() - nurture4Date.getTime()) / (1000 * 60 * 60 * 24);
      if (daysSince < 8) continue;

      const prenom = getPrenom(lead.nom);
      const html = buildNurture5Html(prenom);
      const subject = `${prenom}, dernière chance — rabais avril 20%`;

      try {
        await sendProspectEmail({ to: lead.email!, subject, html });
        const newNotes = ((lead.notes ?? '') + ` [Nurture-5 envoye ${today}]`).trim();
        await query(
          `UPDATE crm_leads SET notes = $1, updated_at = NOW() WHERE id = $2`,
          [newNotes, lead.id],
        );
        touch5Sent++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`Touch5 ${lead.id}: ${msg}`);
        console.error(`[Nurture] Touch 5 fail lead ${lead.id}:`, err);
      }
    }
  } catch (err) {
    console.error('[Nurture] Touch 5 query error:', err);
  }

  // =========================================================================
  // MARK LOST — Leads with Touch 5 sent 7+ days ago, still no response
  // =========================================================================
  try {
    const lostLeads = await query(
      `SELECT id, nom, notes FROM crm_leads
       WHERE notes LIKE '%Nurture-5 envoye%'
         AND statut NOT IN ('contacte', 'converti', 'ferme', 'perdu')
       ORDER BY updated_at ASC
       LIMIT 30`,
      [],
    );

    for (const _lead of lostLeads) {
      const lead = _lead as unknown as { id: number; nom: string; notes: string | null };
      const nurture5Match = (lead.notes ?? '').match(/\[Nurture-5 envoye (\d{4}-\d{2}-\d{2})\]/);
      if (!nurture5Match) continue;
      const nurture5Date = new Date(nurture5Match[1]);
      const daysSince = (now.getTime() - nurture5Date.getTime()) / (1000 * 60 * 60 * 24);
      if (daysSince < 7) continue;

      try {
        await query(
          `UPDATE crm_leads SET statut = 'perdu', temperature = 'froid', updated_at = NOW() WHERE id = $1`,
          [lead.id],
        );
        markedLost++;
      } catch (err) {
        console.error(`[Nurture] Mark lost fail lead ${lead.id}:`, err);
      }
    }
  } catch (err) {
    console.error('[Nurture] Mark lost query error:', err);
  }

  // =========================================================================
  // Telegram summary
  // =========================================================================
  const totalSent = touch3Sent + touch4Sent + touch5Sent;
  if (totalSent > 0 || markedLost > 0) {
    await sendTelegram(
      `<b>Nurture leads</b>\n\n` +
      `📧 ${touch3Sent} touch-3 (email educatif)\n` +
      `📱 ${touch4Sent} touch-4 (SMS rappel)\n` +
      `📧 ${touch5Sent} touch-5 (derniere chance)\n` +
      `❌ ${markedLost} leads marques perdus\n` +
      (errors.length > 0 ? `\n⚠️ ${errors.length} erreur(s)` : ''),
    );
  }

  return NextResponse.json({
    ok: true,
    touch_3: touch3Sent,
    touch_4_sms: touch4Sent,
    touch_5: touch5Sent,
    marked_lost: markedLost,
    errors: errors.length,
  });
}

export async function POST(req: NextRequest) {
  return GET(req);
}

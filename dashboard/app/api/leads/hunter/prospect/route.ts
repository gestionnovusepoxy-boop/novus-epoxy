import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query } from '@/lib/db';
import { sendEmail } from '@/lib/send-email';

// Dynamic photo picking from portfolio DB
interface PortfolioPhoto { id: number; titre: string; type_service: string; description: string | null; photos: string[] }

async function loadPortfolio(): Promise<PortfolioPhoto[]> {
  const rows = await query(
    `SELECT id, titre, type_service, description, photos FROM portfolio WHERE array_length(photos, 1) > 0 ORDER BY featured DESC, created_at DESC`,
    [],
  );
  return rows as unknown as PortfolioPhoto[];
}

function pickPhotos(portfolio: PortfolioPhoto[], notes: string, service: string, type: string): { url: string; caption: string }[] {
  const text = `${notes} ${service}`.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  // Score each portfolio item by keyword match against titre + description
  const scored = portfolio.map(p => {
    const searchable = `${p.titre} ${p.description ?? ''} ${p.type_service}`.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    let score = 0;

    // Keywords from lead notes matched against portfolio content
    const keywords = text.split(/[\s,—\-\/]+/).filter(w => w.length > 3);
    for (const kw of keywords) {
      if (searchable.includes(kw)) score += 2;
    }

    // Boost if type matches
    if (type === 'commercial' && (p.type_service === 'commercial' || p.type_service === 'metallique')) score += 3;
    if (type === 'residentiel' && p.type_service === 'flake') score += 1;

    // Common keyword matching
    const pairs: [string, string[]][] = [
      ['garage', ['garage', 'atelier']],
      ['sous-sol', ['sous-sol', 'basement', 'sous sol']],
      ['escalier', ['escalier', 'marche', 'perron']],
      ['balcon', ['balcon', 'galerie', 'exterieur', 'patio', 'terrasse']],
      ['metallique', ['metallique', 'haut de gamme', 'miroir', 'or', 'bronze']],
      ['commercial', ['commercial', 'industriel', 'entrepot', 'bureau']],
      ['cuisine', ['cuisine', 'interieur', 'plancher']],
      ['rampe', ['rampe', 'acces']],
    ];

    for (const [leadKw, portfolioKws] of pairs) {
      const leadNorm = leadKw.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      if (text.includes(leadNorm)) {
        for (const pk of portfolioKws) {
          if (searchable.includes(pk.normalize('NFD').replace(/[\u0300-\u036f]/g, ''))) {
            score += 3;
          }
        }
      }
    }

    return { ...p, score };
  });

  // Sort by score desc, take top 4
  scored.sort((a, b) => b.score - a.score);

  // If no good matches, fallback to type-based selection
  let picks = scored.filter(p => p.score > 0).slice(0, 4);
  if (picks.length < 4) {
    const typeMatch = type === 'commercial' ? ['commercial', 'metallique'] : ['flake'];
    const fallbacks = scored.filter(p => typeMatch.includes(p.type_service) && !picks.find(x => x.id === p.id));
    picks = [...picks, ...fallbacks].slice(0, 4);
  }
  // Still not enough? just take top rated
  if (picks.length < 4) {
    const remaining = scored.filter(p => !picks.find(x => x.id === p.id));
    picks = [...picks, ...remaining].slice(0, 4);
  }

  return picks.map(p => ({ url: p.photos[0], caption: p.titre }));
}

function getPrenom(nom: string): string {
  return nom.split(' ')[0];
}

function buildProjectDescription(notes: string, service: string): string {
  // Extract meaningful project description from notes
  const parts = (notes || '').split('—').map(s => s.trim());
  const project = parts[0] || service || 'votre projet';
  return project;
}

function buildHtml(lead: {
  nom: string;
  notes: string;
  service: string;
  type: string;
  ville: string;
}, photos: { url: string; caption: string }[]): string {
  const prenom = getPrenom(lead.nom);
  const project = buildProjectDescription(lead.notes, lead.service);

  const photoGrid = photos.map((p, i) => {
    const paddingLeft = i % 2 === 0 ? '0' : '4px';
    const paddingRight = i % 2 === 0 ? '4px' : '0';
    const paddingBottom = i < 2 ? '8px' : '0';
    return `<td width="50%" style="padding:0 ${paddingRight} ${paddingBottom} ${paddingLeft};">
      <img src="${p.url}" alt="${p.caption}" width="270" style="border-radius:8px;display:block;max-width:100%;" />
      <p style="color:#64748b;font-size:11px;margin:4px 0 0;">${p.caption}</p>
    </td>`;
  });

  const row1 = photoGrid.slice(0, 2).join('');
  const row2 = photoGrid.slice(2, 4).join('');

  if (lead.type === 'commercial') {
    return buildCommercialHtml(prenom, project, row1, row2);
  }

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
    Vous nous avez contacte pour <strong>${project}</strong>.
    On aimerait vous montrer quelques-unes de nos realisations pour vous donner une idee du resultat.
  </p>

  <p style="color:#1e293b;font-weight:700;font-size:15px;margin:0 0 12px;">Quelques realisations recentes :</p>
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
    <a href="https://novusepoxy.ca/#contact" style="display:inline-block;background:#f59e0b;color:#0f172a;padding:14px 36px;border-radius:8px;text-decoration:none;font-weight:700;font-size:16px;">
      Demander ma soumission gratuite
    </a>
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
  <p style="color:#94a3b8;font-size:11px;margin:4px 0 0;">Vous recevez cet email car vous avez manifeste un interet pour nos services.</p>
</div>

</div>
</body></html>`;
}

function buildCommercialHtml(prenom: string, project: string, row1: string, row2: string): string {
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
    Je me presente, <strong>Luca Hayes</strong>, coproprietaire de Novus Epoxy.
    On travaille deja avec plusieurs entrepreneurs en construction et renovation dans la region de Quebec,
    et on cherche a batir des <strong>partenariats solides</strong> avec des entreprises comme la votre.
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
    <p style="margin:0;font-size:14px;">✅ Service cle en main — on s'occupe de tout</p>
  </div>

  <div style="background:#f8fafc;border-radius:8px;padding:16px;margin:0 0 20px;border:1px solid #e2e8f0;">
    <p style="color:#1e293b;font-weight:700;font-size:14px;margin:0 0 8px;">Novus Epoxy en chiffres</p>
    <p style="color:#475569;font-size:13px;line-height:1.6;margin:0;">
      ✅ Licence RBQ 5861-8471-01 — Membre APCHQ<br/>
      ✅ +1 000 projets residentiels et commerciaux<br/>
      ✅ 15 ans d'experience dans le domaine<br/>
      ✅ Garantie sur tous nos travaux
    </p>
  </div>

  <div style="text-align:center;margin:0 0 20px;">
    <p style="color:#475569;font-size:14px;margin:0 0 12px;">On aimerait vous presenter nos services. Un appel de 10 minutes?</p>
    <a href="https://novusepoxy.ca/#contact" style="display:inline-block;background:#f59e0b;color:#0f172a;padding:14px 36px;border-radius:8px;text-decoration:none;font-weight:700;font-size:16px;">
      Nous contacter
    </a>
    <p style="color:#1e293b;font-size:15px;font-weight:700;margin:12px 0 0;">ou appelez-nous : 581-307-5983</p>
  </div>

  <div style="border-top:1px solid #e2e8f0;padding:16px 0 0;">
    <p style="color:#475569;font-size:13px;margin:0 0 2px;"><strong>Luca Hayes</strong> — Coproprietaire</p>
    <p style="color:#475569;font-size:13px;margin:0 0 2px;">581-307-5983 | gestionnovusepoxy@gmail.com</p>
    <p style="color:#475569;font-size:13px;margin:0;"><strong>Jason</strong> — Chantier / Operations — 581-307-2678</p>
  </div>
</div>

<div style="background:#f1f5f9;padding:12px 24px;text-align:center;border-radius:0 0 8px 8px;">
  <p style="color:#94a3b8;font-size:11px;margin:0;">Novus Epoxy — 44 rue de la Polyvalente, Quebec, G2N 1G8</p>
  <p style="color:#94a3b8;font-size:11px;margin:4px 0 0;">novusepoxy.ca</p>
</div>

</div>
</body></html>`;
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Non autorise' }, { status: 401 });

  const { leadIds } = (await req.json()) as { leadIds: number[] };

  if (!leadIds || leadIds.length === 0) {
    return NextResponse.json({ error: 'leadIds requis' }, { status: 400 });
  }

  // Max 20 at a time to avoid abuse
  if (leadIds.length > 20) {
    return NextResponse.json({ error: 'Maximum 20 leads a la fois' }, { status: 400 });
  }

  const placeholders = leadIds.map((_, i) => `$${i + 1}`).join(',');
  const leads = await query(
    `SELECT id, nom, telephone, email, service, ville, notes, type, temperature, statut, prospect_sent_at FROM crm_leads WHERE id IN (${placeholders}) AND email IS NOT NULL AND email != ''`,
    leadIds,
  );

  const portfolio = await loadPortfolio();
  const results: { id: number; nom: string; status: 'sent' | 'skipped' | 'error'; error?: string }[] = [];

  interface LeadRow { id: number; nom: string; telephone: string; email: string; service: string; ville: string; notes: string; type: string; temperature: string; statut: string; prospect_sent_at: string | null }

  for (const _lead of leads) {
    const lead = _lead as unknown as LeadRow;
    // Anti-spam: skip if already sent
    if (lead.prospect_sent_at) {
      results.push({ id: lead.id, nom: lead.nom, status: 'skipped', error: 'Offre deja envoyee' });
      continue;
    }

    try {
      const photos = pickPhotos(portfolio, lead.notes ?? '', lead.service ?? '', lead.type ?? 'residentiel');
      const html = buildHtml({
        nom: lead.nom,
        notes: lead.notes ?? '',
        service: lead.service ?? '',
        type: lead.type ?? 'residentiel',
        ville: lead.ville ?? '',
      }, photos);

      const prenom = getPrenom(lead.nom);
      const isCommercial = lead.type === 'commercial';
      const subject = isCommercial
        ? `${prenom} — Partenariat planchers epoxy — Novus Epoxy`
        : `${prenom} — Votre projet en epoxy avec Novus Epoxy`;

      const emailResult = await sendEmail({
        to: lead.email,
        subject,
        html,
      });

      // Log the email (using correct column names)
      await query(
        `INSERT INTO email_logs (resend_id, destinataire, sujet, statut) VALUES ($1, $2, $3, 'sent')`,
        [emailResult.id, lead.email, subject],
      );

      // Update lead: mark as contacted + record prospect send time
      await query(
        `UPDATE crm_leads SET statut = CASE WHEN statut = 'nouveau' THEN 'contacte' ELSE statut END, prospect_sent_at = NOW(), updated_at = NOW() WHERE id = $1`,
        [lead.id],
      );

      results.push({ id: lead.id, nom: lead.nom, status: 'sent' });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      results.push({ id: lead.id, nom: lead.nom, status: 'error', error: msg });
    }
  }

  const sent = results.filter(r => r.status === 'sent').length;
  const skipped = results.filter(r => r.status === 'skipped').length;
  return NextResponse.json({ sent, skipped, total: results.length, results });
}

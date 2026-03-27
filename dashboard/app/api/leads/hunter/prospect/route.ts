import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query } from '@/lib/db';
import { sendEmail } from '@/lib/send-email';

// Map keywords in notes → portfolio photo IDs
const PHOTO_TAGS: Record<number, string[]> = {
  12: ['garage', 'plancher de garage', 'garage double'],
  11: ['garage', 'plancher de garage', 'amg'],
  10: ['sous-sol', 'basement', 'sous sol'],
  9:  ['commercial', 'rampe', 'entrepot', 'entrepôt'],
  8:  ['metallique', 'métallique', 'haut de gamme', 'commercial'],
  7:  ['escalier', 'marche', 'perron', 'entree', 'entrée'],
  6:  ['balcon', 'facade', 'façade', 'exterieur', 'extérieur'],
  5:  ['balcon', 'escalier', 'exterieur', 'extérieur', 'perron'],
  4:  ['balcon', 'exterieur', 'extérieur', 'patio', 'terrasse'],
  3:  ['commercial', 'industriel', 'entrepot', 'entrepôt', 'plancher commercial'],
  2:  ['metallique', 'métallique'],
  1:  ['metallique', 'métallique', 'haut de gamme'],
};

const PHOTO_INFO: Record<number, { url: string; caption: string }> = {
  12: { url: 'https://czu5yydsbx2q3trt.public.blob.vercel-storage.com/portfolio/12-flake-garage-double.jpg', caption: 'Garage double — Flake bleu-gris' },
  11: { url: 'https://czu5yydsbx2q3trt.public.blob.vercel-storage.com/portfolio/11-flake-garage-amg.jpg', caption: 'Garage — Flake noir style AMG' },
  10: { url: 'https://czu5yydsbx2q3trt.public.blob.vercel-storage.com/portfolio/10-flake-sous-sol.jpg', caption: 'Sous-sol — Flake gris' },
  9:  { url: 'https://czu5yydsbx2q3trt.public.blob.vercel-storage.com/portfolio/09-rampe-commercial.jpg', caption: 'Rampe commerciale — Flake' },
  8:  { url: 'https://czu5yydsbx2q3trt.public.blob.vercel-storage.com/portfolio/08-metallique-grand.jpg', caption: 'Grand espace — Metallique noir et or' },
  7:  { url: 'https://czu5yydsbx2q3trt.public.blob.vercel-storage.com/portfolio/07-escalier-entree.jpg', caption: "Escalier d'entree — Flake" },
  6:  { url: 'https://czu5yydsbx2q3trt.public.blob.vercel-storage.com/portfolio/06-balcon-vue-large.jpg', caption: 'Balcon facade — Flake' },
  5:  { url: 'https://czu5yydsbx2q3trt.public.blob.vercel-storage.com/portfolio/05-balcon-escalier.jpg', caption: 'Balcon et escalier — Flake' },
  4:  { url: 'https://czu5yydsbx2q3trt.public.blob.vercel-storage.com/portfolio/04-balcon-flake.jpg', caption: 'Balcon exterieur — Flake' },
  3:  { url: 'https://czu5yydsbx2q3trt.public.blob.vercel-storage.com/portfolio/03-commercial-gris.jpg', caption: 'Plancher commercial gris' },
  2:  { url: 'https://czu5yydsbx2q3trt.public.blob.vercel-storage.com/portfolio/02-metallique-travail.jpg', caption: 'Metallique noir, blanc et rouge' },
  1:  { url: 'https://czu5yydsbx2q3trt.public.blob.vercel-storage.com/portfolio/01-metallique-noir-argent.jpg', caption: 'Metallique noir et argent' },
};

// Default photos for residential / commercial
const DEFAULT_RESIDENTIAL = [12, 10, 7, 5];
const DEFAULT_COMMERCIAL = [3, 8, 9, 1];

function pickPhotos(notes: string, service: string, type: string): number[] {
  const text = `${notes} ${service}`.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const scores: Record<number, number> = {};

  for (const [idStr, tags] of Object.entries(PHOTO_TAGS)) {
    const id = Number(idStr);
    for (const tag of tags) {
      const tagNorm = tag.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      if (text.includes(tagNorm)) {
        scores[id] = (scores[id] ?? 0) + 1;
      }
    }
  }

  const sorted = Object.entries(scores)
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => Number(id));

  if (sorted.length >= 4) return sorted.slice(0, 4);

  // Fill with defaults
  const defaults = type === 'commercial' ? DEFAULT_COMMERCIAL : DEFAULT_RESIDENTIAL;
  const result = [...sorted];
  for (const id of defaults) {
    if (result.length >= 4) break;
    if (!result.includes(id)) result.push(id);
  }
  return result.slice(0, 4);
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
}, photos: number[]): string {
  const prenom = getPrenom(lead.nom);
  const project = buildProjectDescription(lead.notes, lead.service);

  const photoGrid = photos.map((id, i) => {
    const p = PHOTO_INFO[id];
    if (!p) return '';
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
    `SELECT id, nom, telephone, email, service, ville, notes, type, temperature, statut FROM crm_leads WHERE id IN (${placeholders}) AND email IS NOT NULL AND email != ''`,
    leadIds,
  );

  const results: { id: number; nom: string; status: 'sent' | 'error'; error?: string }[] = [];

  for (const lead of leads) {
    try {
      const photos = pickPhotos(lead.notes ?? '', lead.service ?? '', lead.type ?? 'residentiel');
      const html = buildHtml({
        nom: lead.nom,
        notes: lead.notes ?? '',
        service: lead.service ?? '',
        type: lead.type ?? 'residentiel',
        ville: lead.ville ?? '',
      }, photos);

      const prenom = getPrenom(lead.nom);
      const subject = `${prenom} — Votre projet en epoxy avec Novus Epoxy`;

      const emailResult = await sendEmail({
        to: lead.email,
        subject,
        html,
      });

      // Log the email
      await query(
        `INSERT INTO email_logs (recipient, subject, type, reference_id, message_id) VALUES ($1, $2, $3, $4, $5)`,
        [lead.email, subject, 'prospect', String(lead.id), emailResult.id],
      );

      // Update lead status to contacte if nouveau
      if (lead.statut === 'nouveau') {
        await query(
          `UPDATE crm_leads SET statut = 'contacte', updated_at = NOW() WHERE id = $1`,
          [lead.id],
        );
      }

      results.push({ id: lead.id, nom: lead.nom, status: 'sent' });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      results.push({ id: lead.id, nom: lead.nom, status: 'error', error: msg });
    }
  }

  const sent = results.filter(r => r.status === 'sent').length;
  return NextResponse.json({ sent, total: results.length, results });
}

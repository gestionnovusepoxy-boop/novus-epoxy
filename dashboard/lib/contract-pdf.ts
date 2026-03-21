import { SERVICES, formatMoney, type ServiceType } from './pricing';
import { escapeHtml } from './utils';

interface QuoteData {
  id: number;
  client_nom: string;
  client_email: string;
  client_tel: string | null;
  client_adresse: string | null;
  type_service: string;
  superficie: number;
  etat_plancher: string | null;
  notes: string | null;
  sous_total: number;
  tps: number;
  tvq: number;
  total: number;
  depot_requis: number;
  created_at: string;
  booking_jour1_date?: string | null;
  booking_jour2_date?: string | null;
  booking_jour2_slot?: string | null;
}

interface CompanyInfo {
  nom: string;
  adresse: string;
  telephone: string;
  rbq: string;
  apchq: boolean;
}

const DEFAULT_COMPANY: CompanyInfo = {
  nom: 'Novus Epoxy',
  adresse: '44 rue de la Polyvalente, Quebec, G2N 1G8',
  telephone: '581-307-5983',
  rbq: '5861-8471-01',
  apchq: true,
};

export function generateContractHtml(quote: QuoteData, companyInfo: CompanyInfo = DEFAULT_COMPANY): string {
  const service = SERVICES[quote.type_service as ServiceType];
  const serviceName = service?.label ?? quote.type_service;
  const depot30 = formatMoney(Number(quote.depot_requis));
  const solde70 = formatMoney(Number(quote.total) - Number(quote.depot_requis));
  const penalite2pct = Math.max(400, Number(quote.total) * 0.02);

  const formatDate = (d: string | null) => {
    if (!d) return '';
    return new Intl.DateTimeFormat('fr-CA', { year: 'numeric', month: 'long', day: 'numeric' }).format(new Date(d));
  };

  const today = formatDate(new Date().toISOString());

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<title>Contrat de services — Devis #${quote.id} — Novus Epoxy</title>
<style>
  @page { margin: 30px 40px; size: letter; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; color: #1e293b; font-size: 13px; line-height: 1.7; padding: 40px; max-width: 800px; margin: 0 auto; }
  .header { background: #0f172a; color: white; padding: 28px 32px; border-radius: 8px 8px 0 0; margin-bottom: 0; }
  .header h1 { font-size: 22px; font-weight: 800; letter-spacing: -0.3px; margin-bottom: 2px; }
  .header .subtitle { color: #f59e0b; font-size: 15px; font-weight: 600; }
  .header .company-details { color: #94a3b8; font-size: 12px; margin-top: 8px; line-height: 1.5; }
  .body-section { border: 1px solid #e2e8f0; border-top: none; padding: 28px 32px; }
  .body-section:last-of-type { border-radius: 0 0 8px 8px; }
  .parties { display: flex; justify-content: space-between; gap: 32px; margin-bottom: 8px; }
  .party { width: 48%; }
  .party-label { font-size: 10px; text-transform: uppercase; letter-spacing: 1.5px; color: #94a3b8; font-weight: 700; margin-bottom: 6px; }
  .party-name { font-size: 15px; font-weight: 700; color: #0f172a; }
  .party-info { font-size: 12px; color: #475569; line-height: 1.6; }
  .article { margin-bottom: 20px; }
  .article h2 { font-size: 14px; font-weight: 700; color: #0f172a; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 2px solid #f59e0b; padding-bottom: 4px; margin-bottom: 10px; }
  .article p, .article li { font-size: 13px; color: #334155; margin-bottom: 4px; }
  .article ul { padding-left: 20px; }
  .article li { margin-bottom: 3px; }
  .price-table { width: 100%; border-collapse: collapse; margin: 10px 0; }
  .price-table td { padding: 6px 12px; font-size: 13px; border-bottom: 1px solid #f1f5f9; }
  .price-table td:last-child { text-align: right; font-weight: 500; }
  .price-table .total-row td { border-top: 2px solid #0f172a; border-bottom: none; font-size: 16px; font-weight: 700; padding-top: 10px; }
  .price-table .depot-row td { color: #d97706; font-weight: 600; }
  .signatures { display: flex; justify-content: space-between; gap: 40px; margin-top: 28px; padding-top: 20px; border-top: 1px solid #e2e8f0; }
  .sig-block { width: 45%; }
  .sig-label { font-size: 10px; text-transform: uppercase; letter-spacing: 1.5px; color: #94a3b8; font-weight: 700; margin-bottom: 4px; }
  .sig-name { font-size: 14px; font-weight: 600; color: #0f172a; margin-bottom: 8px; }
  .sig-line { border-bottom: 1px solid #0f172a; height: 40px; margin-bottom: 4px; }
  .sig-date { font-size: 11px; color: #64748b; }
  .consent { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 12px 16px; margin: 16px 0 0; font-size: 12px; color: #475569; font-style: italic; }
  .footer { text-align: center; margin-top: 20px; color: #94a3b8; font-size: 11px; }
  @media print {
    body { padding: 0; }
    .header { border-radius: 0; }
    .body-section:last-of-type { border-radius: 0; }
  }
</style>
</head>
<body>

<div class="header">
  <h1>${escapeHtml(companyInfo.nom)}</h1>
  <div class="subtitle">Contrat de services — Plancher epoxy</div>
  <div class="company-details">
    ${escapeHtml(companyInfo.adresse)}<br>
    Tel: ${escapeHtml(companyInfo.telephone)}<br>
    Licence RBQ: ${escapeHtml(companyInfo.rbq)}${companyInfo.apchq ? ' | Membre APCHQ' : ''}
  </div>
</div>

<div class="body-section">
  <div class="parties">
    <div class="party">
      <div class="party-label">Entrepreneur</div>
      <div class="party-name">${escapeHtml(companyInfo.nom)}</div>
      <div class="party-info">
        ${escapeHtml(companyInfo.adresse)}<br>
        ${escapeHtml(companyInfo.telephone)}<br>
        RBQ: ${escapeHtml(companyInfo.rbq)}<br>
        Membre APCHQ
      </div>
    </div>
    <div class="party">
      <div class="party-label">Client</div>
      <div class="party-name">${escapeHtml(quote.client_nom)}</div>
      <div class="party-info">
        ${quote.client_adresse ? escapeHtml(quote.client_adresse) + '<br>' : ''}
        ${escapeHtml(quote.client_email)}<br>
        ${quote.client_tel ? escapeHtml(quote.client_tel) : ''}
      </div>
    </div>
  </div>
</div>

<div class="body-section">
  <div class="article">
    <h2>Article 1 — Description des travaux</h2>
    <ul>
      <li><strong>Type de service :</strong> ${escapeHtml(serviceName)}</li>
      <li><strong>Superficie :</strong> ${quote.superficie} pieds carres</li>
      ${quote.etat_plancher ? `<li><strong>Etat du plancher existant :</strong> ${escapeHtml(quote.etat_plancher)}</li>` : ''}
      ${quote.notes ? `<li><strong>Notes additionnelles :</strong> ${escapeHtml(quote.notes)}</li>` : ''}
    </ul>
  </div>

  <div class="article">
    <h2>Article 2 — Prix et modalites de paiement</h2>
    <table class="price-table">
      <tr><td>Sous-total</td><td>${formatMoney(Number(quote.sous_total))}</td></tr>
      <tr><td>TPS (5%)</td><td>${formatMoney(Number(quote.tps))}</td></tr>
      <tr><td>TVQ (9,975%)</td><td>${formatMoney(Number(quote.tvq))}</td></tr>
      <tr class="total-row"><td>Total</td><td>${formatMoney(Number(quote.total))}</td></tr>
      <tr class="depot-row"><td>Depot (30%) requis a la signature</td><td>${depot30}</td></tr>
      <tr><td>Solde (70%) payable a la fin des travaux</td><td>${solde70}</td></tr>
    </table>
    <p><strong>Modes de paiement acceptes :</strong> virement Interac, cheque.</p>
    <p style="margin-top: 10px;">Le depot de 30% est payable dans les 48 heures suivant la signature du present contrat. Les dates de travaux ne seront confirmees qu'a la reception du depot. Novus Epoxy se reserve le droit d'attribuer les dates choisies a un autre client si le depot n'est pas recu dans ce delai.</p>
  </div>

  <div class="article">
    <h2>Article 3 — Echeancier</h2>
    ${quote.booking_jour1_date ? `
    <p><strong>Dates provisoires choisies par le client :</strong></p>
    <ul>
      <li><strong>Jour 1 (preparation) :</strong> ${formatDate(quote.booking_jour1_date)} — Matin (8h a 12h)</li>
      ${quote.booking_jour2_date ? `<li><strong>Jour 2 (finition) :</strong> ${formatDate(quote.booking_jour2_date)} — ${quote.booking_jour2_slot === 'matin' ? 'Matin (8h a 12h)' : 'Apres-midi (12h a 16h)'}</li>` : ''}
    </ul>
    <p>Ces dates sont provisoires et ne seront confirmees qu'a la reception du depot de 30%.</p>
    ` : `<p>Les dates des travaux seront convenues entre les parties apres la signature du present contrat et le paiement du depot.</p>`}
    <p>L'entrepreneur s'engage a executer les travaux selon les regles de l'art et dans les delais convenus.</p>
  </div>

  <div class="article">
    <h2>Article 4 — Obligations de l'entrepreneur</h2>
    <ul>
      <li>Executer les travaux selon les normes RBQ et les regles de l'art</li>
      <li>Fournir tous les materiaux necessaires a la realisation des travaux</li>
      <li>Respecter l'echeancier convenu entre les parties</li>
      <li>Detenir une assurance responsabilite civile valide</li>
      <li>Offrir une garantie de 1 an sur les travaux (Code civil du Quebec)</li>
    </ul>
  </div>

  <div class="article">
    <h2>Article 5 — Obligations du client</h2>
    <ul>
      <li>Liberer completement l'espace de travail (garage/sous-sol vide) avant l'arrivee de l'equipe</li>
      <li>Assurer l'acces a l'electricite et a l'eau sur les lieux des travaux</li>
      <li>Ne pas utiliser le plancher pendant la periode de sechage (72 heures minimum)</li>
    </ul>
  </div>

  <div class="article">
    <h2>Article 6 — Annulation</h2>
    <ul>
      <li>Le client peut annuler avant le debut des travaux.</li>
      <li>Penalite d'annulation : ${formatMoney(penalite2pct)} (400 $ ou 2 % du prix total, le plus eleve), plus le cout des materiaux deja commandes.</li>
      <li>Le solde du depot sera rembourse dans les 30 jours suivant l'annulation.</li>
      <li>Si l'annulation est a l'initiative de l'entrepreneur : remboursement complet du depot.</li>
    </ul>
  </div>

  <div class="article">
    <h2>Article 7 — Garantie</h2>
    <ul>
      <li>Garantie de 1 an contre les defauts de fabrication et d'installation.</li>
      <li>Garantie de 5 ans contre la perte de l'ouvrage (Code civil du Quebec, art. 2118).</li>
      <li><strong>Exclusions :</strong> dommages causes par une utilisation inadequate, impacts mecaniques lourds, produits chimiques non compatibles.</li>
    </ul>
  </div>

  <div class="article">
    <h2>Article 8 — Resolution des litiges</h2>
    <p>Les parties s'engagent a tenter de resoudre tout litige a l'amiable. A defaut d'entente, les tribunaux du Quebec seront competents.</p>
  </div>
</div>

<div class="body-section">
  <div class="signatures">
    <div class="sig-block">
      <div class="sig-label">Signature de l'entrepreneur</div>
      <div class="sig-name">${escapeHtml(companyInfo.nom)}</div>
      <div class="sig-line"></div>
      <div class="sig-date">Date : ${today}</div>
    </div>
    <div class="sig-block">
      <div class="sig-label">Signature du client</div>
      <div class="sig-name">${escapeHtml(quote.client_nom)}</div>
      <div class="sig-line"></div>
      <div class="sig-date">Date : ____________________</div>
    </div>
  </div>

  <div class="consent">
    En signant ce contrat, je confirme avoir lu et accepte toutes les conditions ci-dessus.
  </div>
</div>

<div class="footer">
  <p>Devis #${quote.id} — ${formatDate(quote.created_at)}</p>
  <p>${escapeHtml(companyInfo.nom)} — Planchers epoxy haut de gamme — Quebec</p>
</div>

<script>window.onload = function() { window.print(); }</script>
</body>
</html>`;
}

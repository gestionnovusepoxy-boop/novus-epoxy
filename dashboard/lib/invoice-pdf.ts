import { SERVICES, formatMoney, type ServiceType } from './pricing';
import { escapeHtml } from './utils';

interface InvoiceData {
  numero: string;
  date_emission: string;
  date_echeance: string | null;
  type_service: string;
  superficie: number;
  prix_pied_carre: number;
  sous_total: number;
  tps: number;
  tvq: number;
  total: number;
  depot_montant: number;
  depot_paye: boolean;
  depot_paye_at: string | null;
  final_montant: number;
  final_paye: boolean;
  final_paye_at: string | null;
  notes: string | null;
  statut: string;
  // Optional enriched data
  work_address?: string | null;
  couleur?: string | null;
  jour1_date?: string | null;
  jour1_slot?: string | null;
  jour2_date?: string | null;
  jour2_slot?: string | null;
}

interface ClientData {
  nom: string;
  email: string;
  telephone: string | null;
  adresse: string | null;
}

// Description détaillée des travaux par type de service.
// Inclus dans toutes les factures pour montrer le pro qu'on est.
const WORK_DESCRIPTION: Record<string, string[]> = {
  flake: [
    "Préparation du béton — meulage diamant + aspiration HEPA",
    "Réparation des fissures et crevasses (epoxy de remplissage)",
    "Application primer epoxy 100% solide (1ère couche d'accroche)",
    "Base coat epoxy pigmentée — couleur sélectionnée",
    "Saupoudrage de flocons (Flake) à plein refus",
    "Topcoat polyaspartique haute brillance (2 couches)",
    "Nettoyage chantier complet à la fin",
  ],
  metallique: [
    "Préparation du béton — meulage diamant + aspiration HEPA",
    "Réparation des fissures et crevasses (epoxy de remplissage)",
    "Application primer epoxy 100% solide",
    "Base coat epoxy noire ou tintée selon couleur sélectionnée",
    "Application metallic pigment épandu et travaillé pour effet liquid-metal",
    "Topcoat polyaspartique cristal-clair haute brillance (2 couches)",
    "Nettoyage chantier complet à la fin",
  ],
  quartz: [
    "Préparation du béton — meulage diamant + aspiration HEPA",
    "Réparation des fissures et crevasses (epoxy de remplissage)",
    "Application primer epoxy 100% solide",
    "Saupoudrage quartz coloré dans base epoxy à plein refus",
    "Application topcoat satiné anti-microbien (2 couches)",
    "Nettoyage chantier complet à la fin",
  ],
  couleur_unie: [
    "Préparation du béton — meulage diamant + aspiration HEPA",
    "Réparation des fissures et crevasses (epoxy de remplissage)",
    "Application primer epoxy 100% solide",
    "Couche epoxy pigmentée — couleur sélectionnée",
    "Topcoat polyaspartique haute brillance",
    "Nettoyage chantier complet à la fin",
  ],
  antiderapant: [
    "Préparation du béton — meulage diamant + aspiration HEPA",
    "Réparation des fissures et crevasses",
    "Application primer epoxy 100% solide",
    "Couche epoxy pigmentée + agrégat antidérapant intégré",
    "Topcoat polyaspartique résistant UV et intempéries",
    "Nettoyage chantier complet à la fin",
  ],
  commercial: [
    "Préparation du béton — meulage diamant industriel + aspiration HEPA",
    "Réparation joints et fissures (epoxy structurel)",
    "Application primer epoxy haute performance",
    "Couches epoxy industrielle pigmentée",
    "Lignes de marquage si requis",
    "Topcoat polyaspartique résistant chimique haute trafic",
    "Nettoyage chantier complet à la fin",
  ],
  meulage: [
    "Meulage diamant du béton existant",
    "Polissage progressif (grits 30 → 50 → 100 → 200 → 400 → 800)",
    "Application durcisseur lithium (densifier)",
    "Polissage final avec brillance haute (1500-3000 grit)",
    "Application scellant anti-tâche pénétrant",
    "Nettoyage chantier complet à la fin",
  ],
  vinyl_click: [
    "Préparation et nivellement du sous-plancher",
    "Installation pare-vapeur sous-couche (si requis)",
    "Pose des planches vinyl click selon plan",
    "Coupes et ajustements autour des obstacles",
    "Installation des plinthes ou moulures de finition",
    "Nettoyage chantier complet à la fin",
  ],
};

export function generateInvoiceHtml(invoice: InvoiceData, client: ClientData): string {
  const service = SERVICES[invoice.type_service as ServiceType];
  const serviceName = service?.label ?? invoice.type_service;
  const workSteps = WORK_DESCRIPTION[invoice.type_service] ?? [];

  const formatDate = (d: string | null) => {
    if (!d) return '—';
    return new Intl.DateTimeFormat('fr-CA', { year: 'numeric', month: 'long', day: 'numeric' }).format(new Date(d));
  };

  const slotLabel = (slot: string | null | undefined) => {
    if (!slot) return '';
    if (slot === 'matin') return ' — Matin (8h)';
    if (slot === 'apres-midi' || slot === 'apres_midi') return ' — Après-midi (13h)';
    return ` — ${slot}`;
  };

  const statusLabel: Record<string, string> = {
    brouillon: 'Brouillon',
    envoyee: 'Envoyée',
    depot_recu: 'Dépôt reçu',
    travaux_en_cours: 'Travaux en cours',
    completee: 'Complétée',
    annulee: 'Annulée',
  };

  const hasInstallation = invoice.jour1_date || invoice.jour2_date;
  const workAddress = invoice.work_address || client.adresse;

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<title>Facture ${invoice.numero} — Novus Epoxy</title>
<style>
  @page { margin: 40px; size: letter; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; color: #1e293b; font-size: 14px; line-height: 1.6; padding: 40px; max-width: 800px; margin: 0 auto; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 40px; border-bottom: 3px solid #f59e0b; padding-bottom: 20px; }
  .company h1 { font-size: 28px; font-weight: 800; color: #0f172a; letter-spacing: -0.5px; }
  .company p { color: #64748b; font-size: 13px; }
  .invoice-info { text-align: right; }
  .invoice-info h2 { font-size: 24px; color: #f59e0b; font-weight: 700; text-transform: uppercase; }
  .invoice-info .numero { font-size: 18px; font-weight: 600; color: #0f172a; }
  .invoice-info .date { color: #64748b; font-size: 13px; margin-top: 4px; }
  .status { display: inline-block; padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: 600; margin-top: 8px; }
  .status-completee { background: #dcfce7; color: #166534; }
  .status-depot_recu { background: #fef3c7; color: #92400e; }
  .status-envoyee { background: #e0e7ff; color: #3730a3; }
  .status-brouillon { background: #f1f5f9; color: #475569; }
  .status-travaux_en_cours { background: #cffafe; color: #155e75; }
  .status-annulee { background: #fce4ec; color: #c62828; }
  .parties { display: flex; justify-content: space-between; margin-bottom: 24px; gap: 20px; }
  .party { flex: 1; }
  .party h3 { font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: #94a3b8; margin-bottom: 8px; font-weight: 600; }
  .party p { font-size: 14px; }
  .party .name { font-weight: 600; font-size: 16px; }
  .work-info { background: #f8fafc; border-left: 4px solid #f59e0b; padding: 16px 20px; margin-bottom: 24px; border-radius: 0 8px 8px 0; }
  .work-info h3 { font-size: 12px; text-transform: uppercase; color: #92400e; font-weight: 700; letter-spacing: 0.5px; margin-bottom: 8px; }
  .work-info .row { display: flex; gap: 20px; margin-bottom: 4px; }
  .work-info .row strong { min-width: 140px; color: #475569; font-weight: 600; }
  .description-section { background: #fff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 18px 20px; margin-bottom: 24px; }
  .description-section h3 { font-size: 12px; text-transform: uppercase; color: #0f172a; font-weight: 700; letter-spacing: 0.5px; margin-bottom: 10px; }
  .description-section ul { list-style: none; padding: 0; }
  .description-section li { padding: 4px 0; padding-left: 24px; position: relative; font-size: 13px; color: #334155; }
  .description-section li::before { content: '✓'; position: absolute; left: 0; color: #16a34a; font-weight: bold; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
  thead th { background: #0f172a; color: white; padding: 12px 16px; text-align: left; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600; }
  thead th:last-child { text-align: right; }
  tbody td { padding: 12px 16px; border-bottom: 1px solid #e2e8f0; }
  tbody td:last-child { text-align: right; font-weight: 500; }
  .totals { margin-left: auto; width: 320px; }
  .totals .row { display: flex; justify-content: space-between; padding: 6px 0; font-size: 14px; }
  .totals .row.subtotal { color: #64748b; }
  .totals .row.tax { color: #64748b; font-size: 13px; }
  .totals .row.total { font-size: 20px; font-weight: 700; border-top: 2px solid #0f172a; padding-top: 12px; margin-top: 8px; }
  .payments { margin-top: 30px; background: #f8fafc; border-radius: 8px; padding: 20px; border: 1px solid #e2e8f0; }
  .payments h3 { font-size: 14px; font-weight: 700; margin-bottom: 12px; text-transform: uppercase; letter-spacing: 0.5px; }
  .payment-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #e2e8f0; }
  .payment-row:last-child { border-bottom: none; }
  .payment-row .label { color: #475569; }
  .payment-row .amount { font-weight: 600; }
  .paid { color: #16a34a; }
  .unpaid { color: #dc2626; }
  .accepted-methods { margin-top: 24px; background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; padding: 18px 20px; }
  .accepted-methods h3 { font-size: 12px; text-transform: uppercase; color: #92400e; font-weight: 700; letter-spacing: 0.5px; margin-bottom: 10px; }
  .accepted-methods .method { padding: 6px 0; font-size: 13px; color: #334155; }
  .accepted-methods .method .icon { display: inline-block; width: 24px; }
  .accepted-methods .method strong { color: #92400e; }
  .warranty { margin-top: 24px; background: #ecfdf5; border-left: 4px solid #16a34a; border-radius: 0 8px 8px 0; padding: 16px 20px; }
  .warranty h3 { font-size: 12px; text-transform: uppercase; color: #166534; font-weight: 700; letter-spacing: 0.5px; margin-bottom: 6px; }
  .warranty p { font-size: 13px; color: #334155; }
  .footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid #e2e8f0; color: #94a3b8; font-size: 12px; text-align: center; }
  .footer .tax-numbers { margin-top: 6px; font-size: 11px; }
  .notes { margin-top: 24px; padding: 16px; background: #fffbeb; border-left: 4px solid #f59e0b; border-radius: 0 8px 8px 0; }
  .notes h4 { font-size: 12px; text-transform: uppercase; color: #92400e; margin-bottom: 4px; }
  @media print {
    body { padding: 0; }
    .no-print { display: none; }
  }
</style>
</head>
<body>
  <div class="header">
    <div class="company">
      <h1>Novus Epoxy</h1>
      <p>Planchers époxy haut de gamme</p>
      <p>Québec, Canada</p>
      <p>581-307-5983 (Luca) · 581-307-2678 (Jason)</p>
      <p>gestionnovusepoxy@gmail.com</p>
    </div>
    <div class="invoice-info">
      <h2>Facture</h2>
      <div class="numero">${escapeHtml(invoice.numero)}</div>
      <div class="date">Émise le ${formatDate(invoice.date_emission)}</div>
      ${invoice.date_echeance ? `<div class="date">Échéance : ${formatDate(invoice.date_echeance)}</div>` : ''}
      <div class="status status-${invoice.statut}">${statusLabel[invoice.statut] ?? invoice.statut}</div>
    </div>
  </div>

  <div class="parties">
    <div class="party">
      <h3>Facturé à</h3>
      <p class="name">${escapeHtml(client.nom)}</p>
      <p>${escapeHtml(client.email)}</p>
      ${client.telephone ? `<p>${escapeHtml(client.telephone)}</p>` : ''}
      ${client.adresse ? `<p>${escapeHtml(client.adresse)}</p>` : ''}
    </div>
    <div class="party">
      <h3>De</h3>
      <p class="name">Novus Epoxy</p>
      <p>gestionnovusepoxy@gmail.com</p>
      <p>581-307-5983</p>
      <p>44 rue de la Polyvalente, Québec G2N 1G8</p>
    </div>
  </div>

  <div class="work-info">
    <h3>Détails des travaux</h3>
    ${workAddress ? `<div class="row"><strong>Adresse des travaux :</strong><span>${escapeHtml(workAddress)}</span></div>` : ''}
    <div class="row"><strong>Type de service :</strong><span>${escapeHtml(serviceName)}</span></div>
    <div class="row"><strong>Superficie :</strong><span>${invoice.superficie} pi²</span></div>
    ${invoice.couleur ? `<div class="row"><strong>Couleur choisie :</strong><span>${escapeHtml(invoice.couleur)}</span></div>` : ''}
    ${hasInstallation && invoice.jour1_date ? `<div class="row"><strong>Jour 1 (préparation) :</strong><span>${formatDate(invoice.jour1_date)}${slotLabel(invoice.jour1_slot)}</span></div>` : ''}
    ${hasInstallation && invoice.jour2_date ? `<div class="row"><strong>Jour 2 (finition) :</strong><span>${formatDate(invoice.jour2_date)}${slotLabel(invoice.jour2_slot)}</span></div>` : ''}
  </div>

  ${workSteps.length > 0 ? `
  <div class="description-section">
    <h3>Description détaillée des travaux inclus</h3>
    <ul>
      ${workSteps.map(s => `<li>${escapeHtml(s)}</li>`).join('')}
    </ul>
  </div>
  ` : ''}

  <table>
    <thead>
      <tr>
        <th>Description</th>
        <th>Quantité</th>
        <th>Prix unitaire</th>
        <th>Montant</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>Plancher époxy — ${serviceName}<br><span style="font-size:11px;color:#64748b;">Matériaux haut de gamme + main d'œuvre 2 jours inclus</span></td>
        <td>${invoice.superficie} pi²</td>
        <td>${formatMoney(Number(invoice.prix_pied_carre))}/pi²</td>
        <td>${formatMoney(Number(invoice.sous_total))}</td>
      </tr>
    </tbody>
  </table>

  <div class="totals">
    <div class="row subtotal">
      <span>Sous-total</span>
      <span>${formatMoney(Number(invoice.sous_total))}</span>
    </div>
    <div class="row tax">
      <span>TPS (5%)</span>
      <span>${formatMoney(Number(invoice.tps))}</span>
    </div>
    <div class="row tax">
      <span>TVQ (9,975%)</span>
      <span>${formatMoney(Number(invoice.tvq))}</span>
    </div>
    <div class="row total">
      <span>Total</span>
      <span>${formatMoney(Number(invoice.total))}</span>
    </div>
  </div>

  <div class="payments">
    <h3>Modalités de paiement</h3>
    <div class="payment-row">
      <span class="label">Dépôt (30%)</span>
      <span class="amount ${invoice.depot_paye ? 'paid' : 'unpaid'}">
        ${formatMoney(Number(invoice.depot_montant))}
        ${invoice.depot_paye ? ' ✓ Payé' + (invoice.depot_paye_at ? ' le ' + formatDate(invoice.depot_paye_at) : '') : ' — À payer'}
      </span>
    </div>
    <div class="payment-row">
      <span class="label">Solde (70%) — à la fin des travaux</span>
      <span class="amount ${invoice.final_paye ? 'paid' : 'unpaid'}">
        ${formatMoney(Number(invoice.final_montant))}
        ${invoice.final_paye ? ' ✓ Payé' + (invoice.final_paye_at ? ' le ' + formatDate(invoice.final_paye_at) : '') : ' — À payer'}
      </span>
    </div>
  </div>

  <div class="accepted-methods">
    <h3>Modes de paiement acceptés</h3>
    <div class="method"><span class="icon">🏦</span> <strong>Virement Interac e-Transfer</strong> — <em>recommandé, sans frais</em> · gestionnovusepoxy@gmail.com</div>
    <div class="method"><span class="icon">💵</span> <strong>Comptant</strong> — coordonner avec Luca au 581-307-5983</div>
  </div>

  <div class="warranty">
    <h3>Garantie écrite</h3>
    <p>Tous nos planchers sont garantis <strong>10 ans</strong> contre le pelage, le décollement et les défauts d'adhésion. Cette garantie couvre la main d'œuvre et les matériaux dans les conditions d'usage normales résidentielles ou commerciales.</p>
  </div>

  ${invoice.notes ? `
  <div class="notes">
    <h4>Notes</h4>
    <p>${escapeHtml(invoice.notes)}</p>
  </div>` : ''}

  <div class="footer">
    <p>Novus Epoxy — Planchers époxy haut de gamme — Québec</p>
    <p>Merci de votre confiance!</p>
    <p class="tax-numbers">RBQ : 5861-8471-01  ·  No TPS : —  ·  No TVQ : —</p>
  </div>

  <script>window.onload = function() { window.print(); }</script>
</body>
</html>`;
}

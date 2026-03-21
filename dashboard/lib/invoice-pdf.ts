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
}

interface ClientData {
  nom: string;
  email: string;
  telephone: string | null;
  adresse: string | null;
}

export function generateInvoiceHtml(invoice: InvoiceData, client: ClientData): string {
  const service = SERVICES[invoice.type_service as ServiceType];
  const serviceName = service?.label ?? invoice.type_service;

  const formatDate = (d: string | null) => {
    if (!d) return '—';
    return new Intl.DateTimeFormat('fr-CA', { year: 'numeric', month: 'long', day: 'numeric' }).format(new Date(d));
  };

  const statusLabel: Record<string, string> = {
    brouillon: 'Brouillon',
    envoyee: 'Envoyée',
    depot_recu: 'Dépôt reçu',
    travaux_en_cours: 'Travaux en cours',
    completee: 'Complétée',
    annulee: 'Annulée',
  };

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
  .parties { display: flex; justify-content: space-between; margin-bottom: 30px; }
  .party { width: 48%; }
  .party h3 { font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: #94a3b8; margin-bottom: 8px; font-weight: 600; }
  .party p { font-size: 14px; }
  .party .name { font-weight: 600; font-size: 16px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
  thead th { background: #0f172a; color: white; padding: 12px 16px; text-align: left; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600; }
  thead th:last-child { text-align: right; }
  tbody td { padding: 12px 16px; border-bottom: 1px solid #e2e8f0; }
  tbody td:last-child { text-align: right; font-weight: 500; }
  .totals { margin-left: auto; width: 300px; }
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
  .footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid #e2e8f0; color: #94a3b8; font-size: 12px; text-align: center; }
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
    </div>
  </div>

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
        <td>Plancher époxy — ${serviceName}</td>
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

  ${invoice.notes ? `
  <div class="notes">
    <h4>Notes</h4>
    <p>${escapeHtml(invoice.notes)}</p>
  </div>` : ''}

  <div class="footer">
    <p>Novus Epoxy — Planchers époxy haut de gamme — Québec</p>
    <p>Merci de votre confiance!</p>
  </div>

  <script>window.onload = function() { window.print(); }</script>
</body>
</html>`;
}

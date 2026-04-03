export const SERVICES = {
  flake:         { label: 'Flocon (Flake)',  prix: 8.50 },
  metallique:    { label: 'Métallique',      prix: 12.75 },
  couleur_unie:  { label: 'Couleur unie',    prix: 7.50 },
  quartz:        { label: 'Quartz',          prix: 11.00 },
  antiderapant:  { label: 'Antidérapant',    prix: 10.00 },
  commercial:    { label: 'Commercial',      prix: 15.00 },
  meulage:       { label: 'Meulage au diamant', prix: 3.50 },
} as const;

// Note: les prix peuvent varier si les travaux sont a plus de 65 km de distance

export type ServiceType = keyof typeof SERVICES;

export const TPS_RATE = 0.05;
export const TVQ_RATE = 0.09975;
export const DEPOT_RATE = 0.30;

export function calculateQuote(type: ServiceType, superficie: number, rabais_pct = 0) {
  const prix = SERVICES[type].prix;
  const sousTotalBrut = Math.round(prix * superficie * 100) / 100;
  const rabaisMontant = Math.round(sousTotalBrut * (rabais_pct / 100) * 100) / 100;
  const sousTotal = Math.round((sousTotalBrut - rabaisMontant) * 100) / 100;
  const tps = Math.round(sousTotal * TPS_RATE * 100) / 100;
  const tvq = Math.round(sousTotal * TVQ_RATE * 100) / 100;
  const total = Math.round((sousTotal + tps + tvq) * 100) / 100;
  const depot = Math.round(total * DEPOT_RATE * 100) / 100;

  return {
    prix_pied_carre: prix,
    rabais_pct,
    rabais_montant: rabaisMontant,
    sous_total: sousTotal,
    tps,
    tvq,
    total,
    depot_requis: depot,
  };
}

// Description des travaux par service — étapes + épaisseurs
export const SERVICE_DESCRIPTION: Record<string, { etapes: string[]; epaisseur_totale: string }> = {
  flake: {
    etapes: [
      'Meulage au diamant de la surface',
      'Réparation si nécessaire (crack filler ou béton)',
      'Application de l\'époxy avec broadcast de flocons (15-20 mils)',
      'Topcoat polyuréthane protection UV (2-4 mils)',
    ],
    epaisseur_totale: '18-25 mils (0.46-0.64 mm)',
  },
  metallique: {
    etapes: [
      'Meulage au diamant de la surface',
      'Application du basecoat époxy (8-12 mils)',
      'Sablage et application des pigments de couleur époxy métallique (12-20 mils)',
      'Topcoat uréthane haute performance (2-4 mils)',
    ],
    epaisseur_totale: '22-36 mils (0.56-0.91 mm)',
  },
  quartz: {
    etapes: [
      'Meulage au diamant de la surface',
      'Application du basecoat époxy (8-12 mils)',
      'Broadcast de quartz (40-60 mils)',
      'Topcoat polyuréthane (8-15 mils)',
    ],
    epaisseur_totale: '55-85 mils (1.40-2.16 mm)',
  },
  couleur_unie: {
    etapes: [
      'Meulage au diamant de la surface',
      'Réparation si nécessaire (crack filler ou béton)',
      'Application époxy couleur unie — 2 couches (10-16 mils)',
      'Topcoat polyuréthane protection UV (2-4 mils)',
    ],
    epaisseur_totale: '12-20 mils (0.30-0.51 mm)',
  },
  commercial: {
    etapes: [
      'Meulage au diamant de la surface',
      'Réparation si nécessaire (crack filler ou béton)',
      'Application époxy commercial haute résistance (15-20 mils)',
      'Topcoat polyuréthane antidérapant (4-6 mils)',
    ],
    epaisseur_totale: '20-30 mils (0.51-0.76 mm)',
  },
};

export function getServiceDescription(type: string): string {
  const desc = SERVICE_DESCRIPTION[type];
  if (!desc) return '';
  return desc.etapes.map((e, i) => `${i + 1}. ${e}`).join('\n') + `\n\nÉpaisseur totale du système : ${desc.epaisseur_totale}`;
}

export function getServiceDescriptionHtml(type: string): string {
  const desc = SERVICE_DESCRIPTION[type];
  if (!desc) return '';
  const steps = desc.etapes.map((e, i) => `<tr><td style="padding:4px 0;color:#475569;font-size:14px;vertical-align:top;">${i + 1}.</td><td style="padding:4px 0 4px 8px;color:#1e293b;font-size:14px;">${e}</td></tr>`).join('');
  return `<table cellpadding="0" cellspacing="0" style="margin:0 0 8px;">${steps}</table><p style="color:#64748b;font-size:13px;margin:4px 0 0;font-style:italic;">Épaisseur totale du système : ${desc.epaisseur_totale}</p>`;
}

export function calculateQuoteCustomPrice(sousTotal: number) {
  const tps = Math.round(sousTotal * TPS_RATE * 100) / 100;
  const tvq = Math.round(sousTotal * TVQ_RATE * 100) / 100;
  const total = Math.round((sousTotal + tps + tvq) * 100) / 100;
  const depot = Math.round(total * DEPOT_RATE * 100) / 100;

  return { sous_total: sousTotal, tps, tvq, total, depot_requis: depot };
}

export function formatMoney(n: number): string {
  return new Intl.NumberFormat('fr-CA', { style: 'currency', currency: 'CAD' }).format(n);
}

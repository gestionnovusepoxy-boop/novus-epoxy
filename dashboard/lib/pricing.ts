export const SERVICES = {
  flake:         { label: 'Flocon (Flake)',  prix: 8.50 },
  metallique:    { label: 'Métallique',      prix: 12.75 },
  couleur_unie:  { label: 'Couleur unie',    prix: 7.50 },
  quartz:        { label: 'Quartz',          prix: 11.00 },
  antiderapant:  { label: 'Antidérapant',    prix: 10.00 },
  commercial:    { label: 'Commercial',      prix: 15.00 },
  meulage:       { label: 'Meulage au diamant', prix: 3.50 },
  autonivelant:  { label: 'Auto-nivelant / Réparation béton', prix: 3.25 },
} as const;

// Note: les prix peuvent varier si les travaux sont a plus de 65 km de distance

export type ServiceType = keyof typeof SERVICES;

export const TPS_RATE = 0.05;
export const TVQ_RATE = 0.09975;
export const DEPOT_RATE = 0.30;

// Promotion avril 2026 — 20% rabais automatique (désactiver fin avril)
const PROMO_DEFAULT_RABAIS = 20;

export function calculateQuote(type: ServiceType, superficie: number, rabais_pct = PROMO_DEFAULT_RABAIS) {
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
      'Application du basecoat époxy (15-20 mils)',
      'Sablage et application des pigments de couleur époxy métallique (45-55 mils)',
      'Topcoat uréthane haute performance (2-4 mils)',
    ],
    epaisseur_totale: '62-79 mils (1.57-2.01 mm)',
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
      'Broadcast de sable de silice antidérapant',
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

// Extras prédéfinis (le user peut aussi en créer des custom)
export const EXTRAS_PREDEFINIS = [
  { key: 'masquage', label: 'Masquage complet', prix_defaut: 250 },
  { key: 'protection', label: 'Protection de chantier', prix_defaut: 200 },
  { key: 'echafaudage', label: 'Échafaudage', prix_defaut: 350 },
  { key: 'reparation_marches', label: 'Réparation de marches de béton', prix_defaut: 500 },
] as const;

export interface QuoteItem {
  type_service: ServiceType;
  superficie: number;
  prix_pied_carre: number;
  sous_total: number;
  description?: string;
}

export interface QuoteExtra {
  description: string;
  quantite: number;
  prix_unitaire: number;
  sous_total: number;
}

export function calculateMultiQuote(
  items: { type_service: ServiceType; superficie: number; prix_fixe?: number }[],
  extras: { description: string; quantite: number; prix_unitaire: number }[],
  rabais_pct = PROMO_DEFAULT_RABAIS,
) {
  // Calculate each service item (supports prix_fixe override)
  const calcItems: QuoteItem[] = items.map(item => {
    if (item.prix_fixe && item.prix_fixe > 0) {
      // Prix fixe — ignore le calcul au pi²
      return { type_service: item.type_service, superficie: item.superficie, prix_pied_carre: 0, sous_total: item.prix_fixe };
    }
    const prix = SERVICES[item.type_service].prix;
    const st = Math.round(prix * item.superficie * 100) / 100;
    return { type_service: item.type_service, superficie: item.superficie, prix_pied_carre: prix, sous_total: st };
  });

  // Calculate each extra
  const calcExtras: QuoteExtra[] = extras.map(ex => ({
    description: ex.description,
    quantite: ex.quantite,
    prix_unitaire: ex.prix_unitaire,
    sous_total: Math.round(ex.quantite * ex.prix_unitaire * 100) / 100,
  }));

  const itemsTotal = calcItems.reduce((s, i) => s + i.sous_total, 0);
  const extrasTotal = calcExtras.reduce((s, e) => s + e.sous_total, 0);
  const sousTotalBrut = Math.round((itemsTotal + extrasTotal) * 100) / 100;

  // Discount applies to services only, not extras
  const rabaisMontant = Math.round(itemsTotal * (rabais_pct / 100) * 100) / 100;
  const sousTotal = Math.round((sousTotalBrut - rabaisMontant) * 100) / 100;
  const tps = Math.round(sousTotal * TPS_RATE * 100) / 100;
  const tvq = Math.round(sousTotal * TVQ_RATE * 100) / 100;
  const total = Math.round((sousTotal + tps + tvq) * 100) / 100;
  const depot = Math.round(total * DEPOT_RATE * 100) / 100;

  return {
    items: calcItems,
    extras: calcExtras,
    items_total: itemsTotal,
    extras_total: extrasTotal,
    rabais_pct,
    rabais_montant: rabaisMontant,
    sous_total: sousTotal,
    tps,
    tvq,
    total,
    depot_requis: depot,
  };
}

export function formatMoney(n: number): string {
  return new Intl.NumberFormat('fr-CA', { style: 'currency', currency: 'CAD' }).format(n);
}

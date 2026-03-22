export const SERVICES = {
  flake:         { label: 'Flocon (Flake)',  prix: 8.50 },
  metallique:    { label: 'Métallique',      prix: 12.75 },
  couleur_unie:  { label: 'Couleur unie',    prix: 7.50 },
  antiderapant:  { label: 'Antidérapant',    prix: 10.00 },
  commercial:    { label: 'Commercial',      prix: 15.00 },
} as const;

export type ServiceType = keyof typeof SERVICES;

export const TPS_RATE = 0.05;
export const TVQ_RATE = 0.09975;
export const DEPOT_RATE = 0.30;

export function calculateQuote(type: ServiceType, superficie: number) {
  const prix = SERVICES[type].prix;
  const sousTotal = Math.round(prix * superficie * 100) / 100;
  const tps = Math.round(sousTotal * TPS_RATE * 100) / 100;
  const tvq = Math.round(sousTotal * TVQ_RATE * 100) / 100;
  const total = Math.round((sousTotal + tps + tvq) * 100) / 100;
  const depot = Math.round(total * DEPOT_RATE * 100) / 100;

  return {
    prix_pied_carre: prix,
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

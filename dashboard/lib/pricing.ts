import { dollarsToCents, centsToDollars, mulCents, pctOfCents, sumCents, taxesFromSubtotalCents } from './money';

export const SERVICES = {
  flake:         { label: 'Flocon (Flake)',  prix: 8.50 },
  metallique:    { label: 'Métallique',      prix: 12.75 },
  couleur_unie:  { label: 'Couleur unie',    prix: 7.50 },
  quartz:        { label: 'Quartz',          prix: 11.00 },
  antiderapant:  { label: 'Antidérapant',    prix: 10.00 },
  commercial:    { label: 'Commercial',      prix: 15.00 },
  meulage:       { label: 'Meulage au diamant', prix: 3.50 },
  autonivelant:  { label: 'Auto-nivelant / Réparation béton', prix: 3.25 },
  vinyl_click:   { label: 'Plancher Vinyl Click',             prix: 2.00 },
} as const;

// Note: les prix peuvent varier si les travaux sont a plus de 65 km de distance

export type ServiceType = keyof typeof SERVICES;

export const TPS_RATE = 0.05;
export const TVQ_RATE = 0.09975;
export const DEPOT_RATE = 0.30;

// Minimum de job (minimum call) — on ne se déplace pas sous ce montant.
// Tout devis dont le service tombe sous ce seuil est ramené à ce minimum.
export const MIN_JOB_DOLLARS = 1500;

/**
 * Calcul simple — un service au pi² + rabais. Calcul interne en CENTS.
 * Retourne des dollars (interface DB inchangée).
 */
export function calculateQuote(type: ServiceType, superficie: number, rabais_pct = 0) {
  const prixCents = dollarsToCents(SERVICES[type].prix);
  const sousTotalBrutCents = mulCents(prixCents, superficie);
  const rabaisCents = pctOfCents(sousTotalBrutCents, rabais_pct);
  // Apply minimum-job floor AFTER rabais — never bill the service portion below MIN_JOB.
  // EXCEPTION: vinyl (plancher flottant) is exempt from the $1500 minimum.
  const minJobCents = type === 'vinyl_click' ? 0 : dollarsToCents(MIN_JOB_DOLLARS);
  const afterRabaisCents = sousTotalBrutCents - rabaisCents;
  const sousTotalCents = Math.max(afterRabaisCents, minJobCents);
  const minimumApplied = afterRabaisCents < minJobCents;
  const { tpsCents, tvqCents, totalCents, depotCents } = taxesFromSubtotalCents(sousTotalCents);

  return {
    prix_pied_carre: SERVICES[type].prix,
    rabais_pct,
    rabais_montant: centsToDollars(rabaisCents),
    minimum_applique: minimumApplied,
    sous_total: centsToDollars(sousTotalCents),
    tps: centsToDollars(tpsCents),
    tvq: centsToDollars(tvqCents),
    total: centsToDollars(totalCents),
    depot_requis: centsToDollars(depotCents),
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
  vinyl_click: {
    etapes: [
      'Nettoyage et préparation du sous-plancher',
      'Vérification du niveau et réparation si nécessaire',
      'Installation du vinyl click flottant (pose sans colle)',
      'Pose des moulures et baguettes de finition',
      'Nettoyage complet après chantier',
    ],
    epaisseur_totale: '4-8 mm selon le produit choisi',
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
  const sousTotalCents = dollarsToCents(sousTotal);
  const { tpsCents, tvqCents, totalCents, depotCents } = taxesFromSubtotalCents(sousTotalCents);
  return {
    sous_total: centsToDollars(sousTotalCents),
    tps: centsToDollars(tpsCents),
    tvq: centsToDollars(tvqCents),
    total: centsToDollars(totalCents),
    depot_requis: centsToDollars(depotCents),
  };
}

/**
 * Recalc complet d'un devis avec services + extras + rabais.
 * Rabais s'applique UNIQUEMENT sur les services (Flake/etc.), JAMAIS sur les extras.
 * Extras = prix fixe net.
 */
export function calculateQuoteWithExtras(opts: {
  serviceType: ServiceType | string;
  superficie: number;
  prixPiedCarre: number | null; // si 0/null + sousTotalService > 0 => prix fixe
  sousTotalService: number; // pour prix fixe; sinon recalculé à partir de prix * superficie
  rabaisPct: number;
  extrasTotal: number; // somme des extras (déjà calculée, jamais rabaisée)
}) {
  const { serviceType, superficie, prixPiedCarre, sousTotalService, rabaisPct, extrasTotal } = opts;

  // Tout en CENTS (entiers) pour zéro problème d'arrondi flottant.
  const isPrixFixe = (!prixPiedCarre || prixPiedCarre === 0) && sousTotalService > 0;
  const knownPrix = serviceType in SERVICES ? SERVICES[serviceType as ServiceType].prix : (prixPiedCarre ?? 0);

  const serviceBrutCents = isPrixFixe
    ? dollarsToCents(sousTotalService)
    : mulCents(dollarsToCents(knownPrix), superficie);

  const rabaisCents = pctOfCents(serviceBrutCents, rabaisPct);
  const serviceNetCents = serviceBrutCents - rabaisCents;
  const extrasCents = dollarsToCents(extrasTotal);
  const sousTotalCents = sumCents(serviceNetCents, extrasCents);

  const { tpsCents, tvqCents, totalCents, depotCents } = taxesFromSubtotalCents(sousTotalCents);

  return {
    prix_pied_carre: isPrixFixe ? 0 : knownPrix,
    service_brut: centsToDollars(serviceBrutCents),
    service_net: centsToDollars(serviceNetCents),
    extras_total: centsToDollars(extrasCents),
    rabais_pct: rabaisPct,
    rabais_montant: centsToDollars(rabaisCents),
    sous_total: centsToDollars(sousTotalCents),
    tps: centsToDollars(tpsCents),
    tvq: centsToDollars(tvqCents),
    total: centsToDollars(totalCents),
    depot_requis: centsToDollars(depotCents),
  };
}

// Extras prédéfinis (le user peut aussi en créer des custom)
// inclus = true : montré au client comme "✓ INCLUS" (prix 0, gratuit, valeur visible)
// inclus = false : extra payant avec prix par défaut
export const EXTRAS_PREDEFINIS = [
  // Payants — matériaux et prep majeure
  { key: 'ardex_k60', label: 'Auto-nivelant Ardex K60 (par poche)', prix_defaut: 85, inclus: false },
  { key: 'pro_patch', label: 'Resurfaçage Pro Patch (par sac)', prix_defaut: 65, inclus: false },
  { key: 'tixo', label: 'Couche truelle epoxy tixo', prix_defaut: 1750, inclus: false },
  { key: 'crack_fill', label: 'Réparation crack/fissure majeure', prix_defaut: 250, inclus: false },
  { key: 'reparation_marches', label: 'Réparation de marches de béton', prix_defaut: 500, inclus: false },
  { key: 'echafaudage', label: 'Échafaudage', prix_defaut: 350, inclus: false },
  { key: 'mileage', label: 'Déplacement > 65 km', prix_defaut: 200, inclus: false },
  // Inclus (gratuit, montre le travail au client)
  { key: 'inspection', label: 'Inspection complète du plancher', prix_defaut: 0, inclus: true },
  { key: 'meulage', label: 'Meulage diamant + aspiration HEPA (sans poussière)', prix_defaut: 0, inclus: true },
  { key: 'masquage', label: 'Masquage complet (plinthes, murs, drains)', prix_defaut: 0, inclus: true },
  { key: 'protection', label: 'Protection de chantier (papier, plastique)', prix_defaut: 0, inclus: true },
  { key: 'nettoyage', label: 'Nettoyage chantier complet à la fin', prix_defaut: 0, inclus: true },
  { key: 'garantie', label: 'Garantie écrite 10 ans', prix_defaut: 0, inclus: true },
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
  rabais_pct = 0,
) {
  // Calcul interne en CENTS. Chaque item garde son sous_total en dollars (interface inchangée),
  // mais l'agrégation se fait sur les cents pour zéro dérive d'arrondi.
  const calcItems: QuoteItem[] = items.map(item => {
    if (item.prix_fixe && item.prix_fixe > 0) {
      return { type_service: item.type_service, superficie: item.superficie, prix_pied_carre: 0, sous_total: item.prix_fixe };
    }
    const prix = SERVICES[item.type_service].prix;
    const stCents = mulCents(dollarsToCents(prix), item.superficie);
    return { type_service: item.type_service, superficie: item.superficie, prix_pied_carre: prix, sous_total: centsToDollars(stCents) };
  });

  const calcExtras: QuoteExtra[] = extras.map(ex => ({
    description: ex.description,
    quantite: ex.quantite,
    prix_unitaire: ex.prix_unitaire,
    sous_total: centsToDollars(mulCents(dollarsToCents(ex.prix_unitaire), ex.quantite)),
  }));

  const itemsTotalCents = sumCents(...calcItems.map(i => dollarsToCents(i.sous_total)));
  const extrasTotalCents = sumCents(...calcExtras.map(e => dollarsToCents(e.sous_total)));

  // Rabais sur les services seulement, jamais les extras
  const rabaisCents = pctOfCents(itemsTotalCents, rabais_pct);
  const sousTotalCents = (itemsTotalCents - rabaisCents) + extrasTotalCents;
  const { tpsCents, tvqCents, totalCents, depotCents } = taxesFromSubtotalCents(sousTotalCents);

  return {
    items: calcItems,
    extras: calcExtras,
    items_total: centsToDollars(itemsTotalCents),
    extras_total: centsToDollars(extrasTotalCents),
    rabais_pct,
    rabais_montant: centsToDollars(rabaisCents),
    sous_total: centsToDollars(sousTotalCents),
    tps: centsToDollars(tpsCents),
    tvq: centsToDollars(tvqCents),
    total: centsToDollars(totalCents),
    depot_requis: centsToDollars(depotCents),
  };
}

export function formatMoney(n: number): string {
  return new Intl.NumberFormat('fr-CA', { style: 'currency', currency: 'CAD' }).format(n);
}

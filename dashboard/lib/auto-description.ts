/**
 * Auto-generate a personalized "description des travaux" for a quote.
 * Combines: service type + extras keywords + superficie + couleur.
 * Smarter than hardcoded WORK_DESCRIPTION: detects ardex/pro-patch/etc. in extras
 * and inserts the corresponding prep steps automatically.
 */

export interface AutoDescInput {
  type_service: string; // 'flake', 'metallique', 'quartz', etc.
  superficie?: number | null;
  couleur_flake?: string | null;
  etat_plancher?: string | null;
  extras?: Array<{ description: string; sous_total: number | string }>;
}

// Keywords to detect in extra descriptions → prep steps to insert
const EXTRA_KEYWORDS: Array<{ match: RegExp; step: string; phase: 'prep' | 'apres-prep' }> = [
  { match: /pro[\s-]*patch|patch/i, step: 'Resurfaçage Pro Patch — réparation des creux, fissures et imperfections majeures', phase: 'prep' },
  { match: /auto[\s-]*nivelant|ardex|nivel|self[\s-]*level/i, step: 'Application auto-nivelant (Ardex K60 ou équivalent) — mise à niveau complète pour surface parfaitement plane', phase: 'prep' },
  { match: /truelle|tixo|époxy[\s-]*tixo|epoxy[\s-]*tix/i, step: 'Application couche truelle epoxy tixo — comblement des défauts profonds et stabilisation', phase: 'prep' },
  { match: /crack|fissur/i, step: 'Réparation des fissures et crevasses (epoxy structural)', phase: 'prep' },
  { match: /humid|vapor|moisture/i, step: 'Test d\'humidité du béton + scellant pare-vapeur si requis', phase: 'prep' },
  { match: /sablage|grit blast|shot blast/i, step: 'Sablage/grenaillage du béton pour préparation maximale', phase: 'prep' },
  { match: /antider|anti[\s-]*derapant|slip resist/i, step: 'Ajout d\'agrégat antidérapant dans la couche finale', phase: 'apres-prep' },
  { match: /uv|ultraviolet/i, step: 'Topcoat résistant UV pour environnements ensoleillés', phase: 'apres-prep' },
  { match: /antimicrob|antibac/i, step: 'Topcoat antimicrobien (santé/restaurant)', phase: 'apres-prep' },
  { match: /plinthe|baseboard|cove/i, step: 'Installation des plinthes ou moulures de finition', phase: 'apres-prep' },
];

// Service-specific application steps (post-prep)
const SERVICE_STEPS: Record<string, string[]> = {
  flake: [
    'Application primer epoxy 100% solide (couche d\'accroche)',
    'Base coat epoxy pigmenté — couleur sélectionnée',
    'Saupoudrage de flocons (Flake) à plein refus sur toute la surface',
    'Grattage et aspiration des flocons excédentaires',
    'Topcoat polyaspartique haute brillance — finition cristal',
  ],
  metallique: [
    'Application primer epoxy 100% solide',
    'Base coat epoxy noir ou tinté selon couleur sélectionnée',
    'Application metallic pigment épandu et travaillé pour effet liquid-metal',
    'Topcoat polyaspartique cristal-clair haute brillance',
  ],
  quartz: [
    'Application primer epoxy 100% solide',
    'Saupoudrage quartz coloré dans base epoxy à plein refus',
    'Topcoat satiné anti-microbien',
  ],
  couleur_unie: [
    'Application primer epoxy 100% solide',
    'Couche epoxy pigmentée — couleur sélectionnée',
    'Topcoat polyaspartique haute brillance',
  ],
  antiderapant: [
    'Application primer epoxy 100% solide',
    'Couche epoxy pigmentée + agrégat antidérapant intégré',
    'Topcoat polyaspartique résistant UV et intempéries',
  ],
  commercial: [
    'Application primer epoxy haute performance',
    'Couches epoxy industrielle pigmentée',
    'Lignes de marquage si requis',
    'Topcoat polyaspartique résistant chimique haute trafic',
  ],
  meulage: [
    'Polissage progressif (grits 30 → 50 → 100 → 200 → 400 → 800)',
    'Application durcisseur lithium (densifier)',
    'Polissage final avec brillance haute (1500-3000 grit)',
    'Application scellant anti-tâche pénétrant',
  ],
  autonivelant: [
    'Préparation du sous-plancher (aspiration, scellement)',
    'Application auto-nivelant haute performance',
    'Cure et nivellement laser',
  ],
  vinyl_click: [
    'Vérification du niveau et réparation si nécessaire',
    'Installation pare-vapeur sous-couche (si requis)',
    'Pose des planches vinyl click selon plan',
    'Coupes et ajustements autour des obstacles',
    'Installation des plinthes ou moulures de finition',
  ],
};

const DUREE_ESTIMEE: Record<string, (sup: number, extras: number) => string> = {
  flake: (sup, ex) => (sup > 2000 || ex > 5000) ? '3-4 jours' : sup > 800 ? '2-3 jours' : '1-2 jours',
  metallique: (sup, ex) => (sup > 1500 || ex > 5000) ? '3-4 jours' : '2-3 jours',
  quartz: (sup, ex) => (sup > 1500 || ex > 5000) ? '3-4 jours' : '2 jours',
  couleur_unie: (sup) => sup > 1500 ? '2-3 jours' : '1-2 jours',
  antiderapant: (sup) => sup > 1500 ? '3 jours' : '2 jours',
  commercial: (sup) => sup > 3000 ? '4-5 jours' : '2-3 jours',
  meulage: (sup) => sup > 1500 ? '2-3 jours' : '1-2 jours',
  autonivelant: () => '1-2 jours',
  vinyl_click: (sup) => sup > 1500 ? '2-3 jours' : '1-2 jours',
};

export function generateAutoDescription(input: AutoDescInput): string {
  const service = (input.type_service || 'flake').toLowerCase();
  const superficie = Number(input.superficie ?? 0);
  const couleur = (input.couleur_flake ?? '').trim();
  const etat = (input.etat_plancher ?? '').trim();
  const extras = input.extras ?? [];
  const extrasTotal = extras.reduce((s, e) => s + Number(e.sous_total || 0), 0);

  // 1) Détecter les keywords dans les extras pour insérer des étapes de prep
  const prepExtras: string[] = [];
  const postPrepExtras: string[] = [];
  for (const ex of extras) {
    const desc = String(ex.description || '');
    for (const kw of EXTRA_KEYWORDS) {
      if (kw.match.test(desc)) {
        if (kw.phase === 'prep' && !prepExtras.includes(kw.step)) prepExtras.push(kw.step);
        if (kw.phase === 'apres-prep' && !postPrepExtras.includes(kw.step)) postPrepExtras.push(kw.step);
      }
    }
  }

  // 2) Construire la liste des étapes
  const prepBase = [
    'Inspection complète du plancher et identification des zones de réparation',
    'Meulage diamant industriel + aspiration HEPA (sans poussière)',
  ];
  const appBase = SERVICE_STEPS[service] ?? SERVICE_STEPS.flake;
  const livraison = [
    'Nettoyage complet du chantier',
    'Inspection finale avec le client',
    'Garantie écrite 10 ans sur les défauts d\'adhésion et le pelage',
  ];

  const allSteps: { phase: string; steps: string[] }[] = [
    { phase: 'PRÉPARATION', steps: [...prepBase, ...prepExtras] },
    { phase: `APPLICATION ${service === 'vinyl_click' ? 'PLANCHER VINYL' : service === 'meulage' ? 'POLISSAGE' : 'ÉPOXY ' + service.toUpperCase()}`, steps: [...appBase, ...postPrepExtras] },
    { phase: 'LIVRAISON', steps: livraison },
  ];

  let step = 1;
  const lines: string[] = [];
  for (const block of allSteps) {
    if (block.steps.length === 0) continue;
    lines.push(block.phase);
    for (const s of block.steps) {
      lines.push(`${step}. ${s}`);
      step++;
    }
    lines.push('');
  }

  // 3) Footer : superficie, couleur, durée, délais
  if (superficie > 0) lines.push(`Superficie totale traitée : ${superficie.toLocaleString('fr-CA')} pi²`);
  if (couleur) lines.push(`Couleur sélectionnée : ${couleur}`);
  if (etat) lines.push(`État du plancher constaté : ${etat}`);

  const duree = DUREE_ESTIMEE[service]?.(superficie, extrasTotal) ?? '2 jours';
  lines.push(`Durée estimée : ${duree}`);
  lines.push('Délai avant utilisation : 24h piétons légers · 72h meubles · 7 jours véhicules');

  return lines.join('\n').trim();
}

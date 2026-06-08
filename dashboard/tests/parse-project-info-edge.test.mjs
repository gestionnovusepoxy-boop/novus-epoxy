/**
 * Edge-case tests for parseProjectInfo() from lib/auto-quote.ts.
 *
 * GAP: parse-project-info.test.mjs covers the happy path well but misses:
 *   - Postal-code-only input (no street address)
 *   - Email extraction
 *   - Confidence score gating (returns null when confidence < 30)
 *   - Service default inference from espace type
 *   - Multi-word service keywords ('couleur unie') vs single-word
 *   - Superficie fallback (standalone number when no unit suffix)
 *   - Accented character normalization
 *
 * Logic inlined from lib/auto-quote.ts to run with plain node.
 * Run: node --test tests/parse-project-info-edge.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

// ── Inlined from lib/auto-quote.ts (pure parseProjectInfo only) ─────────────
const ESPACE_KEYWORDS = {
  garage: 'Garage', 'sous-sol': 'Sous-sol', 'sous sol': 'Sous-sol',
  basement: 'Sous-sol', balcon: 'Balcon', commercial: 'Commercial',
  industriel: 'Industriel', entrepot: 'Entrepôt', entrepôt: 'Entrepôt',
};
const SERVICE_KEYWORDS = {
  flocon: 'flake', flake: 'flake', metallique: 'metallique',
  métallique: 'metallique', metallic: 'metallique', quartz: 'quartz',
  'couleur unie': 'couleur_unie', uni: 'couleur_unie',
  antiderapant: 'antiderapant', antidérapant: 'antiderapant',
  commercial: 'commercial', meulage: 'meulage',
};
const ETAT_KEYWORDS = {
  'beton brut': 'Béton brut', 'béton brut': 'Béton brut',
  peinture: 'Peinture existante', 'epoxy a refaire': 'Époxy à refaire',
  'époxy à refaire': 'Époxy à refaire', 'epoxy à refaire': 'Époxy à refaire',
  bois: 'Bois',
};
const COULEUR_KEYWORDS = ['gris', 'noir', 'beige', 'blanc', 'bleu', 'brun', 'charcoal', 'graphite'];
const CITY_NAMES = [
  'quebec', 'québec', 'levis', 'lévis', 'beauport', 'charlesbourg',
  'sainte-foy', 'cap-rouge', 'loretteville', 'val-belair',
  'saint-augustin', 'ancienne-lorette', 'shannon', 'stoneham',
  'lac-beauport', 'boischatel', "ile-d'orleans", 'saint-nicolas',
  'saint-romuald', 'saint-jean-chrysostome', 'bernières',
  'pintendre', 'breakeyville', 'charny', 'lauzon',
  'montmagny', 'thetford', 'drummondville', 'trois-rivieres',
  'sherbrooke', 'gatineau', 'montreal', 'montréal', 'laval',
  'longueuil', 'repentigny', 'terrebonne', 'blainville',
];

function parseProjectInfo(text) {
  const lower = text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const lowerRaw = text.toLowerCase();

  let type_espace = null;
  for (const [kw, label] of Object.entries(ESPACE_KEYWORDS)) {
    if (lowerRaw.includes(kw)) { type_espace = label; break; }
  }

  let type_service = null;
  for (const [kw, svc] of Object.entries(SERVICE_KEYWORDS)) {
    if (kw.includes(' ') && lowerRaw.includes(kw)) { type_service = svc; break; }
  }
  if (!type_service) {
    for (const [kw, svc] of Object.entries(SERVICE_KEYWORDS)) {
      if (!kw.includes(' ') && lowerRaw.includes(kw)) { type_service = svc; break; }
    }
  }
  if (!type_service) {
    if (type_espace === 'Commercial' || type_espace === 'Industriel' || type_espace === 'Entrepôt') {
      type_service = 'commercial';
    } else if (type_espace === 'Garage' || type_espace === 'Sous-sol' || type_espace === 'Balcon') {
      type_service = 'flake';
    }
  }

  let superficie = null;
  const sqftPatterns = [
    /(\d[\d\s.,]*)\s*(?:pi2|pi²|pieds?\s*carr[eé]s?|sqft|sf|p2|pc|pi\b)/i,
    /(?:pi2|pi²|pieds?\s*carr[eé]s?|sqft|sf|p2|pc)\s*[:\-]?\s*(\d[\d\s.,]*)/i,
  ];
  for (const pat of sqftPatterns) {
    const m = text.match(pat);
    if (m) {
      const raw = (m[1] || m[2] || '').replace(/[\s,]/g, '').replace(/\.+$/, '');
      const n = parseFloat(raw);
      if (!isNaN(n) && n > 0 && n < 100000) { superficie = n; break; }
    }
  }
  if (superficie === null && (type_espace || type_service)) {
    const m = text.match(/\b(\d{2,5})\b/);
    if (m) { const n = parseFloat(m[1]); if (n >= 50 && n <= 50000) superficie = n; }
  }

  let adresse = null;
  const streetMatch = text.match(
    /(\d{1,5}\s+(?:rue|av\.?|avenue|boul\.?|boulevard|chemin|ch\.?|rang|route|place|cote|côte)\s+[A-ZÀ-Üa-zà-ü\-'.]+(?:\s+[A-ZÀ-Üa-zà-ü\-'.]+){0,3})/i
  );
  if (streetMatch) {
    adresse = streetMatch[1].trim();
    for (const city of CITY_NAMES) {
      const cityRegex = new RegExp(`\\b${city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      if (cityRegex.test(text)) {
        if (!adresse.toLowerCase().includes(city)) {
          adresse += ', ' + city.charAt(0).toUpperCase() + city.slice(1);
        }
        break;
      }
    }
  }
  const postalMatch = text.match(/[ABCEGHJKLMNPRSTVXY]\d[A-Z]\s?\d[A-Z]\d/i);
  if (postalMatch) {
    adresse = adresse ? `${adresse} ${postalMatch[0].toUpperCase()}` : postalMatch[0].toUpperCase();
  }

  let etat_plancher = null;
  for (const [kw, label] of Object.entries(ETAT_KEYWORDS)) {
    if (lowerRaw.includes(kw)) { etat_plancher = label; break; }
  }

  let couleur = null;
  for (const c of COULEUR_KEYWORDS) {
    if (lowerRaw.includes(c)) { couleur = c.charAt(0).toUpperCase() + c.slice(1); break; }
  }

  let email = null;
  const emailMatch = text.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/);
  if (emailMatch) email = emailMatch[0].toLowerCase();

  let confidence = 0;
  if (type_espace) confidence += 15;
  if (type_service) confidence += 25;
  if (superficie) confidence += 25;
  if (adresse) confidence += 15;
  if (etat_plancher) confidence += 10;
  if (couleur) confidence += 10;
  if (email) confidence += 5;

  if (confidence < 30) return null;
  return { type_espace, type_service, superficie, adresse, etat_plancher, couleur, email, confidence };
}

// ── Confidence gate ───────────────────────────────────────────────────────────

test('parseProjectInfo: totally empty → null (confidence 0)', () => {
  assert.equal(parseProjectInfo(''), null);
});

test('parseProjectInfo: random text with no keywords → null', () => {
  assert.equal(parseProjectInfo('Bonjour, est-ce que vous faites des travaux?'), null);
});

test('parseProjectInfo: Garage espace alone → NOT null (infers flake as default service, confidence=40)', () => {
  // Garage triggers espace(15) + default flake service(25) = 40 ≥ 30 → returns result
  const r = parseProjectInfo('Mon garage');
  assert.ok(r !== null, 'Garage alone still returns a result due to default service inference');
  assert.equal(r.type_service, 'flake', 'defaults to flake for Garage espace');
  assert.equal(r.confidence, 40);
});

test('parseProjectInfo: only floor state keyword (10pts) → null (< 30)', () => {
  // "peinture" alone = etat(10pts) < 30 → null
  assert.equal(parseProjectInfo('Le plancher est en peinture'), null);
});

test('parseProjectInfo: espace + service (15+25=40pts) → valid result', () => {
  const r = parseProjectInfo('Mon garage avec du flake');
  assert.ok(r !== null);
  assert.equal(r.type_espace, 'Garage');
  assert.equal(r.type_service, 'flake');
});

// ── Service default inference ─────────────────────────────────────────────────

test('parseProjectInfo: commercial espace with no explicit service → defaults to commercial', () => {
  const r = parseProjectInfo('Local commercial de 500 pieds carres');
  assert.ok(r !== null);
  assert.equal(r.type_service, 'commercial');
});

test('parseProjectInfo: industriel espace → defaults to commercial service', () => {
  const r = parseProjectInfo('Batiment industriel 1000 sqft');
  assert.ok(r !== null);
  assert.equal(r.type_service, 'commercial');
});

test('parseProjectInfo: garage espace with no explicit service → defaults to flake', () => {
  const r = parseProjectInfo('Garage de 350 pi2');
  assert.ok(r !== null);
  assert.equal(r.type_service, 'flake');
});

test('parseProjectInfo: sous-sol espace → defaults to flake', () => {
  const r = parseProjectInfo('Sous-sol de 400 sqft beton brut');
  assert.ok(r !== null);
  assert.equal(r.type_service, 'flake');
});

// ── Multi-word service keyword ────────────────────────────────────────────────

test('parseProjectInfo: "couleur unie" (two words) recognized before "uni" alone', () => {
  const r = parseProjectInfo('Garage 300 pi2 couleur unie');
  assert.ok(r !== null);
  assert.equal(r.type_service, 'couleur_unie');
});

// ── Superficie patterns ───────────────────────────────────────────────────────

test('parseProjectInfo: pi2 unit recognized', () => {
  const r = parseProjectInfo('Garage flake 300pi2');
  assert.ok(r !== null);
  assert.equal(r.superficie, 300);
});

test('parseProjectInfo: sqft unit recognized', () => {
  const r = parseProjectInfo('Garage flake 250 sqft');
  assert.ok(r !== null);
  assert.equal(r.superficie, 250);
});

test('parseProjectInfo: "pieds carres" long form recognized', () => {
  const r = parseProjectInfo('Garage flake 450 pieds carres');
  assert.ok(r !== null);
  assert.equal(r.superficie, 450);
});

test('parseProjectInfo: superficie fallback — standalone number when espace known', () => {
  // "garage" gives type_espace → fallback fires for number 350
  const r = parseProjectInfo('Garage 350 avec du flake');
  assert.ok(r !== null);
  assert.equal(r.superficie, 350);
});

test('parseProjectInfo: standalone number < 50 is ignored (too small)', () => {
  const r = parseProjectInfo('Garage flake 25');
  // 25 < 50 → no superficie from fallback; but espace+service = 40pts still valid
  assert.ok(r !== null);
  assert.equal(r.superficie, null);
});

// ── Postal code extraction ────────────────────────────────────────────────────

test('parseProjectInfo: postal code alone used as adresse when no street', () => {
  const r = parseProjectInfo('Garage flake 300pi2 G2N 1G8');
  assert.ok(r !== null);
  assert.ok(r.adresse !== null, 'postal code must be extracted as adresse');
  assert.ok(r.adresse.includes('G2N'), 'adresse must contain postal code');
});

test('parseProjectInfo: postal code appended to street address', () => {
  const r = parseProjectInfo('Garage flake 300pi2 123 rue des Érables G2N 1G8');
  assert.ok(r !== null);
  assert.ok(r.adresse.includes('G2N'), 'postal code appended to street address');
});

// ── Email extraction ──────────────────────────────────────────────────────────

test('parseProjectInfo: email extracted and lowercased', () => {
  const r = parseProjectInfo('Garage flake 300pi2 mon email est Jean.Test@Gmail.Com');
  assert.ok(r !== null);
  assert.equal(r.email, 'jean.test@gmail.com');
});

test('parseProjectInfo: no email → email field null', () => {
  const r = parseProjectInfo('Garage flake 300pi2');
  assert.ok(r !== null);
  assert.equal(r.email, null);
});

// ── Color extraction ──────────────────────────────────────────────────────────

test('parseProjectInfo: couleur gris extracted', () => {
  const r = parseProjectInfo('Garage flake 300pi2 couleur gris');
  assert.ok(r !== null);
  assert.equal(r.couleur, 'Gris');
});

test('parseProjectInfo: couleur charcoal extracted', () => {
  const r = parseProjectInfo('Garage flake 300pi2 charcoal');
  assert.ok(r !== null);
  assert.equal(r.couleur, 'Charcoal');
});

// ── État du plancher ──────────────────────────────────────────────────────────

test('parseProjectInfo: béton brut (accented) detected', () => {
  const r = parseProjectInfo('Garage flake 300pi2 béton brut');
  assert.ok(r !== null);
  assert.equal(r.etat_plancher, 'Béton brut');
});

test('parseProjectInfo: peinture detected', () => {
  const r = parseProjectInfo('Sous-sol flake 300pi2 plancher peinture');
  assert.ok(r !== null);
  assert.equal(r.etat_plancher, 'Peinture existante');
});

// ── Confidence scoring ────────────────────────────────────────────────────────

test('parseProjectInfo: all fields present → confidence ≥ 100 (max possible)', () => {
  // espace(15)+service(25)+superficie(25)+adresse(15)+etat(10)+couleur(10)+email(5) = 105
  // Confidence can exceed 100 when all fields present — just verify it's maxed out
  const r = parseProjectInfo(
    'Mon garage flake 300pi2 beton brut couleur gris 123 rue des Pins test@test.com'
  );
  assert.ok(r !== null);
  assert.ok(r.confidence >= 100, `expected confidence ≥ 100, got ${r.confidence}`);
});

test('parseProjectInfo: confidence exposed on result object', () => {
  const r = parseProjectInfo('Garage flake 300pi2');
  assert.ok(r !== null);
  assert.ok(typeof r.confidence === 'number');
  assert.ok(r.confidence >= 30 && r.confidence <= 100);
});

// ── Accented service keywords ─────────────────────────────────────────────────

test('parseProjectInfo: "métallique" (accented) recognized', () => {
  const r = parseProjectInfo('Garage métallique 300pi2');
  assert.ok(r !== null);
  assert.equal(r.type_service, 'metallique');
});

test('parseProjectInfo: "antidérapant" (accented) recognized', () => {
  const r = parseProjectInfo('Garage antidérapant 300pi2');
  assert.ok(r !== null);
  assert.equal(r.type_service, 'antiderapant');
});

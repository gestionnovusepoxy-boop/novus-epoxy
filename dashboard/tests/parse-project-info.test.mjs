/**
 * Tests for the parseProjectInfo() function from lib/auto-quote.ts.
 *
 * auto-quote.ts has a top-level `import { query } from '@/lib/db'` which cannot
 * resolve outside Next.js. The pure parseProjectInfo logic is reproduced inline
 * here (same approach as pricing.invariants.test.mjs) so tests run with plain node.
 *
 * Run: node --test tests/parse-project-info.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

// ── Inlined from lib/auto-quote.ts (pure section only) ──────────────────────

const ESPACE_KEYWORDS = {
  garage: 'Garage',
  'sous-sol': 'Sous-sol',
  'sous sol': 'Sous-sol',
  basement: 'Sous-sol',
  balcon: 'Balcon',
  commercial: 'Commercial',
  industriel: 'Industriel',
  entrepot: 'Entrepôt',
  entrepôt: 'Entrepôt',
};

const SERVICE_KEYWORDS = {
  flocon: 'flake',
  flake: 'flake',
  metallique: 'metallique',
  métallique: 'metallique',
  metallic: 'metallique',
  quartz: 'quartz',
  'couleur unie': 'couleur_unie',
  uni: 'couleur_unie',
  antiderapant: 'antiderapant',
  antidérapant: 'antiderapant',
  commercial: 'commercial',
  meulage: 'meulage',
};

const ETAT_KEYWORDS = {
  'beton brut': 'Béton brut',
  'béton brut': 'Béton brut',
  peinture: 'Peinture existante',
  'epoxy a refaire': 'Époxy à refaire',
  'époxy à refaire': 'Époxy à refaire',
  'epoxy à refaire': 'Époxy à refaire',
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
    if (m) {
      const n = parseFloat(m[1]);
      if (n >= 50 && n <= 50000) superficie = n;
    }
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

// ── Returns null below confidence threshold ───────────────────────────────────

test('returns null for empty string', () => {
  assert.equal(parseProjectInfo(''), null);
});

test('returns null for generic message with no project info', () => {
  assert.equal(parseProjectInfo('Bonjour, pouvez-vous me rappeler?'), null);
});

test('returns null when confidence < 30 (colour + état only)', () => {
  // couleur(10) + etat(10) = 20 — not enough, and no espace/service to auto-assign
  assert.equal(parseProjectInfo('Je veux du gris avec bois'), null);
});

test('espace alone auto-assigns service and reaches confidence 40', () => {
  // garage(espace=15) auto → flake(service=25) = 40 → NOT null
  const r = parseProjectInfo('Je veux faire mon garage');
  assert.ok(r !== null, 'garage auto-assigns flake and hits confidence 40');
  assert.equal(r?.type_espace, 'Garage');
  assert.equal(r?.type_service, 'flake');
});

// ── Service keyword detection ────────────────────────────────────────────────

test('detects "flake" keyword → type_service flake', () => {
  const r = parseProjectInfo('Je veux du flake dans mon garage 400 pi2');
  assert.equal(r?.type_service, 'flake');
});

test('detects "flocon" (French) → type_service flake', () => {
  const r = parseProjectInfo('Plancher flocon garage 350 sqft');
  assert.equal(r?.type_service, 'flake');
});

test('detects "métallique" with accent → type_service metallique', () => {
  const r = parseProjectInfo('Époxy métallique pour sous-sol 600 pi2');
  assert.equal(r?.type_service, 'metallique');
});

test('detects "quartz" → type_service quartz', () => {
  const r = parseProjectInfo('Quartz epoxy garage 500 pi2');
  assert.equal(r?.type_service, 'quartz');
});

test('detects multi-word "couleur unie" → type_service couleur_unie', () => {
  const r = parseProjectInfo('couleur unie pour garage 300 pi2');
  assert.equal(r?.type_service, 'couleur_unie');
});

test('defaults to flake for garage when no service mentioned', () => {
  const r = parseProjectInfo('Mon garage fait 500 pi2, je veux de l\'époxy');
  assert.equal(r?.type_service, 'flake');
});

test('defaults to commercial for commercial espace', () => {
  const r = parseProjectInfo('Plancher pour local commercial 1000 pi2');
  assert.equal(r?.type_service, 'commercial');
});

// ── Superficie parsing ───────────────────────────────────────────────────────

test('parses "400 pi2"', () => {
  const r = parseProjectInfo('Flake 400 pi2 garage');
  assert.equal(r?.superficie, 400);
});

test('parses "500 sqft"', () => {
  const r = parseProjectInfo('Flake 500 sqft garage');
  assert.equal(r?.superficie, 500);
});

test('parses "pieds carrés"', () => {
  const r = parseProjectInfo('Flake 350 pieds carrés garage');
  assert.equal(r?.superficie, 350);
});

test('parses "pi²" with superscript', () => {
  const r = parseProjectInfo('Flake 600 pi² garage');
  assert.equal(r?.superficie, 600);
});

test('falls back to standalone large number when service/espace known', () => {
  const r = parseProjectInfo('Garage flake 480');
  assert.equal(r?.superficie, 480);
});

test('ignores standalone number < 50 as superficie', () => {
  const r = parseProjectInfo('Garage flake, 3 portes, 500 pi2');
  assert.equal(r?.superficie, 500); // picks pi2 pattern not the 3
});

// ── Email extraction ────────────────────────────────────────────────────────

test('extracts email from text', () => {
  const r = parseProjectInfo('Flake garage 500 pi2, contactez moi a jean.tremblay@gmail.com');
  assert.equal(r?.email, 'jean.tremblay@gmail.com');
});

test('email extraction is case-insensitive (lowercased)', () => {
  const r = parseProjectInfo('Flake garage 500 pi2 Client@Example.COM');
  assert.equal(r?.email, 'client@example.com');
});

test('no email in text → null', () => {
  const r = parseProjectInfo('Flake garage 500 pi2');
  assert.equal(r?.email, null);
});

// ── Espace detection ────────────────────────────────────────────────────────

test('detects "sous-sol"', () => {
  const r = parseProjectInfo('flake sous-sol 400 pi2');
  assert.equal(r?.type_espace, 'Sous-sol');
});

test('detects "basement" (English) → Sous-sol', () => {
  const r = parseProjectInfo('flake basement 400 sqft');
  assert.equal(r?.type_espace, 'Sous-sol');
});

test('detects "industriel"', () => {
  const r = parseProjectInfo('époxy industriel 2000 pi2');
  assert.equal(r?.type_espace, 'Industriel');
});

// ── État du plancher ─────────────────────────────────────────────────────────

test('detects "béton brut" → Béton brut', () => {
  const r = parseProjectInfo('Flake garage 500 pi2, béton brut');
  assert.equal(r?.etat_plancher, 'Béton brut');
});

test('detects "peinture" → Peinture existante', () => {
  const r = parseProjectInfo('Flake garage 500 pi2, peinture existante sur le béton');
  assert.equal(r?.etat_plancher, 'Peinture existante');
});

// ── Couleur detection ────────────────────────────────────────────────────────

test('detects couleur "gris" → Gris', () => {
  const r = parseProjectInfo('Flake garage 500 pi2, couleur gris charcoal');
  assert.equal(r?.couleur, 'Gris');
});

test('detects couleur "charcoal"', () => {
  const r = parseProjectInfo('Metallique sous-sol 600 pi2, je veux du charcoal');
  assert.equal(r?.couleur, 'Charcoal');
});

// ── Confidence scoring ───────────────────────────────────────────────────────

test('all signals present → confidence = 105', () => {
  const r = parseProjectInfo(
    '500 pi2, flake, garage, 123 Rue des Pins, béton brut, gris, info@test.com'
  );
  // espace(15) + service(25) + superficie(25) + adresse(15) + etat(10) + couleur(10) + email(5) = 105
  assert.ok(r !== null);
  assert.equal(r.confidence, 105);
});

test('service + superficie only → confidence = 50, not null', () => {
  const r = parseProjectInfo('flake 300 pi2');
  assert.ok(r !== null, 'should not be null at confidence 50');
  assert.equal(r?.confidence, 50);
  assert.equal(r?.type_service, 'flake');
  assert.equal(r?.superficie, 300);
});

// ── Address parsing ──────────────────────────────────────────────────────────

test('extracts street address', () => {
  const r = parseProjectInfo('Flake 500 pi2, 456 Rue Saint-Jean, Québec');
  assert.ok(r?.adresse?.includes('456'), `adresse: ${r?.adresse}`);
});

test('extracts postal code as fallback address', () => {
  const r = parseProjectInfo('Flake 500 pi2, code postal G1R 2J1');
  assert.ok(r?.adresse?.includes('G1R'), `adresse: ${r?.adresse}`);
});

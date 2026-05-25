/**
 * lib/lead-scoring.ts — auto-classification chaud / tiède / froid à l'import.
 *
 * Rules (signals counted):
 *   +2  phone present + valid (10 digits)
 *   +2  service identifiable (flake, metallique, quartz, etc.)
 *   +2  superficie numeric ≥ 50 pi²
 *   +1  espace defined (garage, sous-sol, balcon, commercial...)
 *   +1  adresse complete (>= 10 chars, contains digit + word)
 *   +1  email valid
 *   -2  test-flavored name (test, lead test, jean test, ...)
 *   -1  source = "import-csv" or "scraper" (lower intent)
 *
 * Scoring:
 *   ≥ 6  → chaud
 *   ≥ 3  → tiède
 *   < 3  → froid
 */

export type LeadTemperature = 'chaud' | 'tiede' | 'froid';

export interface ScoreInput {
  nom?: string | null;
  email?: string | null;
  telephone?: string | null;
  service?: string | null;
  superficie?: string | number | null;
  espace?: string | null;
  adresse?: string | null;
  source?: string | null;
}

const KNOWN_SERVICES = new Set([
  'flake', 'metallique', 'métallique', 'quartz', 'couleur_unie', 'couleur unie',
  'antiderapant', 'antidérapant', 'commercial', 'industriel', 'meulage',
  'vinyl_click', 'vinyl', 'vinyle',
]);

const KNOWN_ESPACES = new Set([
  'garage', 'sous-sol', 'sous sol', 'basement', 'balcon', 'commercial',
  'industriel', 'entrepôt', 'entrepot', 'résidentiel', 'residentiel',
]);

const TEST_PATTERNS = [
  /\btest\b/i,
  /jean\s*test/i,
  /lead\s*test/i,
  /\bfake\b/i,
  /asdf|qwerty|zzzz/i,
];

export function scoreLead(input: ScoreInput): { temperature: LeadTemperature; score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];

  // Phone (+2)
  const digits = String(input.telephone ?? '').replace(/\D/g, '');
  if (digits.length === 10 || digits.length === 11) {
    score += 2;
    reasons.push('phone+2');
  }

  // Service (+2)
  const service = String(input.service ?? '').toLowerCase().trim();
  if (service && (KNOWN_SERVICES.has(service) || [...KNOWN_SERVICES].some(s => service.includes(s)))) {
    score += 2;
    reasons.push('service+2');
  }

  // Superficie (+2)
  const sf = Number(String(input.superficie ?? '').replace(/[^\d.]/g, ''));
  if (sf >= 50) {
    score += 2;
    reasons.push('superficie+2');
  }

  // Espace (+1)
  const espace = String(input.espace ?? '').toLowerCase().trim();
  if (espace && (KNOWN_ESPACES.has(espace) || [...KNOWN_ESPACES].some(e => espace.includes(e)))) {
    score += 1;
    reasons.push('espace+1');
  }

  // Adresse (+1)
  const adresse = String(input.adresse ?? '').trim();
  if (adresse.length >= 10 && /\d/.test(adresse) && /[a-zà-ÿ]{3,}/i.test(adresse)) {
    score += 1;
    reasons.push('adresse+1');
  }

  // Email valid (+1)
  const email = String(input.email ?? '').trim();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && !email.includes('no-email@facebook')) {
    score += 1;
    reasons.push('email+1');
  }

  // Test-flavored name (−2)
  const nom = String(input.nom ?? '').trim();
  if (nom && TEST_PATTERNS.some(rx => rx.test(nom))) {
    score -= 2;
    reasons.push('test_name-2');
  }

  // Low-intent source (−1)
  const source = String(input.source ?? '').toLowerCase();
  if (source.includes('csv') || source.includes('scraper') || source.includes('import')) {
    score -= 1;
    reasons.push('cold_source-1');
  }

  let temperature: LeadTemperature;
  if (score >= 6) temperature = 'chaud';
  else if (score >= 3) temperature = 'tiede';
  else temperature = 'froid';

  return { temperature, score, reasons };
}

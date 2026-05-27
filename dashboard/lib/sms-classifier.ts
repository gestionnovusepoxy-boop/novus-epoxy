// SMS classifier — detects opt-out and complaint phrases (FR + EN).
// Used by /api/sms/webhook and /api/sms/incoming so behavior is identical
// regardless of which Twilio webhook URL is configured.
//
// Strategy: normalize (lowercase + strip diacritics + collapse punctuation+whitespace)
// before matching against a list of regex patterns. Complaints are a strict superset
// of opt-out (a complaint also implies the client wants no further contact AND should
// trigger an urgent Telegram alert).

/**
 * Normalize text for matching:
 *   - lowercase
 *   - strip diacritics (é → e, à → a, ç → c)
 *   - replace runs of non-letter chars (punctuation, whitespace) with single space
 *   - trim
 */
export function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Patterns that mean "stop sending me messages" but are not (yet) complaints.
// Matched against the NORMALIZED string (no accents, no punctuation).
const OPT_OUT_PATTERNS: RegExp[] = [
  // STOP family — bare token or "stop please", "stop !!!", "stop." etc.
  // After normalization "STOP!!!" becomes "stop", "stop please" stays "stop please".
  /(^|\s)stop(\s|$)/,
  /(^|\s)unsubscribe(\s|$)/,
  /(^|\s)opt\s*out(\s|$)/,
  /(^|\s)remove\s+me(\s|$)/,

  // French "arrêt(e)(z)" family — accents already stripped
  /(^|\s)arret(\s|$)/,
  /(^|\s)arrete(z|r)?(\s|$)/,
  /(^|\s)arretez\s+de\s+me/,
  /(^|\s)arrete\s+de\s+me/,

  // "ne me contactez/contacte plus/pas"
  /ne\s+me\s+contact(ez|e|er)\s+(plus|pas|jamais)/,
  /ne\s+plus\s+me\s+contact(er|ez|e)/,
  /plus\s+(jamais\s+)?me\s+contact/,

  // "retirez-moi de votre liste", "enlevez mon numero"
  /retir(ez|er|e)\s+moi/,
  /retir(ez|er|e)\s+mon\s+(numero|nom)/,
  /enlev(ez|er|e)\s+(moi|mon\s+(numero|nom))/,

  // "désabonner / se desabonner"
  /desabonn(er|e|ez)/,

  // "plus de message/texto/sms"
  /plus\s+de\s+(message|texto|sms|pub)/,

  // "laissez/laisser tranquille"
  /laiss(ez|er|e)\s+(moi\s+)?tranquille/,

  // "fichez moi la paix"
  /fich(ez|er|e)\s+moi\s+(la\s+)?paix/,
];

// Patterns that signal a complaint. A complaint ALSO implies opt-out.
// Matched against the NORMALIZED string.
const COMPLAINT_PATTERNS: RegExp[] = [
  // Harcèlement
  /harcel(e|ement|ez|er)/,
  /(^|\s)harassement(\s|$)/,
  /(^|\s)harassment(\s|$)/,

  // Plainte / poursuite
  /port(er|e|ez)\s+plainte/,
  /(^|\s)poursui(s|t|vre|te|tes|vrai|vrais)(\s|$)/,
  /(^|\s)plainte(\s|$)/,
  /(^|\s)lawsuit(\s|$)/,
  /(^|\s)sue(\s+you|\s+u)?(\s|$)/,

  // Spam / pourriel
  /(^|\s)pourriel(s)?(\s|$)/,
  /(^|\s)spam(\s|$)/,
  /(^|\s)c\s*est\s+du\s+(spam|pourriel)/,
  /this\s+is\s+spam/,
  /trop\s+de\s+(pub|publicite|pubs|messages)/,

  // Arnaque / scam / fraude
  /(^|\s)arnaque(s|ur)?(\s|$)/,
  /(^|\s)scam(\s|$)/,
  /(^|\s)scammer(s)?(\s|$)/,
  /(^|\s)fraude(\s|$)/,
  /(^|\s)fraud(\s|$)/,

  // Remboursement (financial complaint)
  /rembours(e|ez|er|ement)/,
  /(^|\s)refund(\s|$)/,
];

/**
 * Returns true if `text` requests to stop being contacted.
 * Complaints also count as opt-out.
 */
export function isOptOut(text: string): boolean {
  if (!text) return false;
  const n = normalize(text);
  if (!n) return false;
  if (OPT_OUT_PATTERNS.some(re => re.test(n))) return true;
  // Complaints imply opt-out.
  return COMPLAINT_PATTERNS.some(re => re.test(n));
}

/**
 * Returns true if `text` is a complaint (harassment, spam accusation, threat of
 * legal action, refund demand, etc).
 */
export function isComplaint(text: string): boolean {
  if (!text) return false;
  const n = normalize(text);
  if (!n) return false;
  return COMPLAINT_PATTERNS.some(re => re.test(n));
}

export type SmsClass = 'optout' | 'complaint' | 'normal';

/**
 * Classify an inbound SMS body. `complaint` takes precedence over `optout`.
 */
export function classify(text: string): SmsClass {
  if (isComplaint(text)) return 'complaint';
  if (isOptOut(text)) return 'optout';
  return 'normal';
}

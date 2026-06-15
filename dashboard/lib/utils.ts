export function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('fr-CA', {
    year:   'numeric',
    month:  'short',
    day:    'numeric',
    hour:   '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

export function formatNumber(n: number): string {
  return new Intl.NumberFormat('fr-CA').format(n);
}

export function formatVariation(v: number): string {
  const sign = v > 0 ? '+' : '';
  return `${sign}${v.toFixed(1)}%`;
}

export function cn(...classes: (string | undefined | false | null)[]): string {
  return classes.filter(Boolean).join(' ');
}

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Assainit du HTML d'email (venant d'expéditeurs externes) avant rendu via
 * dangerouslySetInnerHTML. Neutralise les vecteurs XSS courants sans dépendance:
 * balises exécutables, handlers on*, et URLs javascript:/data: non-image.
 */
export function sanitizeEmailHtml(html: string | null | undefined): string {
  if (!html) return '';
  return String(html)
    // balises dangereuses (paire ouvrante/fermante)
    .replace(/<\s*(script|style|iframe|object|embed|link|meta|base|form)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    // balises dangereuses auto-fermantes ou orphelines
    .replace(/<\s*(script|style|iframe|object|embed|link|meta|base|form)\b[^>]*\/?>/gi, '')
    // attributs gestionnaires d'événements: onclick, onerror, onload, etc.
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    // javascript: dans href/src
    .replace(/(href|src)\s*=\s*(["']?)\s*javascript:[^"'>\s]*/gi, '$1=$2#')
    // data: non-image (data:image OK pour les images inline)
    .replace(/(href|src)\s*=\s*(["']?)\s*data:(?!image\/)[^"'>\s]*/gi, '$1=$2#');
}

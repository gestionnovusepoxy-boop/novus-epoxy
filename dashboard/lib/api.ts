// Toutes les routes API sont locales (Next.js API routes sur Vercel)
// Plus besoin de Bearer token ni de BASE_URL externe

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const base = typeof window === 'undefined'
    ? process.env.NEXTAUTH_URL ?? 'http://localhost:3000'
    : '';

  const res = await fetch(`${base}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options?.headers },
  });

  if (!res.ok) throw new Error(`API ${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

// --- Types ---

export interface Submission {
  id:         number;
  nom:        string;
  email:      string;
  telephone:  string | null;
  service:    string | null;
  statut:     'nouveau' | 'lu' | 'en_traitement' | 'ferme';
  created_at: string;
  updated_at: string;
}

export interface EmailLog {
  id:           number;
  resend_id:    string;
  destinataire: string;
  sujet:        string | null;
  statut:       'sent' | 'delivered' | 'opened' | 'clicked' | 'bounced' | 'complained';
  opened_at:    string | null;
  clicked_at:   string | null;
  created_at:   string;
}

export interface Metriques {
  visites:             number;
  visites_variation:   number;
  visiteurs_uniques:   number;
  visiteurs_variation: number;
  leads:               number;
  leads_variation:     number;
  taux_conversion:     number;
  taux_variation:      number;
  emails_ouverts:      number;
}

export interface StatsResponse {
  periode:       string;
  metriques:     Metriques;
  top_pages:     { url_path: string; vues: number }[];
  serie_visites: { date: string; visites: number; visiteurs: number }[];
  serie_leads:   { semaine: string; leads: number }[];
}

export interface PaginatedResponse<T> {
  data:  T[];
  total: number;
  page:  number;
  limit: number;
}

// --- Fonctions ---

export function fetchSubmissions(params: {
  page?: number; limit?: number; statut?: string; search?: string;
}): Promise<PaginatedResponse<Submission>> {
  const qs = new URLSearchParams();
  if (params.page)   qs.set('page',   String(params.page));
  if (params.limit)  qs.set('limit',  String(params.limit));
  if (params.statut) qs.set('statut', params.statut);
  if (params.search) qs.set('search', params.search);
  return apiFetch(`/api/submissions?${qs}`);
}

export function fetchEmails(params: { page?: number; limit?: number }): Promise<PaginatedResponse<EmailLog>> {
  const qs = new URLSearchParams();
  if (params.page)  qs.set('page',  String(params.page));
  if (params.limit) qs.set('limit', String(params.limit));
  return apiFetch(`/api/emails?${qs}`);
}

export function fetchStats(periode: '7d' | '30d' | '90d' = '30d'): Promise<StatsResponse> {
  return apiFetch(`/api/stats?periode=${periode}`);
}

export async function updateSubmissionStatus(id: number, statut: Submission['statut']): Promise<void> {
  await apiFetch(`/api/submissions?id=${id}`, {
    method: 'PATCH',
    body:   JSON.stringify({ statut }),
  });
}

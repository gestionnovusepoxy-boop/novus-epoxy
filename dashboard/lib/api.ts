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
  revenus:             number;
  revenus_variation:   number;
}

export interface PipelineItem {
  statut: string;
  count:  number;
}

export interface Booking {
  id: number;
  quote_id: number | null;
  client_nom: string;
  client_tel: string | null;
  jour1_date: string;
  jour1_slot: string | null;
  jour2_date: string | null;
  jour2_slot: string | null;
  statut: string;
  created_at: string;
}

export interface StatsResponse {
  periode:        string;
  metriques:      Metriques;
  top_pages:      { url_path: string; vues: number }[];
  serie_visites:  { date: string; visites: number; visiteurs: number }[];
  serie_leads:    { semaine: string; leads: number }[];
  pipeline:       PipelineItem[];
  prochains_rdv:  Booking[];
  serie_revenus:  { date: string; revenus: number }[];
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

// --- Devis (Quotes) ---

export type QuoteStatut = 'brouillon' | 'en_attente' | 'approuve' | 'envoye' | 'contrat_signe' | 'depot_paye' | 'planifie' | 'complete' | 'refuse';
export type ServiceType = 'flake' | 'metallique' | 'commercial';

export interface Quote {
  id:              number;
  client_nom:      string;
  client_email:    string;
  client_tel:      string | null;
  client_adresse:  string | null;
  type_service:    ServiceType;
  superficie:      number;
  etat_plancher:   string | null;
  notes:           string | null;
  prix_pied_carre: number;
  sous_total:      number;
  tps:             number;
  tvq:             number;
  total:           number;
  depot_requis:    number;
  statut:          QuoteStatut;
  submission_id:   number | null;
  approved_at:     string | null;
  sent_at:         string | null;
  contrat_signe_at: string | null;
  contrat_signature_nom: string | null;
  paid_at:         string | null;
  created_at:      string;
  updated_at:      string;
}

export function fetchQuotes(params: {
  page?: number; limit?: number; statut?: string; search?: string;
}): Promise<PaginatedResponse<Quote>> {
  const qs = new URLSearchParams();
  if (params.page)   qs.set('page',   String(params.page));
  if (params.limit)  qs.set('limit',  String(params.limit));
  if (params.statut) qs.set('statut', params.statut);
  if (params.search) qs.set('search', params.search);
  return apiFetch(`/api/quotes?${qs}`);
}

export function fetchQuote(id: number): Promise<Quote> {
  return apiFetch(`/api/quotes/${id}`);
}

export async function createQuote(data: {
  client_nom: string; client_email: string; client_tel?: string; client_adresse?: string;
  type_service: ServiceType; superficie: number; etat_plancher?: string; notes?: string;
  submission_id?: number;
}): Promise<Quote> {
  return apiFetch('/api/quotes', { method: 'POST', body: JSON.stringify(data) });
}

export async function updateQuote(id: number, data: Partial<Quote>): Promise<Quote> {
  return apiFetch(`/api/quotes/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
}

export async function sendQuote(id: number): Promise<{ success: boolean; email_id: string }> {
  return apiFetch(`/api/quotes/${id}/send`, { method: 'POST' });
}

export async function sendQuoteSMS(id: number): Promise<{ success: boolean; method: string }> {
  return apiFetch(`/api/quotes/${id}/send-sms`, { method: 'POST' });
}

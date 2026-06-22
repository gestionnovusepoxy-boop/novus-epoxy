/**
 * lib/gmail-labels.ts — Organisation Gmail par labels (NON destructif).
 *
 * Principe (incident 22 juin): on LABELLISE + archive, on ne SUPPRIME JAMAIS ici.
 * La seule suppression du système reste dans app/api/gmail/cleanup (déjà protégée par GUARD).
 * Un email avec pièce jointe (photo de chantier) est toujours GARDÉ en boîte.
 *
 * Logique pure + helpers Gmail. Opère sur un client `gmail` passé en paramètre.
 */
import type { gmail_v1 } from 'googleapis';
import { query } from '@/lib/db';
import { callLLM } from '@/lib/llm';

type Gmail = gmail_v1.Gmail;

// Schéma de labels (imbriqués sous Novus/ pour une boîte repliable et propre)
export const LABELS = {
  CLIENTS: 'Novus/Clients',
  LEADS: 'Novus/Leads',
  PHOTOS: 'Novus/Photos reçues',
  FACTURES: 'Novus/Factures-Paiements',
  FOURNISSEURS: 'Novus/Fournisseurs',
  SYSTEME: 'Novus/Système',
  A_TRAITER: 'Novus/À traiter',
} as const;

export type LabelName = (typeof LABELS)[keyof typeof LABELS];

/** Crée les labels manquants (idempotent). Retourne une Map nom → id. */
export async function ensureLabels(gmail: Gmail): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  let existing: gmail_v1.Schema$Label[] = [];
  try {
    const list = await gmail.users.labels.list({ userId: 'me' });
    existing = list.data.labels ?? [];
  } catch { /* on tentera quand même la création */ }
  for (const l of existing) { if (l.name && l.id) map.set(l.name, l.id); }

  for (const name of Object.values(LABELS)) {
    if (map.has(name)) continue;
    try {
      const created = await gmail.users.labels.create({
        userId: 'me',
        requestBody: { name, labelListVisibility: 'labelShow', messageListVisibility: 'show' },
      });
      if (created.data.id) map.set(name, created.data.id);
    } catch { /* label peut déjà exister (course) — ignoré */ }
  }
  return map;
}

/** Applique des labels à un message. archive=true retire INBOX. JAMAIS de trash. */
export async function addLabel(
  gmail: Gmail,
  msgId: string,
  labelIds: string[],
  opts: { archive?: boolean } = {},
): Promise<boolean> {
  const ids = labelIds.filter(Boolean);
  if (ids.length === 0) return false;
  try {
    await gmail.users.messages.modify({
      userId: 'me',
      id: msgId,
      requestBody: {
        addLabelIds: ids,
        ...(opts.archive ? { removeLabelIds: ['INBOX'] } : {}),
      },
    });
    return true;
  } catch { return false; }
}

export type Contact = { kind: 'client' | 'lead'; nom: string } | null;

/** Cherche l'expéditeur dans le CRM (crm_leads puis submissions). */
export async function lookupContact(email: string | null | undefined): Promise<Contact> {
  const e = (email ?? '').toLowerCase().trim();
  if (!e || !e.includes('@')) return null;
  try {
    const rows = await query(
      `SELECT nom, statut FROM crm_leads WHERE LOWER(email) = $1 ORDER BY created_at DESC LIMIT 1`,
      [e],
    );
    if (rows[0]) {
      const statut = String(rows[0].statut ?? '').toLowerCase();
      const isClient = ['converti', 'gagne', 'gagné', 'client', 'depot_paye', 'complete'].some(s => statut.includes(s));
      return { kind: isClient ? 'client' : 'lead', nom: String(rows[0].nom ?? '') };
    }
    const subs = await query(
      `SELECT nom FROM submissions WHERE LOWER(email) = $1 ORDER BY created_at DESC LIMIT 1`,
      [e],
    ).catch(() => []);
    if (subs[0]) return { kind: 'lead', nom: String(subs[0].nom ?? '') };
  } catch { /* DB indispo → pas de match, on classera en À traiter */ }
  return null;
}

/** Décision PURE des labels à appliquer + s'il faut archiver. Testable, sans I/O. */
export function decideLabels(input: {
  hasAttachment: boolean;
  contact: Contact;
  isFacture: boolean;
  isFournisseur: boolean;
  isSystem: boolean;
}): { labels: LabelName[]; archive: boolean } {
  const set = new Set<LabelName>();
  let keepInInbox = false;

  // 1. Pièce jointe (photo de chantier) → toujours gardé en boîte
  if (input.hasAttachment) { set.add(LABELS.PHOTOS); keepInInbox = true; }

  // 2. Contact connu (CRM)
  if (input.contact) { set.add(input.contact.kind === 'client' ? LABELS.CLIENTS : LABELS.LEADS); keepInInbox = true; }

  // 3. Facture / paiement
  if (input.isFacture) { set.add(LABELS.FACTURES); keepInInbox = true; }
  if (input.isFournisseur) { set.add(LABELS.FOURNISSEURS); keepInInbox = true; }

  // 4. Notif système non-junk → archivé
  let archive = false;
  if (set.size === 0 && input.isSystem) { set.add(LABELS.SYSTEME); archive = true; }

  // 5. Reste → à traiter (gardé en boîte pour action humaine)
  if (set.size === 0) { set.add(LABELS.A_TRAITER); }

  // Garde-fou: tout ce qui touche un client/photo/facture reste TOUJOURS en boîte.
  if (keepInInbox) archive = false;

  return { labels: [...set], archive };
}

const FACTURE_RE = /\b(facture|invoice|re[çc]u|solde|paiement|payment)\b/i;
const SYSTEM_SENDERS = ['vercel.com', 'github.com', 'sentry.io', 'getsentry.com', 'supabase', 'anthropic.com', 'telegram.org', 'twilio.com', 'google-workspace-noreply', 'accounts.google.com'];

export function isFactureSubject(subject: string): boolean { return FACTURE_RE.test(subject ?? ''); }
export function isSystemSender(fromEmail: string): boolean {
  const f = (fromEmail ?? '').toLowerCase();
  return SYSTEM_SENDERS.some(s => f.includes(s));
}

/** Extrait le texte complet du corps d'un email (text/plain préféré, sinon HTML nettoyé). */
export function extractBodyText(payload: gmail_v1.Schema$MessagePart | undefined): string {
  if (!payload) return '';
  const decode = (data?: string | null) => data ? Buffer.from(data, 'base64url').toString('utf-8') : '';
  let plain = '';
  let html = '';
  const walk = (part: gmail_v1.Schema$MessagePart) => {
    const mime = part.mimeType ?? '';
    if (mime === 'text/plain' && part.body?.data) plain += decode(part.body.data) + '\n';
    else if (mime === 'text/html' && part.body?.data) html += decode(part.body.data) + '\n';
    for (const p of (part.parts ?? [])) walk(p);
  };
  walk(payload);
  const raw = plain.trim() || html.replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/gi, ' ');
  return raw.replace(/\s+/g, ' ').trim().slice(0, 4000);
}

export type EmailCategory = 'client' | 'lead' | 'facture' | 'fournisseur' | 'rdv' | 'important' | 'systeme' | 'spam' | 'autre';

/** LIT le mail au complet et ÉVALUE intelligemment c'est quoi (LLM tier smart). */
export async function evaluateEmail(input: { subject: string; bodyText: string; fromEmail: string }): Promise<{ category: EmailCategory; action: string }> {
  const fallback = { category: 'autre' as EmailCategory, action: 'à examiner' };
  if (!input.bodyText && !input.subject) return fallback;
  try {
    const raw = await callLLM({
      tier: 'smart',
      maxTokens: 120,
      jsonMode: true,
      agent: 'gmail-organize',
      system: `Tu classes les courriels d'une entreprise de planchers époxy (Novus Epoxy, Québec). Lis le courriel AU COMPLET et détermine EXACTEMENT ce que c'est. Réponds en JSON: {"category": "...", "action": "..."}.
category = un de: client (un client existant/qui a un projet en cours), lead (nouveau prospect intéressé par un plancher), facture (une facture/reçu de fournisseur à payer), fournisseur (courriel d'un fournisseur de matériaux/sous-traitant), rdv (demande de rendez-vous/visite/appel), important (action humaine requise, ni client ni facture), systeme (notification automatique: Vercel, GitHub, Sentry, Google, etc.), spam (pourriel/pub non sollicitée), autre.
action = 3-6 mots: quoi faire (ex: "répondre soumission", "payer facture", "rappeler le client", "classer", "ignorer").`,
      messages: [{ role: 'user', content: `De: ${input.fromEmail}\nSujet: ${input.subject}\n\n${input.bodyText.slice(0, 3500)}` }],
    });
    const parsed = JSON.parse(raw);
    const cat = String(parsed.category ?? '').toLowerCase() as EmailCategory;
    const valid: EmailCategory[] = ['client', 'lead', 'facture', 'fournisseur', 'rdv', 'important', 'systeme', 'spam', 'autre'];
    return { category: valid.includes(cat) ? cat : 'autre', action: String(parsed.action ?? '').slice(0, 60) };
  } catch { return fallback; }
}

/** Combine l'évaluation IA + les garde-fous durs (pièce jointe, contact CRM) → labels. */
export function labelsFromEvaluation(input: {
  category: EmailCategory;
  hasAttachment: boolean;
  contact: Contact;
}): { labels: LabelName[]; archive: boolean } {
  const set = new Set<LabelName>();
  let keepInInbox = false;

  // GARDE-FOU DUR: pièce jointe → toujours Photos reçues + gardé en boîte (peu importe l'IA).
  if (input.hasAttachment) { set.add(LABELS.PHOTOS); keepInInbox = true; }
  // GARDE-FOU DUR: contact connu du CRM.
  if (input.contact) { set.add(input.contact.kind === 'client' ? LABELS.CLIENTS : LABELS.LEADS); keepInInbox = true; }

  // Évaluation IA
  let archive = false;
  switch (input.category) {
    case 'client': set.add(LABELS.CLIENTS); keepInInbox = true; break;
    case 'lead': set.add(LABELS.LEADS); keepInInbox = true; break;
    case 'facture': set.add(LABELS.FACTURES); keepInInbox = true; break;
    case 'fournisseur': set.add(LABELS.FOURNISSEURS); keepInInbox = true; break;
    case 'rdv':
    case 'important': set.add(LABELS.A_TRAITER); keepInInbox = true; break;
    case 'systeme': if (set.size === 0) { set.add(LABELS.SYSTEME); archive = true; } break;
    case 'spam': /* on ne label pas — laissé au cleanup (déjà protégé) */ break;
    default: if (set.size === 0) set.add(LABELS.A_TRAITER);
  }
  if (set.size === 0) set.add(LABELS.A_TRAITER);
  if (keepInInbox) archive = false; // client/photo/facture restent TOUJOURS en boîte
  return { labels: [...set], archive };
}

# NOVUS EPOXY — ULTRAPLAN V2
**Date** : 2026-05-26 · **Goal** : tout au poil, clair, linké partout, entrepreneur-grade.

Basé sur 2 audits parallèles : [`AUDIT-DB-V2.md`](AUDIT-DB-V2.md) + [`AUDIT-WIRING-V2.md`](AUDIT-WIRING-V2.md) + mes vérifs live.

---

## 🎯 NORD-ÉTOILE

**Luca utilise ce système chaque jour.** Aucune friction tolérée. Chaque feature livrée doit être :
- ✅ **Au poil** — pas de TODO, pas de placeholder, pas de half-baked
- ✅ **Cliquable de partout** — depuis CRM → devis → facture → projet → photos → comptabilité (chaque page link vers les suivantes)
- ✅ **Visible immédiatement** — pas de "vide" sans guidage
- ✅ **Telegram-first** — chaque notif a un bouton d'action direct

---

## 📊 ÉTAT MESURÉ — 26 mai 2026

| Métrique | Valeur | Verdict |
|---|---|---|
| Tables DB | 36 (28 vivantes, 4 mortes, 7 à 0 rows) | À cleanup |
| API routes | 141 (95 actives, ~25 dead) | Cleanup |
| Crons | 28 (27 wired propre, 1 dead) | OK |
| Telegram callbacks | 100% handlés | ✅ |
| Env vars manquantes prod | 15 sur 58 | À combler |
| Pub flake LIVE | Campaign #120248486426560058 ACTIVE | ✅ |
| Leads CRM | 4 173 | Mais 0 nouveaux depuis pub launch (24h) |
| Quotes | 167 (4 avec submission_id) | Wiring incomplet |
| Emails sent (outbound) | 12 798 | Bounces non trackés (Resend webhook off) |

---

## 🔴 P0 — CETTE SEMAINE (revenue/visibility-blocking)

### ✅ P0-1. `meta-ads-spend` cron URL fix → FAIT
Commit `2fa8359` — Ajout du préfixe `act_` sur l'URL Meta insights. Cron va commencer à remplir `meta_ads_spend` à partir du prochain run (10h Quebec demain) ou trigger manuel.

### P0-2. Back-fill `meta_ads_drafts` avec spend/impressions/leads
Le draft `#12` (pub flake LIVE) n'a jamais ses metrics dans `meta_ads_drafts` malgré que le cron `meta-ads-spend` les pull. **Action** : dans `meta-ads-spend` cron, ajouter un `UPDATE meta_ads_drafts SET spend_usd, impressions, clicks, leads_generated WHERE meta_campaign_id = ...` après chaque INSERT dans `meta_ads_spend`.
- **Pourquoi** : dashboard pub flake reste à 0$ partout, on voit pas si la pub performe.

### P0-3. `USD_CAD_RATE` env var (37% écart)
Set `USD_CAD_RATE=1.37` dans Vercel. Sinon `meta_ads_spend.spend_cad = spend_usd × 1.0` = sous-évalue le spend de 37%.

### P0-4. Wirer ou drop `quote_views` (feature "vu non accepté" silent dead)
2 options :
- **(A) Wirer** : `INSERT INTO quote_views (quote_id, viewed_at, ip_hash, user_agent)` dans `/api/quotes/[id]/payment-info` à chaque hit (capped à 1/IP/h via dédup).
- **(B) Drop la table** et rester sur `quotes.first_view_at` (déjà fixed via commit déjà mergé).

Recommandation : **(B) Drop** + verify que `first_view_at` se remplit (actuellement 2/167 = pas wiré). Vérifier `payment-info/route.ts:36` UPDATE est appelé.

### P0-5. Resend webhook bounces/opens
12 798 emails envoyés mais 0 event de retour. Action :
- Set `RESEND_WEBHOOK_SECRET` dans Vercel
- Configurer URL `https://novus-epoxy.vercel.app/api/resend/webhook` dans dashboard Resend (https://resend.com/webhooks)
- Sinon : bounces invisibles → emails se font blocker silencieusement.

### P0-6. Tracker.js absent du site marketing
`page_views` = 698 rows alors qu'on a 4 173 leads CRM. Funnel cassé. Vérifier que `<script src="https://novus-epoxy.vercel.app/tracker.js">` est inclus dans toutes les pages de novusepoxy.ca (PHP custom Hostinger).

### P0-7. FAL_KEY pour pubs designed
Set `FAL_KEY` dans Vercel (https://fal.ai/dashboard/keys). Sans elle, génération d'image fallback OpenRouter = qualité texte moindre pour ad creatives.

### P0-8. AdSet auto-creation fix (déjà fait dimanche soir commit `a430af9`)
Vérifié : nouveau code crée Campaign + AdSet + Ad en ACTIVE direct. Plus de bug "AdSet PAUSED" qui a empêché la pub flake de diffuser pendant 14h.

---

## 🟡 P1 — CE SPRINT (UX + dette technique)

### Entrepreneur-grade UX (priorité #1 P1)

**P1-1. Linkage cross-pages dashboard**

Pages qui doivent linker entre elles avec boutons contextuels :

| Page | Doit avoir liens vers |
|---|---|
| `/dashboard/crm/[id]` | Devis du lead · Submissions · Emails · SMS · Notes Telegram |
| `/dashboard/devis/[id]` | Lead source · Contrat · Facture · Projet · Photos · Paiements |
| `/dashboard/factures/[id]` | Devis source · Projet · Photos · Paiements · Email envoyé |
| `/dashboard/projets/[id]` | Devis · Facture · Photos chantier · Heures travailleurs · Avis |
| `/dashboard/portfolio/[id]` | Projet source · Sage scan log |
| `/dashboard/comptabilite` | Lien filtre par projet · par mois |

**P1-2. Fusionner Mission Control endpoints**

3 endpoints actuels (`/api/agents/activity`, `/api/agents/cost`, `/api/agents/status`) → 1 seul `/api/agents/dashboard` qui retourne tout. Page Mission Control fait 1 fetch au lieu de 3.

**P1-3. Drop pages/features "blank state"**

- Pages dashboard avec 0 row doivent afficher un CTA "Créer le premier X" + tutorial 30 sec.
- Pas de tableau vide muet.

### Cleanup DB

**P1-4. Drop tables mortes**
```sql
DROP TABLE playing_with_neon;
DROP TABLE auth_users;
DROP TABLE auth_verification_tokens;
ALTER TABLE crm_leads DROP COLUMN prospect_followup1_at;
ALTER TABLE crm_leads DROP COLUMN prospect_followup2_at;
```

**P1-5. Wirer `sms_logs.lead_id`**
Au moment de l'INSERT dans `sms_logs`, lookup `crm_leads.id` par `to_number → telephone`. Back-fill les 3860 rows existantes via UPDATE.

**P1-6. Wirer `email_logs.direction='inbound'`**
Dans `/api/gmail/webhook` quand un reply Gmail arrive, INSERT dans `email_logs` avec `direction='inbound'`. Permet de tracker les conversations bi-directionnelles.

**P1-7. Wirer `quotes.submission_id` au moment de l'auto-quote**
Dans `app/api/meta/webhook/route.ts` quand auto-quote créé depuis FB lead, set `submission_id`. Permet de back-track le formulaire qui a généré le devis.

### Cleanup Wiring

**P1-8. Drop routes mortes** :
- `/api/cron/prospect-followup` (renvoie skipped, consolidé dans relance-prospect)
- `/api/scraper` (env var inexistante)
- `/api/terminal` (impossible sur Vercel serverless)
- `/api/admin/migrate-quotes` (migration ponctuelle terminée)
- `/api/auth/google/start` (OAuth jamais wired, on utilise env vars)

**P1-9. Consolider SMS webhooks**
2 endpoints `/api/sms/webhook` ET `/api/sms/incoming` cohabitent et sont configurés sur 2 numéros Twilio différents. **Décision** :
- `+15817014055` (Novus principal) → `/api/sms/webhook` (Nova AI reply)
- `+15817095940` (Novus secondaire) → `/api/sms/incoming` (parsing devis SMS)
- **Garder les 2** mais documenter et ajouter validation HMAC Twilio sur `/sms/webhook` (manquante).

**P1-10. GHL — décider**
Soit set `GHL_WEBHOOK_SECRET` + configurer webhook push (rapide). Soit supprimer `/api/webhooks/ghl` et rester sur cron `crm/leads/sync-ghl` (mode actuel).

### Features missing

**P1-11. Page "Pubs FB" sur dashboard**
Liste les `meta_ads_drafts` avec leur spend/impressions/leads en live. Bouton "Pause/Resume" via Meta API. Bouton "Voir dans Ads Manager".

**P1-12. Page "Activité agents" complète**
`/dashboard/mission-control` doit afficher cost par agent, calls 24h, latency, dernier message. Endpoint `/api/agents/cost` existe déjà mais aucune UI le consomme.

**P1-13. Notifs Telegram avec boutons d'action partout**
- Nouveau lead → bouton "Voir CRM" + "Approuver devis" ✅ (déjà)
- Devis vu non accepté → bouton "Voir" + "Relancer maintenant" (manquant)
- Avis Google reçu → bouton "Voir" + "Remercier" (manquant)
- Paiement reçu → bouton "Voir facture" + "Lancer travaux"

---

## 🟢 P2 — BACKLOG (refactor + perf)

**P2-1. Décider `clients` table**
Soit drop, soit en faire la table canonique avec FK partout. Actuellement 3 sources de vérité.

**P2-2. Décider `bank_transactions`**
Si Luca veut import bancaire (Plaid ou CSV) → setup. Sinon drop la table + routes.

**P2-3. Refactor `app/api/telegram/admin/route.ts`** (2998 lignes)
Splitter en sous-fichiers par mode (callback, command, photo, group).

**P2-4. Refactor prospect-engine**
80% du code Hunter ↔ Denis (Jason) est dupliqué. Extraire dans `lib/prospect-engine.ts`.

**P2-5. Indexes manquants**
```sql
CREATE INDEX idx_email_logs_created ON email_logs(created_at DESC);
CREATE INDEX idx_telegram_messages_created ON telegram_messages(created_at DESC);
```

**P2-6. TTL sur `email_logs.html_body`**
12 798 rows × HTML stocké en clair = ~600 Mo disk. Cron purge > 90 jours OU compression gzip.

**P2-7. `schema_migrations` table**
Mécanisme simple pour tracker quelle migration a été appliquée. Actuellement c'est `IF NOT EXISTS` partout → fragile si quelqu'un rejoue.

**P2-8. Page views funnel**
Une fois tracker.js installé partout, dashboard "Funnel" qui montre :
- Visits novusepoxy.ca → Lead submitted → Lead chaud → Devis envoyé → Devis vu → Accepté → Payé → Complété

---

## 🗺️ ROADMAP 2 SEMAINES

### Semaine 1 (26 mai → 1 juin)

**Lundi 27 mai** :
- ✅ P0-1 done (commit `2fa8359`)
- Set `USD_CAD_RATE=1.37` + `RESEND_WEBHOOK_SECRET` + `FAL_KEY` (10 min)
- Trigger manuel `meta-ads-spend` cron pour valider fix
- Migration drop 3 tables mortes + 2 colonnes mortes

**Mardi 28 mai** :
- Code P0-2 (back-fill meta_ads_drafts)
- Code P0-4 (décision quote_views — recommandation drop)
- Configurer Resend webhook côté dashboard Resend

**Mercredi 29 mai** :
- Code P1-5 (sms_logs.lead_id wiring + back-fill 3860 rows)
- Code P1-6 (email_logs.direction inbound)
- Code P1-7 (quotes.submission_id propagation)

**Jeudi 30 mai** :
- P1-8 cleanup routes mortes (5 routes)
- P1-1 commencer linkage cross-pages dashboard (CRM ↔ Devis)
- Verify tracker.js sur site marketing

**Vendredi 31 mai** :
- P1-11 page Pubs FB dashboard
- P1-2 fusion endpoints Mission Control

### Semaine 2 (2 → 8 juin)

- P1-1 finir linkage (Factures ↔ Projets ↔ Photos)
- P1-12 page Activité agents complète
- P1-13 boutons Telegram étendus
- P1-9 consolider SMS webhooks (auth HMAC)
- P1-10 GHL décision
- P2-1 et P2-2 décisions clients/bank_transactions
- P2-5 indexes
- Smoke test complet end-to-end

---

## 📌 ENV VARS À SET DANS VERCEL (action immédiate)

```bash
USD_CAD_RATE=1.37
RESEND_WEBHOOK_SECRET=<générer>
FAL_KEY=<de fal.ai/dashboard/keys>
META_LEAD_FORM_ID=1645385520039445  # déjà default mais explicit
GHL_WEBHOOK_SECRET=<générer>         # si on garde GHL webhook
```

---

## 📈 SUCCESS METRICS (30 jours après livraison P0+P1)

| KPI | Cible |
|---|---|
| Pub flake spend trackée dans dashboard | $30/jour visible en temps réel |
| Resend bounces/opens reçus | > 80% des emails ont un event |
| `quotes.first_view_at` rempli | > 70% des devis envoyés |
| `sms_logs.lead_id` rempli | 100% des nouveaux SMS |
| Dashboard pages avec liens contextuels | 100% (CRM, Devis, Factures, Projets) |
| Routes mortes | 0 (vs 25 actuellement) |
| Tables 0 rows mortes | 0 (vs 3 actuellement) |
| Telegram notifs avec boutons | 100% des notifs business |

---

## 🎯 ANTI-OBJECTIFS

Ce qu'on NE FAIT PAS dans cette V2 (à éviter de scope-creep) :
- Pas de refactor `/api/telegram/admin/route.ts` (2998 lignes mais marche) → P2
- Pas de migration vers Plaid pour bank_transactions → décision business d'abord
- Pas de redesign UI complet du dashboard → juste linkage + features manquantes
- Pas de nouveau service externe (Algolia, etc.) → optimiser ce qu'on a

---

**Fin de l'ULTRAPLAN-V2**. Prochaine étape : exécuter P0 + commencer P1 — je peux le faire en autonomie, dis "go" pour lancer la phase d'exécution.

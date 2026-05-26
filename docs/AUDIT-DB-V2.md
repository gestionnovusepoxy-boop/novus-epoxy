# AUDIT DB Novus Epoxy — 26 mai 2026

**Scope** : 36 tables Neon Postgres, 28 migrations, `dashboard/app/api/**` + `dashboard/lib/**`
**Méthode** : cross-ref `information_schema` ↔ `grep` SQL refs ↔ row counts ↔ `vercel.json` crons.

---

## 1. Tables orphelines (à supprimer / dead code)

| Table | Rows | Refs code | Verdict |
|---|---|---|---|
| `playing_with_neon` | 10 | **0** | DEAD — table de test Neon par défaut. **Drop.** |
| `auth_users` | 1 | **0** | DEAD — `lib/auth.ts` utilise NextAuth Credentials avec env vars `ADMIN_EMAIL`/`AUTHORIZED_USERS`. Aucune query SQL ne touche la table. La row unique est un fossile. **Drop.** |
| `auth_verification_tokens` | 0 | **0** | DEAD — magic-link non utilisé (auth Credentials seulement). **Drop.** |

Total : **3 tables 100 % mortes** + index inutiles. Économie : ~7 objets schema, requêtes plus rapides au catalog.

---

## 2. Features fantômes (table existe, code l'écrit/lit, 0 row = jamais déclenchée)

### 2.1 `quote_views` (0 rows) — **CASSÉ P0**
- Migration 028 crée la table avec FK + index `idx_quote_views_quote`.
- **AUCUN code n'écrit dans `quote_views`** (zéro `INSERT INTO quote_views`).
- Le tracking de "vue de devis" passe par `quotes.first_view_at` mis à jour dans `app/api/quotes/[id]/payment-info/route.ts`. Résultat : 167 quotes mais seulement **2** ont `first_view_at` rempli.
- Le cron `/api/cron/relance` lit `first_view_at` pour la relance "vu non accepté" → cette feature est **silencieusement inopérante** (ne se déclenche jamais).
- **Fix** : soit (a) wirer un `INSERT INTO quote_views` dans la page publique du devis, soit (b) drop la table et fixer `first_view_at` (vérifier que le endpoint payment-info est appelé sur chaque vue).

### 2.2 `events` (0 rows) — feature half-baked
- `app/api/track/route.ts` fait `INSERT INTO events` quand `body.type === 'event'`.
- `public/tracker.js` envoie seulement `pageview` automatiquement. Les events custom dépendent de `[data-track]` attributes sur des éléments HTML — **aucun élément du site vitrine novusepoxy.ca n'a `data-track`**.
- Aucun `SELECT FROM events` dans le code → la table accumule rien et personne ne la lit.
- **Verdict** : feature jamais finie. Choix : drop la table + cleanup `track/route.ts`, ou ajouter des `data-track` sur CTA (devis, appel, scroll-50, etc.) et un dashboard pour les lire.

### 2.3 `meta_ads_spend` (0 rows) — cron pas tourné
- Cron configuré dans `vercel.json` (`0 10 * * *`) et logique propre dans `app/api/cron/meta-ads-spend/route.ts`.
- `synced_at` MAX = `NULL`. La pub flake `#12` est `lance` depuis hier 20:03 mais le sync quotidien à 10h n'a pas inséré → soit cron pas encore exécuté (next run 10h ce matin), soit erreur token FB silencieuse.
- **Action P1** : trigger manuel `GET /api/cron/meta-ads-spend?bearer=…` aujourd'hui pour vérifier wiring + remplir `spend_usd/impressions/clicks` sur `meta_ads_drafts #12`.

### 2.4 `lead_campaigns` (0 rows) — agent Hunter inactif
- 3 INSERTs dans le code (`leads/hunter`, `leads/offer`). 0 rows → l'agent Hunter n'a jamais été exécuté en prod, ou les routes ne sont jamais appelées.
- Soit l'agent est désactivé, soit ces routes sont mortes. **Investigate**.

### 2.5 `recurring_expenses` (0 rows)
- Cron `/api/cron/recurring-expenses` actif (10h tous les jours). Aucune dépense récurrente configurée par Luca encore.
- Pas un bug — feature attend données. **Note pour onboarding** : créer entries (Hydro, internet, Stripe fees, etc.).

### 2.6 `campaigns` (0 rows) — promotions SMS jamais envoyées
- Tables `promotions` (2 rows) + `campaigns` (0). Le rabais 20 % avril existe en `promotions` mais aucune campagne SMS n'a été envoyée via `app/api/campagnes/route.ts`. À vérifier : feature SMS de masse jamais utilisée.

### 2.7 `bank_transactions` (0 rows)
- 19 refs code, 3 FK (`expenses.transaction_id`, etc.), pipeline complet (import, auto-match, reconcile).
- **Aucun import bancaire jamais effectué**. Feature complète mais inutilisée → décision business : intégrer ou drop.

---

## 3. Colonnes mortes / sous-utilisées

| Colonne | Refs code | État |
|---|---|---|
| `crm_leads.prospect_followup1_at` | **0** | DEAD — migration 018 ajoute, jamais utilisée. Probablement remplacée par `prospect_relance_1_at`. **Drop.** |
| `crm_leads.prospect_followup2_at` | **0** | DEAD — idem. **Drop.** |
| `quotes.contrat_signature_image` | 2 | Marginalement utilisée (set + invoice PDF). OK. |
| `email_logs.html_body` | included in 37 | Stocke HTML en clair — gros disk, à monitorer (12 798 rows × HTML potentiellement >50 ko = ~600 Mo). Considérer compression / TTL 90j. |
| `email_logs.reply_body` | inclus | OK. |
| `email_logs.direction` | inclus | Toutes les 12 798 rows = `outbound`. Les replies entrantes ne sont **jamais loggées** comme `inbound`. Bug ou feature pas wirée. |

---

## 4. Wiring missing / sync gaps

### 4.1 `submissions` (36) ↔ `crm_leads` (4 173) : doublons potentiels
- 3 submissions sans crm_lead match (par email ou phone). Le cron `sync-submissions` (12:30) corrige mais 3 leaks restent.
- Doublons fonctionnels : un FB lead arrive 3 fois (zapier → submissions, fb-leads-sync direct → crm_leads, meta/webhook → les deux). Le `ON CONFLICT` sur `crm_leads.email` protège mais `submissions` n'a pas d'unique → 36 rows historique inclut probablement des dupes.

### 4.2 `quotes.submission_id` rarement rempli
- 167 quotes, **4 seulement** avec `submission_id` rempli. La FK existe mais le flux Lead → Devis ne propage pas le `submission_id`. Pas critique mais perte de traçabilité (impossible de back-track quel formulaire a généré quel devis).

### 4.3 `invoices.client_id` quasi vide (3/3 invoices)
- Hasard ou pattern : la table `clients` (5 rows) est sous-utilisée. Quotes utilisent `client_nom/email/tel` en plain text. Les `clients` ne sont pas synchronisés depuis `crm_leads`. **Doublon de logique** `clients` ↔ `crm_leads` ↔ `quotes.client_*`.
- **Reco P2** : décider — soit promouvoir `clients` comme table de référence + FK partout, soit dropper la table.

### 4.4 `meta_ads_drafts #12` (active depuis hier) — spend pas remontée
- Le draft `lance` n'a ni `spend_usd`, `impressions`, `clicks`, `leads_generated` mis à jour. La logique de réconciliation depuis `meta_ads_spend` → `meta_ads_drafts` **n'existe pas** dans le code. Cron `meta-ads-spend` écrit dans `meta_ads_spend` mais ne back-fill jamais `meta_ads_drafts.{spend,impressions,leads_generated}`. **P1 — feature manquante**.

### 4.5 `sms_logs.lead_id` orphelin
- Colonne `lead_id` existe mais **aucune query ne la SELECT/SET avec `crm_leads.id`**. Tous les `sms_logs` ont `quote_id` ou rien. Les SMS Hunter/Aria envoyés aux 4 173 leads ne sont pas reliés à `crm_leads`. **Reco** : back-fill via `sms_logs.to_number` → `crm_leads.telephone`, et set au moment de l'INSERT.

---

## 5. Migrations vs schéma réel

- Migration 018 cohabite avec 3 fichiers (`prospect-followup`, `leads-type`, `email-logs-statut`) — numérotation cassée mais toutes appliquées (les colonnes existent).
- Migration 015 idem (2 fichiers).
- Toutes les colonnes des migrations 002→029 sont présentes en DB. **Pas de migration non appliquée détectée**.
- **Risque** : aucun mécanisme de tracking (pas de `schema_migrations` table). Si quelqu'un rejoue une migration, behavior dépend de `IF NOT EXISTS`. Acceptable mais fragile.

---

## 6. Indexes manquants (perf risk)

Vérifié — les indexes critiques sont en place. Quelques manques mineurs :

- `email_logs.created_at` — pas d'index, mais `email_logs_resend_id_key` couvre les lookups par resend_id. Si dashboard liste les emails ORDER BY created_at, ajouter `idx_email_logs_created`.
- `messages.created_at` — pas d'index, queries de chat dépendent du PK + `conversation_id`. OK pour 323 rows, à surveiller.
- `audit_logs.created_at` — pas d'index ORDER BY date. 30 rows = pas urgent.
- `telegram_messages.created_at` — pas d'index date. 628 rows + dashboard `iris-report` lit par date.

---

## 7. Doublons de logique / dette

1. **`clients` ↔ `crm_leads` ↔ `quotes.client_*`** : 3 sources de vérité pour "personne". Choisir une (`crm_leads` = candidat le + complet).
2. **`submissions` ↔ `crm_leads`** : `submissions` ne sert quasi qu'à l'archivage du form public. Tout converge vers `crm_leads`. Idée : drop `submissions` + tout pousser dans `crm_leads` avec `source=form`.
3. **`first_view_at` (quotes) ↔ `quote_views` table** : 2 systèmes pour le même besoin. `quote_views` mort → garder `first_view_at`, dropper `quote_views`.
4. **`email_logs.direction`** : seul `outbound` est jamais loggé. Soit dropper la colonne, soit wirer Gmail watch → INSERT inbound (le code existe partiellement dans `gmail/watch`).

---

## 8. Recommandations prioritisées

### P0 — fix avant fin de semaine
1. **`quote_views` cassé** : décider drop vs wirer. Si gardé, insérer une row dans la page publique de quote (visible sur `/quote/[id]?token=…`). Sinon, supprimer la table + le code `track.ts` "event" mort.
2. **`meta_ads_drafts #12` ne reçoit jamais ses metrics** : ajouter dans cron `meta-ads-spend` un `UPDATE meta_ads_drafts SET spend_usd, impressions, clicks, leads_generated WHERE meta_campaign_id = …`. Sans ça le dashboard pub flake reste à 0.
3. **Trigger manuel `meta-ads-spend`** aujourd'hui pour valider token FB (cron 10h n'a jamais inséré une seule row).

### P1 — ce sprint
4. Drop : `playing_with_neon`, `auth_users`, `auth_verification_tokens`, colonnes `crm_leads.prospect_followup1_at` / `prospect_followup2_at`.
5. Wirer `sms_logs.lead_id` au moment de l'INSERT (lookup par `to_number` → `crm_leads.id`).
6. Wirer `email_logs.direction='inbound'` dans `gmail/watch` quand un reply est reçu.
7. `quotes.submission_id` : propager systématiquement quand quote créée depuis form (auto-quote / agent).

### P2 — dette
8. Décider du sort de `clients` (drop ou en faire la table canonique).
9. Décider du sort de `bank_transactions` (intégrer Plaid/import CSV ou drop).
10. Ajouter `idx_email_logs_created`, `idx_telegram_messages_created`.
11. Mettre en place un `schema_migrations` tracker simple.
12. `email_logs.html_body` : TTL 90 jours via cron (purge ou compression) — gros disque.

---

**Top 5 P0** :
1. `quote_views` 100 % cassée — feature "vu non accepté" broken.
2. `meta_ads_drafts` ne reçoit jamais spend/impressions/leads de `meta_ads_spend` — dashboard pub flake fantôme.
3. `meta_ads_spend` cron jamais exécuté (0 rows malgré pub `lance`).
4. `auth_users` / `auth_verification_tokens` dead — à dropper pour clarté sécurité.
5. `email_logs.direction` ne logge que `outbound` — replies entrantes invisibles côté DB.

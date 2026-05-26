# AUDIT WIRING Novus Epoxy — 26 mai 2026

Audit complet de `dashboard/app/api/` (141 routes) et `dashboard/vercel.json` (28 crons). Mesures DB live + grep statique. Tout fichier référencé en chemin absolu.

---

## 1. Endpoints fantômes / sous-utilisés

Routes existantes sans aucun caller (ni `fetch('/api/…')` côté UI, ni serveur-à-serveur, ni cron) :

### 1.1 Dead — UI-orphelins (à supprimer ou à wirer)

- `/api/admin/balcon-sms-photo` — script one-shot, jamais déclenché. `app/api/admin/balcon-sms-photo/route.ts:1`
- `/api/admin/fb-leads-auto-devis` — idem, lancé manuellement via curl seulement.
- `/api/admin/fb-leads-renotify` — idem.
- `/api/admin/gmail-search` — debug tool, aucun caller.
- `/api/admin/meta-subscribe` — devrait être déclenché une seule fois, OK garder.
- `/api/admin/migrate-quotes` — migration ponctuelle, à archiver.
- `/api/ads/upload-creative` — backend prêt mais aucune UI ne l'appelle. `app/api/ads/upload-creative/route.ts:8` mentionne "use the returned URL as customImageUrl in POST /api/ads/propose" — flow manuel uniquement.
- `/api/agents/cost` — endpoint dashboard prêt, mais aucun composant ne le fetch. La page `/dashboard/mission-control` devrait l'utiliser.
- `/api/auth/google/start` — flux OAuth Google jamais wired ; les credentials sont en env. À retirer.
- `/api/bank/reconcile` — reconciliation manuelle, jamais appelée depuis UI.
- `/api/chat/email` — wired dans middleware mais aucun caller; probablement Resend Inbound mais aucun webhook ne pointe ici.
- `/api/chat/history` — exposé public via middleware mais aucun composant chat ne le lit.
- `/api/chat/upload` — idem, photo upload chat widget pas wired sur le site marketing.
- `/api/leads/zapier` — actif (Zapier production) MAIS aucune référence dans le code. À documenter comme webhook externe.
- `/api/portfolio/videos` — backend prêt, jamais appelé. `app/api/portfolio/videos/route.ts`.
- `/api/projects/[id]/report` — PDF report, jamais déclenché.
- `/api/reviews/stats` — stats Google reviews, aucun caller.
- `/api/scraper` — proxy vers `SCRAPER_URL` mais cette env var **n'existe pas en production** (voir §6). Code mort.
- `/api/sage/scan` — appelé seulement par `/api/agents/[agentId]/route.ts:751,765`. Le bouton UI Sage doit passer par `/api/agents/sage` qui retransmet. OK mais fragile.
- `/api/terminal` — exécute `vercel deploy --prod`, `git status` etc. via `child_process` avec `cwd: '/Users/novusepoxy/novus-epoxy'`. **Ne peut pas fonctionner sur Vercel serverless** (filesystem read-only, pas de git, pas de binaire vercel). Le composant TerminalClient l'appelle quand même. À supprimer ou exécuter via Vercel Deploy Hook.
- `/api/composio/connect`, `/api/composio/sheets-report` — Composio est wired mais `COMPOSIO_API_KEY` n'est pas dans la liste des env vars utilisées (§6 — il manque dans le grep), à vérifier.

### 1.2 Routes "1 caller serveur" — risque si caller change

- `/api/leads/hunter/prospect` — appelé uniquement par `app/api/agents/[agentId]/route.ts`.
- `/api/leads/offer` — appelé par `app/dashboard/leadhunter/page.tsx:153`.
- `/api/sms/devis` — middleware le protège mais aucune référence côté UI; probablement un endpoint manuel pour Telegram.

---

## 2. Crons cassés ou suspects

### 2.1 Cron 28 entries vercel.json → 100 % wirés sur des routes existantes

Bonne nouvelle : tous les paths `vercel.json` ont un `route.ts` correspondant. Inversement, **`/api/cron/prospect-followup` existe en code mais n'est pas dans `vercel.json`** — confirmation : `app/api/cron/prospect-followup/route.ts:5` retourne `{ ok:true, skipped:true, message: 'Consolidated into /api/cron/relance-prospect' }`. Code mort à supprimer.

### 2.2 Crons dont des env vars critiques manquent en prod (cf §6)

- `/api/cron/meta-ads-spend` — exige `META_PAGE_TOKEN` (présent), `META_AD_ACCOUNT_ID` (présent), `USD_CAD_RATE` **(absent — fallback `1.0` donc CAD = USD, sous-évalue dépenses ~37 %)**. Fichier `app/api/cron/meta-ads-spend/route.ts:71,90`. Table `meta_ads_spend` = 0 rows → le cron n'a jamais réussi un INSERT, soit fail silencieux soit Meta API renvoie vide. À tester en live.
- `/api/cron/ads-weekly` — exige `FAL_KEY` **absent**, `TELEGRAM_GROUP_CHAT_ID` (présent). `lib/meta-ads.ts:94` : si `FAL_KEY` manque, fallback OpenRouter pour images. **Le cron tourne tous les lundis 14h UTC mais ne peut générer la créative finale** — soit erreur silencieuse soit image basse qualité.
- `/api/cron/email-scan` — `ANTHROPIC_API_KEY` présent ✓. `maxDuration = 60`s ; le fichier fait 1076 lignes et scanne Gmail avec parsing AI. **Risque timeout** sur backlogs > 50 emails. Cron toutes les 15 min → si timeout, retry next slot mais possible blocage. À monitorer.
- `/api/gmail/watch` — exige `GOOGLE_*` (présents) ✓.
- `/api/cron/health-check` — appelle `getGmailClient()` et `callLLM`. Si crash, `getAdminChatIds()` ping Telegram avec rapport. Robuste. ✓

### 2.3 `events` table à 0 rows alors que cron `/api/track` fait INSERT

`app/api/track/route.ts:39` insère dans `events` mais la table a 0 rows en prod. Soit :
- Tracker `tracker.js` n'est pas chargé sur le site marketing (probable — vérifier `https://novusepoxy.ca`).
- Table créée mais `INSERT` échoue silencieusement (try/catch).

**Action** : ouvrir Chrome DevTools sur novusepoxy.ca et confirmer que `/tracker.js` est inclus et fire un event.

---

## 3. Telegram callbacks

Tous les `callback_data` envoyés sont handlés dans `app/api/telegram/admin/route.ts` :

| callback_data prefix | Handler line | Status |
|----|----|----|
| `approve_quote_*` | 1199, 1247 | ✓ |
| `reject_quote_*` | 1452 | ✓ |
| `confirm_deposit_*` | 1382 | ✓ |
| `assign_expense_*` | 1352 | ✓ |
| `approve_ad_*` | 1460 | ✓ |
| `reject_ad_*` | 1539 | ✓ |
| `regen_ad_*` | 1547 | ✓ |

Aucun callback orphelin trouvé. ✓

---

## 4. Webhooks externes — statut

| Webhook | Endpoint | Auth | Statut |
|---|---|---|---|
| Meta Lead Ads | `/api/meta/webhook` | `META_APP_SECRET` HMAC-SHA256 + `META_VERIFY_TOKEN` | ✓ wired (mais `META_APP_SECRET` "if not configured, allow through" — fallback dangereux, `app/api/meta/webhook/route.ts:29`) |
| Stripe | `/api/stripe/webhook` | `STRIPE_WEBHOOK_SECRET` | ✓ wired ; **0 paiements confirmés via webhook** (5 dans `payments` mais peut être manual). `STRIPE_SECRET_KEY` et `STRIPE_WEBHOOK_SECRET` présents en env ✓ |
| Resend | `/api/resend/webhook` | `RESEND_WEBHOOK_SECRET` **absent en env** → endpoint n'a pas de verif si secret manque, `app/api/resend/webhook/route.ts`. Wired dans Resend dashboard? À vérifier. **Email_logs = 12 798 rows mais aucun `delivered/bounced` event reçu via webhook?** |
| Gmail Pub/Sub | `/api/gmail/webhook` | check `CRON_SECRET` optionnel | ✓ wired, autoHeal triggered |
| Twilio inbound | `/api/sms/webhook` ET `/api/sms/incoming` | aucune verif `X-Twilio-Signature` sur `/sms/webhook` ; `/sms/incoming` a HMAC-SHA1 | **DOUBLON — voir §5**. Twilio configuré sur un seul, à confirmer lequel. |
| OpenClaw (Nova) | `/api/openclaw/webhook` | `OPENCLAW_WEBHOOK_SECRET` (timing-safe) ✓ | wired |
| GHL | `/api/webhooks/ghl` | `GHL_WEBHOOK_SECRET` **absent en env** | code prêt mais Champfields n'envoie probablement rien — `GHL_API_KEY` présent côté pull, mais `crm/leads/sync-ghl` est le mode utilisé (cron polling), pas le webhook push. À désactiver ou setup. |
| Zapier (FB leads bridge) | `/api/leads/zapier` | `ZAPIER_API_KEY` ✓ | actif en prod selon mémoire user |

**P0 — vérifier Resend webhook** : 12 798 emails envoyés et zéro tracking back → soit `RESEND_WEBHOOK_SECRET` jamais set + webhook bloqué, soit Resend webhook non-configuré côté dashboard Resend.

---

## 5. Doublons / overlaps à consolider

### 5.1 `/api/sms/webhook` vs `/api/sms/incoming`

- `app/api/sms/webhook/route.ts` (175 lignes) — STOP/START handling + Nova AI reply via TwiML.
- `app/api/sms/incoming/route.ts` (327 lignes) — parsing devis SMS via keywords + Twilio HMAC-SHA1 validation.

Deux endpoints qui reçoivent les SMS entrants Twilio. **Un seul est configuré dans la console Twilio**. L'autre est mort. À consolider en un seul handler.

### 5.2 `/api/cron/relance-prospect` vs `/api/cron/prospect-followup`

`prospect-followup` est désactivé par code (renvoie skipped) mais existe encore. À supprimer.

### 5.3 `/api/leads/hunter/prospect` vs `/api/leads/jason/prospect`

- Hunter → cold outreach via portfolio-aware emails (`app/api/leads/hunter/prospect/route.ts`).
- Jason (Denis) → pipeline FB leads, multi-channel (email + SMS) (`app/api/leads/jason/prospect/route.ts`).

**Pas vraiment des doublons** mais 80 % du code de sélection portfolio + scoring est dupliqué. Refactor → extraire dans `lib/prospect-engine.ts`.

### 5.4 `/api/crm/leads/sync-ghl` (cron) vs `/api/webhooks/ghl` (push)

Si webhook GHL actif → désactiver le cron (économise un appel Champfields/jour).

### 5.5 `/api/agents/activity` + `/api/agents/cost` + `/api/agents/status`

Trois endpoints qui retournent des sous-ensembles de la même page Mission Control. À fusionner en `/api/agents/dashboard` qui renvoie tout en un payload.

---

## 6. Env vars utilisées dans le code mais ABSENTES en production

(`vercel env pull --environment=production` → 74 vars; code utilise ~58, voici l'intersection vide)

| Var | Used by | Impact |
|---|---|---|
| `FAL_KEY` | `lib/meta-ads.ts:94` | Pas d'image fal.ai → fallback OpenRouter (qualité réduite ou échec si OR_MODEL_IMAGE absent aussi) |
| `GHL_WEBHOOK_SECRET` | `app/api/webhooks/ghl/route.ts` | Webhook GHL accepte sans verif si secret absent → vérifier code, sinon désactiver |
| `LANGFUSE_*` (3 vars) | observabilité LLM | Pas de tracing, OK pas critique |
| `META_ADS_DEFAULT_STATUS`, `META_LEAD_FORM_ID` | `lib/meta-ads.ts` | Status pubs probablement défaut PAUSED OK ; lead form filter manquant peut importer trop de leads |
| `OR_MODEL_BULK / FAST / MEDIUM / SMART / TOP / IMAGE` (6 vars) | `lib/llm.ts:20-24` | Fallbacks hardcoded vers `deepseek/deepseek-v4-flash`, `google/gemini-3.1-flash-lite`, etc. **Ces modèles n'existent pas sur OpenRouter** (DeepSeek V4? Gemini 3.1?). Soit modèles roulés out, soit typos. **À vérifier d'urgence avec `/api/cron/health-check` qui ping LLM.** |
| `RESEND_WEBHOOK_SECRET` | `app/api/resend/webhook/route.ts` | Webhook événements email pas auth → silencieusement skipped ? |
| `SCRAPER_URL` | `app/api/scraper/route.ts:3` | Proxy scraper dead, OK route morte. |
| `TWILIO_JASON_PHONE` | `lib/sms.ts` ou similaire | Si SMS sortants depuis Jason routent vers TWILIO_PHONE_NUMBER par défaut, pas grave |
| `USD_CAD_RATE` | `app/api/cron/meta-ads-spend/route.ts:71,90` | Fallback `1.0` → spend CAD sous-évalué ~37%. À set à `1.37` ou via cron FX. |
| `VERCEL_TOKEN`, `VERCEL_PROJECT_ID` | utilisés par auto-heal/deploy hooks | Auto-redeploy ne fonctionne pas si manquants. |
| `AUTH_SECRET` / `NEXTAUTH_SECRET` | NextAuth | Présents ✓ |

---

## 7. Tables DB orphelines (0 rows en prod)

Vérification live Neon, namespace `public` :

| Table | Rows | Routes qui écrivent | Diagnostic |
|---|---|---|---|
| `bank_transactions` | 0 | `/api/bank/import` `/api/bank/auto-match` | Aucun CSV bancaire importé. Feature jamais utilisée par Luca. |
| `quote_views` | 0 | **Aucune route !** Le tracking est sur `quotes.first_view_at` (single shot, `app/api/quotes/[id]/payment-info/route.ts:35`). Table morte. | Supprimer la table ou implémenter le tracking event-stream. |
| `meta_ads_spend` | 0 | `/api/cron/meta-ads-spend` | Cron jamais inséré → soit Meta token sans `ads_read`, soit `META_AD_ACCOUNT_ID` invalide. Tester `/api/cron/meta-ads-spend` manuellement avec `Authorization: Bearer $CRON_SECRET`. |
| `lead_campaigns` | 0 | `/api/leads/hunter`, `/api/leads/offer` | Endpoints rarement appelés → 0 inserts. Pas critique. |
| `recurring_expenses` | 0 | `/api/expenses/recurring`, cron `/api/cron/recurring-expenses` | Aucune dépense récurrente configurée par admin. UI prête, ajouter une dépense (hydro, telcomm, etc.). |
| `events` | 0 | `/api/track` | Tracker JS non chargé ou bloqué. Vérifier site marketing. |
| `campaigns` | 0 | `/api/campagnes` (POST) | Aucune campagne marketing créée. OK. |

**Tables référencées dans le code mais inexistantes en DB** :
- `projects` — référencée nulle part actuellement (grep négatif), OK
- `llm_logs` — `lib/llm.ts` log dans `llm_calls` (40 rows ✓), pas `llm_logs`. OK.
- `agent_activity`, `agent_memory` — vues virtuelles ou jamais créées. `/api/agents/activity` joint `crm_leads` et `email_logs` directement. OK.

---

## 8. Cohérence Auth

Pattern audité sur ~70 endpoints :

| Pattern | Routes | Notes |
|---|---|---|
| `await auth()` (NextAuth session) | UI endpoints (devis, factures, clients, dashboard) | ✓ cohérent |
| `Bearer $CRON_SECRET` ou `$ADMIN_API_KEY` | tous les `/api/cron/*` | ✓ cohérent |
| `x-api-key: $ADMIN_API_KEY` | `/api/admin/*`, `/api/leads/zapier` (avec `ZAPIER_API_KEY` aussi) | ✓ cohérent |
| Aucun auth | `/api/track`, `/api/submissions` POST, `/api/chat*`, `/api/bookings*`, `/api/meta/webhook` (HMAC), `/api/stripe/webhook` (HMAC), `/api/quotes/[id]/payment-info?token=` | Tous protégés par middleware rate-limit + HMAC ou token. ✓ |
| Mixte session/api-key | `/api/ads/propose`, `/api/ads/upload-creative`, `/api/sage/scan`, `/api/agents/cost` | ✓ OK |

**Anomalies** :
- `app/api/meta/webhook/route.ts:29` : si `META_APP_SECRET` non configuré, **le webhook est ouvert**. Le commentaire dit "cron sync is backup" — fragile. Au minimum logger un warning. (En prod il est configuré donc OK pour l'instant.)
- `app/api/openclaw/webhook/route.ts:18` : reject si secret non configuré ✓ (meilleure pratique).

---

## 9. Recommandations priorisées

### P0 — corriger cette semaine

1. **Vérifier modèles OpenRouter** (`lib/llm.ts:20-24`) — `deepseek-v4-flash`, `gemini-3.1-flash-lite`, `gemini-3-flash-preview`, `grok-4.20`, `gemini-3.1-pro-preview` : ces noms ressemblent à des hallucinations. Tester via `/api/cron/health-check` (LLM ping). Si erreur, set les vars `OR_MODEL_FAST` etc. vers modèles réels (`google/gemini-2.0-flash-exp`, `anthropic/claude-haiku-4`, etc.).
2. **Resend webhook** — set `RESEND_WEBHOOK_SECRET` en prod + configurer URL `https://novus-epoxy.vercel.app/api/resend/webhook` dans dashboard Resend. Sinon impossible de tracker bounces/opens sur 12 798 emails.
3. **`USD_CAD_RATE`** — set à `1.37` (ou cron FX) ; cron meta-ads-spend sous-évalue le spend de ~37%.
4. **`/api/cron/meta-ads-spend`** — tester en live avec curl + token CRON_SECRET. 0 rows insérés depuis le go-live. Probablement `META_AD_ACCOUNT_ID` invalide ou Meta token sans `ads_read` scope.
5. **Tracker site marketing** — la table `events` (et probablement `page_views` n'est qu'à 698) suggère que tracker.js n'est chargé que sur certaines pages. Vérifier `https://novusepoxy.ca` source HTML inclut `<script src="https://novus-epoxy.vercel.app/tracker.js">`.

### P1 — corriger ce mois-ci

6. **Consolider `/api/sms/webhook` + `/api/sms/incoming`** en un seul handler. Twilio est configuré sur un des deux ; supprimer l'autre. Action: `curl https://api.twilio.com/2010-04-01/Accounts/$SID/IncomingPhoneNumbers.json` pour voir où pointe le webhook.
7. **Supprimer routes mortes** : `/api/cron/prospect-followup` (skipped), `/api/scraper`, `/api/terminal`, `/api/admin/migrate-quotes`, `/api/auth/google/start`.
8. **GHL** — soit set `GHL_WEBHOOK_SECRET` + configurer webhook push (rapide), soit supprimer `/api/webhooks/ghl` et rester sur le cron `/api/crm/leads/sync-ghl`.
9. **FAL_KEY** — set la clé fal.ai en env (référence : `lib/meta-ads.ts:94`) pour avoir des images de pubs propres avec texte. Le fallback OpenRouter image est moins bon pour ads.
10. **`/api/agents/cost` + activity + status** — fusionner en un endpoint Mission Control unique.

### P2 — refactor de fond

11. **Refactor portfolio-picker** entre Hunter et Jason prospects → `lib/prospect-engine.ts`.
12. **Drop `quote_views` table** (jamais utilisée) ou implémenter event-stream (chaque view, pas seulement first).
13. **`/api/telegram/admin/route.ts` = 2998 lignes** — splitter en sous-fichiers par mode (callback, command, photo, group). Risque maintenance.
14. **Auto-renew Gmail watch** — déjà dans health-check + gmail/webhook. Bon, mais ajouter alerte Telegram si > 6j sans renew.
15. **`page_views` = 698 rows mais `quotes` = 167, `crm_leads` = 4 173** — funnel implique > 10 000 visits attendus. Tracker quasi inactif.

---

## Annexes

- Routes existantes : **141**. Routes référencées (ui+server) : **~95**. Vraiment mortes : **~25** (§1).
- Crons configurés : **28** dans `vercel.json`. Tous wirés sur un route.ts. 1 route cron orpheline (`prospect-followup`).
- Env vars utilisées : **58 distinctes**. Env vars manquantes en prod : **15** (§6).
- Tables DB existantes : ~25. Tables à 0 rows : **7** (§7), dont **1 totalement morte** (`quote_views`).
- Telegram callback handlers : 100 % couverts (§3).

Audit généré 2026-05-26.

# NOVUS EPOXY — ULTRAPLAN
**Date** : 2026-05-25 · **Goal** : full-business automation, OpenRouter only (no Anthropic), every tunnel closed end-to-end.

---

## 0. Stack LLM (Mai 2026, NO Anthropic)

Live-priced from `openrouter.ai/api/v1/models` on 2026-05-25.

| Tier | Model | $/M in | $/M out | Ctx | Usage |
|---|---|---|---|---|---|
| **top** | `google/gemini-3.1-pro-preview` | $2.00 | $12.00 | 1M | Marcel, Iris reports, decisions stratégiques |
| **smart** | `x-ai/grok-4.20` | $1.25 | $2.50 | **2M** | Aria, content, email replies, agents |
| **medium** | `google/gemini-3-flash-preview` | $0.50 | $3.00 | 1M | Short agents, analysis |
| **fast** | `google/gemini-3.1-flash-lite` | $0.25 | $1.50 | 1M | Parsing, ping, classify |
| **bulk** | `deepseek/deepseek-v4-flash` | $0.10 | $0.20 | 1M | Bulk classify, scoring, summaries |

**Alternates** (env override): `openai/gpt-5.5` ($5/$30), `openai/gpt-5.4` ($2.50/$15), `x-ai/grok-4.20-multi-agent` ($2/$6, **2M ctx**), `qwen/qwen3.7-max` ($2.50/$7.50), `deepseek/deepseek-v4-pro` ($0.43/$0.87 reasoning).

**Cost target** : <$60/mois LLM total (vs Anthropic budget historique ~$200).

---

## 1. Tunnels — état actuel et gaps

### 1.1 Tunnel Lead → Devis → Close (CORE)

```
FB/IG Ads ─┐
Site form ─┼─► /api/leads/* ─► crm_leads ─► Telegram alert ─► Luca/Jason manual contact
GHL  ─────┘                          │
                                     ├─► auto-quote (si service+superficie connus)
                                     ├─► SMS Luca + Jason
                                     └─► nurture cron (J+1, J+3, J+7)
```

**État** :
- ✅ FB webhook direct (`/api/meta/webhook`) — leadgen + Messenger
- ✅ Fallback cron `/api/cron/fb-leads-sync` every 5 min
- ✅ Health-check re-subscribe leadgen hourly
- ✅ Composio whitelist : FACEBOOK, META_ADS, FACEBOOK_LEAD_ADS, INSTAGRAM (commit 421cf8a)
- ✅ Zapier endpoint `/api/leads/zapier` (GHL bridge)
- ✅ Aria auto-contact DISABLED (manual contact)
- ❌ **GAP** : pas de scoring chaud/tiède/froid à l'import (mémoire `feedback_leads_auto_classify`)
- ❌ **GAP** : pas de A/B test sur form FB pour optimiser CPL

**Actions P0** :
1. Auto-score leads à l'import via bulk-tier LLM (DeepSeek V4 Flash).
2. Expose `/dashboard/leads/score-explain` pour audit Luca.
3. Cron daily : sync Meta Ads spend → CRM (Composio META_ADS).

### 1.2 Tunnel Devis (Quote)

```
crm_lead ─► quotes (brouillon) ─► Telegram approve ─► email + SMS au client
                                                   │
                                                   ├─► /q/[token] page publique
                                                   ├─► Stripe + Interac affichés (Interac priorité 0 frais)
                                                   └─► acceptation ─► depot ─► travaux
```

**État** :
- ✅ Auto-quote depuis FB leads
- ✅ Token sécurisé `/q/[token]`
- ✅ Promo dynamique depuis DB (`promotions` table)
- ✅ Telegram approve button (inline keyboard)
- ✅ Email sans prix (mémoire `feedback_no_prices_email`) — prix uniquement dans devis officiel
- ❌ **GAP** : pas de relance auto si devis consulté mais non accepté
- ❌ **GAP** : pas d'A/B test sur structure devis (montant, terms)

**Actions P1** :
1. Cron `/api/cron/relance` déjà existe — ajouter détection "vu mais non accepté > 48h".
2. Tracker `quote_views` table (déjà `track.ts`) → triggers relance personnalisée.

### 1.3 Tunnel Paiement

```
devis accepté ─► depot Stripe/Interac ─► /api/cron/deposit-watch ─► Telegram confirm
                                                                 │
                                                                 ├─► statut "depot_recu"
                                                                 └─► booking travaux
```

**État** :
- ✅ Stripe webhook configuré (`/api/stripe/webhook`)
- ✅ Interac affiché à côté de Stripe (mémoire `feedback_interac_preferred`)
- ✅ Telegram bouton confirmer dépôt manuel pour Interac
- ❌ **GAP** : Interac dépôt = matching manuel via bank import. Pas d'OCR receipt yet.

**Actions P2** : OCR Interac email → auto-match au devis via bulk-tier LLM.

### 1.4 Tunnel Travaux (Project execution)

```
depot ─► booking calendar ─► travaux planning
                          ├─► /api/travaux/checklist
                          ├─► /api/travaux/photos (avant/pendant/après)
                          └─► /api/travaux/complete ─► solde Stripe/Interac ─► avis
```

**État** :
- ✅ Routes complètes (checklist, photos, complete)
- ✅ Sage scan Google Drive auto → portfolio
- ❌ **GAP** : Sage timeout sur 170 fichiers (mémoire `project_sage_status`)
- ❌ **GAP** : pas de SMS travailleurs J-1 avec adresse + checklist

**Actions P1** :
1. Sage : queue + cursor pagination, 10 fichiers/batch.
2. Cron `/api/cron/worker-reminders` J-1 18h → SMS sous-traitants (PAS de SMS avant 8h/après 21h — mémoire `feedback_sms_hours`).

### 1.5 Tunnel Email Inbound (Aria responder)

```
Gmail (gestionnovusepoxy@gmail.com) ─► /api/cron/email-scan (15 min)
                                                            │
                                                            ├─► classify : lead | rdv | paiement | spam | autre
                                                            ├─► spam → trash (gmail.trash)
                                                            ├─► auto-reply → trash
                                                            ├─► autre → archive
                                                            ├─► rdv/paiement → Telegram alert
                                                            └─► lead → Aria responds AS Luca
```

**État** :
- ✅ Scan toutes 15 min via Vercel cron
- ✅ Cleanup auto (bounces, newsletters, FB, GitHub, Sentry, Vercel)
- ✅ Aria respond as Luca (mémoire `feedback_aria_auto_respond`)
- ✅ Daily summary AM + PM
- ✅ Gmail OAuth via kv_store (renewable via `/api/auth/google/start`)
- ❌ **GAP** : Aria utilise tier smart = avant Anthropic. Migrer vers Grok 4.20 (déjà fait via lib/llm.ts).

**Actions P0** :
1. Vérifier que `email-scan` n'a pas de fallback Anthropic.
2. Tester Aria sur 5 vrais emails après deploy.

### 1.6 Tunnel Chatbot Nova (site + Messenger)

```
visitor.novusepoxy.ca / Messenger ─► /api/chat ─► agent.ts (Nova)
                                              ├─► quick replies (espace, état, type)
                                              ├─► flux ordonné (mémoire feedback_chatbot_nova)
                                              └─► soumission ─► crm_leads
```

**État** :
- ✅ Nova flow strict (espace → état → type → confirmation → soumission)
- ✅ Quick replies sur Messenger
- ✅ Lead persistence sur fermeture
- ❌ **GAP** : pas de handoff vers SMS humain si question hors-script

**Actions P2** : détection "frustration" via fast-tier → escalade Telegram immédiate.

### 1.7 Tunnel Avis (Reviews)

```
travaux completed ─► /api/cron/avis ─► SMS demande review J+2
                                    │
                                    ├─► lien Google review
                                    └─► tracking `avis_envoye_at`
```

**État** : ✅ Working. Pas de gap critique.

### 1.8 Tunnel Référence

```
client satisfait (5★) ─► /api/cron/referral (lundi 16h) ─► SMS demande référence
```

**État** : ✅ Working.

### 1.9 Tunnel Comptabilité

```
expenses scan email ─► /api/expenses/scan (OCR)
bank statement CSV ─► /api/bank/import ─► auto-match crm ─► /api/bank/reconcile
recurring ─► /api/cron/recurring-expenses (daily)
workers heures ─► /api/equipe/heures ─► payés samedi (mémoire feedback_soustraitants)
```

**État** :
- ✅ Bank import + auto-match
- ✅ Recurring expenses cron
- ✅ Expense OCR scan
- ❌ **GAP** : pas de facture auto pour sous-traitants samedi
- ❌ **GAP** : pas d'export comptable automatique fin de mois

**Actions P1** :
1. Cron samedi 8h : génère facture PDF heures par sous-traitant + email + Interac request.
2. Cron 1er du mois : `/api/accounting/export` → email Luca.

### 1.10 Tunnel Mission Control (agents)

```
/dashboard/mission-control ─► cards : Aria, Hunter, Marcel, Iris, Sage, Echo, Denis, Nova, Jason, Zara, Bolt, Rex
                          ├─► live metrics
                          ├─► restart button
                          └─► logs/activity
```

**État** :
- ✅ 12 agents définis dans `VALID_AGENTS`
- ✅ Cards avec métriques (March 28 fix)
- ❌ **GAP** : pas de cost dashboard par agent (avec OpenRouter on aura les usage tokens, faisable)

**Actions P1** :
1. Logger usage tokens par agent dans `agent_calls` table.
2. Card affiche $/mois par agent.

---

## 2. Migration LLM — récap

| Call site | Tier actuel | Modèle (avant) | Modèle (après) |
|---|---|---|---|
| `lib/agent.ts:544` (Nova) | smart | claude-sonnet-4-5 | **x-ai/grok-4.20** |
| `api/cron/email-scan` | smart | claude-sonnet-4-5 | **x-ai/grok-4.20** |
| `api/marcel` | top (probable) | claude-opus-4 | **google/gemini-3.1-pro-preview** |
| `api/content/generate` | smart | claude-sonnet-4-5 | **x-ai/grok-4.20** |
| `api/leads/hunter` | smart | claude-sonnet-4-5 | **x-ai/grok-4.20** |
| `api/crm/leads/import` | bulk | deepseek-v3 | **deepseek/deepseek-v4-flash** |
| `api/submissions` | fast | gemini-flash-1.5-8b | **google/gemini-3.1-flash-lite** |
| `api/telegram/admin` | fast | gemini-flash-1.5-8b | **google/gemini-3.1-flash-lite** |
| `api/bank/import` | bulk | deepseek-v3 | **deepseek/deepseek-v4-flash** |
| `api/cron/lead-followup` | fast | gemini-flash-1.5-8b | **google/gemini-3.1-flash-lite** |
| `api/cron/health-check` | fast (ping) | gemini-flash-1.5-8b | **google/gemini-3.1-flash-lite** |

**Action P0** : aucun call site n'a besoin d'être modifié — `lib/llm.ts` réroute automatiquement. Juste **déployer**.

**Action P0bis** : vérifier qu'`OPENROUTER_API_KEY` est en place dans Vercel (déjà oui, sinon les call sites crashent à cause du removal du fallback Anthropic).

---

## 3. Goals & KPIs

### Goals (90 jours)
1. **0 lead perdu** : webhook + cron polling 100% uptime, Telegram alert si token expire.
2. **<5 min de réponse** au lead chaud (premier qui rappelle gagne — mémoire `feedback_leads_realtime`).
3. **30% taux close** sur leads chauds (vs ~15% baseline historique).
4. **Coût LLM <$60/mois** (vs ~$200 baseline).
5. **Gmail inbox <50 emails** non lus en permanence (cleanup auto + Aria responds).

### KPIs trackés (déjà ou à ajouter)
- `leads_count_24h`, `leads_chauds_count_24h`
- `temps_premier_contact_moyen` (ajouter — nouveau)
- `quote_to_close_rate_30d` (ajouter)
- `llm_cost_30d_$` par tier (ajouter — log dans `agent_calls`)
- `gmail_unread_count` (existe via `/api/gmail/inbox-stats`)

---

## 4. Roadmap d'exécution

### Semaine en cours (mai 25 → mai 31)
- [x] `lib/llm.ts` purge Anthropic → OpenRouter stack 2026
- [x] Composio whitelist FB/Meta/IG
- [ ] Deploy + smoke test (5 leads + 3 emails)
- [ ] Auto-score leads à l'import (P0 §1.1)
- [ ] Sage queue + pagination (P1 §1.4)

### Semaine 2 (juin 1 → juin 7)
- [ ] Cron worker-reminders J-1 (P1 §1.4)
- [ ] Cron samedi sous-traitants facture (P1 §1.9)
- [ ] Cost dashboard par agent (P1 §1.10)
- [ ] Cron export comptable 1er du mois (P1 §1.9)

### Semaine 3-4
- [ ] Relance auto "devis vu non accepté" (P1 §1.2)
- [ ] OCR Interac receipt → auto-match (P2 §1.3)
- [ ] Frustration detection chatbot (P2 §1.6)

### Backlog
- Meta Ads spend sync via Composio toolkit (P1)
- A/B test form FB
- A/B test structure devis

---

## 5. Notes opérationnelles

- **Push immédiat** après chaque commit (mémoire `feedback_push_immediately`).
- **Test live** chaque changement, pas juste lire le code (mémoire `feedback_test_live`).
- **Pas de SMS avant 8h ou après 21h** (mémoire `feedback_sms_hours`).
- **Twilio est PAYÉ** — ne plus jamais suggérer upgrade (mémoire `feedback_twilio_paid`).
- **Tous les emails depuis** `gestionnovusepoxy@gmail.com` via Gmail API (mémoire `feedback_email_from`).
- **Aria répond comme Luca** — pas modifier ses réponses sans instruction (mémoire `feedback_aria_responses_perfect`).

---

## 6. Env vars requises (Vercel)

```
OPENROUTER_API_KEY=sk-or-...            # REQUIS (no Anthropic fallback)

# Optionnels (overrides par tier)
OR_MODEL_TOP=google/gemini-3.1-pro-preview
OR_MODEL_SMART=x-ai/grok-4.20
OR_MODEL_MEDIUM=google/gemini-3-flash-preview
OR_MODEL_FAST=google/gemini-3.1-flash-lite
OR_MODEL_BULK=deepseek/deepseek-v4-flash

# Existing
META_PAGE_TOKEN=...
META_APP_SECRET=...
META_VERIFY_TOKEN=...
COMPOSIO_API_KEY=...
```

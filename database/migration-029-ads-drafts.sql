-- Migration 029: Meta Ads drafts table (approval workflow)
CREATE TABLE IF NOT EXISTS meta_ads_drafts (
  id              SERIAL PRIMARY KEY,
  -- Generated content
  service         VARCHAR(40),                 -- flake, metallique, etc.
  headline        VARCHAR(255),
  primary_text    TEXT,
  cta             VARCHAR(40) DEFAULT 'LEARN_MORE',  -- LEARN_MORE, SHOP_NOW, GET_QUOTE, MESSAGE_PAGE
  image_url       TEXT,                        -- Blob URL (Sage portfolio OR LLM-generated)
  image_source    VARCHAR(20),                 -- 'sage' or 'llm'
  image_prompt    TEXT,                        -- if LLM-generated
  -- Ad config
  daily_budget_usd NUMERIC(8,2) DEFAULT 50,
  target_audience JSONB,                       -- geo, age, interests
  duration_days   INT DEFAULT 7,
  -- Workflow
  statut          VARCHAR(20) NOT NULL DEFAULT 'brouillon',  -- brouillon, approve, lance, rejete, erreur
  approved_at     TIMESTAMPTZ,
  approved_by     VARCHAR(40),                 -- telegram user id who clicked
  launched_at     TIMESTAMPTZ,
  meta_campaign_id VARCHAR(60),
  meta_adset_id   VARCHAR(60),
  meta_ad_id      VARCHAR(60),
  error           TEXT,
  -- Performance (synced later)
  spend_usd       NUMERIC(8,2),
  impressions     INT,
  clicks          INT,
  leads_generated INT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_meta_ads_drafts_statut ON meta_ads_drafts(statut, created_at DESC);

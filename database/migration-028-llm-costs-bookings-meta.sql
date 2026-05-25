-- Migration 028: LLM cost tracking, bookings.employee_id, Meta Ads spend, quote views

-- 1) LLM call cost tracking (per-agent, per-tier)
CREATE TABLE IF NOT EXISTS llm_calls (
  id              BIGSERIAL PRIMARY KEY,
  agent           VARCHAR(40) NOT NULL,           -- 'aria', 'iris', 'marcel', 'sage', 'hunter', 'nova', 'system'
  tier            VARCHAR(10) NOT NULL,           -- 'bulk', 'fast', 'medium', 'smart', 'top'
  model           VARCHAR(80) NOT NULL,           -- 'x-ai/grok-4.20', etc.
  prompt_tokens   INT,
  completion_tokens INT,
  total_tokens    INT,
  latency_ms      INT,
  cost_usd        NUMERIC(10,6),                  -- estimated cost in USD
  trace_id        VARCHAR(80),                    -- Langfuse trace id
  trace_name      VARCHAR(120),
  error           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_llm_calls_agent_created ON llm_calls(agent, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_llm_calls_created ON llm_calls(created_at DESC);

-- 2) Bookings → optionally assign sous-traitants (JSON array of employee IDs)
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS employees_assignes INT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS rappel_workers_sent BOOLEAN NOT NULL DEFAULT FALSE;

-- 3) Meta Ads daily spend snapshot
CREATE TABLE IF NOT EXISTS meta_ads_spend (
  id            SERIAL PRIMARY KEY,
  date_day      DATE NOT NULL,
  ad_account_id VARCHAR(60),
  campaign_id   VARCHAR(60),
  campaign_name VARCHAR(255),
  spend_usd     NUMERIC(10,2) DEFAULT 0,
  spend_cad     NUMERIC(10,2) DEFAULT 0,
  impressions   INT DEFAULT 0,
  clicks        INT DEFAULT 0,
  leads_count   INT DEFAULT 0,
  cpl_cad       NUMERIC(10,2),                    -- cost per lead in CAD
  raw_data      JSONB,
  synced_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (date_day, campaign_id)
);
CREATE INDEX IF NOT EXISTS idx_meta_spend_date ON meta_ads_spend(date_day DESC);

-- 4) Quote views tracking (lightweight, already in track.ts but with our own table for relance logic)
CREATE TABLE IF NOT EXISTS quote_views (
  id          BIGSERIAL PRIMARY KEY,
  quote_id    INT NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  viewed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ip_hash     VARCHAR(64),
  user_agent  TEXT
);
CREATE INDEX IF NOT EXISTS idx_quote_views_quote ON quote_views(quote_id, viewed_at DESC);

-- 5) Track if a "viewed but not accepted" relance was sent (separate from generic relance_1/2)
ALTER TABLE quotes
  ADD COLUMN IF NOT EXISTS relance_vu_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS first_view_at TIMESTAMPTZ;

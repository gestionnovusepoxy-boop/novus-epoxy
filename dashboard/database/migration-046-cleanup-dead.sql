-- Migration 030: Cleanup dead tables + dead columns
-- Per ULTRAPLAN-V2 P1-4: drop tables 100% dead in production

-- 1) playing_with_neon — Neon default test table, 10 rows, 0 refs in code
DROP TABLE IF EXISTS playing_with_neon;

-- 2) auth_users — NextAuth Credentials uses env vars, table never queried
DROP TABLE IF EXISTS auth_users CASCADE;

-- 3) auth_verification_tokens — magic-link not used (Credentials only)
DROP TABLE IF EXISTS auth_verification_tokens CASCADE;

-- 4) quote_views — 100% broken, no INSERT in code, replaced by quotes.first_view_at
DROP TABLE IF EXISTS quote_views CASCADE;

-- 5) crm_leads.prospect_followup1_at / _2_at — dead columns from migration 018,
--    replaced by prospect_relance_1_at / _2_at
ALTER TABLE crm_leads DROP COLUMN IF EXISTS prospect_followup1_at;
ALTER TABLE crm_leads DROP COLUMN IF EXISTS prospect_followup2_at;

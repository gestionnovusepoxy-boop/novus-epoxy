-- Migration 056: UTM extra (utm_content + utm_term) sur submissions ET crm_leads.
-- Meta/Google passent utm_content (variante de pub/creative) et utm_term (mot-clé)
-- en plus de source/medium/campaign. On les capture pour mieux attribuer quelle
-- pub/creative génère les leads qui paient (croisé avec la CAPI).
-- Idempotent (ADD COLUMN IF NOT EXISTS) → ne casse rien d'existant, nullable.

ALTER TABLE submissions
  ADD COLUMN IF NOT EXISTS utm_content VARCHAR(120),
  ADD COLUMN IF NOT EXISTS utm_term    VARCHAR(120);

ALTER TABLE crm_leads
  ADD COLUMN IF NOT EXISTS utm_content VARCHAR(120),
  ADD COLUMN IF NOT EXISTS utm_term    VARCHAR(120);

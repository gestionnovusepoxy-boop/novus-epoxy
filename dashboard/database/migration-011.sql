-- Migration 011: Add contrat_signe status and contract fields to quotes
-- Run this in Neon SQL Editor

ALTER TABLE quotes DROP CONSTRAINT IF EXISTS quotes_statut_check;
ALTER TABLE quotes ADD CONSTRAINT quotes_statut_check
  CHECK (statut IN ('brouillon','en_attente','approuve','envoye','contrat_signe','depot_paye','planifie','complete','refuse'));

-- Add contract fields
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS contrat_signe_at TIMESTAMPTZ;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS contrat_signature_nom VARCHAR(120);

-- Add discount columns to quotes table (used by pricing.ts + promotions)
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS rabais_pct NUMERIC(5,2) DEFAULT 0;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS rabais_montant NUMERIC(10,2) DEFAULT 0;

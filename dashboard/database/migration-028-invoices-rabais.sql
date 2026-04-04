-- Add rabais columns to invoices table
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS rabais_pct NUMERIC(5,2) DEFAULT 0;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS rabais_montant NUMERIC(10,2) DEFAULT 0;

-- Backfill from quotes
UPDATE invoices SET rabais_pct = q.rabais_pct, rabais_montant = q.rabais_montant
FROM quotes q WHERE invoices.quote_id = q.id AND q.rabais_pct > 0;

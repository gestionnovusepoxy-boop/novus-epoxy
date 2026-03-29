-- Migration 022: Add invoice payment reminder tracking columns
-- Tracks the 3-stage automated reminder system for unpaid balances after deposit

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS relance_facture_1_at TIMESTAMPTZ;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS relance_facture_2_at TIMESTAMPTZ;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS relance_facture_3_at TIMESTAMPTZ;

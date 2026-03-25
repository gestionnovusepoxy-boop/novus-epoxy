-- Add signature image column to quotes table
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS contrat_signature_image TEXT;

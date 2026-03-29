-- Migration 024: Add description_travaux and couleur_flake to quotes
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS description_travaux TEXT;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS couleur_flake TEXT;

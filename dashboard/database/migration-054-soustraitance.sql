-- Migration 054: sous-traitance (contrats de sous-traitance = projets)
-- Un CONTRAT de sous-traitance = un PROJET dans la table existante `quotes` avec is_subcontract=true.
-- Réutilise toute l'infra existante (bookings, job_photos, invoices, expenses, time_entries liés à quote_id).
-- Les nouvelles colonnes sont nullable/avec défaut: le code de devis existant les ignore.

-- Table des fournisseurs d'ouvrage (partenaires, ex: JJ)
CREATE TABLE IF NOT EXISTS partners (
  id SERIAL PRIMARY KEY,
  nom VARCHAR(120) NOT NULL,
  telephone VARCHAR(30),
  email VARCHAR(255),
  split_defaut_pct NUMERIC(5,2) DEFAULT 50,
  actif BOOLEAN DEFAULT TRUE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Colonnes ajoutées à `quotes` pour transformer un devis en contrat de sous-traitance
ALTER TABLE quotes
  ADD COLUMN IF NOT EXISTS is_subcontract BOOLEAN DEFAULT FALSE;

ALTER TABLE quotes
  ADD COLUMN IF NOT EXISTS partner_id INT REFERENCES partners(id);

ALTER TABLE quotes
  ADD COLUMN IF NOT EXISTS contract_price NUMERIC(12,2);

ALTER TABLE quotes
  ADD COLUMN IF NOT EXISTS profit_split_pct NUMERIC(5,2) DEFAULT 50;

-- Index pour lister rapidement les contrats de sous-traitance
CREATE INDEX IF NOT EXISTS idx_quotes_is_subcontract ON quotes (is_subcontract) WHERE is_subcontract = TRUE;
CREATE INDEX IF NOT EXISTS idx_quotes_partner_id ON quotes (partner_id);

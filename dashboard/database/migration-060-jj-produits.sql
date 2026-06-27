-- Migration 060 — Sous-traitance JJ: modèle d'argent complet + produits/matériel
-- Le contrat (ex: 4000$) est séparé en deux: part Novus (main d'œuvre, paye les employés)
-- + part JJ (matériel). On suit les PRODUITS utilisés par chantier pour connaître le coût
-- matériel réel et vérifier que les calculs font du sens.

ALTER TABLE jj_chantiers ADD COLUMN IF NOT EXISTS montant_contrat NUMERIC NOT NULL DEFAULT 0; -- total du contrat
ALTER TABLE jj_chantiers ADD COLUMN IF NOT EXISTS montant_materiel NUMERIC NOT NULL DEFAULT 0; -- part JJ (matériel)
ALTER TABLE jj_workers ADD COLUMN IF NOT EXISTS equipe SMALLINT; -- équipe 1 ou 2 (logger les heures par équipe)

-- Catalogue de produits réutilisables (kit époxy, flake, etc.) avec coût par défaut.
CREATE TABLE IF NOT EXISTS jj_produits_catalogue (
  id              SERIAL PRIMARY KEY,
  nom             TEXT NOT NULL UNIQUE,
  cout_unitaire   NUMERIC NOT NULL DEFAULT 0,
  unite           TEXT DEFAULT 'unité',
  actif           BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Produits réellement utilisés par chantier.
CREATE TABLE IF NOT EXISTS jj_produits (
  id            SERIAL PRIMARY KEY,
  chantier_id   INTEGER NOT NULL REFERENCES jj_chantiers(id) ON DELETE CASCADE,
  nom           TEXT NOT NULL,
  quantite      NUMERIC NOT NULL DEFAULT 1,
  cout_unitaire NUMERIC NOT NULL DEFAULT 0,
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_jj_produits_chantier ON jj_produits(chantier_id);

-- Catalogue de départ (modifiable ensuite).
INSERT INTO jj_produits_catalogue (nom, cout_unitaire, unite) VALUES
  ('Kit époxy', 0, 'kit'),
  ('Boîte de flake', 0, 'boîte'),
  ('Kit LV (low viscosity)', 0, 'kit'),
  ('Crack filler', 0, 'unité'),
  ('Top coat', 0, 'gallon'),
  ('Polyaspartique', 0, 'gallon'),
  ('Primer', 0, 'gallon')
ON CONFLICT (nom) DO NOTHING;

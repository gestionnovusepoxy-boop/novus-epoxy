-- Migration 061 — Sous-traitance JJ: équipe par contrat, couleur, split % ajustable
-- (colonnes ajoutées pendant l'itération du 27 juin — modèle d'équité)

ALTER TABLE jj_chantiers ADD COLUMN IF NOT EXISTS equipe    SMALLINT;              -- équipe assignée au contrat
ALTER TABLE jj_chantiers ADD COLUMN IF NOT EXISTS couleur   TEXT;                  -- couleur du plancher
ALTER TABLE jj_chantiers ADD COLUMN IF NOT EXISTS split_pct NUMERIC NOT NULL DEFAULT 50; -- % part Novus (ajustable)
ALTER TABLE jj_workers   ADD COLUMN IF NOT EXISTS equipe    SMALLINT;              -- équipe 1 ou 2 du worker

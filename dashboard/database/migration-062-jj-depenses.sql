-- Migration 062 — Sous-traitance JJ: factures remboursables par JJ + couleur matériaux
-- Novus avance parfois des factures matériel (Canac...) que JJ doit rembourser.
-- On stocke JUSTE le sous-total (taxes ajoutées sur la facture finale à JJ).
-- Le remboursable s'ajoute à ce que JJ doit (part Novus 50% + remboursements).

CREATE TABLE IF NOT EXISTS jj_depenses (
  id             SERIAL PRIMARY KEY,
  chantier_id    INTEGER NOT NULL REFERENCES jj_chantiers(id) ON DELETE CASCADE,
  description    TEXT NOT NULL,
  sous_total     NUMERIC(10,2) NOT NULL DEFAULT 0,
  recu_url       TEXT,                                -- photo du reçu (optionnel)
  rembourse      BOOLEAN NOT NULL DEFAULT FALSE,
  date_rembourse DATE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_jj_depenses_chantier ON jj_depenses(chantier_id);

-- Couleur des matériaux utilisés (kit époxy gris/noir/blanc, flake coyote, etc.)
ALTER TABLE jj_produits ADD COLUMN IF NOT EXISTS couleur TEXT;

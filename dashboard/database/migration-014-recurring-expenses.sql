-- Migration 014: Recurring expenses
CREATE TABLE IF NOT EXISTS recurring_expenses (
  id             SERIAL PRIMARY KEY,
  fournisseur    VARCHAR(120) NOT NULL,
  description    TEXT,
  categorie      VARCHAR(60) NOT NULL,
  montant_ht     NUMERIC(10,2) NOT NULL,
  tps            NUMERIC(10,2) DEFAULT 0,
  tvq            NUMERIC(10,2) DEFAULT 0,
  montant_ttc    NUMERIC(10,2) NOT NULL,
  methode        VARCHAR(20),
  frequence      VARCHAR(20) NOT NULL DEFAULT 'mensuel', -- mensuel, hebdomadaire, annuel
  jour_du_mois   INT DEFAULT 1, -- 1-28 for monthly
  actif          BOOLEAN DEFAULT TRUE,
  derniere_creation DATE, -- last time an expense was auto-created
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

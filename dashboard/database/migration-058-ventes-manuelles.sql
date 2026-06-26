-- Migration 058: ventes manuelles (ventes faites HORS du systeme de devis).
-- Luca: "beaucoup de ventes ne sont PAS dans le systeme". Sans ces ventes, le
-- cerveau pub (lib/ad-brain.ts) analyse sur des donnees INCOMPLETES et
-- sous-estime ce qui vend reellement.
--
-- Cette table laisse logger une vente conclue (souvent FLAKE) que le funnel
-- devis n'a jamais touchee. lib/ad-brain.ts fait l'UNION avec les contrats
-- signes (quotes) pour byService/revenu => analyse sur donnees COMPLETES.
-- Idempotente: rejouable sans danger.

CREATE TABLE IF NOT EXISTS manual_sales (
  id SERIAL PRIMARY KEY,
  client_nom VARCHAR(160),
  service VARCHAR(60) NOT NULL,        -- flake, metallique, couleur_unie, quartz, commercial, etc.
  montant NUMERIC(12,2) NOT NULL,      -- revenu de la vente (avant ou sans taxes, peu importe — c'est le signal)
  source VARCHAR(60) DEFAULT 'manuel', -- d'ou vient la vente (facebook, reference, bouche-a-oreille, ...)
  date_vente DATE DEFAULT CURRENT_DATE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index pour les agregats par service / fenetre temporelle (utilise par ad-brain).
CREATE INDEX IF NOT EXISTS idx_manual_sales_service ON manual_sales (service);
CREATE INDEX IF NOT EXISTS idx_manual_sales_date_vente ON manual_sales (date_vente);

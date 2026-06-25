-- Migration 057: factures de sous-traitant (portail /partenaire)
-- Un sous-traitant peut déposer SES propres factures (heures travaillées) contre un contrat.
-- TABLE ISOLÉE: ne touche PAS la table officielle `invoices` (factures clients) ni ses CHECK.
-- Un contrat = un projet dans `quotes` avec is_subcontract=true, lié à un partner_id.
-- partner_invoices = la facturation horaire du sous-traitant (cf. workers payés à l'heure).

CREATE TABLE IF NOT EXISTS partner_invoices (
  id            SERIAL PRIMARY KEY,
  quote_id      INT NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  partner_id    INT NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  -- Contenu de la facture du sous-traitant
  description   TEXT,
  heures        NUMERIC(8,2),
  taux_horaire  NUMERIC(8,2),
  montant       NUMERIC(12,2) NOT NULL,
  -- Pièce jointe optionnelle (PDF/photo de facture)
  fichier_url   TEXT,
  fichier_nom   VARCHAR(255),
  statut        VARCHAR(20) NOT NULL DEFAULT 'soumise', -- soumise, approuvee, payee
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Lookup par contrat et par partenaire (isolation stricte côté requêtes)
CREATE INDEX IF NOT EXISTS idx_partner_invoices_quote   ON partner_invoices (quote_id);
CREATE INDEX IF NOT EXISTS idx_partner_invoices_partner ON partner_invoices (partner_id);

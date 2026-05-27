-- Migration 025: Quote items (multi-service) + extras
-- Allows multiple services and custom extras on a single quote

-- Quote line items (multiple services per quote)
CREATE TABLE IF NOT EXISTS quote_items (
  id SERIAL PRIMARY KEY,
  quote_id INTEGER NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  type_service VARCHAR(40) NOT NULL,
  superficie NUMERIC NOT NULL DEFAULT 0,
  prix_pied_carre NUMERIC NOT NULL DEFAULT 0,
  sous_total NUMERIC NOT NULL DEFAULT 0,
  description TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_quote_items_quote ON quote_items(quote_id);

-- Quote extras (custom line items with free-form name + price)
CREATE TABLE IF NOT EXISTS quote_extras (
  id SERIAL PRIMARY KEY,
  quote_id INTEGER NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  description VARCHAR(255) NOT NULL,
  quantite NUMERIC NOT NULL DEFAULT 1,
  prix_unitaire NUMERIC NOT NULL DEFAULT 0,
  sous_total NUMERIC NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_quote_extras_quote ON quote_extras(quote_id);

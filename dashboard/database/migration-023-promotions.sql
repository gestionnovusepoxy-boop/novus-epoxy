CREATE TABLE IF NOT EXISTS promotions (
  id SERIAL PRIMARY KEY,
  nom VARCHAR(120) NOT NULL,
  description TEXT,
  rabais_pct NUMERIC(5,2) NOT NULL DEFAULT 0,
  date_debut DATE NOT NULL,
  date_fin DATE NOT NULL,
  actif BOOLEAN DEFAULT TRUE,
  services TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed the April promo
INSERT INTO promotions (nom, description, rabais_pct, date_debut, date_fin, actif, services)
VALUES ('Rabais Avril 2026', 'Rabais de 20% sur toutes les installations pour le mois d''avril', 20, '2026-04-01', '2026-04-30', true, '{}')
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS campaigns (
  id SERIAL PRIMARY KEY,
  promotion_id INT REFERENCES promotions(id),
  nom VARCHAR(200),
  audience VARCHAR(40) NOT NULL,
  message TEXT,
  destinataires_count INT DEFAULT 0,
  sent_at TIMESTAMPTZ DEFAULT NOW()
);

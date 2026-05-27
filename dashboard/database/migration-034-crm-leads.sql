CREATE TABLE IF NOT EXISTS crm_leads (
  id SERIAL PRIMARY KEY,
  nom VARCHAR(120) NOT NULL,
  telephone VARCHAR(30),
  email VARCHAR(255),
  service VARCHAR(80),
  superficie VARCHAR(50),
  ville VARCHAR(120),
  notes TEXT,
  source VARCHAR(80) DEFAULT 'jason',
  statut VARCHAR(30) DEFAULT 'nouveau',
  temperature VARCHAR(10) DEFAULT 'tiede',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_crm_leads_statut ON crm_leads(statut);
CREATE INDEX IF NOT EXISTS idx_crm_leads_created ON crm_leads(created_at DESC);

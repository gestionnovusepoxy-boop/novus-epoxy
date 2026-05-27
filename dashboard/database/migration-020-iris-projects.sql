-- Migration 020: Iris Financial System — Projects, Time Tracking, Expense Linking
-- Enables per-project profit reports, employee hours, bank reconciliation

-- Employees table (for time tracking)
CREATE TABLE IF NOT EXISTS employees (
  id SERIAL PRIMARY KEY,
  nom VARCHAR(120) NOT NULL,
  telephone VARCHAR(30),
  role VARCHAR(60) DEFAULT 'installateur', -- proprietaire, installateur, aide, sous-traitant
  taux_horaire NUMERIC(6,2) DEFAULT 0, -- hourly rate for cost calculation
  actif BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed owners
INSERT INTO employees (nom, telephone, role, taux_horaire) VALUES
  ('Luca Hayes', '5813075983', 'proprietaire', 0),
  ('Jason Lanthier', '5813072678', 'proprietaire', 0)
ON CONFLICT DO NOTHING;

-- Time entries (punch in/out or manual hours per project)
CREATE TABLE IF NOT EXISTS time_entries (
  id SERIAL PRIMARY KEY,
  employee_id INT NOT NULL REFERENCES employees(id),
  quote_id INT REFERENCES quotes(id), -- linked to project/job
  date_travail DATE NOT NULL DEFAULT CURRENT_DATE,
  heure_debut TIME, -- punch in (nullable for manual entry)
  heure_fin TIME, -- punch out (nullable for manual entry)
  heures NUMERIC(4,1), -- total hours (auto-calculated or manual)
  type VARCHAR(20) DEFAULT 'travail', -- travail, deplacement, preparation, nettoyage
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Link expenses to projects (quotes)
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS quote_id INT REFERENCES quotes(id);

-- Index for fast project expense lookups
CREATE INDEX IF NOT EXISTS idx_expenses_quote_id ON expenses(quote_id);
CREATE INDEX IF NOT EXISTS idx_time_entries_quote_id ON time_entries(quote_id);
CREATE INDEX IF NOT EXISTS idx_time_entries_employee_id ON time_entries(employee_id);
CREATE INDEX IF NOT EXISTS idx_time_entries_date ON time_entries(date_travail);

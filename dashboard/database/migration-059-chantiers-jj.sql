-- Migration 059 — Sous-traitance JJ (partenaire Epoxy JJ)
-- Système DÉDIÉ et SÉPARÉ de Novus: JJ vend + paye le matériel, les workers NOVUS
-- fournissent la main d'œuvre. Pas de suivi client (aucun CRM/email).
-- 2 équipes, multi-jours ajustables (AM/PM/journée ou heures précises), photos avant/après.
-- Les heures servent à calculer COMBIEN PAYER LES EMPLOYÉS (heures × taux), réutilise
-- la table `employees` existante de Novus.

CREATE TABLE IF NOT EXISTS jj_chantiers (
  id                   SERIAL PRIMARY KEY,
  client_nom           TEXT NOT NULL,
  client_tel           TEXT,
  adresse              TEXT,
  ville                TEXT,
  service              TEXT,
  superficie           NUMERIC,
  montant_main_oeuvre  NUMERIC NOT NULL DEFAULT 0,   -- ce que JJ paye Novus (main d'œuvre)
  depot_recu           BOOLEAN NOT NULL DEFAULT FALSE,
  depot_montant        NUMERIC NOT NULL DEFAULT 0,
  statut               TEXT NOT NULL DEFAULT 'a_planifier'
                         CHECK (statut IN ('a_planifier','planifie','en_cours','complete','paye')),
  paye                 BOOLEAN NOT NULL DEFAULT FALSE, -- JJ a payé Novus
  date_paye            DATE,
  photos_avant         JSONB NOT NULL DEFAULT '[]'::jsonb,
  photos_apres         JSONB NOT NULL DEFAULT '[]'::jsonb,
  notes                TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS jj_planning (
  id           SERIAL PRIMARY KEY,
  chantier_id  INTEGER NOT NULL REFERENCES jj_chantiers(id) ON DELETE CASCADE,
  date         DATE NOT NULL,
  equipe       SMALLINT NOT NULL DEFAULT 1,
  slot         TEXT NOT NULL DEFAULT 'am' CHECK (slot IN ('am','pm','journee','custom')),
  heure_debut  TEXT,
  heure_fin    TEXT,
  jour_numero  SMALLINT NOT NULL DEFAULT 1,
  notes        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Liste d'employés JJ — SÉPARÉE de Novus, gérée par Luca (ajouter/renommer/ajuster taux).
CREATE TABLE IF NOT EXISTS jj_workers (
  id           SERIAL PRIMARY KEY,
  nom          TEXT NOT NULL,
  taux_horaire NUMERIC NOT NULL DEFAULT 0,
  telephone    TEXT,
  actif        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Heures travaillées par employé (entrées À LA MAIN chaque jour) → calcul de la paie.
-- But: savoir COMBIEN PAYER chaque employé (heures × taux). Pas lié au rapport projet Novus.
CREATE TABLE IF NOT EXISTS jj_heures (
  id           SERIAL PRIMARY KEY,
  worker_id    INTEGER NOT NULL REFERENCES jj_workers(id) ON DELETE CASCADE,
  chantier_id  INTEGER REFERENCES jj_chantiers(id) ON DELETE SET NULL,
  equipe       SMALLINT,
  date         DATE NOT NULL,
  heures       NUMERIC NOT NULL DEFAULT 0,
  taux_horaire NUMERIC NOT NULL DEFAULT 0,  -- snapshot du taux au moment de l'entrée
  paye         BOOLEAN NOT NULL DEFAULT FALSE, -- l'employé a-t-il été payé (samedi)
  notes        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_jj_planning_date ON jj_planning(date);
CREATE INDEX IF NOT EXISTS idx_jj_planning_chantier ON jj_planning(chantier_id);
CREATE INDEX IF NOT EXISTS idx_jj_chantiers_statut ON jj_chantiers(statut);
CREATE INDEX IF NOT EXISTS idx_jj_heures_employee ON jj_heures(employee_id);
CREATE INDEX IF NOT EXISTS idx_jj_heures_date ON jj_heures(date);

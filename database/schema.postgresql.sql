-- ============================================================
-- Novus Epoxy — Schéma PostgreSQL (Neon)
-- Coller dans l'éditeur SQL de Neon (neon.tech → SQL Editor)
-- ============================================================

CREATE TABLE IF NOT EXISTS submissions (
  id          SERIAL PRIMARY KEY,
  nom         VARCHAR(120) NOT NULL,
  email       VARCHAR(255) NOT NULL,
  telephone   VARCHAR(30),
  message     TEXT,
  service     VARCHAR(80),
  statut      VARCHAR(20) NOT NULL DEFAULT 'nouveau'
                CHECK (statut IN ('nouveau','lu','en_traitement','ferme')),
  ip_hash     CHAR(64),
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_submissions_statut    ON submissions(statut);
CREATE INDEX IF NOT EXISTS idx_submissions_created   ON submissions(created_at);

-- Trigger updated_at automatique
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_submissions_updated_at
  BEFORE UPDATE ON submissions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ----

CREATE TABLE IF NOT EXISTS email_logs (
  id            SERIAL PRIMARY KEY,
  resend_id     VARCHAR(100) UNIQUE,
  destinataire  VARCHAR(255) NOT NULL,
  sujet         VARCHAR(500),
  statut        VARCHAR(20) NOT NULL DEFAULT 'sent'
                  CHECK (statut IN ('sent','delivered','opened','clicked','bounced','complained')),
  submission_id INT REFERENCES submissions(id) ON DELETE SET NULL,
  opened_at     TIMESTAMPTZ,
  clicked_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_logs_resend_id ON email_logs(resend_id);
CREATE INDEX IF NOT EXISTS idx_email_logs_statut    ON email_logs(statut);

-- ----

CREATE TABLE IF NOT EXISTS page_views (
  id           BIGSERIAL PRIMARY KEY,
  url_path     VARCHAR(500) NOT NULL,
  referrer     VARCHAR(500),
  user_agent   VARCHAR(500),
  visitor_hash CHAR(64),
  session_hash CHAR(64),
  duree_sec    SMALLINT,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_page_views_path      ON page_views(url_path);
CREATE INDEX IF NOT EXISTS idx_page_views_created   ON page_views(created_at);
CREATE INDEX IF NOT EXISTS idx_page_views_visitor   ON page_views(visitor_hash);

-- ----

CREATE TABLE IF NOT EXISTS events (
  id           BIGSERIAL PRIMARY KEY,
  type         VARCHAR(80) NOT NULL,
  url_path     VARCHAR(500),
  valeur       VARCHAR(255),
  visitor_hash CHAR(64),
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_events_type    ON events(type);
CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at);

-- ----

CREATE TABLE IF NOT EXISTS quotes (
  id              SERIAL PRIMARY KEY,
  client_nom      VARCHAR(120) NOT NULL,
  client_email    VARCHAR(255) NOT NULL,
  client_tel      VARCHAR(30),
  client_adresse  TEXT,
  type_service    VARCHAR(40) NOT NULL CHECK (type_service IN ('flake','metallique','commercial')),
  superficie      NUMERIC(10,2) NOT NULL,
  etat_plancher   TEXT,
  notes           TEXT,
  prix_pied_carre NUMERIC(6,2) NOT NULL,
  sous_total      NUMERIC(10,2) NOT NULL,
  tps             NUMERIC(10,2) NOT NULL,
  tvq             NUMERIC(10,2) NOT NULL,
  total           NUMERIC(10,2) NOT NULL,
  depot_requis    NUMERIC(10,2) NOT NULL,
  statut          VARCHAR(20) NOT NULL DEFAULT 'brouillon'
                    CHECK (statut IN ('brouillon','en_attente','approuve','envoye','depot_paye','planifie','complete','refuse')),
  submission_id   INT REFERENCES submissions(id) ON DELETE SET NULL,
  approved_at     TIMESTAMPTZ,
  sent_at         TIMESTAMPTZ,
  paid_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_quotes_statut  ON quotes(statut);
CREATE INDEX IF NOT EXISTS idx_quotes_created ON quotes(created_at);
CREATE INDEX IF NOT EXISTS idx_quotes_email   ON quotes(client_email);

CREATE OR REPLACE TRIGGER trg_quotes_updated_at
  BEFORE UPDATE ON quotes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

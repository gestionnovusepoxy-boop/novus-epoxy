-- ============================================================
-- Migration 002 — Nouvelles tables (conversations, clients, invoices, etc.)
-- Coller dans Neon SQL Editor
-- ============================================================

-- Clients
CREATE TABLE IF NOT EXISTS clients (
  id          SERIAL PRIMARY KEY,
  nom         VARCHAR(120) NOT NULL,
  email       VARCHAR(255),
  telephone   VARCHAR(30),
  adresse     TEXT,
  notes       TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_clients_email ON clients(email);

CREATE OR REPLACE TRIGGER trg_clients_updated_at
  BEFORE UPDATE ON clients
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Conversations (agent IA)
CREATE TABLE IF NOT EXISTS conversations (
  id              SERIAL PRIMARY KEY,
  channel         VARCHAR(20) NOT NULL DEFAULT 'web' CHECK (channel IN ('web','messenger','email')),
  visitor_id      VARCHAR(100) NOT NULL,
  visitor_name    VARCHAR(120),
  visitor_email   VARCHAR(255),
  visitor_tel     VARCHAR(30),
  visitor_adresse TEXT,
  type_service    VARCHAR(40),
  superficie      NUMERIC(10,2),
  etat_plancher   TEXT,
  quote_id        INT REFERENCES quotes(id) ON DELETE SET NULL,
  submission_id   INT REFERENCES submissions(id) ON DELETE SET NULL,
  status          VARCHAR(30) NOT NULL DEFAULT 'active' CHECK (status IN ('active','pending_approval','quote_sent','closed')),
  lead_temp       VARCHAR(10) NOT NULL DEFAULT 'cold' CHECK (lead_temp IN ('cold','warm','hot')),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conversations_visitor  ON conversations(visitor_id);
CREATE INDEX IF NOT EXISTS idx_conversations_status   ON conversations(status);
CREATE INDEX IF NOT EXISTS idx_conversations_channel  ON conversations(channel);

CREATE OR REPLACE TRIGGER trg_conversations_updated_at
  BEFORE UPDATE ON conversations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Messages (chat)
CREATE TABLE IF NOT EXISTS messages (
  id              SERIAL PRIMARY KEY,
  conversation_id INT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role            VARCHAR(20) NOT NULL CHECK (role IN ('user','assistant','system')),
  content         TEXT NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);

-- Invoices (factures)
CREATE TABLE IF NOT EXISTS invoices (
  id              SERIAL PRIMARY KEY,
  numero          VARCHAR(20) UNIQUE NOT NULL,
  quote_id        INT REFERENCES quotes(id) ON DELETE SET NULL,
  client_id       INT REFERENCES clients(id) ON DELETE SET NULL,
  type_service    VARCHAR(40),
  superficie      NUMERIC(10,2),
  prix_pied_carre NUMERIC(6,2),
  sous_total      NUMERIC(10,2) NOT NULL,
  tps             NUMERIC(10,2) NOT NULL,
  tvq             NUMERIC(10,2) NOT NULL,
  total           NUMERIC(10,2) NOT NULL,
  depot_montant   NUMERIC(10,2),
  depot_paye      BOOLEAN DEFAULT FALSE,
  depot_paye_at   TIMESTAMPTZ,
  depot_methode   VARCHAR(20),
  final_montant   NUMERIC(10,2),
  final_paye      BOOLEAN DEFAULT FALSE,
  final_paye_at   TIMESTAMPTZ,
  final_methode   VARCHAR(20),
  statut          VARCHAR(30) NOT NULL DEFAULT 'brouillon'
                    CHECK (statut IN ('brouillon','envoyee','depot_recu','travaux_en_cours','completee','annulee')),
  notes           TEXT,
  date_emission   DATE DEFAULT CURRENT_DATE,
  date_echeance   DATE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_invoices_statut    ON invoices(statut);
CREATE INDEX IF NOT EXISTS idx_invoices_client    ON invoices(client_id);
CREATE INDEX IF NOT EXISTS idx_invoices_numero    ON invoices(numero);

CREATE OR REPLACE TRIGGER trg_invoices_updated_at
  BEFORE UPDATE ON invoices
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Payments
CREATE TABLE IF NOT EXISTS payments (
  id          SERIAL PRIMARY KEY,
  invoice_id  INT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  type        VARCHAR(10) NOT NULL CHECK (type IN ('depot','final')),
  montant     NUMERIC(10,2) NOT NULL,
  methode     VARCHAR(20) CHECK (methode IN ('virement','cheque','comptant','carte','autre')),
  reference   VARCHAR(100),
  notes       TEXT,
  paid_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payments(invoice_id);

-- Expenses (depenses)
CREATE TABLE IF NOT EXISTS expenses (
  id             SERIAL PRIMARY KEY,
  date_depense   DATE NOT NULL DEFAULT CURRENT_DATE,
  fournisseur    VARCHAR(120),
  description    TEXT,
  categorie      VARCHAR(60),
  montant_ht     NUMERIC(10,2),
  tps            NUMERIC(10,2),
  tvq            NUMERIC(10,2),
  montant_ttc    NUMERIC(10,2) NOT NULL,
  methode        VARCHAR(20),
  reference      VARCHAR(100),
  reconciled     BOOLEAN DEFAULT FALSE,
  transaction_id INT,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_expenses_date      ON expenses(date_depense);
CREATE INDEX IF NOT EXISTS idx_expenses_categorie ON expenses(categorie);

CREATE OR REPLACE TRIGGER trg_expenses_updated_at
  BEFORE UPDATE ON expenses
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Bank transactions
CREATE TABLE IF NOT EXISTS bank_transactions (
  id          SERIAL PRIMARY KEY,
  date_tx     DATE NOT NULL,
  description TEXT,
  montant     NUMERIC(10,2) NOT NULL,
  type        VARCHAR(10) NOT NULL CHECK (type IN ('credit','debit')),
  reference   VARCHAR(100),
  reconciled  BOOLEAN DEFAULT FALSE,
  invoice_id  INT REFERENCES invoices(id) ON DELETE SET NULL,
  expense_id  INT REFERENCES expenses(id) ON DELETE SET NULL,
  payment_id  INT REFERENCES payments(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bank_tx_date       ON bank_transactions(date_tx);
CREATE INDEX IF NOT EXISTS idx_bank_tx_reconciled ON bank_transactions(reconciled);

-- Add FK from expenses to bank_transactions
ALTER TABLE expenses
  ADD CONSTRAINT fk_expenses_transaction
  FOREIGN KEY (transaction_id) REFERENCES bank_transactions(id) ON DELETE SET NULL;

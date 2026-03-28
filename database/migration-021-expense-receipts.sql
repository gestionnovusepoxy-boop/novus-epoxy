-- Migration 021: Expense receipts, invoice linking, Gmail push support
-- Stores receipt URLs (Vercel Blob), links expenses to invoices for project reports

-- Receipt storage (Vercel Blob URL)
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS receipt_url TEXT;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS receipt_filename VARCHAR(255);

-- Link expense to invoice (for project-based reporting)
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS invoice_id INT REFERENCES invoices(id);

-- Flag for expenses pending project assignment
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS pending_project BOOLEAN DEFAULT FALSE;

-- Source tracking (manual, email-scan, recurring, photo-scan)
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS source VARCHAR(40) DEFAULT 'manual';

-- Gmail message ID to prevent reprocessing
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS gmail_msg_id VARCHAR(100);

CREATE INDEX IF NOT EXISTS idx_expenses_invoice_id ON expenses(invoice_id);
CREATE INDEX IF NOT EXISTS idx_expenses_pending ON expenses(pending_project) WHERE pending_project = TRUE;
CREATE INDEX IF NOT EXISTS idx_expenses_gmail_msg ON expenses(gmail_msg_id);

ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS type VARCHAR(20) DEFAULT 'residentiel';
CREATE INDEX IF NOT EXISTS idx_crm_leads_type ON crm_leads(type);

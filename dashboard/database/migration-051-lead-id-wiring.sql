-- migration-051-lead-id-wiring.sql
--
-- Wire crm_leads directly into email_logs, quotes, conversations
-- so the timeline API + lead-hygiene + analytics queries can use a single
-- index lookup instead of fragile email/phone JOIN matching.
--
-- Idempotent: each ALTER + CREATE INDEX uses IF NOT EXISTS where supported.

-- 1. Add lead_id columns (nullable so old rows aren't blocked)
ALTER TABLE email_logs    ADD COLUMN IF NOT EXISTS lead_id INTEGER REFERENCES crm_leads(id) ON DELETE SET NULL;
ALTER TABLE quotes        ADD COLUMN IF NOT EXISTS lead_id INTEGER REFERENCES crm_leads(id) ON DELETE SET NULL;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS lead_id INTEGER REFERENCES crm_leads(id) ON DELETE SET NULL;

-- 2. Indexes for fast lookup
CREATE INDEX IF NOT EXISTS idx_email_logs_lead_id    ON email_logs(lead_id);
CREATE INDEX IF NOT EXISTS idx_quotes_lead_id        ON quotes(lead_id);
CREATE INDEX IF NOT EXISTS idx_conversations_lead_id ON conversations(lead_id);
CREATE INDEX IF NOT EXISTS idx_sms_logs_lead_id      ON sms_logs(lead_id);

-- 3. Backfill — link existing rows to crm_leads where the email/phone matches.
-- Uses LATERAL to pick the BEST-matching lead (most recent crm_leads.id) when
-- multiple leads share the same email/phone.

-- email_logs: match by destinataire (case-insensitive)
UPDATE email_logs e
   SET lead_id = c.id
  FROM crm_leads c
 WHERE e.lead_id IS NULL
   AND e.destinataire IS NOT NULL AND e.destinataire != ''
   AND c.email IS NOT NULL AND c.email != ''
   AND LOWER(c.email) = LOWER(e.destinataire);

-- quotes: match by client_email or client_tel
UPDATE quotes q
   SET lead_id = c.id
  FROM crm_leads c
 WHERE q.lead_id IS NULL
   AND ((q.client_email IS NOT NULL AND q.client_email != ''
         AND LOWER(c.email) = LOWER(q.client_email))
     OR (q.client_tel IS NOT NULL AND q.client_tel != ''
         AND regexp_replace(COALESCE(c.telephone,''),'[^0-9]','','g')
           = regexp_replace(COALESCE(q.client_tel,''),'[^0-9]','','g')
         AND regexp_replace(COALESCE(q.client_tel,''),'[^0-9]','','g') != ''));

-- conversations: match by visitor_email or visitor_tel
UPDATE conversations cv
   SET lead_id = c.id
  FROM crm_leads c
 WHERE cv.lead_id IS NULL
   AND ((cv.visitor_email IS NOT NULL AND cv.visitor_email != ''
         AND LOWER(c.email) = LOWER(cv.visitor_email))
     OR (cv.visitor_tel IS NOT NULL AND cv.visitor_tel != ''
         AND regexp_replace(COALESCE(c.telephone,''),'[^0-9]','','g')
           = regexp_replace(COALESCE(cv.visitor_tel,''),'[^0-9]','','g')
         AND regexp_replace(COALESCE(cv.visitor_tel,''),'[^0-9]','','g') != ''));

-- sms_logs: backfill missing lead_id by phone match
UPDATE sms_logs s
   SET lead_id = c.id
  FROM crm_leads c
 WHERE s.lead_id IS NULL
   AND regexp_replace(COALESCE(c.telephone,''),'[^0-9]','','g') != ''
   AND (regexp_replace(COALESCE(c.telephone,''),'[^0-9]','','g')
         = regexp_replace(COALESCE(s.from_number,''),'[^0-9]','','g')
     OR regexp_replace(COALESCE(c.telephone,''),'[^0-9]','','g')
         = regexp_replace(COALESCE(s.to_number,''),'[^0-9]','','g'));

-- Record in schema_migrations
INSERT INTO schema_migrations (filename) VALUES ('migration-051-lead-id-wiring.sql')
  ON CONFLICT (filename) DO NOTHING;

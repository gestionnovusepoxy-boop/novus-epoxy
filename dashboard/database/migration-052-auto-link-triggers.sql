-- migration-052-auto-link-triggers.sql
--
-- Triggers BEFORE INSERT qui auto-populent lead_id sur:
--   - email_logs (par destinataire)
--   - quotes (par client_email OU client_tel)
--   - conversations (par visitor_email OU visitor_tel)
--   - sms_logs (par from_number OU to_number)
--
-- Garantit que CHAQUE nouvelle ligne est wired au CRM sans backfill,
-- même si le code applicatif oublie de set lead_id à la création.

CREATE OR REPLACE FUNCTION auto_link_email_lead() RETURNS trigger AS $$
BEGIN
  IF NEW.lead_id IS NULL AND NEW.destinataire IS NOT NULL AND NEW.destinataire != '' THEN
    SELECT id INTO NEW.lead_id FROM crm_leads
     WHERE LOWER(email) = LOWER(NEW.destinataire)
     ORDER BY created_at DESC LIMIT 1;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_email_logs_auto_lead ON email_logs;
CREATE TRIGGER trg_email_logs_auto_lead BEFORE INSERT ON email_logs
  FOR EACH ROW EXECUTE FUNCTION auto_link_email_lead();

CREATE OR REPLACE FUNCTION auto_link_quote_lead() RETURNS trigger AS $$
BEGIN
  IF NEW.lead_id IS NULL THEN
    SELECT id INTO NEW.lead_id FROM crm_leads
     WHERE (NEW.client_email IS NOT NULL AND NEW.client_email != ''
            AND LOWER(email) = LOWER(NEW.client_email))
        OR (NEW.client_tel IS NOT NULL AND NEW.client_tel != ''
            AND regexp_replace(COALESCE(telephone,''),'[^0-9]','','g')
              = regexp_replace(NEW.client_tel,'[^0-9]','','g')
            AND regexp_replace(NEW.client_tel,'[^0-9]','','g') != '')
     ORDER BY created_at DESC LIMIT 1;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_quotes_auto_lead ON quotes;
CREATE TRIGGER trg_quotes_auto_lead BEFORE INSERT ON quotes
  FOR EACH ROW EXECUTE FUNCTION auto_link_quote_lead();

CREATE OR REPLACE FUNCTION auto_link_conversation_lead() RETURNS trigger AS $$
BEGIN
  IF NEW.lead_id IS NULL THEN
    SELECT id INTO NEW.lead_id FROM crm_leads
     WHERE (NEW.visitor_email IS NOT NULL AND NEW.visitor_email != ''
            AND LOWER(email) = LOWER(NEW.visitor_email))
        OR (NEW.visitor_tel IS NOT NULL AND NEW.visitor_tel != ''
            AND regexp_replace(COALESCE(telephone,''),'[^0-9]','','g')
              = regexp_replace(NEW.visitor_tel,'[^0-9]','','g')
            AND regexp_replace(NEW.visitor_tel,'[^0-9]','','g') != '')
     ORDER BY created_at DESC LIMIT 1;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_conversations_auto_lead ON conversations;
CREATE TRIGGER trg_conversations_auto_lead BEFORE INSERT ON conversations
  FOR EACH ROW EXECUTE FUNCTION auto_link_conversation_lead();

CREATE OR REPLACE FUNCTION auto_link_sms_lead() RETURNS trigger AS $$
BEGIN
  IF NEW.lead_id IS NULL THEN
    SELECT id INTO NEW.lead_id FROM crm_leads
     WHERE regexp_replace(COALESCE(telephone,''),'[^0-9]','','g') != ''
       AND (regexp_replace(COALESCE(telephone,''),'[^0-9]','','g')
             = regexp_replace(COALESCE(NEW.from_number,''),'[^0-9]','','g')
         OR regexp_replace(COALESCE(telephone,''),'[^0-9]','','g')
             = regexp_replace(COALESCE(NEW.to_number,''),'[^0-9]','','g'))
     ORDER BY created_at DESC LIMIT 1;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_sms_logs_auto_lead ON sms_logs;
CREATE TRIGGER trg_sms_logs_auto_lead BEFORE INSERT ON sms_logs
  FOR EACH ROW EXECUTE FUNCTION auto_link_sms_lead();

INSERT INTO schema_migrations (filename) VALUES ('migration-052-auto-link-triggers.sql')
  ON CONFLICT (filename) DO NOTHING;

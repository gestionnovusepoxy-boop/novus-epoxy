-- Add email content columns for viewing sent/received emails
ALTER TABLE email_logs ADD COLUMN IF NOT EXISTS html_body TEXT;
ALTER TABLE email_logs ADD COLUMN IF NOT EXISTS reply_body TEXT;
ALTER TABLE email_logs ADD COLUMN IF NOT EXISTS direction VARCHAR(10) DEFAULT 'outbound';

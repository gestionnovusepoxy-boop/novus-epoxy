-- Add referral_sms_sent column to bookings table for 6-month referral SMS tracking
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS referral_sms_sent BOOLEAN DEFAULT FALSE;

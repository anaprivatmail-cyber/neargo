-- migrate_calendar_security.sql
-- Adds token expiry for provider_calendars and analytics events table
-- Also creates a helper index for provider_reservations by email/time for rate limiting

ALTER TABLE IF EXISTS public.provider_calendars
  ADD COLUMN IF NOT EXISTS token_expires_at TIMESTAMPTZ;

-- Reservation analytics (created/cancelled)
CREATE TABLE IF NOT EXISTS public.provider_reservation_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id UUID,
  calendar_id UUID,
  slot_id UUID,
  reserved_email TEXT,
  event TEXT NOT NULL CHECK (event IN ('created','cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS provider_reservation_events_calendar_idx ON public.provider_reservation_events(calendar_id, created_at DESC);
CREATE INDEX IF NOT EXISTS provider_reservation_events_email_idx ON public.provider_reservation_events(reserved_email, created_at DESC);

-- Helpful for rate limiting queries
CREATE INDEX IF NOT EXISTS provider_reservations_email_time_idx ON public.provider_reservations(reserved_email, status, reserved_at DESC);

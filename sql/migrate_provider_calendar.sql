-- migrate_provider_calendar.sql
-- NearGo: internal provider calendars, slots, reservations
-- Creates tables for calendar-based booking (Pro feature) but usable by free providers (limited UI).

-- Safety: create if not exists; simple enum constraints via CHECK.

CREATE TABLE IF NOT EXISTS public.provider_calendars (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_email TEXT NOT NULL,
  title TEXT,
  event_submission_key TEXT, -- storage key of original submission JSON (for lookup)
  edit_token TEXT,           -- token giving provider rights to modify slots (mirrors submission edit token)
  stats_token TEXT,          -- token tying analytics queries
  plan TEXT,                 -- grow|pro|null (for future feature gating)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS provider_calendars_provider_idx ON public.provider_calendars(provider_email);
CREATE INDEX IF NOT EXISTS provider_calendars_edit_token_idx ON public.provider_calendars(edit_token);

CREATE TABLE IF NOT EXISTS public.provider_slots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  calendar_id UUID NOT NULL REFERENCES public.provider_calendars(id) ON DELETE CASCADE,
  start_time TIMESTAMPTZ NOT NULL,
  end_time   TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'free' CHECK (status IN ('free','reserved','blocked')),
  reserved_email TEXT,
  reserved_at TIMESTAMPTZ,
  coupon_token TEXT, -- if a coupon was auto-issued for premium user
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS provider_slots_unique_time ON public.provider_slots(calendar_id, start_time, end_time);
CREATE INDEX IF NOT EXISTS provider_slots_calendar_status_idx ON public.provider_slots(calendar_id, status, start_time);

CREATE TABLE IF NOT EXISTS public.provider_reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slot_id UUID NOT NULL REFERENCES public.provider_slots(id) ON DELETE CASCADE,
  calendar_id UUID NOT NULL REFERENCES public.provider_calendars(id) ON DELETE CASCADE,
  reserved_email TEXT NOT NULL,
  reserved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  coupon_token TEXT,
  premium BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','cancelled')),
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS provider_reservations_calendar_idx ON public.provider_reservations(calendar_id, reserved_at DESC);
CREATE INDEX IF NOT EXISTS provider_reservations_email_idx ON public.provider_reservations(reserved_email, reserved_at DESC);
CREATE INDEX IF NOT EXISTS provider_reservations_slot_idx ON public.provider_reservations(slot_id);

-- Simple helper view: upcoming free slots (non-blocked) for public listing
CREATE OR REPLACE VIEW public.view_calendar_upcoming_free AS
SELECT s.id AS slot_id, s.calendar_id, c.title, s.start_time, s.end_time
FROM public.provider_slots s
JOIN public.provider_calendars c ON c.id = s.calendar_id
WHERE s.status = 'free' AND s.start_time >= now()
ORDER BY s.start_time ASC;

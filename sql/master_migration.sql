-- MASTER MIGRATION: NearGo core schema (idempotent)
-- Goal: robust, global-ready schema for high concurrency & future features.
-- Safe to run multiple times (uses IF NOT EXISTS / ADD COLUMN IF NOT EXISTS / CREATE OR REPLACE).
-- Run in Supabase SQL editor. Adjust RLS policies after creation.

CREATE EXTENSION IF NOT EXISTS pgcrypto; -- UUID generation
CREATE EXTENSION IF NOT EXISTS pg_stat_statements; -- optional perf insight

/* ===================== USERS (placeholder if not yet) ===================== */
-- Supabase often provides public.users. We reference it; avoid redefining.
-- If missing and you want a local auth table, uncomment below.
-- CREATE TABLE IF NOT EXISTS public.users (
--   id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
--   email text UNIQUE,
--   created_at timestamptz NOT NULL DEFAULT now()
-- );

/* ===================== EVENTS ===================== */
CREATE TABLE IF NOT EXISTS public.events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text,
  city text,
  country text,
  venue text,
  subcategory text,
  organizer_email text,
  featured boolean NOT NULL DEFAULT false,
  start timestamptz,
  end timestamptz,
  published_at timestamptz,
  image_public_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS events_city_idx ON public.events (city);
CREATE INDEX IF NOT EXISTS events_published_idx ON public.events (published_at DESC);
CREATE INDEX IF NOT EXISTS events_featured_idx ON public.events (featured) WHERE featured;
CREATE OR REPLACE FUNCTION public.events_touch_updated() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at := now(); RETURN NEW; END; $$;
DROP TRIGGER IF EXISTS events_touch_updated_trg ON public.events;
CREATE TRIGGER events_touch_updated_trg BEFORE UPDATE ON public.events FOR EACH ROW EXECUTE FUNCTION public.events_touch_updated();

/* ===================== OFFERS (simplified if missing) ===================== */
-- Only ensure columns used by checker exist; assume existing table else.
CREATE TABLE IF NOT EXISTS public.offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text,
  subcategory text,
  publish_at timestamptz,
  venue_lat double precision,
  venue_lon double precision,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS offers_publish_idx ON public.offers (publish_at DESC);
CREATE INDEX IF NOT EXISTS offers_subcategory_idx ON public.offers (subcategory);

/* ===================== TICKETS ===================== */
CREATE TABLE IF NOT EXISTS public.tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text,
  email text,
  token text UNIQUE,
  redeemed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tickets_email_idx ON public.tickets (email);
CREATE INDEX IF NOT EXISTS tickets_token_not_redeemed_idx ON public.tickets (token) WHERE redeemed_at IS NULL;

/* ===================== VERIFICATION CODES ===================== */
CREATE TABLE IF NOT EXISTS public.verif_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  code text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS verif_codes_email_idx ON public.verif_codes (email);
CREATE INDEX IF NOT EXISTS verif_codes_expiry_idx ON public.verif_codes (expires_at);

/* ===================== SCANS ===================== */
CREATE TABLE IF NOT EXISTS public.scans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid,
  event_id uuid,
  token text,
  scanned_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS scans_token_idx ON public.scans (token);
CREATE INDEX IF NOT EXISTS scans_ticket_idx ON public.scans (ticket_id);

/* ===================== PREMIUM USERS ===================== */
CREATE TABLE IF NOT EXISTS public.premium_users (
  email text PRIMARY KEY,
  premium_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_premium_users_until ON public.premium_users (premium_until DESC);

/* ===================== EVENT VIEWS ===================== */
CREATE TABLE IF NOT EXISTS public.event_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  item_id text NOT NULL,
  item_type text NOT NULL,
  viewed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS event_views_user_viewed_idx ON public.event_views (user_id, viewed_at DESC);
CREATE INDEX IF NOT EXISTS event_views_item_idx ON public.event_views (item_id, item_type);

/* ===================== REWARDS LEDGER ===================== */
CREATE TABLE IF NOT EXISTS public.rewards_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  email text,
  points integer NOT NULL,
  reason text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS rewards_ledger_user_idx ON public.rewards_ledger (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS rewards_ledger_email_idx ON public.rewards_ledger (email, created_at DESC);

/* ===================== USER POINTS (legacy) ===================== */
CREATE TABLE IF NOT EXISTS public.user_points (
  email text PRIMARY KEY,
  points bigint NOT NULL DEFAULT 0,
  last_award timestamptz
);

/* ===================== NOTIFICATION PREFS (email keyed variant) ===================== */
CREATE TABLE IF NOT EXISTS public.notification_prefs (
  email text PRIMARY KEY,
  categories text[] NOT NULL DEFAULT '{}',
  location text,
  radius double precision NOT NULL DEFAULT 30,
  lat double precision,
  lon double precision,
  phone text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS notification_prefs_email_key ON public.notification_prefs(email);
CREATE INDEX IF NOT EXISTS notification_prefs_updated_idx ON public.notification_prefs(updated_at DESC);
CREATE INDEX IF NOT EXISTS notification_prefs_categories_idx ON public.notification_prefs USING gin(categories);

/* ===================== EARLY NOTIFY (inbox + sends) ===================== */
CREATE TABLE IF NOT EXISTS public.early_notify_inbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  offer_id uuid,
  payload jsonb,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS early_notify_inbox_email_idx ON public.early_notify_inbox (email, created_at DESC);

CREATE TABLE IF NOT EXISTS public.early_notify_sends (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  offer_id uuid,
  subcategory text,
  sent_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS early_notify_sends_email_idx ON public.early_notify_sends (email, sent_at DESC);
CREATE INDEX IF NOT EXISTS early_notify_sends_offer_idx ON public.early_notify_sends (offer_id);

/* ===================== INVOICES & COUNTERS ===================== */
CREATE TABLE IF NOT EXISTS public.invoice_counters (
  year integer PRIMARY KEY,
  last_no integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number text UNIQUE,
  provider_id uuid,
  email text,
  amount numeric(12,2) NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'EUR',
  pdf_url text,
  issued_at timestamptz NOT NULL DEFAULT now(),
  paid_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS invoices_issued_idx ON public.invoices (issued_at DESC);
CREATE INDEX IF NOT EXISTS invoices_provider_idx ON public.invoices (provider_id);
CREATE OR REPLACE FUNCTION public.next_invoice_number(p_year integer DEFAULT EXTRACT(YEAR FROM now())) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v_year integer := COALESCE(p_year, EXTRACT(YEAR FROM now())); v_last integer; v_new integer; BEGIN LOOP SELECT last_no INTO v_last FROM public.invoice_counters WHERE year = v_year FOR UPDATE; IF NOT FOUND THEN INSERT INTO public.invoice_counters(year, last_no, updated_at) VALUES(v_year, 0, now()); v_last := 0; END IF; v_new := v_last + 1; UPDATE public.invoice_counters SET last_no = v_new, updated_at = now() WHERE year = v_year; RETURN v_year::text || '-' || LPAD(v_new::text, 4, '0'); END LOOP; END; $$;
CREATE OR REPLACE FUNCTION public.create_invoice(p_provider uuid, p_email text, p_amount numeric, p_currency text DEFAULT 'EUR', p_pdf_url text DEFAULT NULL, p_metadata jsonb DEFAULT '{}'::jsonb) RETURNS json LANGUAGE plpgsql AS $$
DECLARE v_number text; v_id uuid := gen_random_uuid(); BEGIN v_number := next_invoice_number(); INSERT INTO public.invoices(id, number, provider_id, email, amount, currency, pdf_url, metadata, issued_at, created_at) VALUES (v_id, v_number, p_provider, p_email, COALESCE(p_amount,0), COALESCE(p_currency,'EUR'), p_pdf_url, p_metadata, now(), now()); RETURN json_build_object('ok', true, 'invoice_id', v_id, 'number', v_number); END; $$;

/* ===================== GEO QUEUE / CACHE ===================== */
CREATE TABLE IF NOT EXISTS public.geo_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_id uuid,
  addr_raw text,
  addr_norm text,
  status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  last_attempt_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS geo_queue_status_idx ON public.geo_queue (status);

CREATE TABLE IF NOT EXISTS public.geocode_cache (
  addr_norm text PRIMARY KEY,
  lat double precision,
  lon double precision,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS geocode_cache_lat_lon_idx ON public.geocode_cache (lat, lon);

CREATE TABLE IF NOT EXISTS public.geo_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  city text,
  country text,
  lat double precision,
  lon double precision,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS geo_cache_city_country_idx ON public.geo_cache (city, country);

/* ===================== REWARD / POINTS RPCS ===================== */
CREATE OR REPLACE FUNCTION public.add_points(p_user_id uuid, p_points integer, p_reason text, p_metadata json DEFAULT '{}'::json) RETURNS json LANGUAGE plpgsql AS $$
DECLARE v_email text := NULL; v_ledger_id uuid; v_payload json; BEGIN BEGIN SELECT email INTO v_email FROM public.users WHERE id = p_user_id LIMIT 1; EXCEPTION WHEN undefined_table THEN v_email := NULL; END; INSERT INTO public.rewards_ledger (id, user_id, email, points, reason, metadata, created_at) VALUES (gen_random_uuid(), p_user_id, v_email, p_points, p_reason, p_metadata::jsonb, now()) RETURNING id INTO v_ledger_id; INSERT INTO public.user_points (email, points, last_award) VALUES (v_email, p_points, now()) ON CONFLICT (email) DO UPDATE SET points = public.user_points.points + EXCLUDED.points, last_award = now(); v_payload := json_build_object('type','reward','user_id', p_user_id, 'points', p_points, 'reason', p_reason, 'ledger_id', v_ledger_id); PERFORM pg_notify('neargo_rewards', v_payload::text); RETURN json_build_object('ok', true, 'ledger_id', v_ledger_id, 'points', p_points); END; $$;

/* ===================== CLEANUP / FUTURE ===================== */
-- Add RLS policies after verifying tables populate correctly.
-- Example enabling RLS (uncomment & adapt):
-- ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
-- CREATE POLICY events_read ON public.events FOR SELECT USING (true);
-- Grant minimal usage:
-- GRANT USAGE ON SCHEMA public TO anon, authenticated;
-- GRANT SELECT ON public.events TO anon, authenticated;

-- End master migration.

-- Migration: create missing core tables (events, invoices, invoice_counters)
-- Run this in Supabase SQL editor or psql. Safe: uses IF NOT EXISTS.
-- Depends on pgcrypto for UUID generation.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

/* ===================== EVENTS ===================== */
-- Minimal columns required by application: id, title, city
-- Extended set added for future flexibility.
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

-- Helpful indexes
CREATE INDEX IF NOT EXISTS events_city_idx ON public.events (city);
CREATE INDEX IF NOT EXISTS events_published_idx ON public.events (published_at DESC);
CREATE INDEX IF NOT EXISTS events_featured_idx ON public.events (featured) WHERE featured;

-- Simple trigger to keep updated_at fresh
CREATE OR REPLACE FUNCTION public.events_touch_updated()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;$$;
DROP TRIGGER IF EXISTS events_touch_updated_trg ON public.events;
CREATE TRIGGER events_touch_updated_trg BEFORE UPDATE ON public.events
FOR EACH ROW EXECUTE FUNCTION public.events_touch_updated();

/* ===================== INVOICE COUNTERS ===================== */
-- Stores last sequence number per year for human-readable invoice numbers.
CREATE TABLE IF NOT EXISTS public.invoice_counters (
  year integer PRIMARY KEY,
  last_no integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

/* ===================== INVOICES ===================== */
-- Stores issued invoices; "number" becomes human-readable identifier (e.g. 2025-0001).
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

/* ===================== HELPERS ===================== */
-- Function: next human invoice number (prefix YEAR then zero-padded sequential).
CREATE OR REPLACE FUNCTION public.next_invoice_number(p_year integer DEFAULT EXTRACT(YEAR FROM now()))
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  v_year integer := COALESCE(p_year, EXTRACT(YEAR FROM now()));
  v_last integer;
  v_new integer;
BEGIN
  LOOP
    SELECT last_no INTO v_last FROM public.invoice_counters WHERE year = v_year FOR UPDATE;
    IF NOT FOUND THEN
      INSERT INTO public.invoice_counters(year, last_no, updated_at) VALUES(v_year, 0, now());
      v_last := 0;
    END IF;
    v_new := v_last + 1;
    UPDATE public.invoice_counters SET last_no = v_new, updated_at = now() WHERE year = v_year;
    RETURN v_year::text || '-' || LPAD(v_new::text, 4, '0');
  END LOOP;
END;$$;

-- Helper to create invoice and auto-assign number if not provided.
CREATE OR REPLACE FUNCTION public.create_invoice(p_provider uuid, p_email text, p_amount numeric, p_currency text DEFAULT 'EUR', p_pdf_url text DEFAULT NULL, p_metadata jsonb DEFAULT '{}'::jsonb)
RETURNS json LANGUAGE plpgsql AS $$
DECLARE
  v_number text;
  v_id uuid := gen_random_uuid();
BEGIN
  v_number := next_invoice_number();
  INSERT INTO public.invoices(id, number, provider_id, email, amount, currency, pdf_url, metadata, issued_at, created_at)
  VALUES (v_id, v_number, p_provider, p_email, COALESCE(p_amount,0), COALESCE(p_currency,'EUR'), p_pdf_url, p_metadata, now(), now());
  RETURN json_build_object('ok', true, 'invoice_id', v_id, 'number', v_number);
END;$$;

-- NOTE: Add RLS policies / grants as needed for service role vs. public access.
-- Example (enable read for authenticated):
-- ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
-- CREATE POLICY invoices_read ON public.invoices FOR SELECT USING (auth.role() = 'authenticated');

-- End of migration.

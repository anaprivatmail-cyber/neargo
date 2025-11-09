-- Align DB schema with stripe-webhook expectations (idempotent)
-- - invoices table with webhook columns
-- - invoice_counters + increment_invoice_counter RPC
-- - tickets columns required by webhook inserts

CREATE EXTENSION IF NOT EXISTS pgcrypto;

/* ===================== INVOICE COUNTERS + RPC ===================== */
CREATE TABLE IF NOT EXISTS public.invoice_counters (
  year integer PRIMARY KEY,
  last_no integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.increment_invoice_counter(y integer)
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE v_last integer; v_new integer; v_year integer := y; BEGIN
  IF v_year IS NULL THEN v_year := EXTRACT(YEAR FROM now())::integer; END IF;
  LOOP
    INSERT INTO public.invoice_counters(year, last_no, updated_at) VALUES (v_year, 0, now())
    ON CONFLICT (year) DO NOTHING;
    SELECT last_no INTO v_last FROM public.invoice_counters WHERE year = v_year FOR UPDATE;
    v_new := COALESCE(v_last, 0) + 1;
    UPDATE public.invoice_counters SET last_no = v_new, updated_at = now() WHERE year = v_year;
    RETURN v_new;
  END LOOP;
END;$$;

/* ===================== INVOICES (webhook schema) ===================== */
CREATE TABLE IF NOT EXISTS public.invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seq_no text UNIQUE,
  year integer NOT NULL,
  customer_email text,
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  currency text NOT NULL DEFAULT 'eur',
  subtotal integer NOT NULL DEFAULT 0,
  tax_rate numeric(5,2) NOT NULL DEFAULT 22,
  tax_amount integer NOT NULL DEFAULT 0,
  total integer NOT NULL DEFAULT 0,
  paid_at timestamptz,
  stripe_session_id text,
  stripe_payment_intent text,
  event_id uuid,
  type text,
  pdf_url text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS invoices_paid_idx ON public.invoices (paid_at DESC);
CREATE INDEX IF NOT EXISTS invoices_email_idx ON public.invoices (customer_email, paid_at DESC);
CREATE INDEX IF NOT EXISTS invoices_year_idx ON public.invoices (year);

/* ===================== TICKETS (add missing columns) ===================== */
CREATE TABLE IF NOT EXISTS public.tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text,
  customer_email text,
  token text UNIQUE,
  redeemed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS event_id uuid;
ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS display_benefit text;
ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS benefit_type text;
ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS benefit_value numeric;
ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS freebie_text text;
ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS stripe_checkout_session_id text;
ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS stripe_payment_intent_id text;
ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS status text;
ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS issued_at timestamptz;
-- created_at already ensured above

CREATE INDEX IF NOT EXISTS tickets_email_idx ON public.tickets (customer_email);
CREATE INDEX IF NOT EXISTS tickets_token_idx ON public.tickets (token);
CREATE INDEX IF NOT EXISTS tickets_status_idx ON public.tickets (status);

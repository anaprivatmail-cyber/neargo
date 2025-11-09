-- Unifikacija email stolpcev (ASCII, snake_case)
-- Cilj: uporabljamo 'email' v tabelah tickets in invoices
-- Idempotentno: če stolpec že obstaja, ne podvaja.

DO $$
BEGIN
  -- invoices: preimenuj customer_email -> email
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='invoices' AND column_name='customer_email'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='invoices' AND column_name='email'
  ) THEN
    EXECUTE 'ALTER TABLE public.invoices RENAME COLUMN customer_email TO email';
  END IF;

  -- tickets: preimenuj customer_email -> email
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='tickets' AND column_name='customer_email'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='tickets' AND column_name='email'
  ) THEN
    EXECUTE 'ALTER TABLE public.tickets RENAME COLUMN customer_email TO email';
  END IF;

  -- Popravi indekse (varno, če obstajajo stari):
  BEGIN
    EXECUTE 'DROP INDEX IF EXISTS invoices_email_idx';
  EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN
    EXECUTE 'CREATE INDEX IF NOT EXISTS invoices_email_idx ON public.invoices (email, paid_at DESC)';
  EXCEPTION WHEN OTHERS THEN NULL; END;

  BEGIN
    EXECUTE 'DROP INDEX IF EXISTS tickets_customer_idx';
  EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN
    EXECUTE 'DROP INDEX IF EXISTS tickets_email_idx';
  EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN
    EXECUTE 'CREATE INDEX IF NOT EXISTS tickets_email_idx ON public.tickets (email)';
  EXCEPTION WHEN OTHERS THEN NULL; END;
END $$;

-- INFO: če si kdaj ustvaril stolpec z nenavadnim imenom (npr. "e-pošta"),
-- ga najprej preimenuj na customer_email ali email, nato poženi zgornje.
-- Primer:
--   ALTER TABLE public.invoices RENAME COLUMN "e-pošta" TO email;

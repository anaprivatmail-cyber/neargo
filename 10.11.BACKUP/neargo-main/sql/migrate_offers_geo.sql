-- Enable extensions we rely on
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto; -- for gen_random_uuid()

-- Safety: if an older partial geocode_cache exists without addr_norm, add it now
ALTER TABLE IF EXISTS public.geocode_cache ADD COLUMN IF NOT EXISTS addr_norm text;
-- Also ensure core columns exist if table was created earlier without them
ALTER TABLE IF EXISTS public.geocode_cache ADD COLUMN IF NOT EXISTS lat double precision;
ALTER TABLE IF EXISTS public.geocode_cache ADD COLUMN IF NOT EXISTS lon double precision;
ALTER TABLE IF EXISTS public.geocode_cache ADD COLUMN IF NOT EXISTS point geography(Point,4326);
ALTER TABLE IF EXISTS public.geocode_cache ADD COLUMN IF NOT EXISTS updated_at timestamptz;
-- Create missing unique index on addr_norm (needed for ON CONFLICT)
DO $$BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname='public' AND tablename='geocode_cache' AND indexname='uq_geocode_cache_addr_norm'
  ) THEN
    BEGIN
      CREATE UNIQUE INDEX uq_geocode_cache_addr_norm ON public.geocode_cache (addr_norm);
    EXCEPTION WHEN OTHERS THEN
      -- if table is empty and addr_norm still null, ignore
      RAISE NOTICE 'Could not create unique index uq_geocode_cache_addr_norm: %', SQLERRM;
    END;
  END IF;
END$$;

-- 0) Create offers table if it doesn't exist yet (text id to allow flexible IDs like 'provider:123')
CREATE TABLE IF NOT EXISTS public.offers (
  id text PRIMARY KEY,
  name text NOT NULL,
  description text,
  url text,
  start timestamptz,
  "end" timestamptz,
  timezone text,
  venue_address text,
  venue_city text,
  venue_country text,
  venue_lat double precision,
  venue_lon double precision,
  venue_point geography(Point,4326),
  categories text[],
  subcategory text,
  images jsonb,
  price jsonb,
  contact jsonb,
  source text,
  source_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  publish_at timestamptz,
  notified_early boolean NOT NULL DEFAULT false,
  CONSTRAINT chk_offers_lat_range CHECK (venue_lat IS NULL OR (venue_lat BETWEEN -90 AND 90)),
  CONSTRAINT chk_offers_lon_range CHECK (venue_lon IS NULL OR (venue_lon BETWEEN -180 AND 180))
);

-- 1) Add geo-related columns to offers (idempotent)
ALTER TABLE IF EXISTS public.offers
  ADD COLUMN IF NOT EXISTS subcategory text,
  ADD COLUMN IF NOT EXISTS publish_at timestamptz,
  ADD COLUMN IF NOT EXISTS venue_address text,
  ADD COLUMN IF NOT EXISTS venue_city text,
  ADD COLUMN IF NOT EXISTS venue_country text,
  ADD COLUMN IF NOT EXISTS venue_lat double precision,
  ADD COLUMN IF NOT EXISTS venue_lon double precision,
  ADD COLUMN IF NOT EXISTS venue_point geography(Point,4326);

-- 2) Lightweight sanity checks on lat/lon (re-create constraints idempotently)
ALTER TABLE IF EXISTS public.offers DROP CONSTRAINT IF EXISTS chk_offers_lat_range;
ALTER TABLE IF EXISTS public.offers ADD CONSTRAINT chk_offers_lat_range CHECK (
  venue_lat IS NULL OR (venue_lat BETWEEN -90 AND 90)
);
ALTER TABLE IF EXISTS public.offers DROP CONSTRAINT IF EXISTS chk_offers_lon_range;
ALTER TABLE IF EXISTS public.offers ADD CONSTRAINT chk_offers_lon_range CHECK (
  venue_lon IS NULL OR (venue_lon BETWEEN -180 AND 180)
);

-- 3) Keep venue_point <-> lat/lon in sync
CREATE OR REPLACE FUNCTION public.offers_point_sync()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- If lat/lon provided, compute point
  IF NEW.venue_lat IS NOT NULL AND NEW.venue_lon IS NOT NULL THEN
    NEW.venue_point := ST_SetSRID(ST_MakePoint(NEW.venue_lon, NEW.venue_lat), 4326)::geography;
  ELSIF NEW.venue_point IS NOT NULL AND (NEW.venue_lat IS NULL OR NEW.venue_lon IS NULL) THEN
    -- If only point provided, backfill lat/lon
    NEW.venue_lon := ST_X(NEW.venue_point::geometry);
    NEW.venue_lat := ST_Y(NEW.venue_point::geometry);
  END IF;
  RETURN NEW;
END$$;

DROP TRIGGER IF EXISTS trg_offers_point_sync_insupd ON public.offers;
CREATE TRIGGER trg_offers_point_sync_insupd
BEFORE INSERT OR UPDATE OF venue_lat, venue_lon, venue_point ON public.offers
FOR EACH ROW EXECUTE FUNCTION public.offers_point_sync();

-- 4) Useful indexes (idempotent)
CREATE INDEX IF NOT EXISTS idx_offers_publish_at ON public.offers (publish_at);
CREATE INDEX IF NOT EXISTS idx_offers_subcategory ON public.offers (subcategory);
CREATE INDEX IF NOT EXISTS idx_offers_venue_point ON public.offers USING GIST (venue_point);
-- Additional composite index for heavy read scenarios: filter upcoming + category
CREATE INDEX IF NOT EXISTS idx_offers_publish_subcat ON public.offers (publish_at, subcategory);
-- Optional full-text index (run manually if name & description exist):
-- CREATE INDEX IF NOT EXISTS idx_offers_fts ON public.offers USING GIN (
--   to_tsvector('simple', coalesce(name,'') || ' ' || coalesce(description,''))
-- );

-- 5) Haversine distance function for cases without PostGIS usage in queries
CREATE OR REPLACE FUNCTION public.near_km(lat1 double precision, lon1 double precision,
                                          lat2 double precision, lon2 double precision)
RETURNS double precision
LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT 2 * 6371 * asin(
    sqrt(
      pow(sin(radians($3 - $1)/2), 2) +
      cos(radians($1)) * cos(radians($3)) * pow(sin(radians($4 - $2)/2), 2)
    )
  );
$$;

-- 6) Geocoding cache table (address -> lat/lon/point)
CREATE TABLE IF NOT EXISTS public.geocode_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  addr_raw text NOT NULL,
  addr_norm text NOT NULL,
  lat double precision,
  lon double precision,
  point geography(Point,4326),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- Unique index may already have been created by safety block above
CREATE UNIQUE INDEX IF NOT EXISTS uq_geocode_cache_addr_norm ON public.geocode_cache (addr_norm);
CREATE INDEX IF NOT EXISTS idx_geocode_cache_point ON public.geocode_cache USING GIST(point);

-- 6a) Helper to normalize addresses (very simple; improve if needed)
CREATE OR REPLACE FUNCTION public.normalize_addr(txt text)
RETURNS text LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT regexp_replace(lower(trim(txt)), '\\s+', ' ', 'g')
$$;

-- 7) Geocoding queue (Netlify/worker processes rows and fills offers.lat/lon)
CREATE TABLE IF NOT EXISTS public.geo_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_id text NOT NULL,                -- store as text to be agnostic to offers.id type
  addr_raw text NOT NULL,
  addr_norm text GENERATED ALWAYS AS (public.normalize_addr(addr_raw)) STORED,
  created_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'pending', -- pending | done | failed
  error text
);
CREATE INDEX IF NOT EXISTS idx_geo_queue_status ON public.geo_queue (status, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_geo_queue_offer_pending
  ON public.geo_queue(offer_id) WHERE status = 'pending';

-- 8) Enqueue for geocoding on offers insert/update when lat/lon missing
CREATE OR REPLACE FUNCTION public.offers_enqueue_geocode()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  addr text;
BEGIN
  addr := coalesce(nullif(trim(NEW.venue_address), ''), NEW.venue_city);
  IF addr IS NULL THEN
    RETURN NEW; -- nothing to geocode
  END IF;

  -- If lat/lon already present, optionally store in cache and skip queue
  IF NEW.venue_lat IS NOT NULL AND NEW.venue_lon IS NOT NULL THEN
    INSERT INTO public.geocode_cache(addr_raw, addr_norm, lat, lon, point)
    VALUES (addr, public.normalize_addr(addr), NEW.venue_lat, NEW.venue_lon,
            ST_SetSRID(ST_MakePoint(NEW.venue_lon, NEW.venue_lat), 4326)::geography)
    ON CONFLICT (addr_norm) DO UPDATE
      SET lat = EXCLUDED.lat,
          lon = EXCLUDED.lon,
          point = EXCLUDED.point,
          updated_at = now();
    RETURN NEW;
  END IF;

  -- Otherwise enqueue if not already pending
  -- Ensure only one pending row per offer (partial unique index can't be targeted by ON CONFLICT)
  PERFORM 1 FROM public.geo_queue WHERE offer_id = NEW.id::text AND status = 'pending';
  IF NOT FOUND THEN
    INSERT INTO public.geo_queue(offer_id, addr_raw)
    VALUES (NEW.id::text, addr);
  END IF;

  RETURN NEW;
END$$;

DROP TRIGGER IF EXISTS trg_offers_enqueue_geocode ON public.offers;
CREATE TRIGGER trg_offers_enqueue_geocode
AFTER INSERT OR UPDATE OF venue_address, venue_city, venue_lat, venue_lon ON public.offers
FOR EACH ROW EXECUTE FUNCTION public.offers_enqueue_geocode();

-- 8a) Auto-fill subcategory from categories[1] if subcategory is NULL (requires categories column)
-- Uncomment if table has a text[] column "categories":
-- CREATE OR REPLACE FUNCTION public.offers_subcategory_autofill()
-- RETURNS trigger LANGUAGE plpgsql AS $$
-- BEGIN
--   IF NEW.subcategory IS NULL AND NEW.categories IS NOT NULL AND array_length(NEW.categories,1) >= 1 THEN
--     NEW.subcategory := lower(NEW.categories[1]);
--   END IF;
--   RETURN NEW;
-- END$$;
-- DROP TRIGGER IF EXISTS trg_offers_subcategory_autofill ON public.offers;
-- CREATE TRIGGER trg_offers_subcategory_autofill
-- BEFORE INSERT OR UPDATE OF categories ON public.offers
-- FOR EACH ROW EXECUTE FUNCTION public.offers_subcategory_autofill();

-- 9) Optional: View that exposes computed fields safely
CREATE OR REPLACE VIEW public.offers_with_geo AS
SELECT o.*,
       o.venue_lat AS lat,
       o.venue_lon AS lon,
       o.venue_point AS point
FROM public.offers o;


-- 11) Early notifications send log (per-user dedup and monthly caps)
CREATE TABLE IF NOT EXISTS public.early_notify_sends (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  offer_id text NOT NULL,
  subcategory text,
  sent_at timestamptz NOT NULL DEFAULT now()
);
-- Prevent duplicate sends per user+offer
CREATE UNIQUE INDEX IF NOT EXISTS uq_ens_email_offer ON public.early_notify_sends (email, offer_id);
-- Fast per-user monthly counts and recent queries
CREATE INDEX IF NOT EXISTS idx_ens_email_sent_at ON public.early_notify_sends (email, sent_at DESC);

-- 12) In-app inbox for early notifications (PWA fallback instead of SMS)
CREATE TABLE IF NOT EXISTS public.early_notify_inbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  offer_id text NOT NULL,
  payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_eni_email_created ON public.early_notify_inbox (email, created_at DESC);

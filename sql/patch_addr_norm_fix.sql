-- Patch: ensure addr_norm column exists on geocode_cache and related indexes/functions
-- Reason: Previous partial migration created geocode_cache without addr_norm, causing ON CONFLICT (addr_norm) errors.

-- 1. Normalization function (safe re-create)
CREATE OR REPLACE FUNCTION public.normalize_addr(txt text)
RETURNS text LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT regexp_replace(lower(trim(txt)), '\s+', ' ', 'g')
$$;

-- 2. Add addr_norm column if missing
ALTER TABLE IF EXISTS public.geocode_cache ADD COLUMN IF NOT EXISTS addr_norm text;

-- 3. Backfill addr_norm values
UPDATE public.geocode_cache
SET addr_norm = public.normalize_addr(addr_raw)
WHERE addr_norm IS NULL OR length(trim(addr_norm)) = 0;

-- 4. Add unique index (idempotent)
CREATE UNIQUE INDEX IF NOT EXISTS uq_geocode_cache_addr_norm ON public.geocode_cache (addr_norm);

-- 5. Optional: GIST index on point if missing
CREATE INDEX IF NOT EXISTS idx_geocode_cache_point ON public.geocode_cache USING GIST(point);

-- 6. Verify
SELECT 'geocode_cache columns' AS info, column_name
FROM information_schema.columns
WHERE table_schema='public' AND table_name='geocode_cache'
ORDER BY column_name;

SELECT 'geocode_cache sample' AS info, id, addr_raw, addr_norm, lat, lon
FROM public.geocode_cache
LIMIT 5;

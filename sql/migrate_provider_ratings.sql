-- Provider ratings schema (idempotent)
-- Allows logged-in users to rate providers on 3 axes: quality, value, experience
-- and computes badge tiers based on recent (last 365 days) aggregate scores.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

/* Core table */
CREATE TABLE IF NOT EXISTS public.provider_ratings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id text NOT NULL,
  email text NOT NULL,
  score_quality smallint NOT NULL CHECK (score_quality BETWEEN 0 AND 100),
  score_value   smallint NOT NULL CHECK (score_value   BETWEEN 0 AND 100),
  score_experience smallint NOT NULL CHECK (score_experience BETWEEN 0 AND 100),
  comment text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Enforce one rating per (provider,email). Updates are allowed.
CREATE UNIQUE INDEX IF NOT EXISTS provider_ratings_unique ON public.provider_ratings (provider_id, email);

-- Touch updated_at on update
CREATE OR REPLACE FUNCTION public.touch_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END; $$;
DROP TRIGGER IF EXISTS trg_provider_ratings_touch ON public.provider_ratings;
CREATE TRIGGER trg_provider_ratings_touch BEFORE UPDATE ON public.provider_ratings FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

/* Recent aggregate view (last 365 days) */
CREATE OR REPLACE VIEW public.provider_ratings_recent AS
SELECT provider_id,
       COUNT(*)                          AS cnt,
       AVG(score_quality)::numeric(6,2)  AS avg_q,
       AVG(score_value)::numeric(6,2)    AS avg_v,
       AVG(score_experience)::numeric(6,2) AS avg_x,
       -- Weighted score (0..100)
       (AVG(score_quality)*0.4 + AVG(score_value)*0.3 + AVG(score_experience)*0.3)::numeric(6,2) AS score,
       MAX(updated_at)                   AS last_update
FROM public.provider_ratings
WHERE updated_at >= (now() - interval '365 days')
GROUP BY provider_id;

/* Helper function to compute badge tier */
CREATE OR REPLACE FUNCTION public.provider_badge_tier(p_provider_id text)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  r record; -- cnt, score
BEGIN
  SELECT cnt, score INTO r FROM public.provider_ratings_recent WHERE provider_id = p_provider_id;
  IF NOT FOUND OR r.cnt IS NULL OR r.cnt < 3 OR r.score IS NULL THEN
    RETURN NULL; -- insufficient data
  END IF;
  IF r.cnt >= 25 AND r.score >= 88 THEN RETURN 'excellent'; END IF;
  IF r.cnt >= 10 AND r.score >= 75 THEN RETURN 'better'; END IF;
  IF r.cnt >= 3  AND r.score >= 60 THEN RETURN 'basic'; END IF;
  RETURN NULL;
END; $$;

-- Optional index to speed provider_id lookups
CREATE INDEX IF NOT EXISTS provider_ratings_provider_idx ON public.provider_ratings (provider_id, updated_at DESC);

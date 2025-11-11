-- Purpose: Rename legacy category keys to new canonical ones.
-- Old -> New:
--   kulinarika          -> kulinarka
--   kulinarika-catering -> kulinarka-catering
-- This migration is idempotent and safe to re-run.
-- It updates:
--   1. notification_prefs.categories (text[] of subcategory keys)
--   2. JSONB event submissions in storage are NOT directly changed here (handled by runtime script).
--   3. Any relational tables with a plain category text column (ADD your table names below if applicable).
--
-- Rollback (if needed): reverse new -> old (see bottom section).
--
-- IMPORTANT: Run inside a transaction; verify row counts before COMMIT.

BEGIN;

-- 1) notification_prefs: update array elements (no join on email needed)
UPDATE public.notification_prefs AS np
SET categories = (
  SELECT ARRAY(
    SELECT CASE
      WHEN c = 'kulinarika' THEN 'kulinarka'
      WHEN c = 'kulinarika-catering' THEN 'kulinarka-catering'
      ELSE c END
    FROM unnest(np.categories) AS c
  )
),
    updated_at = now()
WHERE np.categories && ARRAY['kulinarika','kulinarika-catering'];

-- 2) Example for a table with a category column: public.events (UNCOMMENT if exists)
-- UPDATE public.events
-- SET category = CASE
--   WHEN category = 'kulinarika' THEN 'kulinarka'
--   WHEN category = 'kulinarika-catering' THEN 'kulinarka-catering'
--   ELSE category END
-- WHERE category IN ('kulinarika','kulinarika-catering');

-- 3) Example for submissions metadata table (if created later): public.provider_submissions
-- UPDATE public.provider_submissions
-- SET category = CASE
--   WHEN category = 'kulinarika' THEN 'kulinarka'
--   WHEN category = 'kulinarika-catering' THEN 'kulinarka-catering'
--   ELSE category END
-- WHERE category IN ('kulinarika','kulinarika-catering');

-- Diagnostics: show counts after update
DO $$
DECLARE
  v_old int;
  v_new int;
BEGIN
  SELECT count(*) INTO v_old FROM public.notification_prefs WHERE categories && ARRAY['kulinarika','kulinarika-catering'];
  SELECT count(*) INTO v_new FROM public.notification_prefs WHERE categories && ARRAY['kulinarka','kulinarka-catering'];
  RAISE NOTICE 'notification_prefs rows still with old keys: %', v_old;
  RAISE NOTICE 'notification_prefs rows now with new keys: %', v_new;
END $$;

COMMIT;

-- Optional: verify other tables (uncomment if they exist)
-- SELECT category, count(*) FROM public.events GROUP BY 1 ORDER BY 2 DESC;
-- SELECT category, count(*) FROM public.provider_submissions GROUP BY 1 ORDER BY 2 DESC;
-- SELECT subcategory, count(*) FROM public.offers GROUP BY 1 ORDER BY 2 DESC;

-- Rollback snippet (ONLY if you must revert)
-- BEGIN;
-- WITH updated AS (
--   SELECT email,
--          categories,
--          ARRAY(
--            SELECT CASE
--              WHEN c = 'kulinarka' THEN 'kulinarika'
--              WHEN c = 'kulinarka-catering' THEN 'kulinarika-catering'
--              ELSE c END
--            FROM unnest(categories) AS c
--          ) AS old_categories
--   FROM public.notification_prefs
--   WHERE categories && ARRAY['kulinarka','kulinarka-catering']
-- )
-- UPDATE public.notification_prefs np
-- SET categories = u.old_categories,
--     updated_at = now()
-- FROM updated u
-- WHERE np.email = u.email;
-- COMMIT;

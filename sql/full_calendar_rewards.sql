-- full_calendar_rewards.sql
-- Consolidated migration: calendar + security + rewards + referrals + dynamic revenue-based points + reward catalog.
-- Copy & run in Supabase SQL editor (or psql). Safe to re-run (IF NOT EXISTS used where possible).

-- =============== EXTENSIONS =====================
CREATE EXTENSION IF NOT EXISTS pgcrypto; -- for gen_random_uuid()

-- =============== CALENDAR CORE ==================
CREATE TABLE IF NOT EXISTS public.provider_calendars (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_email TEXT NOT NULL,
  title TEXT,
  event_submission_key TEXT,
  edit_token TEXT,
  stats_token TEXT,
  plan TEXT, -- grow|pro|null
  token_expires_at TIMESTAMPTZ, -- security (may be NULL)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS provider_calendars_provider_idx   ON public.provider_calendars(provider_email);
CREATE INDEX IF NOT EXISTS provider_calendars_edit_token_idx ON public.provider_calendars(edit_token);

CREATE TABLE IF NOT EXISTS public.provider_slots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  calendar_id UUID NOT NULL REFERENCES public.provider_calendars(id) ON DELETE CASCADE,
  start_time TIMESTAMPTZ NOT NULL,
  end_time   TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'free' CHECK (status IN ('free','reserved','blocked')),
  reserved_email TEXT,
  reserved_at TIMESTAMPTZ,
  coupon_token TEXT,
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
CREATE INDEX IF NOT EXISTS provider_reservations_email_idx   ON public.provider_reservations(reserved_email, reserved_at DESC);
CREATE INDEX IF NOT EXISTS provider_reservations_slot_idx    ON public.provider_reservations(slot_id);
CREATE INDEX IF NOT EXISTS provider_reservations_email_time_idx ON public.provider_reservations(reserved_email, status, reserved_at DESC);

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

CREATE OR REPLACE VIEW public.view_calendar_upcoming_free AS
SELECT s.id AS slot_id, s.calendar_id, c.title, s.start_time, s.end_time
FROM public.provider_slots s
JOIN public.provider_calendars c ON c.id = s.calendar_id
WHERE s.status = 'free' AND s.start_time >= now()
ORDER BY s.start_time ASC;

-- =============== REWARDS CORE ====================
CREATE TABLE IF NOT EXISTS public.event_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  item_id text NOT NULL,
  item_type text NOT NULL,
  viewed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS event_views_user_viewed_idx ON public.event_views (user_id, viewed_at DESC);
CREATE INDEX IF NOT EXISTS event_views_item_idx ON public.event_views (item_id, item_type);

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

CREATE TABLE IF NOT EXISTS public.wallets (
  user_id uuid PRIMARY KEY,
  balance bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.user_points (
  email text PRIMARY KEY,
  points bigint NOT NULL DEFAULT 0,
  last_award timestamptz
);

CREATE TABLE IF NOT EXISTS public.referrals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id uuid,
  referred_email text,
  referred_user_id uuid,
  register_rewarded boolean DEFAULT false,
  premium_rewarded boolean DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Ensure compatibility if referrals existed already
ALTER TABLE IF EXISTS public.referrals
  ADD COLUMN IF NOT EXISTS register_rewarded boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS premium_rewarded boolean DEFAULT false;

CREATE TABLE IF NOT EXISTS public.referral_codes (
  user_id uuid PRIMARY KEY,
  code text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.user_logins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  login_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS user_logins_user_idx ON public.user_logins (user_id, login_at DESC);

CREATE TABLE IF NOT EXISTS public.badges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb,
  awarded_at timestamptz NOT NULL DEFAULT now()
);

-- Catalog of rewards user can redeem with points (e.g., premium_month, free_coupon_X)
CREATE TABLE IF NOT EXISTS public.reward_items (
  code text PRIMARY KEY,
  kind text NOT NULL,           -- e.g. 'premium','coupon','other'
  points_cost integer NOT NULL, -- cost in points
  metadata jsonb DEFAULT '{}'::jsonb,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Send-once mail markers for thresholds (e.g., 500 points reached)
CREATE TABLE IF NOT EXISTS public.rewards_threshold_emails (
  user_id uuid NOT NULL,
  threshold integer NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, threshold)
);

-- =============== RPC FUNCTIONS ===================

-- Helper: resolve user email robustly across different schemas/column names
CREATE OR REPLACE FUNCTION public.resolve_user_email(p_user_id uuid)
RETURNS text LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_email text := NULL;
  v_col text;
BEGIN
  -- Try public.users with common email-like column names
  IF to_regclass('public.users') IS NOT NULL THEN
    FOR v_col IN
      SELECT column_name FROM information_schema.columns
      WHERE table_schema='public' AND table_name='users' AND column_name IN ('email','email_address','user_email','primary_email')
    LOOP
      EXECUTE format('SELECT %I FROM public.users WHERE id = $1 LIMIT 1', v_col) INTO v_email USING p_user_id;
      IF v_email IS NOT NULL THEN RETURN v_email; END IF;
    END LOOP;
  END IF;

  -- Try auth.users (Supabase) with common email-like column names
  IF to_regclass('auth.users') IS NOT NULL THEN
    FOR v_col IN
      SELECT column_name FROM information_schema.columns
      WHERE table_schema='auth' AND table_name='users' AND column_name IN ('email','email_address','user_email','primary_email')
    LOOP
      EXECUTE format('SELECT %I FROM auth.users WHERE id = $1 LIMIT 1', v_col) INTO v_email USING p_user_id;
      IF v_email IS NOT NULL THEN RETURN v_email; END IF;
    END LOOP;
  END IF;

  -- Fallback: if rewards_ledger already contains entries for this user, reuse most recent non-null email
  SELECT email INTO v_email FROM public.rewards_ledger WHERE user_id = p_user_id AND email IS NOT NULL ORDER BY created_at DESC LIMIT 1;
  IF v_email IS NOT NULL THEN RETURN v_email; END IF;

  -- Fallback 2: if referrals table has referred_email for this user
  SELECT referred_email INTO v_email FROM public.referrals WHERE referred_user_id = p_user_id AND referred_email IS NOT NULL ORDER BY created_at DESC LIMIT 1;
  IF v_email IS NOT NULL THEN RETURN v_email; END IF;

  RETURN NULL;
END; $$;

-- Atomic add_points
CREATE OR REPLACE FUNCTION public.add_points(p_user_id uuid, p_points integer, p_reason text, p_metadata json DEFAULT '{}'::json)
RETURNS json LANGUAGE plpgsql AS $$
DECLARE v_email text := NULL; v_ledger_id uuid; v_user_exists boolean := false; BEGIN
  IF p_points = 0 THEN RETURN json_build_object('ok',false,'error','zero_points'); END IF;
  IF p_user_id IS NULL THEN RETURN json_build_object('ok',false,'error','user_required'); END IF;
  -- Enforce: only registered users can receive points (email alone is not enough)
  IF to_regclass('auth.users') IS NOT NULL THEN
    PERFORM 1 FROM auth.users WHERE id = p_user_id;
    IF FOUND THEN v_user_exists := true; END IF;
  END IF;
  IF NOT v_user_exists AND to_regclass('public.users') IS NOT NULL THEN
    PERFORM 1 FROM public.users WHERE id = p_user_id;
    IF FOUND THEN v_user_exists := true; END IF;
  END IF;
  IF NOT v_user_exists THEN RETURN json_build_object('ok',false,'error','user_not_found'); END IF;
  -- Resolve email robustly across schemas/column names
  v_email := public.resolve_user_email(p_user_id);
  INSERT INTO public.rewards_ledger(id,user_id,email,points,reason,metadata,created_at)
    VALUES(gen_random_uuid(),p_user_id,v_email,p_points,p_reason,p_metadata::jsonb,now()) RETURNING id INTO v_ledger_id;
  INSERT INTO public.wallets(user_id,balance,updated_at)
    VALUES(p_user_id,p_points,now())
    ON CONFLICT (user_id) DO UPDATE SET balance = public.wallets.balance + EXCLUDED.balance, updated_at = now();
  IF v_email IS NOT NULL THEN
    INSERT INTO public.user_points(email,points,last_award) VALUES(v_email,p_points,now())
      ON CONFLICT (email) DO UPDATE SET points = public.user_points.points + EXCLUDED.points, last_award = now();
  END IF;
  PERFORM pg_notify('neargo_rewards', json_build_object('type','reward','user_id',p_user_id,'points',p_points,'reason',p_reason,'ledger_id',v_ledger_id)::text);
  RETURN json_build_object('ok',true,'ledger_id',v_ledger_id,'points',p_points);
END; $$;

-- Atomic redeem_points (generic)
CREATE OR REPLACE FUNCTION public.redeem_points(p_user_id uuid, p_points integer, p_reward_code text DEFAULT NULL)
RETURNS json LANGUAGE plpgsql AS $$
DECLARE v_balance bigint; v_ledger_id uuid; BEGIN
  IF p_points <= 0 THEN RETURN json_build_object('ok',false,'error','invalid_points'); END IF;
  SELECT balance INTO v_balance FROM public.wallets WHERE user_id = p_user_id FOR UPDATE;
  IF NOT FOUND OR v_balance IS NULL THEN RETURN json_build_object('ok',false,'error','no_balance'); END IF;
  IF v_balance < p_points THEN RETURN json_build_object('ok',false,'error','insufficient_points'); END IF;
  UPDATE public.wallets SET balance = balance - p_points, updated_at = now() WHERE user_id = p_user_id;
  INSERT INTO public.rewards_ledger(id,user_id,points,reason,metadata,created_at)
    VALUES(gen_random_uuid(),p_user_id,-p_points,'redeem', json_build_object('reward_code',p_reward_code), now()) RETURNING id INTO v_ledger_id;
  PERFORM pg_notify('neargo_rewards', json_build_object('type','redeem','user_id',p_user_id,'points',-p_points,'ledger_id',v_ledger_id)::text);
  RETURN json_build_object('ok',true,'ledger_id',v_ledger_id,'remaining', (v_balance - p_points));
END; $$;

-- Revenue-based awarding (unlimited): points proportional to amount; default 1 point per 100 cents (1€)
CREATE OR REPLACE FUNCTION public.award_revenue_points(p_user_id uuid, p_amount_cents integer, p_source text, p_metadata json DEFAULT '{}'::json, p_rate numeric DEFAULT 0.01)
RETURNS json LANGUAGE plpgsql AS $$
DECLARE v_points integer; v_meta json; BEGIN
  IF p_amount_cents <= 0 THEN RETURN json_build_object('ok',false,'error','non_positive_amount'); END IF;
  -- points = amount_cents * p_rate (e.g. 0.01 => 1 point per 100 cents)
  v_points := FLOOR(p_amount_cents * p_rate);
  IF v_points <= 0 THEN v_points := 1; END IF; -- guarantee at least 1
  v_meta := json_build_object('amount_cents',p_amount_cents,'source',p_source) || p_metadata::jsonb;
  RETURN public.add_points(p_user_id, v_points, 'revenue_'+p_source, v_meta);
END; $$;

-- Referral premium bonus awarding (variable points)
CREATE OR REPLACE FUNCTION public.award_referral_premium(p_referrer_id uuid, p_referred_email text, p_points integer DEFAULT 100)
RETURNS json LANGUAGE plpgsql AS $$
DECLARE v_meta json; BEGIN
  v_meta := json_build_object('referred_email', p_referred_email);
  RETURN public.add_points(p_referrer_id, p_points, 'referral_premium', v_meta);
END; $$;

-- Redeem a catalog reward by code
CREATE OR REPLACE FUNCTION public.redeem_reward_item(p_user_id uuid, p_code text)
RETURNS json LANGUAGE plpgsql AS $$
DECLARE v_cost integer; v_kind text; v_meta jsonb; v_balance bigint; v_ledger_id uuid; BEGIN
  SELECT points_cost, kind, metadata INTO v_cost, v_kind, v_meta FROM public.reward_items WHERE code = p_code AND active = true;
  IF NOT FOUND THEN RETURN json_build_object('ok',false,'error','invalid_reward'); END IF;
  SELECT balance INTO v_balance FROM public.wallets WHERE user_id = p_user_id FOR UPDATE;
  IF NOT FOUND OR v_balance < v_cost THEN RETURN json_build_object('ok',false,'error','insufficient_points'); END IF;
  UPDATE public.wallets SET balance = balance - v_cost, updated_at = now() WHERE user_id = p_user_id;
  INSERT INTO public.rewards_ledger(id,user_id,points,reason,metadata,created_at)
    VALUES(gen_random_uuid(),p_user_id,-v_cost,'reward_item', json_build_object('code',p_code,'kind',v_kind,'meta',v_meta), now()) RETURNING id INTO v_ledger_id;
  RETURN json_build_object('ok',true,'ledger_id',v_ledger_id,'kind',v_kind,'cost',v_cost,'remaining', (v_balance - v_cost), 'metadata', v_meta);
END; $$;

-- View bonus aggregator (distinct views in last 7 days >=5) for cron
CREATE OR REPLACE FUNCTION public.query_event_views_7d()
RETURNS TABLE(user_id uuid, unique_count integer) LANGUAGE sql AS $$
  SELECT ev.user_id, count(DISTINCT ev.item_id || '|' || ev.item_type) AS unique_count
  FROM public.event_views ev
  WHERE ev.viewed_at >= (now() - interval '7 days') AND ev.user_id IS NOT NULL
  GROUP BY ev.user_id
  HAVING count(DISTINCT ev.item_id || '|' || ev.item_type) >= 5
  ORDER BY unique_count DESC;
$$;

-- =============== INITIAL REWARD ITEMS ============
INSERT INTO public.reward_items(code,kind,points_cost,metadata,active)
VALUES
  ('premium_month','premium',500,json_build_object('months',1),true),
  ('free_coupon_generic','coupon',300,json_build_object('description','Brezplačen splošen kupon'),true)
ON CONFLICT (code) DO NOTHING;

-- =============== EARLY-NOTIFY (Preferences & Sends) ============
-- User notification preferences for early offer alerts (subcategory filter + geo radius)
CREATE TABLE IF NOT EXISTS public.notification_prefs (
  email text PRIMARY KEY,
  categories text[] NOT NULL DEFAULT '{}', -- array of subcategory keys user wants early alerts for
  location text,
  radius double precision NOT NULL DEFAULT 30, -- km (clamped 3..50 via trigger)
  lat double precision,
  lon double precision,
  phone text, -- optional for future SMS usage
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- Ensure column naming compatibility for notification_prefs.email and then create the unique index
DO $$ BEGIN
  IF to_regclass('public.notification_prefs') IS NOT NULL THEN
    -- If email column missing, try to rename common alternatives; if none exist, add the column
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_schema='public' AND table_name='notification_prefs' AND column_name='email') THEN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema='public' AND table_name='notification_prefs' AND column_name='user_email') THEN
        EXECUTE 'ALTER TABLE public.notification_prefs RENAME COLUMN user_email TO email';
      ELSIF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema='public' AND table_name='notification_prefs' AND column_name='email_address') THEN
        EXECUTE 'ALTER TABLE public.notification_prefs RENAME COLUMN email_address TO email';
      ELSIF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema='public' AND table_name='notification_prefs' AND column_name='primary_email') THEN
        EXECUTE 'ALTER TABLE public.notification_prefs RENAME COLUMN primary_email TO email';
      ELSE
        EXECUTE 'ALTER TABLE public.notification_prefs ADD COLUMN email text';
      END IF;
    END IF;
    -- Create the unique index only if email now exists
    IF EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_schema='public' AND table_name='notification_prefs' AND column_name='email') THEN
      EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS notification_prefs_email_key ON public.notification_prefs(email)';
    END IF;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS notification_prefs_updated_idx ON public.notification_prefs(updated_at DESC);
CREATE INDEX IF NOT EXISTS notification_prefs_categories_idx ON public.notification_prefs USING gin(categories);
ALTER TABLE IF EXISTS public.notification_prefs ADD COLUMN IF NOT EXISTS phone text; -- safety if table existed without phone

-- Radius guard trigger (ensure sane bounds 3..50 km)
CREATE OR REPLACE FUNCTION public.notification_prefs_radius_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.radius IS NULL THEN NEW.radius := 30; END IF;
  IF NEW.radius < 3 THEN NEW.radius := 3; END IF;
  IF NEW.radius > 50 THEN NEW.radius := 50; END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS notification_prefs_radius_guard_trg ON public.notification_prefs;
CREATE TRIGGER notification_prefs_radius_guard_trg
BEFORE INSERT OR UPDATE ON public.notification_prefs
FOR EACH ROW EXECUTE FUNCTION public.notification_prefs_radius_guard();

-- Log of early notification sends (enforces monthly caps in backend logic)
CREATE TABLE IF NOT EXISTS public.early_notify_sends (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  offer_id text NOT NULL,
  subcategory text,
  sent_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS early_notify_sends_unique ON public.early_notify_sends(email, offer_id);
CREATE INDEX IF NOT EXISTS early_notify_sends_email_time_idx ON public.early_notify_sends(email, sent_at DESC);

-- Inbox style records for in-app rendering of early notifications
CREATE TABLE IF NOT EXISTS public.early_notify_inbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  offer_id text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS early_notify_inbox_email_time_idx ON public.early_notify_inbox(email, created_at DESC);

-- Monthly aggregate view (count of sends per user for current month)
CREATE OR REPLACE VIEW public.view_early_notify_monthly AS
SELECT email,
       date_trunc('month', sent_at) AS month,
       count(*) AS sends
FROM public.early_notify_sends
WHERE sent_at >= date_trunc('month', now())
GROUP BY email, date_trunc('month', sent_at);

-- NOTE: Backend enforces EARLY_NOTIFY_CAP (env, default 25). This schema only stores events.
--       Reward linkage: reaching certain early-notify engagement milestones can trigger adding reward items
--       (e.g., auto-grant 'free_coupon_generic' when user first subscribes or reaches 10 early-notify sends in a month).
--       Such logic should call add_points or insert into rewards_ledger separately.

-- OPTIONAL: If PostGIS is enabled you can extend notification_prefs with geography point & GIST index for faster geo filtering.
-- See earlier migration notes.

-- =============== NOTES ===========================
-- award_revenue_points: call with purchase amount (in cents) to grant scalable points (no cap).
-- redeem_reward_item: for expanding catalog (add rows to reward_items).
-- Existing JS logic for caps can ignore revenue_* reasons to allow unlimited income-based rewards.
-- Adjust p_rate in award_revenue_points if you want faster or slower point accumulation.
-- Early-notify: tables notification_prefs, early_notify_sends, early_notify_inbox unify preference + delivery logging.
-- View view_early_notify_monthly aids monitoring & enforcing caps server-side.
-- IMPORTANT: Points can be awarded only with a valid p_user_id that exists in auth.users or public.users; email alone is not sufficient.

-- Optional perf: if offers table exists, add indexes used by early-notify queries
DO $$ BEGIN
  IF to_regclass('public.offers') IS NOT NULL THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS offers_publish_at_idx ON public.offers(publish_at)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS offers_subcategory_idx ON public.offers(subcategory)';
  END IF;
END $$;

-- End of migration.

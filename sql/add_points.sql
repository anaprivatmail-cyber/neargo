-- SQL: create event_views table and add_points RPC
-- Run this in your Supabase Postgres (psql or via SQL editor)

-- Table for tracking unique views of events/services
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Table: event_views (track views of events/services)
CREATE TABLE IF NOT EXISTS public.event_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  item_id text NOT NULL,
  item_type text NOT NULL,
  viewed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS event_views_user_viewed_idx ON public.event_views (user_id, viewed_at DESC);
CREATE INDEX IF NOT EXISTS event_views_item_idx ON public.event_views (item_id, item_type);

-- Table: rewards_ledger (audit trail of all point activity)
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

-- Table: wallets (current balance per user)
CREATE TABLE IF NOT EXISTS public.wallets (
  user_id uuid PRIMARY KEY,
  balance bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Table: user_points (legacy compatibility; keyed by email as used by some providers)
CREATE TABLE IF NOT EXISTS public.user_points (
  email text PRIMARY KEY,
  points bigint NOT NULL DEFAULT 0,
  last_award timestamptz
);

-- Table: notification_prefs (simple storage)
CREATE TABLE IF NOT EXISTS public.notification_prefs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  email text,
  categories text[],
  location jsonb,
  radius integer DEFAULT 30,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Table: referrals
CREATE TABLE IF NOT EXISTS public.referrals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id uuid,
  referred_email text,
  referred_user_id uuid,
  rewarded boolean DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Table: user_logins (for streaks/loyalty)
CREATE TABLE IF NOT EXISTS public.user_logins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  login_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS user_logins_user_idx ON public.user_logins (user_id, login_at DESC);

-- Table: badges (awarded badges)
CREATE TABLE IF NOT EXISTS public.badges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb,
  awarded_at timestamptz NOT NULL DEFAULT now()
);

-- RPC: add_points (atomic): inserts ledger entry, updates wallets, emits NOTIFY
CREATE OR REPLACE FUNCTION public.add_points(p_user_id uuid, p_points integer, p_reason text, p_metadata json DEFAULT '{}'::json)
RETURNS json LANGUAGE plpgsql AS $$
DECLARE
  v_email text := NULL;
  v_ledger_id uuid;
  v_payload json;
BEGIN
  -- resolve email if possible
  BEGIN
    SELECT email INTO v_email FROM public.users WHERE id = p_user_id LIMIT 1;
  EXCEPTION WHEN undefined_table THEN
    v_email := NULL;
  END;

  -- transactional: insert ledger and update wallet
  INSERT INTO public.rewards_ledger (id, user_id, email, points, reason, metadata, created_at)
  VALUES (gen_random_uuid(), p_user_id, v_email, p_points, p_reason, p_metadata::jsonb, now())
  RETURNING id INTO v_ledger_id;

  INSERT INTO public.wallets (user_id, balance, updated_at)
  VALUES (p_user_id, p_points, now())
  ON CONFLICT (user_id) DO
    UPDATE SET balance = public.wallets.balance + EXCLUDED.balance, updated_at = now();

  -- try to keep legacy table in sync if email present
  IF v_email IS NOT NULL THEN
    INSERT INTO public.user_points (email, points, last_award)
    VALUES (v_email, p_points, now())
    ON CONFLICT (email) DO
      UPDATE SET points = public.user_points.points + EXCLUDED.points, last_award = now();
  END IF;

  v_payload := json_build_object('type','reward','user_id', p_user_id, 'points', p_points, 'reason', p_reason, 'ledger_id', v_ledger_id);
  PERFORM pg_notify('neargo_rewards', v_payload::text);

  RETURN json_build_object('ok', true, 'ledger_id', v_ledger_id, 'points', p_points);
END;
$$;

-- RPC: query_event_views_7d: returns user_id and unique_count
CREATE OR REPLACE FUNCTION public.query_event_views_7d()
RETURNS TABLE(user_id uuid, unique_count integer) LANGUAGE sql AS $$
  SELECT ev.user_id, count(DISTINCT ev.item_id || '|' || ev.item_type) AS unique_count
  FROM public.event_views ev
  WHERE ev.viewed_at >= (now() - interval '7 days')
  GROUP BY ev.user_id
  HAVING count(DISTINCT ev.item_id || '|' || ev.item_type) >= 5
  ORDER BY unique_count DESC;
$$;

-- RPC: redeem_points (atomic): deducts from wallets and writes ledger, requires sufficient balance
CREATE OR REPLACE FUNCTION public.redeem_points(p_user_id uuid, p_points integer, p_reward_code text DEFAULT NULL)
RETURNS json LANGUAGE plpgsql AS $$
DECLARE
  v_balance bigint;
  v_ledger_id uuid;
BEGIN
  IF p_points <= 0 THEN
    RETURN json_build_object('ok', false, 'error', 'invalid_points');
  END IF;

  SELECT balance INTO v_balance FROM public.wallets WHERE user_id = p_user_id FOR UPDATE;
  IF NOT FOUND OR v_balance IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'no_balance');
  END IF;
  IF v_balance < p_points THEN
    RETURN json_build_object('ok', false, 'error', 'insufficient_points');
  END IF;

  UPDATE public.wallets SET balance = balance - p_points, updated_at = now() WHERE user_id = p_user_id;

  INSERT INTO public.rewards_ledger (id, user_id, points, reason, metadata, created_at)
  VALUES (gen_random_uuid(), p_user_id, -p_points, 'redeem', json_build_object('reward_code', p_reward_code), now())
  RETURNING id INTO v_ledger_id;

  PERFORM pg_notify('neargo_rewards', json_build_object('type','redeem','user_id', p_user_id, 'points', -p_points, 'ledger_id', v_ledger_id)::text);

  RETURN json_build_object('ok', true, 'ledger_id', v_ledger_id, 'remaining', (v_balance - p_points));
END;
$$;

-- RPC: convert_points (atomic): convert points to amount and deduct from wallet
CREATE OR REPLACE FUNCTION public.convert_points(p_user_id uuid, p_points integer, p_rate numeric DEFAULT 0.01)
RETURNS json LANGUAGE plpgsql AS $$
DECLARE
  v_balance bigint;
  v_amount numeric;
  v_ledger_id uuid;
BEGIN
  IF p_points <= 0 THEN
    RETURN json_build_object('ok', false, 'error', 'invalid_points');
  END IF;

  SELECT balance INTO v_balance FROM public.wallets WHERE user_id = p_user_id FOR UPDATE;
  IF NOT FOUND OR v_balance IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'no_balance');
  END IF;
  IF v_balance < p_points THEN
    RETURN json_build_object('ok', false, 'error', 'insufficient_points');
  END IF;

  UPDATE public.wallets SET balance = balance - p_points, updated_at = now() WHERE user_id = p_user_id;

  v_amount := round(p_points * p_rate::numeric, 2);
  INSERT INTO public.rewards_ledger (id, user_id, points, reason, metadata, created_at)
  VALUES (gen_random_uuid(), p_user_id, -p_points, 'convert', json_build_object('amount', v_amount), now())
  RETURNING id INTO v_ledger_id;

  PERFORM pg_notify('neargo_rewards', json_build_object('type','convert','user_id', p_user_id, 'points', -p_points, 'amount', v_amount, 'ledger_id', v_ledger_id)::text);

  RETURN json_build_object('ok', true, 'ledger_id', v_ledger_id, 'amount', v_amount, 'remaining', (v_balance - p_points));
END;
$$;

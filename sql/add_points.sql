-- SQL: create event_views table and add_points RPC
-- Run this in your Supabase Postgres (psql or via SQL editor)

-- Table for tracking unique views of events/services
CREATE TABLE IF NOT EXISTS public.event_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  item_id text NOT NULL,
  item_type text NOT NULL,
  viewed_at timestamptz NOT NULL DEFAULT now()
);

-- Index to speed queries by user and time
CREATE INDEX IF NOT EXISTS event_views_user_viewed_idx ON public.event_views (user_id, viewed_at DESC);
CREATE INDEX IF NOT EXISTS event_views_item_idx ON public.event_views (item_id, item_type);

-- add_points RPC: inserts into rewards_ledger and updates wallets atomically
-- Assumptions: tables `rewards_ledger` and `wallets` exist. Adjust column names if different in your schema.
-- This function will also emit a NOTIFY on channel 'neargo_rewards' with a small JSON payload so a realtime listener can react.
CREATE OR REPLACE FUNCTION public.add_points(p_user_id uuid, p_points integer, p_reason text, p_metadata json DEFAULT '{}'::json)
RETURNS json LANGUAGE plpgsql AS $$
DECLARE
  v_email text := NULL;
  v_ledger_id uuid;
  v_payload json;
BEGIN
  -- try to resolve email if users table exists
  BEGIN
    SELECT email INTO v_email FROM public.users WHERE id = p_user_id LIMIT 1;
  EXCEPTION WHEN undefined_table THEN
    v_email := NULL;
  END;

  -- insert ledger entry (adapt columns if your rewards_ledger has different names)
  INSERT INTO public.rewards_ledger (id, user_id, email, points, reason, metadata, created_at)
  VALUES (gen_random_uuid(), p_user_id, v_email, p_points, p_reason, p_metadata, now())
  RETURNING id INTO v_ledger_id;

  -- upsert wallets: create or increment balance
  BEGIN
    INSERT INTO public.wallets (user_id, balance, updated_at)
    VALUES (p_user_id, p_points, now())
    ON CONFLICT (user_id) DO
      UPDATE SET balance = public.wallets.balance + EXCLUDED.balance, updated_at = now();
  EXCEPTION WHEN undefined_table THEN
    -- if wallets table doesn't exist, ignore silently
    RAISE NOTICE 'wallets table not found, skipping balance update';
  END;

  -- emit a lightweight realtime notification for frontend listeners
  v_payload := json_build_object('type','reward','user_id', p_user_id, 'points', p_points, 'reason', p_reason, 'ledger_id', v_ledger_id);
  PERFORM pg_notify('neargo_rewards', v_payload::text);

  RETURN json_build_object('ok', true, 'ledger_id', v_ledger_id, 'points', p_points);
END;
$$;

-- Create premium_users table to gate early notifications to Premium only
CREATE TABLE IF NOT EXISTS public.premium_users (
  email text PRIMARY KEY,
  premium_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_premium_users_until ON public.premium_users (premium_until DESC);

-- Simple upsert helper view (optional)
CREATE OR REPLACE VIEW public.active_premium_users AS
  SELECT email FROM public.premium_users WHERE premium_until IS NOT NULL AND premium_until > now();

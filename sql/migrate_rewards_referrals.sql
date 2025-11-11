-- Create referral_codes table used by referral endpoints
CREATE TABLE IF NOT EXISTS public.referral_codes (
  user_id uuid PRIMARY KEY,
  code text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Optional index to search by code quickly (UNIQUE already adds one)
-- CREATE UNIQUE INDEX IF NOT EXISTS referral_codes_code_key ON public.referral_codes (code);

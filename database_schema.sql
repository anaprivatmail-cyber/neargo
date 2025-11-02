-- NearGo Database Schema for Login/Registration
-- Run this script in your Supabase SQL Editor

-- Create verification codes table
CREATE TABLE IF NOT EXISTS verif_codes (
  id SERIAL PRIMARY KEY,
  email TEXT,
  phone TEXT,
  code TEXT NOT NULL,
  used BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_verif_codes_email ON verif_codes(email);
CREATE INDEX IF NOT EXISTS idx_verif_codes_phone ON verif_codes(phone);
CREATE INDEX IF NOT EXISTS idx_verif_codes_code ON verif_codes(code);
CREATE INDEX IF NOT EXISTS idx_verif_codes_created_at ON verif_codes(created_at);
CREATE INDEX IF NOT EXISTS idx_verif_codes_used ON verif_codes(used);

-- Optional: Add a cleanup policy to remove old codes (older than 24 hours)
-- This helps keep the table size manageable
CREATE OR REPLACE FUNCTION cleanup_old_verif_codes()
RETURNS void AS $$
BEGIN
  DELETE FROM verif_codes
  WHERE created_at < NOW() - INTERVAL '24 hours';
END;
$$ LANGUAGE plpgsql;

-- Optional: Create a scheduled job to run cleanup daily
-- Note: This requires pg_cron extension to be enabled in Supabase
-- You can also manually run: SELECT cleanup_old_verif_codes();

-- Add RLS (Row Level Security) policies if needed
-- By default, we'll allow service role to manage this table
ALTER TABLE verif_codes ENABLE ROW LEVEL SECURITY;

-- Allow service role full access (used by backend functions)
CREATE POLICY "Service role can manage verif_codes"
  ON verif_codes
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Prevent public access to verification codes table
CREATE POLICY "Public cannot access verif_codes"
  ON verif_codes
  FOR ALL
  TO anon
  USING (false)
  WITH CHECK (false);

-- Optional: Add user metadata columns to auth.users if needed
-- This is handled automatically by Supabase when using user_metadata
-- but you can add custom fields to a separate profiles table

CREATE TABLE IF NOT EXISTS profiles (
  id UUID REFERENCES auth.users(id) PRIMARY KEY,
  first_name TEXT,
  last_name TEXT,
  phone TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS on profiles
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Users can read their own profile
CREATE POLICY "Users can view own profile"
  ON profiles
  FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

-- Users can update their own profile
CREATE POLICY "Users can update own profile"
  ON profiles
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Service role can manage all profiles
CREATE POLICY "Service role can manage profiles"
  ON profiles
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Create a function to automatically create a profile when a user signs up
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, first_name, last_name, phone)
  VALUES (
    new.id,
    COALESCE(new.raw_user_meta_data->>'first_name', ''),
    COALESCE(new.raw_user_meta_data->>'last_name', ''),
    COALESCE(new.raw_user_meta_data->>'phone', '')
  );
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger to call the function when a new user signs up
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Success message
DO $$
BEGIN
  RAISE NOTICE 'Database schema setup complete!';
  RAISE NOTICE 'Tables created: verif_codes, profiles';
  RAISE NOTICE 'Triggers created: on_auth_user_created';
  RAISE NOTICE 'Next steps:';
  RAISE NOTICE '1. Configure environment variables in Netlify';
  RAISE NOTICE '2. Test registration flow';
  RAISE NOTICE '3. (Optional) Enable pg_cron and schedule cleanup_old_verif_codes()';
END $$;

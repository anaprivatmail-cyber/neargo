-- Create table to store verified IAP receipts (Apple / Google)
-- This migration must run after migrate_premium.sql to ensure dependencies are met.

-- Ensure the pgcrypto extension is available for UUID generation
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Create the iap_receipts table to store in-app purchase receipts
CREATE TABLE IF NOT EXISTS public.iap_receipts (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY, -- Unique identifier for each receipt
  email text NOT NULL, -- User email associated with the receipt
  platform text NOT NULL CHECK (platform IN ('apple','google')), -- Platform: Apple or Google
  transaction_id text, -- Transaction ID (nullable for legacy compatibility)
  original_transaction_id text, -- Original transaction ID for subscription renewals
  expires_at timestamptz, -- Expiration timestamp for subscriptions
  raw jsonb, -- Raw receipt data for auditing/debugging
  created_at timestamptz DEFAULT now() -- Timestamp of record creation
);

-- Enable Row-Level Security (RLS) to restrict access
-- No policies are created intentionally; only the service role can access this table
ALTER TABLE public.iap_receipts ENABLE ROW LEVEL SECURITY;

-- Create indices to optimize common queries
CREATE INDEX IF NOT EXISTS idx_iap_receipts_email ON public.iap_receipts (email);
CREATE INDEX IF NOT EXISTS idx_iap_receipts_expires ON public.iap_receipts (expires_at DESC);
CREATE INDEX IF NOT EXISTS idx_iap_receipts_created ON public.iap_receipts (created_at DESC);

-- Add unique constraints to prevent duplicate transactions
CREATE UNIQUE INDEX IF NOT EXISTS uniq_iap_tx
  ON public.iap_receipts (platform, transaction_id)
  WHERE transaction_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_iap_original_tx
  ON public.iap_receipts (platform, original_transaction_id)
  WHERE original_transaction_id IS NOT NULL;

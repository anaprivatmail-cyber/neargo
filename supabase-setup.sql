-- Supabase SQL for NearGo payment system
-- Run these commands in your Supabase SQL Editor

-- Create user_subscriptions table for managing Premium and Provider subscriptions
CREATE TABLE IF NOT EXISTS user_subscriptions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID, -- can be NULL for anonymous users, link via purchase_token
  platform TEXT NOT NULL CHECK (platform IN ('stripe', 'apple', 'google')),
  subscription_id TEXT, -- Stripe subscription ID, Apple original_transaction_id, Google subscription ID
  purchase_token TEXT, -- Apple receipt, Google purchase token, Stripe subscription ID
  plan_type TEXT NOT NULL CHECK (plan_type IN ('premium', 'provider_grow', 'provider_pro')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'cancelled', 'pending')),
  
  -- Stripe specific
  stripe_customer_id TEXT,
  stripe_session_id TEXT,
  
  -- Apple specific
  apple_receipt_data JSONB,
  apple_original_transaction_id TEXT,
  
  -- Google specific  
  google_order_id TEXT,
  last_notification_type INTEGER,
  
  -- Provider specific features
  provider_features JSONB DEFAULT '{}', -- {"max_highlights": 3, "analytics": true, "api_access": true}
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  expires_at TIMESTAMP WITH TIME ZONE,
  
  -- Indexes
  UNIQUE(platform, purchase_token)
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_user_subscriptions_user_id ON user_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_subscriptions_platform_status ON user_subscriptions(platform, status);
CREATE INDEX IF NOT EXISTS idx_user_subscriptions_purchase_token ON user_subscriptions(purchase_token);

-- Create payment_events table for tracking all payment events
CREATE TABLE IF NOT EXISTS payment_events (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  subscription_id UUID REFERENCES user_subscriptions(id),
  event_type TEXT NOT NULL, -- 'purchase', 'renewal', 'cancellation', 'refund', etc.
  platform TEXT NOT NULL CHECK (platform IN ('stripe', 'apple', 'google')),
  amount_cents INTEGER, -- amount in cents
  currency TEXT DEFAULT 'EUR',
  platform_event_id TEXT, -- Stripe event ID, Apple notification ID, etc.
  raw_data JSONB, -- store the full webhook payload for debugging
  processed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payment_events_subscription_id ON payment_events(subscription_id);
CREATE INDEX IF NOT EXISTS idx_payment_events_platform_event_id ON payment_events(platform_event_id);

-- Create user_premium_status view for easy Premium status checking
CREATE OR REPLACE VIEW user_premium_status AS
SELECT 
  user_id,
  purchase_token,
  platform,
  plan_type,
  status,
  CASE 
    WHEN status = 'active' AND plan_type IN ('premium', 'provider_grow', 'provider_pro') THEN true
    ELSE false
  END as is_premium,
  CASE
    WHEN status = 'active' AND plan_type IN ('provider_grow', 'provider_pro') THEN plan_type
    ELSE 'free'
  END as provider_plan,
  provider_features,
  expires_at,
  updated_at
FROM user_subscriptions
WHERE status = 'active';

-- Create function to check Premium status by purchase token (for anonymous users)
CREATE OR REPLACE FUNCTION check_premium_status(token TEXT)
RETURNS TABLE(is_premium BOOLEAN, provider_plan TEXT, features JSONB) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    ups.is_premium,
    ups.provider_plan,
    COALESCE(ups.provider_features, '{}'::jsonb) as features
  FROM user_premium_status ups
  WHERE ups.purchase_token = token
  LIMIT 1;
  
  -- If no active subscription found, return free tier
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'free'::TEXT, '{}'::JSONB;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Row Level Security (RLS) policies
ALTER TABLE user_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_events ENABLE ROW LEVEL SECURITY;

-- Users can only see their own subscriptions
CREATE POLICY "Users can view own subscriptions" ON user_subscriptions
  FOR SELECT USING (auth.uid() = user_id);

-- Service role can manage all subscriptions (for webhooks)
CREATE POLICY "Service role full access" ON user_subscriptions
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role payment events" ON payment_events
  FOR ALL USING (auth.role() = 'service_role');

-- Grant necessary permissions
GRANT ALL ON user_subscriptions TO service_role;
GRANT ALL ON payment_events TO service_role;
GRANT SELECT ON user_premium_status TO anon, authenticated, service_role;
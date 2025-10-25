// netlify/functions/user-status.js  
// Check user's Premium and Provider subscription status
import { createClient } from '@supabase/supabase-js'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization'
}
const json = (d, s = 200) => ({
  statusCode: s,
  headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS },
  body: JSON.stringify(d),
})

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession:false } })

export async function handler(event) {
  try {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' }
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return json({ ok:false, error:'Missing SUPABASE env' }, 500)

    // Support both GET and POST
    let params = {}
    if (event.httpMethod === 'POST') {
      params = JSON.parse(event.body || '{}')
    } else {
      // GET parameters
      params = event.queryStringParameters || {}
    }

    const { userId, purchaseToken, platform } = params

    if (!userId && !purchaseToken) {
      return json({ ok: false, error: 'userId or purchaseToken required' }, 400)
    }

    let query = supa
      .from('user_premium_status')
      .select('*')

    if (userId) {
      query = query.eq('user_id', userId)
    } else if (purchaseToken) {
      query = query.eq('purchase_token', purchaseToken)
      if (platform) {
        query = query.eq('platform', platform)
      }
    }

    const { data, error } = await query.single()

    if (error) {
      // No active subscription found
      console.log('No active subscription found:', error.message)
      return json({
        ok: true,
        isPremium: false,
        providerPlan: 'free',
        features: {},
        status: 'free'
      })
    }

    return json({
      ok: true,
      isPremium: data.is_premium,
      providerPlan: data.provider_plan,
      features: data.provider_features || {},
      status: data.status,
      platform: data.platform,
      expiresAt: data.expires_at,
      updatedAt: data.updated_at
    })

  } catch (err) {
    console.error('[user-status] Error:', err)
    return json({ ok: false, error: 'Internal server error' }, 500)
  }
}
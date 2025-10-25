// netlify/functions/iap-google-verify.js
// Google Play Store webhook za subscription notifications
import { createClient } from '@supabase/supabase-js'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
}
const json = (d, s = 200) => ({
  statusCode: s,
  headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS },
  body: JSON.stringify(d),
})

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const GOOGLE_PLAY_PACKAGE_NAME = process.env.GOOGLE_PLAY_PACKAGE_NAME || '' // com.neargo.app

const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession:false } })

// Google Play Billing notification types
function mapNotificationToStatus(notificationType = 0) {
  const type = Number(notificationType)
  // 1 = SUBSCRIPTION_RECOVERED, 2 = SUBSCRIPTION_RENEWED, 4 = SUBSCRIPTION_PURCHASED
  if ([1, 2, 4].includes(type)) return 'active'
  // 3 = SUBSCRIPTION_CANCELLED, 12 = SUBSCRIPTION_EXPIRED, 13 = SUBSCRIPTION_REVOKED
  if ([3, 12, 13].includes(type)) return 'expired' 
  // 5 = SUBSCRIPTION_ON_HOLD, 6 = SUBSCRIPTION_IN_GRACE_PERIOD
  if ([5, 6].includes(type)) return 'active' // grace period still active
  return 'active' // default to active for unknown types
}

export async function handler(event) {
  try {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' }
    if (event.httpMethod !== 'POST') return json({ ok:false, error:'Method Not Allowed' }, 405)
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return json({ ok:false, error:'Missing SUPABASE env' }, 500)

    const body = JSON.parse(event.body||'{}')
    const { message } = body

    if (!message?.data) {
      console.log('[Google Play] No message.data in body:', body)
      return json({ ok: true, message: 'No data to process' })
    }

    // Decode base64 message
    let notification
    try {
      const decoded = Buffer.from(message.data, 'base64').toString('utf-8')
      notification = JSON.parse(decoded)
    } catch (err) {
      console.error('[Google Play] Failed to decode message:', err)
      return json({ ok: false, error: 'Invalid message format' }, 400)
    }

    const { subscriptionNotification, testNotification } = notification

    // Handle test notifications
    if (testNotification) {
      console.log('[Google Play] Test notification received:', testNotification)
      return json({ ok: true, message: 'Test notification processed' })
    }

    if (!subscriptionNotification) {
      console.log('[Google Play] No subscription notification found')
      return json({ ok: true, message: 'No subscription notification to process' })
    }

    const {
      version,
      notificationType,
      purchaseToken,
      subscriptionId
    } = subscriptionNotification

    // Validate package name if provided
    if (GOOGLE_PLAY_PACKAGE_NAME && notification.packageName !== GOOGLE_PLAY_PACKAGE_NAME) {
      console.log(`[Google Play] Package name mismatch: expected ${GOOGLE_PLAY_PACKAGE_NAME}, got ${notification.packageName}`)
      return json({ ok: false, error: 'Package name mismatch' }, 400)
    }

    // Determine subscription status
    const status = mapNotificationToStatus(notificationType)
    const now = new Date().toISOString()

    console.log(`[Google Play] Processing notification: type=${notificationType}, token=${purchaseToken}, status=${status}`)

    // Store in user_subscriptions table
    const { data: existingSub } = await supa
      .from('user_subscriptions')
      .select('*')
      .eq('purchase_token', purchaseToken)
      .eq('platform', 'google')
      .single()

    if (existingSub) {
      // Update existing subscription
      const { error: updateError } = await supa
        .from('user_subscriptions')
        .update({
          status,
          last_notification_type: notificationType,
          updated_at: now
        })
        .eq('id', existingSub.id)

      if (updateError) {
        console.error('[Google Play] Failed to update subscription:', updateError)
        return json({ ok: false, error: 'Failed to update subscription' }, 500)
      }

      console.log(`[Google Play] Updated subscription ${existingSub.id} to status: ${status}`)
    } else {
      // Create new subscription record
      const { error: insertError } = await supa
        .from('user_subscriptions')
        .insert({
          platform: 'google',
          subscription_id: subscriptionId,
          purchase_token: purchaseToken,
          status,
          plan_type: 'premium', // Default to premium, can be updated later
          last_notification_type: notificationType,
          created_at: now,
          updated_at: now
        })

      if (insertError) {
        console.error('[Google Play] Failed to create subscription:', insertError)
        return json({ ok: false, error: 'Failed to create subscription' }, 500)
      }

      console.log(`[Google Play] Created new subscription for token: ${purchaseToken}`)
    }

    return json({ ok: true, message: 'Notification processed successfully' })

  } catch (err) {
    console.error('[Google Play] Fatal error:', err)
    return json({ ok: false, error: 'Internal server error' }, 500)
  }
}
// netlify/functions/iap-apple-notify.js
import { createClient } from '@supabase/supabase-js'
import { jwtVerify, decodeProtectedHeader, importX509 } from 'jose'

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
const APP_BUNDLE_ID = process.env.APPLE_APP_BUNDLE_ID || '' // npr. com.neargo.app

const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession:false } })

async function verifyAppleJws(compactJws) {
  const header = decodeProtectedHeader(compactJws)
  const x5cArr = header?.x5c
  if (!x5cArr || !Array.isArray(x5cArr) || !x5cArr.length) {
    throw new Error('Apple JWS manjka x5c header')
  }
  const alg = header.alg || 'ES256'
  const pem = `-----BEGIN CERTIFICATE-----\n${x5cArr[0]}\n-----END CERTIFICATE-----`
  const key = await importX509(pem, alg)
  const { payload, protectedHeader } = await jwtVerify(compactJws, key, { algorithms: [alg] })
  return { payload, header: protectedHeader }
}
const msToIso = (ms) => (ms ? new Date(Number(ms)).toISOString() : null)

function mapNotificationToStatus(notificationType = '') {
  const t = String(notificationType||'').toUpperCase()
  if (['SUBSCRIBED','DID_RENEW','DID_RECOVER'].includes(t)) return 'active'
  if (['EXPIRED','REFUND','REVOKED'].includes(t)) return 'expired'
  if (['GRACE_PERIOD_EXPIRED','DID_FAIL_TO_RENEW','BILLING_RETRY'].includes(t)) return 'active'
  return 'active'
}

export async function handler(event) {
  try {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' }
    if (event.httpMethod !== 'POST') return json({ ok:false, error:'Method Not Allowed' }, 405)
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return json({ ok:false, error:'Missing SUPABASE env' }, 500)

    const body = JSON.parse(event.body||'{}')
    const signedPayload = body?.signedPayload
    if (!signedPayload) return json({ ok:false, error:'Missing signedPayload' }, 400)

    // 1) preveri top-level JWS podpis (brez APPLE_SHARED_SECRET)
    const { payload: top } = await verifyAppleJws(signedPayload)

    // varnostni check
    if (top?.iss && top.iss !== 'appstoreconnect-v1') throw new Error(`Nepričakovani issuer: ${top.iss}`)
    if (APP_BUNDLE_ID && top?.data?.bundleId && top.data.bundleId !== APP_BUNDLE_ID) {
      throw new Error(`BundleId mismatch: ${top.data.bundleId}`)
    }

    const notificationType = String(top?.notificationType||'')
    const signedTx = top?.data?.signedTransactionInfo
    const signedRenewal = top?.data?.signedRenewalInfo

    let tx = null, renewal = null
    if (typeof signedTx === 'string') {
      const v = await verifyAppleJws(signedTx)
      tx = v.payload
    }
    if (typeof signedRenewal === 'string') {
      const r = await verifyAppleJws(signedRenewal)
      renewal = r.payload
    }

    const originalTransactionId =
      tx?.originalTransactionId || tx?.original_transaction_id || top?.data?.originalTransactionId || null
    const productId = tx?.productId || top?.data?.productId || null

    let expiresMs =
      (tx?.expiresDateMs && Number(tx.expiresDateMs)) ||
      (tx?.expiresDate    && Number(tx.expiresDate)) ||
      (renewal?.gracePeriodExpiresDate && Number(renewal.gracePeriodExpiresDate)) ||
      null

    const validUntil = expiresMs ? msToIso(expiresMs) : null
    let autoRenew = true
    if (typeof renewal?.autoRenewStatus !== 'undefined') {
      const raw = String(renewal.autoRenewStatus)
      autoRenew = raw === '1' || raw.toUpperCase() === 'ON'
    }
    const status = mapNotificationToStatus(notificationType)

    if (originalTransactionId) {
      await supa.from('subscriptions').upsert({
        provider_sub_id: String(originalTransactionId),
        platform: 'apple',
        product_id: productId || null,
        status,
        current_period_end: validUntil,
        auto_renew: autoRenew,
        updated_at: new Date().toISOString()
      }, { onConflict: 'provider_sub_id' })
    }

    return json({ ok:true, type:notificationType, provider_sub_id:originalTransactionId })
  } catch (e) {
    console.error('[iap-apple-notify] error:', e?.message||e)
    // Apple pričakuje 200 OK, tudi če je interna napaka — da ne pinga v nedogled
    return json({ ok:true })
  }
}

// netlify/functions/iap-verify.js
// Consolidated skeleton for native IAP verification (Apple / Google) -> grants Premium.
// TEST MODE ONLY: If env IAP_VERIFY_TEST='1', any non-empty receipt/token is accepted and grants +1 month.
// Production: implement real verification (Apple verifyReceipt, Google AndroidPublisher) before enabling.

import { createClient } from '@supabase/supabase-js';
import { rateLimit, tooMany } from './_guard.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supa = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession:false } });

const CORS = { 'Access-Control-Allow-Origin':'*', 'Access-Control-Allow-Methods':'POST,OPTIONS', 'Access-Control-Allow-Headers':'content-type' };
const json = (body, statusCode=200) => ({ statusCode, headers:{ 'content-type':'application/json', ...CORS }, body:JSON.stringify(body) });
const bad  = (msg, code=400) => json({ ok:false, error:msg }, code);

function addMonths(date, months){ const d=new Date(date); d.setMonth(d.getMonth()+months); return d; }
function parseDateMaybe(v){ if(!v) return null; const d=new Date(v); return isNaN(d.getTime())?null:d; }

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode:204, headers:CORS, body:'' };
  if (event.httpMethod !== 'POST') return bad('use_post',405);

  // Simple rate limit: 10 requests / minute per IP
  const rl = await rateLimit(event, 'iap-verify', 10, 60);
  if (rl.blocked) return tooMany(60);

  let body; try { body = JSON.parse(event.body||'{}'); } catch { return bad('invalid_json'); }
  const platform = (body.platform||'').toLowerCase();
  const email    = (body.email||'').trim().toLowerCase();
  const rawReceipt = body.receipt || body.token || body.raw || null; // Accept several field names
  const providedExpires = parseDateMaybe(body.expires_at); // Optional hint (e.g. from client SDK sandbox)

  if (!email) return bad('missing_email');
  if (!platform || !['apple','google'].includes(platform)) return bad('invalid_platform');
  if (!rawReceipt) return bad('missing_receipt');

  const TEST_MODE = process.env.IAP_VERIFY_TEST === '1';
  if (!TEST_MODE) {
    // Placeholder for real verification logic.
    // Apple: POST https://buy.itunes.apple.com/verifyReceipt (or sandbox URL) with shared secret -> validate status===0.
    // Google: Use AndroidPublisher API (purchases.subscriptions / products) with service account credentials.
    return bad('verification_not_implemented',501);
  }

  // Simulate / accept receipt: choose expiration (provided hint OR +1 month from now)
  const now = new Date();
  let expiresAt = providedExpires && providedExpires.getTime() > now.getTime() ? providedExpires : addMonths(now,1);

  // Extend existing future premium_until by +1 month (stacking months in test mode)
  try {
    const { data: cur } = await supa.from('premium_users').select('premium_until').eq('email', email).maybeSingle();
    if (cur?.premium_until) {
      const curDate = new Date(cur.premium_until);
      if (!isNaN(curDate) && curDate.getTime() > Date.now()) {
        expiresAt = addMonths(curDate,1);
      }
    }
    await supa.from('premium_users').upsert({ email, premium_until: expiresAt.toISOString(), updated_at: new Date().toISOString() }, { onConflict:'email' });
  } catch (e) {
    return bad('db_error:'+e.message,500);
  }

  // Store receipt audit row
  try {
    await supa.from('iap_receipts').insert({
      email,
      platform,
      transaction_id: 'TEST-'+Date.now(),
      original_transaction_id: null,
      expires_at: expiresAt.toISOString(),
      raw: { test:true, received: rawReceipt },
      created_at: new Date().toISOString()
    });
  } catch {/* non-fatal */}

  return json({ ok:true, premium_until: expiresAt.toISOString(), test:true });
};

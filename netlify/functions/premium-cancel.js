// netlify/functions/premium-cancel.js (ESM)
// Preklic (takojšnja deaktivacija) Premium – nastavi premium_until v preteklost.
// Preprosta različica: ne obravnava Stripe naročnin (ker so enkratna plačila).
// Če kasneje uvedeš dejanske Stripe subscriptions, shrani subscription_id in kliči stripe.subscriptions.update(...)

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supa = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession:false } });

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};
const ok  = (b)=>({ statusCode:200, headers:{'content-type':'application/json', ...CORS}, body:JSON.stringify(b) });
const bad = (m,s=400)=>({ statusCode:s, headers:{'content-type':'application/json', ...CORS}, body:JSON.stringify({ ok:false, error:m }) });

export const handler = async (event) => {
  try {
    if(event.httpMethod === 'OPTIONS') return { statusCode:204, headers:CORS, body:'' };
    if(event.httpMethod !== 'POST') return bad('method_not_allowed', 405);
    let body = {};
    try{ body = JSON.parse(event.body||'{}'); }catch{}
    const email = (body.email||'').trim().toLowerCase();
    if(!email) return bad('missing_email');

    // Set premium_until to past (1 second ago) – immediate expiry.
    const past = new Date(Date.now() - 1000).toISOString();
    const { error } = await supa.from('premium_users').upsert({ email, premium_until: past, updated_at: new Date().toISOString() }, { onConflict:'email' });
    if(error) return bad('db_error');
    return ok({ ok:true, premium:false });
  } catch(e){
    return bad(e?.message || 'server_error', 500);
  }
};

// netlify/functions/rewards-premium-redeem.js
// Spend 500 points to grant +1 month Premium. Atomic via redeem_points RPC; extends premium_users.
// Safeguards: checks sufficient balance, uses reward_code 'premium_month' to avoid duplicate manual grants.
import { createClient } from '@supabase/supabase-js';
const SUPABASE_URL = process.env.SUPABASE_URL; const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supa = createClient(SUPABASE_URL, SERVICE_KEY, { auth:{ persistSession:false } });

const CORS = { 'Access-Control-Allow-Origin':'*', 'Access-Control-Allow-Methods':'POST,OPTIONS', 'Access-Control-Allow-Headers':'content-type' };
const ok  = (b)=>({ statusCode:200, headers:{ 'content-type':'application/json', ...CORS }, body: JSON.stringify(b) });
const bad = (m,s=400)=>({ statusCode:s, headers:{ 'content-type':'application/json', ...CORS }, body: JSON.stringify({ ok:false, error:m }) });

const REQUIRED_POINTS = 500;

export const handler = async (event) => {
  try{
    if (event.httpMethod === 'OPTIONS') return { statusCode:204, headers:CORS, body:'' };
    if (event.httpMethod !== 'POST') return bad('use_post',405);
    let body={}; try{ body = JSON.parse(event.body||'{}'); }catch{ return bad('invalid_json'); }
    const email = (body.email||'').trim().toLowerCase();
    if (!email) return bad('missing_email');

    // Resolve user id
    let userId=null; try{ const u = await supa.auth.admin.getUserByEmail(email); if(u?.data?.user?.id) userId=u.data.user.id; }catch{}
    if(!userId) return bad('user_not_found',404);

    // Check current wallet balance (FOR UPDATE occurs inside RPC; we just do a quick pre-check) and existing premium_until
    let premiumUntil=null; try{ const { data: pu } = await supa.from('premium_users').select('premium_until').eq('email', email).maybeSingle(); if(pu?.premium_until) premiumUntil = pu.premium_until; }catch{}
    let balance=0; try{ const { data: w } = await supa.from('wallets').select('balance').eq('user_id', userId).maybeSingle(); if(w?.balance!=null) balance = Number(w.balance); }catch{}
    if (balance < REQUIRED_POINTS) return bad('insufficient_points',402);

    // Redeem points atomically
    const rpc = await supa.rpc('redeem_points', { p_user_id: userId, p_points: REQUIRED_POINTS, p_reward_code: 'premium_month' });
    if (!rpc || !rpc.data || !rpc.data.ok) return bad('redeem_failed:'+(rpc?.data?.error||'unknown'),500);

    // Extend premium by 1 month from later of now or existing future premium_until
    let start = new Date();
    if (premiumUntil && new Date(premiumUntil).getTime() > Date.now()) start = new Date(premiumUntil);
    start.setUTCMonth(start.getUTCMonth() + 1);
    const newUntil = start.toISOString();

    try{
      await supa.from('premium_users').upsert({ email, premium_until: newUntil, updated_at: new Date().toISOString() }, { onConflict:'email' });
    }catch(e){
      // Attempt rollback? (Cannot re-credit inside function easily). Log and surface partial failure.
      console.error('[premium_redeem] upsert failed', e.message||e);
      return bad('premium_extend_failed',500);
    }

    // Optional badge awarding if first time premium via points
    try{
      if(!premiumUntil){ await supa.from('badges').insert({ user_id:userId, name:'premium_via_points', metadata:{ first:true } }); }
    }catch{}

    return ok({ ok:true, granted_until: newUntil, spent: REQUIRED_POINTS, remaining: rpc.data.remaining });
  }catch(e){ return bad(e?.message||e,500); }
};

// netlify/functions/rewards-auto-grant.js
// Generic endpoint to grant points for a specific user action, respecting cooldowns and monthly caps.
import { createClient } from '@supabase/supabase-js';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supa = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const CORS = { 'Access-Control-Allow-Origin':'*', 'Access-Control-Allow-Methods':'POST,OPTIONS', 'Access-Control-Allow-Headers':'content-type' };
const ok = (b)=>({ statusCode:200, headers:{ 'content-type':'application/json', ...CORS }, body: JSON.stringify(b) });
const bad = (m,s=400)=>({ statusCode:s, headers:{ 'content-type':'application/json', ...CORS }, body: JSON.stringify({ ok:false, error:m }) });

const MONTHLY_CAP = 300; // points per user per calendar month

export const handler = async (event) => {
  try{
    if (event.httpMethod === 'OPTIONS') return { statusCode:204, headers:CORS, body:'' };
    if (event.httpMethod !== 'POST') return bad('use_post',405);
    let body = {};
    try{ body = JSON.parse(event.body||'{}'); }catch(e){ return bad('invalid_json'); }
    const user_id = body.user_id || null;
    const action = body.action || '';
    const item_id = body.item_id || null;
    const metadata = body.metadata || {};
    if (!user_id || !action) return bad('missing_user_or_action');

    // Determine points and rules per action
    let points = 0;
    let reason = action;
    let cooldownDays = 0; // per-item cooldown
    let dailyLimit = false; // 1x/day

    switch(action){
      case 'favorite': points = 5; cooldownDays = 7; break;
      case 'share': points = 10; dailyLimit = true; break;
      case 'review_approved': points = 20; break;
      case 'notifications_setup': points = 10; break;
      case 'want': points = 5; cooldownDays = 7; break;
      case 'purchase_coupon': points = 20; break;
      case 'purchase_ticket': points = 10; break;
      case 'use_coupon': points = 5; break;
      case 'monthly_premium_renewal': points = 30; break;
      case 'referral_register': points = 50; break;
      case 'referral_premium': points = 100; break;
      case 'top_contributor': points = 200; break;
      case 'return_after_30': points = 10; break;
      case 'anniversary': points = 50; break;
      default:
        return bad('unknown_action');
    }

    // Monthly cap check
    const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0,0,0,0);
    const { data: rows2, error: rowsErr } = await supa.from('rewards_ledger').select('points').gte('created_at', monthStart.toISOString()).eq('user_id', user_id);
    if (rowsErr) console.warn('monthly_sum_err', rowsErr.message);
    const currentMonthTotal = (rows2 || []).reduce((s,r)=>s + (r.points||0), 0);
    if (currentMonthTotal >= MONTHLY_CAP) return ok({ ok:false, skipped:'monthly_cap_reached' });
    if (currentMonthTotal + points > MONTHLY_CAP) {
      points = Math.max(0, MONTHLY_CAP - currentMonthTotal);
      if (points === 0) return ok({ ok:false, skipped:'monthly_cap_reached' });
    }

    // Cooldown per item: check rewards_ledger for same reason and same item_id within cooldownDays
    if (cooldownDays > 0 && item_id){
      const since = new Date(Date.now() - cooldownDays*24*60*60*1000).toISOString();
      const { data: prev, error: pErr } = await supa.from('rewards_ledger').select('id').eq('user_id', user_id).eq('reason', action).gte('created_at', since).filter("metadata->>item_id", 'eq', String(item_id));
      if (pErr) console.warn('cooldown_check_err', pErr.message);
      if (prev && prev.length>0) return ok({ ok:false, skipped:'cooldown' });
    }

    // daily limit check (1x/day)
    if (dailyLimit){
      const startOfDay = new Date(); startOfDay.setHours(0,0,0,0);
      const { data: today, error: tErr } = await supa.from('rewards_ledger').select('id').eq('user_id', user_id).eq('reason', action).gte('created_at', startOfDay.toISOString());
      if (tErr) console.warn('daily_check_err', tErr.message);
      if (today && today.length>0) return ok({ ok:false, skipped:'daily_limit' });
    }

    // notifications_setup: only once
    if (action === 'notifications_setup'){
      const { data: ex, error: exErr } = await supa.from('rewards_ledger').select('id').eq('user_id', user_id).eq('reason', action).limit(1);
      if (ex && ex.length>0) return ok({ ok:false, skipped:'already_set' });
    }

    // perform add_points RPC
    const meta = Object.assign({}, metadata || {});
    if (item_id) meta.item_id = item_id;
    const { data: rpcRes, error: rpcErr } = await supa.rpc('add_points', { p_user_id: user_id, p_points: points, p_reason: action, p_metadata: JSON.stringify(meta) });
    if (rpcErr) return bad('rpc_error:'+rpcErr.message,500);

    return ok({ ok:true, granted: points, rpc: rpcRes });
  }catch(e){ console.error(e); return bad(String(e?.message||e),500); }
};

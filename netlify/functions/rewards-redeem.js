// netlify/functions/rewards-redeem.js
import { createClient } from '@supabase/supabase-js';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supa = createClient(SUPABASE_URL, SERVICE_KEY, { auth:{ persistSession:false } });

const CORS = { 'Access-Control-Allow-Origin':'*', 'Access-Control-Allow-Methods':'POST,OPTIONS', 'Access-Control-Allow-Headers':'content-type' };
const ok = (b)=>({ statusCode:200, headers:{ 'content-type':'application/json', ...CORS }, body: JSON.stringify(b) });
const bad = (m,s=400)=>({ statusCode:s, headers:{ 'content-type':'application/json', ...CORS }, body: JSON.stringify({ ok:false, error:m }) });

export const handler = async (event) => {
  try{
    if (event.httpMethod === 'OPTIONS') return { statusCode:204, headers:CORS, body:'' };
    if (event.httpMethod !== 'POST') return bad('use_post',405);
    let body = {};
    try{ body = JSON.parse(event.body||'{}'); }catch(e){ return bad('invalid_json'); }
    const email = (body.email||'').trim();
    const points = Number(body.points||0);
    const reward_code = (body.reward_code||'').trim();
    if (!email) return bad('missing_email');
    if (!points || points <= 0) return bad('invalid_points');
    if (!reward_code) return bad('missing_reward_code');

    // check points
    const { data: up, error: upErr } = await supa.from('user_points').select('points').eq('email', email).single();
    if (upErr) return bad('db_error_read:'+upErr.message,500);
    const current = (up && up.points) || 0;
    if (current < points) return bad('insufficient_points',402);

    // deduct points (non-transactional)
    const { error: decErr } = await supa.from('user_points').update({ points: current - points }).eq('email', email);
    if (decErr) return bad('db_error_update:'+decErr.message,500);

    // create ledger entry marking redemption
    const ledger = {
      email,
      type: 'redeem',
      points: points,
      reward_code,
      created_at: new Date().toISOString()
    };
    const { error: insErr } = await supa.from('rewards_ledger').insert(ledger);
    if (insErr) return bad('db_error_insert:'+insErr.message,500);

    return ok({ ok:true, remaining: current - points, reward_code });
  }catch(e){ return bad(String(e?.message||e),500); }
};

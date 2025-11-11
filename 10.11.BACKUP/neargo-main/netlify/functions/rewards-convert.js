// netlify/functions/rewards-convert.js
import { createClient } from '@supabase/supabase-js';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supa = createClient(SUPABASE_URL, SERVICE_KEY, { auth:{ persistSession:false } });

const CORS = { 'Access-Control-Allow-Origin':'*', 'Access-Control-Allow-Methods':'POST,OPTIONS', 'Access-Control-Allow-Headers':'content-type' };
const ok = (b)=>({ statusCode:200, headers:{ 'content-type':'application/json', ...CORS }, body: JSON.stringify(b) });
const bad = (m,s=400)=>({ statusCode:s, headers:{ 'content-type':'application/json', ...CORS }, body: JSON.stringify({ ok:false, error:m }) });

// simple conversion: 1 point = $0.01 (configurable later)
const POINT_TO_DOLLAR = 0.01;

export const handler = async (event) => {
  try{
    if (event.httpMethod === 'OPTIONS') return { statusCode:204, headers:CORS, body:'' };
    if (event.httpMethod !== 'POST') return bad('use_post',405);
    let body = {};
    try{ body = JSON.parse(event.body||'{}'); }catch(e){ return bad('invalid_json'); }
    const email = (body.email||'').trim();
    const points = Number(body.points||0);
    if (!email) return bad('missing_email');
    if (!points || points <= 0) return bad('invalid_points');

    // Try to resolve user_id using admin API
    let userId = null;
    try{
      const adminRes = await supa.auth.admin.getUserByEmail(email);
      if (adminRes?.data?.user && adminRes.data.user.id) userId = adminRes.data.user.id;
    }catch(e){ /* ignore, fallback to email-based path */ }

    // If we have userId, try calling atomic RPC convert_points
    if (userId){
      try{
        const rpc = await supa.rpc('convert_points', { p_user_id: userId, p_points: points, p_rate: POINT_TO_DOLLAR });
        if (rpc && rpc.data) {
          return ok(Object.assign({ ok:true }, rpc.data));
        }
      }catch(rpcErr){
        console.warn('convert_points rpc failed, falling back to legacy logic', rpcErr.message || rpcErr);
      }
    }

    // Legacy fallback (email-keyed user_points) — non-atomic
    const { data: up, error: upErr } = await supa.from('user_points').select('points').eq('email', email).single();
    if (upErr) return bad('db_error_read:'+upErr.message,500);
    const current = (up && up.points) || 0;
    if (current < points) return bad('insufficient_points',402);

    // deduct points (non-transactional)
    const { error: decErr } = await supa.from('user_points').update({ points: current - points }).eq('email', email);
    if (decErr) return bad('db_error_update:'+decErr.message,500);

    const converted_amount = Math.round(points * POINT_TO_DOLLAR * 100) / 100; // euros
    const ledger = {
      email,
      type: 'convert',
      points: points,
      amount: converted_amount,
      note: body.note || null,
      created_at: new Date().toISOString()
    };
    const { error: insErr } = await supa.from('rewards_ledger').insert(ledger);
    if (insErr) return bad('db_error_insert:'+insErr.message,500);

    return ok({ ok:true, converted_amount, remaining: current - points });
  }catch(e){ return bad(String(e?.message||e),500); }
};

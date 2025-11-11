// netlify/functions/cron-rewards-views.js
// Daily job: check event_views for unique views in the last 7 days and grant 10 points for each group of 5 unique views
import { createClient } from '@supabase/supabase-js';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supa = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const CORS = { 'Access-Control-Allow-Origin':'*', 'Access-Control-Allow-Methods':'GET,OPTIONS,POST', 'Access-Control-Allow-Headers':'content-type' };
const ok = (b)=>({ statusCode:200, headers:{ 'content-type':'application/json', ...CORS }, body: JSON.stringify(b) });
const bad = (m,s=400)=>({ statusCode:s, headers:{ 'content-type':'application/json', ...CORS }, body: JSON.stringify({ ok:false, error:m }) });

export const handler = async (event) => {
  try{
    if (event.httpMethod === 'OPTIONS') return { statusCode:204, headers:CORS, body:'' };
    // allow GET or POST (cron triggers often use GET)
    if (!['GET','POST'].includes(event.httpMethod)) return bad('use_get_or_post',405);

    // find users with distinct item views in last 7 days
    const since = new Date(Date.now() - 7*24*60*60*1000).toISOString();
    const { data: rows, error } = await supa.rpc('query_event_views_7d');
    // note: if rpc not available, fallback to SQL query
    let users = [];
    if (error || !rows) {
      // fallback: aggregate via from
      const { data, error: qerr } = await supa
        .from('event_views')
        .select('user_id, item_id', { count: 'exact', head: false })
        .gte('viewed_at', since);
      if (qerr) return bad('db_error:'+qerr.message,500);
      // aggregate unique item counts per user
      const map = new Map();
      (data||[]).forEach(r=>{
        const uid = r.user_id || 'anon';
        const key = uid;
        if (!map.has(key)) map.set(key, new Set());
        map.get(key).add(r.item_id + '|' + (r.item_type||''));
      });
      users = Array.from(map.entries()).map(([user_id, set])=>({ user_id, unique_count: set.size }));
    } else {
      users = rows; // expected shape: [{user_id, unique_count}]
    }

    const grants = [];
    for (const u of users) {
      const user_id = u.user_id;
      const uniq = u.unique_count || 0;
      if (!user_id || uniq < 5) continue;
      const shouldBe = Math.floor(uniq / 5);
      // count existing view_bonus grants in last 7 days
      const { data: existing, error: e2 } = await supa.from('rewards_ledger').select('id').eq('user_id', user_id).eq('reason','view_bonus').gte('created_at', since);
      if (e2) return bad('db_error:'+e2.message,500);
      const existingCount = (existing || []).length;
      const toGive = shouldBe - existingCount;
      for (let i=0;i<toGive;i++){
        // call add_points RPC
        const { data: rpcRes, error: rpcErr } = await supa.rpc('add_points', { p_user_id: user_id, p_points: 10, p_reason: 'view_bonus', p_metadata: JSON.stringify({ window_start: since }) });
        if (rpcErr) {
          // log and continue
          console.error('rpc_err', rpcErr.message);
        } else {
          grants.push({ user_id, granted:10, ledger: rpcRes });
        }
      }
    }

    return ok({ ok:true, grants_count: grants.length, grants });
  }catch(e){ console.error(e); return bad(String(e?.message||e),500); }
};

// netlify/functions/early-notify-count.js
// Returns monthly early notification send count + cap for a given email
// GET /api/early-notify-count?email=...
// Response: { ok:true, email, sent, cap }

import { createClient } from '@supabase/supabase-js';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supa = createClient(SUPABASE_URL, SERVICE_KEY, { auth:{ persistSession:false } });

const CORS = { 'Access-Control-Allow-Origin':'*', 'Access-Control-Allow-Methods':'GET,OPTIONS', 'Access-Control-Allow-Headers':'content-type' };
const ok = (b)=>({ statusCode:200, headers:{ 'content-type':'application/json', ...CORS }, body: JSON.stringify(b) });
const bad = (m,s=400)=>({ statusCode:s, headers:{ 'content-type':'application/json', ...CORS }, body: JSON.stringify({ ok:false, error:m }) });

export const handler = async (event) => {
  try{
    if (event.httpMethod === 'OPTIONS') return { statusCode:204, headers:CORS, body:'' };
    if (event.httpMethod !== 'GET') return bad('use_get',405);
    const qs = event.queryStringParameters || {};
    const email = (qs.email||'').trim();
    if (!email) return bad('missing_email');
    const monthStart = new Date(); monthStart.setUTCDate(1); monthStart.setUTCHours(0,0,0,0);
    let sent = 0;
    try{
      const { count, error } = await supa
        .from('early_notify_sends')
        .select('*', { head:true, count:'exact' })
        .eq('email', email)
        .gte('sent_at', monthStart.toISOString());
      if (!error && typeof count === 'number') sent = count;
    }catch(e){ /* ignore */ }
    const cap = Number(process.env.EARLY_NOTIFY_CAP || 25);
    return ok({ ok:true, email, sent, cap });
  }catch(e){ return bad(String(e?.message||e),500); }
};

// netlify/functions/record-view.js
// Secure endpoint: accepts POST { item_id, item_type }
// Requires Authorization: Bearer <access_token> (Supabase user JWT)
import { createClient } from '@supabase/supabase-js';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supa = createClient(SUPABASE_URL, SERVICE_KEY, { auth:{ persistSession:false } });

const CORS = { 'Access-Control-Allow-Origin':'*', 'Access-Control-Allow-Methods':'POST,OPTIONS', 'Access-Control-Allow-Headers':'content-type,authorization' };
const ok = (b)=>({ statusCode:200, headers:{ 'content-type':'application/json', ...CORS }, body: JSON.stringify(b) });
const bad = (m,s=400)=>({ statusCode:s, headers:{ 'content-type':'application/json', ...CORS }, body: JSON.stringify({ ok:false, error:m }) });

export const handler = async (event) => {
  try{
    if (event.httpMethod === 'OPTIONS') return { statusCode:204, headers:CORS, body:'' };
    if (event.httpMethod !== 'POST') return bad('use_post',405);
    let body = {};
    try{ body = JSON.parse(event.body||'{}'); }catch(e){ return bad('invalid_json'); }

    const auth = (event.headers.authorization || event.headers.Authorization || '').trim();
    const token = auth.startsWith('Bearer ') ? auth.split(' ')[1] : (body.token || '');
    if (!token) return bad('missing_token',401);

    // verify token -> get user
    const { data: userData, error: userErr } = await supa.auth.getUser(token);
    if (userErr || !userData?.user) return bad('invalid_token',401);
    const user = userData.user;

    const item_id = (body.item_id || body.event_id || '').toString();
    const item_type = (body.item_type || 'event').toString();
    if (!item_id) return bad('missing_item_id');

    // Prevent spam: we still insert; deduping/uniqueness handled by cron and aggregation.
    const { error: insErr } = await supa.from('event_views').insert({ user_id: user.id, item_id, item_type, viewed_at: new Date().toISOString() });
    if (insErr) return bad('db_error:'+insErr.message,500);
    return ok({ ok:true });
  }catch(e){ return bad(String(e?.message||e),500); }
};

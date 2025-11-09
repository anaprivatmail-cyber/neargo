// netlify/functions/early-inbox.js
// GET:  /api/early-inbox?email=...&limit=5&mark=1  => returns latest unread + optionally mark read
// POST: { email, offer_id, payload }               => insert new inbox item (internal use by other functions)

import { createClient } from '@supabase/supabase-js';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supa = createClient(SUPABASE_URL, SERVICE_KEY, { auth:{ persistSession:false } });

const CORS = { 'Access-Control-Allow-Origin':'*', 'Access-Control-Allow-Methods':'GET,POST,OPTIONS', 'Access-Control-Allow-Headers':'content-type' };
const ok = (b)=>({ statusCode:200, headers:{ 'content-type':'application/json', ...CORS }, body: JSON.stringify(b) });
const bad = (m,s=400)=>({ statusCode:s, headers:{ 'content-type':'application/json', ...CORS }, body: JSON.stringify({ ok:false, error:m }) });

export const handler = async (event) => {
  try{
    if (event.httpMethod === 'OPTIONS') return { statusCode:204, headers:CORS, body:'' };
    if (event.httpMethod === 'GET'){
      const qs = event.queryStringParameters || {};
      const email = (qs.email||'').trim(); if (!email) return bad('missing_email');
      const limit = Math.max(1, Math.min(20, Number(qs.limit||5)));
      const mark = (qs.mark||'') === '1';
      // Premium gating: if enabled, skip returning inbox items for non-premium users (defense-in-depth)
      const requirePremium = (process.env.EARLY_NOTIFY_REQUIRE_PREMIUM || '1') !== '0';
      if (requirePremium){
        try{
          const { data: pu } = await supa.from('premium_users').select('email,premium_until').eq('email', email).maybeSingle();
          const ok = pu && pu.premium_until && new Date(pu.premium_until).getTime() > Date.now();
          if (!ok){
            const { count } = await supa.from('tickets').select('*',{head:true,count:'exact'}).eq('email', email).eq('type','premium');
            if (!count) return ok({ ok:true, items: [] });
          }
        }catch{}
      }
      const { data, error } = await supa
        .from('early_notify_inbox')
        .select('id,email,offer_id,payload,created_at,read_at')
        .eq('email', email)
        .is('read_at', null)
        .order('created_at', { ascending:false })
        .limit(limit);
      if (error) return bad('db_read: '+error.message,500);
      if (mark && data?.length){
        const ids = data.map(x=>x.id);
        await supa.from('early_notify_inbox').update({ read_at: new Date().toISOString() }).in('id', ids);
      }
      return ok({ ok:true, items: data||[] });
    }
    if (event.httpMethod === 'POST'){
      let body={};
      try{ body = JSON.parse(event.body||'{}'); }catch{ return bad('invalid_json'); }
      const email = (body.email||'').trim(); const offer_id = (body.offer_id||'').trim();
      if (!email || !offer_id) return bad('missing_fields');
      const payload = (typeof body.payload==='object' && body.payload) ? body.payload : null;
      const { error } = await supa.from('early_notify_inbox').insert({ email, offer_id, payload });
      if (error) return bad('db_insert: '+error.message,500);
      return ok({ ok:true });
    }
    return bad('method_not_allowed',405);
  }catch(e){ return bad(String(e?.message||e),500); }
};

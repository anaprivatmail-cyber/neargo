// netlify/functions/provider-ratings-get.js
// GET /api/provider-ratings?provider_id=abc&email=user(optional) -> aggregate + user rating

import { createClient } from '@supabase/supabase-js';

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth:{ persistSession:false } });

const CORS = { 'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET,OPTIONS','Access-Control-Allow-Headers':'content-type' };
const ok = (b)=>({ statusCode:200, headers:{ 'content-type':'application/json', ...CORS }, body:JSON.stringify(b) });
const bad = (m,s=400)=>({ statusCode:s, headers:{ 'content-type':'application/json', ...CORS }, body:JSON.stringify({ ok:false, error:m }) });

export const handler = async (event) => {
  try{
    if(event.httpMethod==='OPTIONS') return { statusCode:204, headers:CORS, body:'' };
    if(event.httpMethod!=='GET') return bad('use_get',405);
    const qs = event.queryStringParameters || {};
    const provider_id = String(qs.provider_id||'').trim(); if(!provider_id) return bad('missing_provider_id');
    const email = String(qs.email||'').trim().toLowerCase();

    const { data: agg } = await supa
      .from('provider_ratings_recent')
      .select('provider_id,cnt,avg_q,avg_v,avg_x,score')
      .eq('provider_id', provider_id)
      .maybeSingle();

    let badge=null; if(agg){
      if(agg.cnt>=25 && agg.score>=88) badge='excellent';
      else if(agg.cnt>=10 && agg.score>=75) badge='better';
      else if(agg.cnt>=3 && agg.score>=60) badge='basic';
    }

    let userRating=null; if(email){
      const { data: ur } = await supa
        .from('provider_ratings')
        .select('score_quality,score_value,score_experience,comment,updated_at')
        .eq('provider_id', provider_id)
        .eq('email', email)
        .maybeSingle();
      if(ur){ userRating=ur; }
    }

    return ok({ ok:true, aggregate: agg||null, badge, userRating });
  }catch(e){ return bad(String(e?.message||e),500); }
};

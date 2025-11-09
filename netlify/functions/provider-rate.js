// netlify/functions/provider-rate.js
// Submit or update a rating for a provider.
// POST { provider_id, email, quality, value, experience, comment }
// Constraints: one rating per provider/email; updates allowed.
// Rate limiting: max 3 updates per provider per email per 24h.

import { createClient } from '@supabase/supabase-js';

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth:{ persistSession:false } });

const CORS = { 'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'POST,OPTIONS','Access-Control-Allow-Headers':'content-type' };
const ok = (b)=>({ statusCode:200, headers:{ 'content-type':'application/json', ...CORS }, body:JSON.stringify(b) });
const bad = (m,s=400)=>({ statusCode:s, headers:{ 'content-type':'application/json', ...CORS }, body:JSON.stringify({ ok:false, error:m }) });

function clamp(v){ v = Number(v); if(!Number.isFinite(v)) return 0; return Math.max(0, Math.min(100, Math.round(v))); }

export const handler = async (event) => {
  try{
    if(event.httpMethod==='OPTIONS') return { statusCode:204, headers:CORS, body:'' };
    if(event.httpMethod!=='POST') return bad('use_post',405);
    let body={}; try{ body=JSON.parse(event.body||'{}'); }catch{ return bad('invalid_json'); }
    const provider_id = String(body.provider_id||'').trim();
    const email       = String(body.email||'').trim().toLowerCase();
    if(!provider_id || !email) return bad('missing_fields');
    const q = clamp(body.quality); const v = clamp(body.value); const x = clamp(body.experience);
    const comment = String(body.comment||'').trim().slice(0,800);

    // Rate limit: last 24h updates <=3
    const since = new Date(Date.now()-24*60*60*1000).toISOString();
    const { count: recentCount } = await supa
      .from('provider_ratings')
      .select('*',{ head:true, count:'exact' })
      .eq('provider_id', provider_id)
      .eq('email', email)
      .gte('updated_at', since);
    if((recentCount||0) >= 3) return bad('rate_limit');

    // Upsert
    const nowIso = new Date().toISOString();
    // Try update first
    const { data: existing } = await supa
      .from('provider_ratings')
      .select('id')
      .eq('provider_id', provider_id)
      .eq('email', email)
      .maybeSingle();

    if(existing && existing.id){
      const { error: upErr } = await supa
        .from('provider_ratings')
        .update({ score_quality:q, score_value:v, score_experience:x, comment, updated_at: nowIso })
        .eq('id', existing.id);
      if(upErr) return bad('update_fail: '+upErr.message,500);
    } else {
      const { error: insErr } = await supa
        .from('provider_ratings')
        .insert({ provider_id, email, score_quality:q, score_value:v, score_experience:x, comment });
      if(insErr) return bad('insert_fail: '+insErr.message,500);
    }

    // Return aggregate + badge
    const { data: agg } = await supa
      .from('provider_ratings_recent')
      .select('provider_id,cnt,avg_q,avg_v,avg_x,score')
      .eq('provider_id', provider_id)
      .maybeSingle();

    let badge = null;
    if(agg){
      // Mirror logic from provider_badge_tier (defense)
      if(agg.cnt>=25 && agg.score>=88) badge='excellent';
      else if(agg.cnt>=10 && agg.score>=75) badge='better';
      else if(agg.cnt>=3 && agg.score>=60) badge='basic';
    }

    return ok({ ok:true, updated:true, aggregate: agg||null, badge });
  }catch(e){ return bad(String(e?.message||e),500); }
};

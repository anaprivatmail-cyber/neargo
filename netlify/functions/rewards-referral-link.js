// netlify/functions/rewards-referral-link.js
// Returns (and creates if needed) a referral code + shareable link for a logged in user (by email)
import { createClient } from '@supabase/supabase-js';
const SUPABASE_URL = process.env.SUPABASE_URL; const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supa = createClient(SUPABASE_URL, SERVICE_KEY, { auth:{ persistSession:false } });

const CORS={ 'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET,OPTIONS','Access-Control-Allow-Headers':'content-type' };
const ok=b=>({statusCode:200,headers:{'content-type':'application/json',...CORS},body:JSON.stringify(b)});
const bad=(m,s=400)=>({statusCode:s,headers:{'content-type':'application/json',...CORS},body:JSON.stringify({ok:false,error:m})});

function genCode(){ return Math.random().toString(36).slice(2,10); }

export const handler = async (event) => {
  try{
    if(event.httpMethod==='OPTIONS') return {statusCode:204,headers:CORS,body:''};
    if(event.httpMethod!=='GET') return bad('use_get',405);
    const qs = event.queryStringParameters||{};
    const email=(qs.email||'').trim().toLowerCase();
    if(!email) return bad('missing_email');
    let userId=null;
    try{ const u = await supa.auth.admin.getUserByEmail(email); if(u?.data?.user?.id) userId=u.data.user.id; }catch{}
    if(!userId) return bad('user_not_found',404);
    // ensure referral_codes table exists (migration should create it)
    const { data: existing, error: exErr } = await supa.from('referral_codes').select('code').eq('user_id', userId).maybeSingle();
    let code = existing?.code || null;
    if(!code){
      // generate unique
      for(let i=0;i<5 && !code;i++){
        const c = genCode();
        const { error: insErr } = await supa.from('referral_codes').insert({ user_id:userId, code:c });
        if(!insErr) code=c;
      }
      if(!code) return bad('could_not_generate_code',500);
    }
    const base = (process.env.PUBLIC_BASE_URL || process.env.SITE_URL || 'https://getneargo.com').replace(/\/$/,'');
    const link = `${base}/register.html?ref=${encodeURIComponent(code)}`;
    return ok({ ok:true, code, link });
  }catch(e){ return bad(e?.message||e,500); }
};

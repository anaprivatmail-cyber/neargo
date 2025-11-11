// netlify/functions/rewards-referral-register.js
// Claim referral on signup: user provides email and ref code; award referrer for register (once)
import { createClient } from '@supabase/supabase-js';
const SUPABASE_URL=process.env.SUPABASE_URL; const SERVICE_KEY=process.env.SUPABASE_SERVICE_ROLE_KEY;
const supa=createClient(SUPABASE_URL,SERVICE_KEY,{auth:{persistSession:false}});
const CORS={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'POST,OPTIONS','Access-Control-Allow-Headers':'content-type'};
const ok=b=>({statusCode:200,headers:{'content-type':'application/json',...CORS},body:JSON.stringify(b)});
const bad=(m,s=400)=>({statusCode:s,headers:{'content-type':'application/json',...CORS},body:JSON.stringify({ok:false,error:m})});

export const handler=async(event)=>{
  try{
    if(event.httpMethod==='OPTIONS') return {statusCode:204,headers:CORS,body:''};
    if(event.httpMethod!=='POST') return bad('use_post',405);
    let body={}; try{ body=JSON.parse(event.body||'{}'); }catch{ return bad('invalid_json'); }
    const email=(body.email||'').trim().toLowerCase();
    const code=(body.code||'').trim();
    if(!email||!code) return bad('missing_email_or_code');
    // resolve referred user id
    let referredId=null; try{ const u=await supa.auth.admin.getUserByEmail(email); if(u?.data?.user?.id) referredId=u.data.user.id; }catch{}
    // find referrer by code
    const { data: refc } = await supa.from('referral_codes').select('user_id').eq('code', code).maybeSingle();
    if(!refc||!refc.user_id) return bad('invalid_code');
    const referrerId = refc.user_id;
    // upsert referral row for this email
    const base = { referrer_id: referrerId, referred_email: email, referred_user_id: referredId };
    // check existing
    const { data: existing } = await supa.from('referrals').select('id,register_rewarded').eq('referred_email', email).maybeSingle();
    if(existing){
      await supa.from('referrals').update(base).eq('id', existing.id);
      // award if not yet
      if(!existing.register_rewarded){ await supa.from('referrals').update({ register_rewarded:true }).eq('id', existing.id); await supa.rpc('add_points',{ p_user_id: referrerId, p_points: 50, p_reason:'referral_register', p_metadata: JSON.stringify({ referred_email: email }) }); }
    }else{
      const ins = await supa.from('referrals').insert(Object.assign({},{...base, register_rewarded:true})).select('id').single();
      if(!ins.error){ await supa.rpc('add_points',{ p_user_id: referrerId, p_points: 50, p_reason:'referral_register', p_metadata: JSON.stringify({ referred_email: email }) }); }
    }
    return ok({ ok:true });
  }catch(e){ return bad(e?.message||e,500); }
};

// netlify/functions/rewards-redeem-item.js
// Wrapper to redeem a reward item and, if type=coupon, issue a free coupon ticket.
import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || process.env.SITE_URL || 'https://getneargo.com').replace(/\/$/,'');

const supa = createClient(SUPABASE_URL, SERVICE_KEY, { auth:{ persistSession:false } });

const CORS={ 'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'POST,OPTIONS','Access-Control-Allow-Headers':'content-type' };
const ok  = b=>({ statusCode:200, headers:{ 'content-type':'application/json', ...CORS }, body: JSON.stringify(b) });
const bad = (m,s=400)=>({ statusCode:s, headers:{ 'content-type':'application/json', ...CORS }, body: JSON.stringify({ ok:false, error:m }) });

export const handler = async (event) => {
  try{
    if(event.httpMethod==='OPTIONS') return { statusCode:204, headers:CORS, body:'' };
    if(event.httpMethod!=='POST') return bad('use_post',405);
    let body={}; try{ body = JSON.parse(event.body||'{}'); }catch{return bad('invalid_json');}
    const email = (body.email||'').trim().toLowerCase();
    const code  = (body.code||'').trim();
    if(!email||!code) return bad('missing_email_or_code');

    // Resolve user id
    let userId=null; try{ const u = await supa.auth.admin.getUserByEmail(email); userId = u?.data?.user?.id || null; }catch{}
    if(!userId) return bad('user_not_found',404);

    // redeem item
    const red = await supa.rpc('redeem_reward_item', { p_user_id: userId, p_code: code });
    if(!red || !red.data || !red.data.ok) return bad('redeem_failed:'+ (red?.data?.error||'unknown'), 400);

    // If coupon: issue a free ticket
    if(red.data.kind === 'coupon'){
      const meta = red.data.metadata || {};
      const title = meta.title || 'Brezplačen kupon';
      const benefit = meta.description || 'gratis';
      const eventId = meta.event_id || null; // optional mapping to special offer
      const token = (crypto.randomUUID && crypto.randomUUID()) || crypto.randomBytes(16).toString('hex');
      const nowIso = new Date().toISOString();
      await supa.from('tickets').insert({
        event_id: eventId,
        type: 'coupon',
        display_benefit: benefit,
        stripe_checkout_session_id: null,
        stripe_payment_intent_id: null,
        token,
        status: 'issued',
        issued_at: nowIso,
        created_at: nowIso,
        customer_email: email
      });
      return ok({ ok:true, ticket_token: token, redeem_url: `${PUBLIC_BASE_URL}/r/${token}` });
    }

    return ok({ ok:true, result: red.data });
  }catch(e){ return bad(e?.message||e,500); }
};

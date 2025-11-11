// netlify/functions/rewards-history.js
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supa = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,OPTIONS', 'Access-Control-Allow-Headers': 'content-type' };
const ok = (b)=>({ statusCode:200, headers:{ 'content-type':'application/json', ...CORS }, body: JSON.stringify(b) });
const bad = (m,s=400)=>({ statusCode:s, headers:{ 'content-type':'application/json', ...CORS }, body: JSON.stringify({ ok:false, error:m }) });

export const handler = async (event) => {
  try{
    if (event.httpMethod === 'OPTIONS') return { statusCode:204, headers:CORS, body:'' };
    if (event.httpMethod !== 'GET') return bad('use_get',405);
    const qs = event.queryStringParameters || {};
    const email = (qs.email || '').trim();
    if (!email) return bad('missing_email');

    // return recent ledger entries for this email (limit to keep payload small)
    const { data, error } = await supa
      .from('rewards_ledger')
      .select('*')
      .eq('email', email)
      .order('inserted_at', { ascending: false })
      .limit(100);
    if (error) return bad('db_error: '+error.message,500);
    return ok({ ok:true, rows: data || [] });
  }catch(e){ return bad(String(e?.message||e),500); }
};

// netlify/functions/provider-get.js
// Preberi shranjen dogodek za urejanje (preveri edit token)

import { createClient } from '@supabase/supabase-js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET,OPTIONS'
};
const json = (d, s=200)=>({ statusCode:s, headers:{'content-type':'application/json', ...CORS}, body:JSON.stringify(d) });

const SUPABASE_URL              = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = 'event-images';

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode:200, headers:CORS, body:'' };
  if (event.httpMethod !== 'GET') return json({ ok:false, error:'Method not allowed' }, 405);
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return json({ ok:false, error:'Missing Supabase env' }, 500);

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const qs = new URLSearchParams(event.rawQuery || '');
  const key = qs.get('key') || '';
  const token = qs.get('token') || '';

  if (!key || !token) return json({ ok:false, error:'Missing key/token' }, 400);

  try{
    const { data, error } = await supabase.storage.from(BUCKET).download(key);
    if (error) return json({ ok:false, error:error.message }, 404);
    const txt = await data.text();
    const obj = JSON.parse(txt);
    if (!obj?.edit?.token || obj.edit.token !== token) return json({ ok:false, error:'Unauthorized' }, 401);
    return json({ ok:true, data: obj });
  }catch(e){
    return json({ ok:false, error:String(e?.message||e) }, 500);
  }
};

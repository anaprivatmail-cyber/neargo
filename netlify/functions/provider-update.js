// netlify/functions/provider-update.js
// Posodobi že oddan dogodek (s preverjanjem edit tokena)

import { createClient } from '@supabase/supabase-js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST,OPTIONS'
};
const json = (d, s=200)=>({ statusCode:s, headers:{'content-type':'application/json', ...CORS}, body:JSON.stringify(d) });

const SUPABASE_URL              = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = 'event-images';

const ALLOWED = new Set([
  'organizer','organizerEmail','eventName','venue','city','country',
  'start','end','url','offerType','price','stock','maxPerOrder',
  'description','category','featured','featuredUntil','imagePublicUrl',
  'venueLat','venueLon'
]);

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode:200, headers:CORS, body:'' };
  if (event.httpMethod !== 'POST') return json({ ok:false, error:'Method not allowed' }, 405);
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return json({ ok:false, error:'Missing Supabase env' }, 500);

  let body={};
  try{ body = JSON.parse(event.body||'{}'); }catch{ return json({ ok:false, error:'Bad JSON' }, 400); }
  const { key, token, updates={} } = body;
  if (!key || !token) return json({ ok:false, error:'Missing key/token' }, 400);

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try{
    // preberi staro
    const { data, error } = await supabase.storage.from(BUCKET).download(key);
    if (error) return json({ ok:false, error:error.message }, 404);
    const txt = await data.text();
    const obj = JSON.parse(txt);

    if (!obj?.edit?.token || obj.edit.token !== token) return json({ ok:false, error:'Unauthorized' }, 401);

    // uporabi samo dovoljena polja
    for (const k of Object.keys(updates||{})){
      if (!ALLOWED.has(k)) continue;
      obj[k] = updates[k];
    }

    // posodobi derived polja
    obj.venue = {
      name: obj.venue?.name || obj.venue || '',
      address: `${obj.venue?.name || obj.venue || ''}, ${obj.city || ''}, ${obj.country || ''}`.replace(/^[,\s]+|[,\s]+$/g,''),
      lat: obj.venueLat ?? obj.venue?.lat ?? null,
      lon: obj.venueLon ?? obj.venue?.lon ?? null
    };
    obj.images = obj.imagePublicUrl ? [obj.imagePublicUrl] : (obj.images||[]);
    obj.edit = { ...(obj.edit||{}), updatedAt: new Date().toISOString() };

    const uint8 = Buffer.from(JSON.stringify(obj, null, 2), 'utf8');
    const { error: upErr } = await supabase.storage.from(BUCKET).upload(key, uint8, {
      contentType:'application/json; charset=utf-8',
      upsert:true
    });
    if (upErr) return json({ ok:false, error: upErr.message }, 500);

    return json({ ok:true });
  }catch(e){
    return json({ ok:false, error:String(e?.message||e) }, 500);
  }
};

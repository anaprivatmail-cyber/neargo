// netlify/functions/notifications-prefs-upsert.js
import { createClient } from '@supabase/supabase-js';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supa = createClient(SUPABASE_URL, SERVICE_KEY, { auth:{ persistSession:false } });

const CORS = { 'Access-Control-Allow-Origin':'*', 'Access-Control-Allow-Methods':'POST,OPTIONS', 'Access-Control-Allow-Headers':'content-type' };
const ok = (b)=>({ statusCode:200, headers:{ 'content-type':'application/json', ...CORS }, body: JSON.stringify(b) });
const bad = (m,s=400)=>({ statusCode:s, headers:{ 'content-type':'application/json', ...CORS }, body: JSON.stringify({ ok:false, error:m }) });

export const handler = async (event) => {
  try{
    if (event.httpMethod === 'OPTIONS') return { statusCode:204, headers:CORS, body:'' };
    if (event.httpMethod !== 'POST') return bad('use_post',405);
    let body = {};
    try{ body = JSON.parse(event.body||'{}'); }catch(e){ return bad('invalid_json'); }
    const email = (body.email||'').trim();
    if (!email) return bad('missing_email');
    // Derive lat/lon: either explicit fields or parsed from location "lat,lon"
    let lat = null, lon = null;
    if (typeof body.lat === 'number' && typeof body.lon === 'number') {
      lat = body.lat; lon = body.lon;
    } else if (typeof body.location === 'string') {
      const m = body.location.trim().match(/^(-?\d+(?:\.\d+)?)[, ]\s*(-?\d+(?:\.\d+)?)/);
      if (m){ lat = parseFloat(m[1]); lon = parseFloat(m[2]); }
    }
    // Clamp radius to max 50 km (frontend constraint) but allow smaller floor 3
    let radius = Number(body.radius)||30; radius = Math.max(3, Math.min(50, radius));
  const phone = (body.phone||'').trim() || null;
  const prefs = { email, categories: body.categories||[], location: body.location||null, radius, lat, lon, phone, updated_at: new Date().toISOString() };

  const { data, error } = await supa.from('notification_prefs').upsert(prefs, { onConflict: ['email'] }).select();
    if (error) return bad('db_error: '+error.message,500);
    return ok({ ok:true, prefs: data && data[0] ? data[0] : prefs });
  }catch(e){ return bad(String(e?.message||e),500); }
};

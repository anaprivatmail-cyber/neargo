// netlify/functions/offers-early.js
// Server-side early-access listing: strictly returns items in the 15-minute early window
// only for Premium users whose prefs match (subcategory + geo radius).

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supa = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const BUCKET = 'event-images';
const SUBMISSIONS_DIR = 'submissions';

const EARLY_MIN = Number(process.env.EARLY_NOTIFY_MINUTES || 15);

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,OPTIONS',
  'Access-Control-Allow-Headers': 'content-type'
};
const ok  = (b)      => ({ statusCode:200, headers:{ 'content-type':'application/json', ...CORS }, body: JSON.stringify(b) });
const bad = (m, s=400)=> ({ statusCode:s,   headers:{ 'content-type':'application/json', ...CORS }, body: JSON.stringify({ ok:false, error:m }) });

function haversineKm(a, b){
  if (!a || !b || !Number.isFinite(a.lat) || !Number.isFinite(a.lon) || !Number.isFinite(b.lat) || !Number.isFinite(b.lon)) return null;
  const toRad = d => d*Math.PI/180; const R=6371;
  const dLat = toRad(b.lat - a.lat), dLon = toRad(b.lon - a.lon);
  const la1 = toRad(a.lat), la2 = toRad(b.lat);
  const x = Math.sin(dLat/2)**2 + Math.cos(la1)*Math.cos(la2)*Math.sin(dLon/2)**2;
  return 2*R*Math.asin(Math.sqrt(x));
}

function normalizeProvider(obj){
  const address = [obj.venue, obj.city || obj.city2, obj.country].filter(Boolean).join(', ');
  const images  = obj.imagePublicUrl ? [obj.imagePublicUrl] : (Array.isArray(obj.images) ? obj.images : []);
  return {
    ...obj,
    name: obj.eventName || obj.name || '',
    images,
    url: obj.url || null,
    venue: {
      address,
      lat: parseFloat(obj.venueLat || obj.lat || obj.latitude) || null,
      lon: parseFloat(obj.venueLon || obj.lon || obj.longitude) || null
    }
  };
}

async function isPremium(email){
  try{
    const nowMs = Date.now();
    const { data: pu } = await supa.from('premium_users').select('email,premium_until').eq('email', email).maybeSingle();
    if (pu && pu.premium_until && new Date(pu.premium_until).getTime() > nowMs) return true;
  }catch{}
  try{
    const { count } = await supa.from('tickets').select('*', { head:true, count:'exact' }).eq('customer_email', email).eq('type', 'premium');
    return (count||0) > 0;
  }catch{}
  return false;
}

async function getPrefs(email){
  const { data, error } = await supa
    .from('notification_prefs')
    .select('email,categories,lat,lon,radius')
    .eq('email', email)
    .maybeSingle();
  if (error) throw new Error('prefs_db_error: '+error.message);
  return data || {};
}

async function listSubmissions(){
  // Read all JSON submissions
  const { data: files, error } = await supa.storage.from(BUCKET).list(SUBMISSIONS_DIR, { limit: 1000 });
  if (error) throw new Error('storage_list_error: '+error.message);
  const raw = [];
  for (const f of files || []){
    if (!f.name?.toLowerCase().endsWith('.json')) continue;
    const path = `${SUBMISSIONS_DIR}/${f.name}`;
    const { data: blob, error: dlErr } = await supa.storage.from(BUCKET).download(path);
    if (dlErr) continue;
    try{ const txt = await blob.text(); const obj = JSON.parse(txt); raw.push(obj); }catch{}
  }
  return raw.map(normalizeProvider);
}

export const handler = async (event) => {
  try{
    if (event.httpMethod === 'OPTIONS') return { statusCode:204, headers:CORS, body:'' };
    if (event.httpMethod !== 'GET') return bad('use_get',405);

    const qs = event.queryStringParameters || {};
    const email = (qs.email || '').trim();
    if (!email) return bad('missing_email');

    // Premium gating
    const premium = await isPremium(email);
    if (!premium) return ok({ ok:true, results: [] });

    // Prefs
    const prefs = await getPrefs(email);
    const cats = Array.isArray(prefs.categories) ? prefs.categories.map(x=>String(x||'').toLowerCase()) : [];
    if (!cats.length) return ok({ ok:true, results: [] });
    const hasGeo = typeof prefs.lat === 'number' && typeof prefs.lon === 'number';
    const rKm = Math.max(3, Math.min(50, Number(prefs.radius)||30));

    // Time window: publish_at - EARLY_MIN <= now < publish_at
    const now = Date.now();

    let items = await listSubmissions();

    // Filter: only coupons for early preview (can extend later)
    items = items.filter(e => String(e.offerType||'').toLowerCase() === 'coupon');

    // Stock
    items = items.filter(e => Number(e.stock||0) > 0);

    // Time
    items = items.filter(e => {
      const pub = Date.parse(e.publish_at || e.start || '') || NaN;
      if (!Number.isFinite(pub)) return false;
      return now >= (pub - EARLY_MIN*60*1000) && now < pub;
    });

    // Subcategory match
    items = items.filter(e => {
      const sub = String(e.subcategory || e.subCategory || e.subcategoryKey || '').toLowerCase();
      return cats.includes(sub);
    });

    // Geo match (optional)
    if (hasGeo){
      const center = { lat: prefs.lat, lon: prefs.lon };
      items = items.filter(e => {
        const lat = e?.venue?.lat; const lon = e?.venue?.lon;
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return true; // keep if missing geo
        const d = haversineKm(center, { lat, lon });
        return d == null || d <= rKm;
      });
      // sort by distance then publish time
      items.sort((a,b)=>{
        const da = haversineKm(center, a.venue) ?? Infinity;
        const db = haversineKm(center, b.venue) ?? Infinity;
        if (da !== db) return da - db;
        const pa = Date.parse(a.publish_at || a.start || '') || Infinity;
        const pb = Date.parse(b.publish_at || b.start || '') || Infinity;
        return pa - pb;
      });
    } else {
      items.sort((a,b)=>{
        const pa = Date.parse(a.publish_at || a.start || '') || Infinity;
        const pb = Date.parse(b.publish_at || b.start || '') || Infinity;
        return pa - pb;
      });
    }

    // Mark earlyPreview explicitly for UI
    items = items.map(e => ({ ...e, earlyPreview: true }));

    // limit
    const limit = Math.max(1, Math.min(100, Number(qs.limit)||50));

    return ok({ ok:true, results: items.slice(0, limit) });
  }catch(e){
    return bad(String(e?.message || e), 500);
  }
};

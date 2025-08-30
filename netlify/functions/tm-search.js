// netlify/functions/tm-search.js
// Iskanje dogodkov iz Supabase Storage (JSON v bucketu) + (opcijsko) geo geokodiranje mesta.
// Deluje brez kakršnihkoli tabel; če tabela public.geo_cache obstaja, jo uporabi kot cache.

import { createClient } from '@supabase/supabase-js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
};
const json = (d, s = 200) => ({
  statusCode: s,
  headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS },
  body: JSON.stringify(d)
});

const SUPABASE_URL              = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const BUCKET = 'event-images';
const SUBMISSIONS_DIR = 'submissions';

const toStr = v => (v == null ? '' : String(v));

function norm(s){
  return toStr(s).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'');
}

function haversineKm(a, b){
  if (!a || !b) return null;
  const toRad = d => d*Math.PI/180, R = 6371;
  const dLat = toRad(b.lat - a.lat), dLon = toRad(b.lon - a.lon);
  const la1 = toRad(a.lat), la2 = toRad(b.lat);
  const x = Math.sin(dLat/2)**2 + Math.cos(la1)*Math.cos(la2)*Math.sin(dLon/2)**2;
  return 2*R*Math.asin(Math.sqrt(x));
}

async function loadAllSubmissions(supabase){
  const { data: files, error } = await supabase.storage.from(BUCKET).list(SUBMISSIONS_DIR, { limit: 1000 });
  if (error) throw new Error('Storage list error: ' + error.message);
  const onlyJson = (files || []).filter(f => f.name?.toLowerCase().endsWith('.json'));
  const items = await Promise.all(onlyJson.map(async f=>{
    const path = `${SUBMISSIONS_DIR}/${f.name}`;
    const { data, error: dlErr } = await supabase.storage.from(BUCKET).download(path);
    if (dlErr) return null;
    try{
      const obj = JSON.parse(await data.text());
      return {
        id: path,
        name: obj.eventName || obj.name || '',
        description: obj.description || '',
        category: obj.category || '',
        start: obj.start || obj.starts_at || null,
        end: obj.end || obj.ends_at || null,
        url: obj.url || '',
        images: obj.imagePublicUrl ? [obj.imagePublicUrl] : (obj.images || []),
        venue: {
          address: [obj.venue, obj.city || obj.city2, obj.country].filter(Boolean).join(', '),
          lat: Number(obj.venueLat ?? obj.lat),
          lon: Number(obj.venueLon ?? obj.lon)
        },
        featuredUntil: obj.featuredUntil || null
      };
    }catch{ return null; }
  }));
  return items.filter(Boolean);
}

function filterSortPaginate(items, { query, category, center, radiusKm, page, size }){
  const q = norm(query), cat = norm(category);

  let out = items.filter(e=>{
    const matchQ = !q || [e.name, e.description, e.venue?.address].some(v => norm(v).includes(q));
    const matchC = !cat || norm(e.category) === cat;
    let matchG = true, dist = null;
    if (center && Number.isFinite(center.lat) && Number.isFinite(center.lon) &&
        Number.isFinite(e.venue?.lat) && Number.isFinite(e.venue?.lon)){
      dist = haversineKm(center, { lat:e.venue.lat, lon:e.venue.lon });
      matchG = dist != null && dist <= (Number(radiusKm) || 30);
    }
    e._distanceKm = dist;
    return matchQ && matchC && matchG;
  });

  const now = Date.now();
  out.sort((a,b)=>{
    const fa = a.featuredUntil && Date.parse(a.featuredUntil) > now ? 1 : 0;
    const fb = b.featuredUntil && Date.parse(b.featuredUntil) > now ? 1 : 0;
    if (fa !== fb) return fb - fa;
    const sa = a.start ? Date.parse(a.start) : Infinity;
    const sb = b.start ? Date.parse(b.start) : Infinity;
    if (sa !== sb) return sa - sb;
    const da = a._distanceKm ?? Infinity;
    const db = b._distanceKm ?? Infinity;
    return da - db;
  });

  const p = Math.max(0, Number(page) || 0);
  const s = Math.max(1, Math.min(50, Number(size) || 20));
  const start = p*s, end = start + s;

  return { total: out.length, page: p, size: s, results: out.slice(start, end) };
}

/* ====== GEO: opcijski DB cache + Nominatim fallback ====== */
const memCache = new Map();
const TTL = 24*60*60*1000;

async function dbGetGeo(supabase, city){
  try{
    const q = norm(city);
    if (!q) return null;
    // če tabela ne obstaja ali je RLS, se zgodi error -> tiho vrni null
    const { data, error } = await supabase.from('geo_cache').select('lat,lon').eq('query', q).maybeSingle();
    if (error || !data) return null;
    const lat = Number(data.lat), lon = Number(data.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    return { lat, lon };
  }catch{ return null; }
}

async function dbUpsertGeo(supabase, city, lat, lon){
  try{
    const q = norm(city);
    if (!q || !Number.isFinite(lat) || !Number.isFinite(lon)) return;
    await supabase.from('geo_cache').upsert({ query: q, lat, lon, created_at: new Date().toISOString() }, { onConflict:'query' });
  }catch{/* ignore */}
}

async function geocodeCity(supabase, city){
  const key = norm(city||''); if (!key) return null;

  const m = memCache.get(key);
  if (m && (Date.now()-m.ts) < TTL) return { lat:m.lat, lon:m.lon };

  const db = await dbGetGeo(supabase, city);
  if (db){ memCache.set(key, { ...db, ts: Date.now() }); return db; }

  const url = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=0&limit=1&q=${encodeURIComponent(city)}`;
  try{
    const r = await fetch(url, { headers:{ 'User-Agent':'NearGo/1.0 (contact: info@getneargo.com)' } });
    if (!r.ok) throw new Error('geocode http '+r.status);
    const arr = await r.json();
    if (arr?.[0]?.lat && arr?.[0]?.lon){
      const lat = Number(arr[0].lat), lon = Number(arr[0].lon);
      memCache.set(key, { lat, lon, ts: Date.now() });
      await dbUpsertGeo(supabase, city, lat, lon); // če tabela ne obstaja, se tiho preskoči
      return { lat, lon };
    }
  }catch{/* ignore */}
  return null;
}

/* ====== HANDLER ====== */
export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode:200, headers:CORS, body:'' };

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY){
    return json({ ok:false, error:'Manjka SUPABASE_URL ali SUPABASE_SERVICE_ROLE_KEY' }, 500);
  }
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  let params = {};
  try{
    if (event.httpMethod === 'GET'){
      const u = new URL(event.rawUrl || ('https://x/?'+(event.rawQuery||'')));
      params = Object.fromEntries(u.searchParams.entries());
      if (params.latlon){
        const [la,lo] = String(params.latlon).split(',').map(Number);
        params.center = { lat: la, lon: lo };
      }
      if (params.radiuskm) params.radiusKm = Number(params.radiuskm);
    }else if (event.httpMethod === 'POST'){
      params = JSON.parse(event.body || '{}');
    }else{
      return json({ ok:false, error:'Method not allowed' }, 405);
    }
  }catch{
    return json({ ok:false, error:'Neveljaven vnos parametrov' }, 400);
  }

  const query    = toStr(params.q || params.query || '');
  const category = toStr(params.category || '');
  let center     = params.center && Number.isFinite(params.center.lat) && Number.isFinite(params.center.lon)
    ? { lat:Number(params.center.lat), lon:Number(params.center.lon) }
    : null;
  const radiusKm = Number(params.radiusKm ?? params.radiuskm ?? 30);
  const page     = Number(params.page || 0);
  const size     = Number(params.size || 20);

  // če center ni podan, poskusi z 'city' (majhni kraji podprti)
  const cityRaw = toStr(params.city || '');
  if (!center && cityRaw){
    const gc = await geocodeCity(supabase, cityRaw);
    if (gc) center = gc;
  }

  try{
    const items = await loadAllSubmissions(supabase);
    const result = filterSortPaginate(items, { query, category, center, radiusKm, page, size });
    return json({ ok:true, ...result });
  }catch(e){
    return json({ ok:false, error:String(e?.message || e) }, 500);
  }
};

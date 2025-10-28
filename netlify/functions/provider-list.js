// netlify/functions/provider-list.js
// Vrne seznam oddanih dogodkov/storitev iz Supabase Storage (bucket event-images/submissions/*.json)

import { createClient } from '@supabase/supabase-js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET,OPTIONS'
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

// ————————————————————————————————————————————————————————————————
// Pomagala
// ————————————————————————————————————————————————————————————————
function safeNum(v){
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function trimLower(s){ return String(s||'').trim().toLowerCase(); }

//  Minimalen fallback “category detect”, če manjka
function detectCategory(obj){
  const t = `${obj.eventName||obj.name||''} ${obj.description||''}`.toLowerCase();
  if (t.includes('koncert') || t.includes('band')) return 'koncert';
  if (t.includes('otro') || t.includes('family'))   return 'otroci';
  if (t.includes('food') || t.includes('hrana'))   return 'hrana';
  if (t.includes('sport') || t.includes('šport'))  return 'sport';
  if (t.includes('narav') || t.includes('hike'))   return 'narava';
  if (t.includes('party') || t.includes('žur'))    return 'zabava';
  if (t.includes('podjet')|| t.includes('b2b'))    return 'za-podjetja';
  return 'kultura';
}

// normalizacija v obliko, ki jo pričakuje frontend
function normalizeProvider(obj){
  const address = [obj.venue, obj.city || obj.city2, obj.country].filter(Boolean).join(', ');
  const images  = obj.imagePublicUrl ? [obj.imagePublicUrl] : (Array.isArray(obj.images) ? obj.images : []);
  const lat = safeNum(obj.venueLat ?? obj.lat ?? obj.latitude);
  const lon = safeNum(obj.venueLon ?? obj.lon ?? obj.longitude);

  const type = (obj.type || obj.entryType || '').toLowerCase(); // 'event' | 'service'

  return {
    ...obj,
    name: obj.eventName || obj.name || '',
    images,
    category: obj.category || detectCategory(obj),
    entryType: type || undefined,
    type: type || undefined,
    url: obj.url || null,
    venue: { address, lat, lon }
  };
}

function haversineKm(a, b){
  if (!a || !b || !Number.isFinite(a.lat) || !Number.isFinite(a.lon) || !Number.isFinite(b.lat) || !Number.isFinite(b.lon)) return null;
  const toRad = d => d * Math.PI/180;
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const la1 = toRad(a.lat), la2 = toRad(b.lat);
  const x = Math.sin(dLat/2)**2 + Math.cos(la1)*Math.cos(la2)*Math.sin(dLon/2)**2;
  return 2*R*Math.asin(Math.sqrt(x));
}

// enostaven geocoder (Nominatim) + opcijski Supabase cache
async function geocodeCityIfNeeded(supa, cityStr){
  const q = trimLower(cityStr);
  if (!q) return null;

  // poskusi iz cache tabele (če jo imaš)
  try{
    const { data: hit } = await supa.from('geocode_cache').select('lat,lon').eq('q', q).maybeSingle?.() ?? {};
    if (hit && Number.isFinite(hit.lat) && Number.isFinite(hit.lon)) return { lat: hit.lat, lon: hit.lon };
  }catch{} // tabela morda ne obstaja – ignoriraj

  try{
    const r = await fetch(`https://nominatim.openstreetmap.org/search?`+new URLSearchParams({
      q: cityStr, format:'json', limit:'1'
    }), { headers:{ 'Accept-Language':'sl' }});
    const arr = await r.json();
    if (arr && arr[0]) {
      const res = { lat: Number(arr[0].lat), lon: Number(arr[0].lon) };
      if (Number.isFinite(res.lat) && Number.isFinite(res.lon)) {
        // poskusi zapisati v cache (če tabela obstaja)
        try{
          await supa.from('geocode_cache').upsert({ q, lat: res.lat, lon: res.lon }, { onConflict:'q' });
        }catch{}
        return res;
      }
    }
  }catch{}

  return null;
}

function fileLooksJson(f){ return (f?.name||'').toLowerCase().endsWith('.json'); }

// ————————————————————————————————————————————————————————————————
// Handler
// ————————————————————————————————————————————————————————————————
export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode:200, headers:CORS, body:'' };
  if (event.httpMethod !== 'GET')     return json({ ok:false, error:'Method not allowed' },405);

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return json({ ok:false, error:'Manjka SUPABASE_URL ali SUPABASE_SERVICE_ROLE_KEY' }, 500);
  }

  const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try{
    const url = new URL(event.rawUrl);
    const qs  = url.searchParams;

    const onlyFeatured = ['1','true','yes'].includes((qs.get('featured')||'').toLowerCase());
    const qText        = trimLower(qs.get('q')||'');
    const mode         = trimLower(qs.get('mode')||''); // 'events' | 'services' | ''
    // paging (page/size ima prednost pred limit/offset)
    const page  = Math.max(0, Number(qs.get('page')||0));
    const size  = Math.max(0, Number(qs.get('size')||0));
    const limit = size || Math.max(0, Number(qs.get('limit')||0));
    const offset= size ? page*size : Math.max(0, Number(qs.get('offset')||0));

    // geo
    let center = null;
    const radiusKm = Number(qs.get('radiuskm') || qs.get('radiusKm') || 0);
    const latlon   = qs.get('latlon');
    const cityQ    = qs.get('city');

    if (latlon) {
      const [la, lo] = String(latlon).split(',').map(Number);
      if (Number.isFinite(la) && Number.isFinite(lo)) center = { lat: la, lon: lo };
    } else if (cityQ) {
      center = await geocodeCityIfNeeded(supa, cityQ);
    }

    // preberi vse JSON datoteke
    const { data: files, error:listErr } = await supa
      .storage
      .from(BUCKET)
      .list(SUBMISSIONS_DIR, { limit: 1000 });

    if (listErr) throw new Error('Storage list error: ' + listErr.message);

    const raw = [];
    for (const f of (files||[])) {
      if (!fileLooksJson(f)) continue;
      const path = `${SUBMISSIONS_DIR}/${f.name}`;
      const { data, error: dlErr } = await supa.storage.from(BUCKET).download(path);
      if (dlErr) continue;
      try{
        const txt = await data.text();
        const obj = JSON.parse(txt);
        raw.push(obj);
      }catch{}
    }

    // “featured” filter
    const now = Date.now();
    let out = onlyFeatured
      ? raw.filter(it => it?.featured || (it?.featuredUntil && Date.parse(it.featuredUntil) > now))
      : raw;

    // odstrani pretečene (če je samo start → +2h)
    out = out.filter(e => {
      const end = e.end ? Date.parse(e.end) : (e.start ? Date.parse(e.start) + 2*3600*1000 : 0);
      return Number.isFinite(end) && end >= Date.now();
    });

    // mode: events|services
    if (mode === 'events')   out = out.filter(o => trimLower(o.type||o.entryType||'') !== 'service');
    if (mode === 'services') out = out.filter(o => trimLower(o.type||o.entryType||'') === 'service');

    // tekstovno iskanje
    if (qText) {
      out = out.filter(o => {
        const blob = `${o.eventName||o.name||''} ${o.description||''} ${o.category||''} ${o.city||o.city2||''} ${o.venue||''}`.toLowerCase();
        return blob.includes(qText);
      });
    }

    // normalizacija
    out = out.map(normalizeProvider);

    // geo: izračun razdalje
    if (center) {
      out.forEach(e => { e._distanceKm = haversineKm(center, e.venue); });
      if (Number.isFinite(radiusKm) && radiusKm > 0) {
        out = out.filter(e => (e._distanceKm == null) || e._distanceKm <= radiusKm);
      }
    }

    // sort: distance → start → createdAt
    out.sort((a,b)=>{
      if (center) {
        const da = a._distanceKm ?? Infinity;
        const db = b._distanceKm ?? Infinity;
        if (da !== db) return da - db;
      }
      const sa = a.start ? Date.parse(a.start) : Infinity;
      const sb = b.start ? Date.parse(b.start) : Infinity;
      if (sa !== sb) return sa - sb;
      const ca = a.createdAt ? Date.parse(a.createdAt) : 0;
      const cb = b.createdAt ? Date.parse(b.createdAt) : 0;
      return cb - ca;
    });

    const total = out.length;
    const results = (limit > 0) ? out.slice(offset, offset + limit) : out;

    return json({
      ok:true,
      total,
      page: size ? page : undefined,
      size: size || undefined,
      offset: size ? undefined : offset,
      limit: size ? undefined : limit,
      results
    });

  }catch(e){
    return json({ ok:false, error: String(e?.message || e) }, 500);
  }
};

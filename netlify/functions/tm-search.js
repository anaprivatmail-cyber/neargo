
// netlify/functions/tm-search.js
// Združeno iskanje: Supabase Storage oddaje + Ticketmaster + Eventbrite.
// Filtri: q, category, city (geokodiranje), latlon, radiuskm, page, size.
// Sort: featured najprej, nato po razdalji, znotraj tega po začetku.

import { createClient } from '@supabase/supabase-js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
};
const json = (d, s = 200) => ({
  statusCode: s,
  headers: { 'Content-Type': 'application/json', ...CORS },
  body: JSON.stringify(d)
});

const SUPABASE_URL              = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const TM_KEY  = process.env.TICKETMASTER_API_KEY || '';
const EB_TOKEN = process.env.EB_PRIVATE_TOKEN || '';

const BUCKET = 'event-images';
const SUBMISSIONS_DIR = 'submissions';

const toStr = v => (v == null ? '' : String(v));

function norm(s){
  return toStr(s).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
}

function haversineKm(a, b){
  if (!a || !b) return null;
  const toRad = d => d * Math.PI/180;
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const la1 = toRad(a.lat), la2 = toRad(b.lat);
  const x = Math.sin(dLat/2)**2 + Math.cos(la1)*Math.cos(la2)*Math.sin(dLon/2)**2;
  return 2*R*Math.asin(Math.sqrt(x));
}

/* --------------------- SUPABASE submissions --------------------- */
async function loadAllSubmissions(supabase){
  const { data: files, error } = await supabase.storage.from(BUCKET).list(SUBMISSIONS_DIR, { limit: 1000 });
  if (error) throw new Error('Storage list error: ' + error.message);
  const onlyJson = (files || []).filter(f => f.name?.toLowerCase().endsWith('.json'));
  const items = await Promise.all(onlyJson.map(async f=>{
    const path = `${SUBMISSIONS_DIR}/${f.name}`;
    const { data, error: dlErr } = await supabase.storage.from(BUCKET).download(path);
    if (dlErr) return null;
    try{
      const txt = await data.text();
      const obj = JSON.parse(txt);
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
          lat: Number(obj.venueLat || obj.lat),
          lon: Number(obj.venueLon || obj.lon)
        },
        featuredUntil: obj.featuredUntil || null,
        // 🔹 Dodano iz 8. točke — dodatna polja iz oddaje
        organizer: obj.organizer || '',
        organizerEmail: obj.organizerEmail || '',
        price: obj.price != null ? obj.price : null,
        stock: obj.stock != null ? obj.stock : null,
        offerType: obj.offerType || '',
        createdAt: obj.createdAt || null
      };
    }catch{ return null; }
  }));
  return items.filter(Boolean);
}

/* --------------------- Nominatim geocode --------------------- */
async function geocodeCity(city){
  if (!city) return null;
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('q', city);
  url.searchParams.set('format', 'json');
  url.searchParams.set('limit', '1');
  const r = await fetch(url.toString(), {
    headers: { 'User-Agent': 'NearGo/1.0 (getneargo.com)' }
  });
  if (!r.ok) return null;
  const arr = await r.json().catch(()=>[]);
  if (!arr?.length) return null;
  const lat = parseFloat(arr[0].lat), lon = parseFloat(arr[0].lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon };
}

/* --------------------- Ticketmaster --------------------- */
async function fetchTicketmaster({ q, center, radiusKm, size=50 }){
  if (!TM_KEY || !center) return [];
  const url = new URL('https://app.ticketmaster.com/discovery/v2/events.json');
  url.searchParams.set('apikey', TM_KEY);
  url.searchParams.set('latlong', `${center.lat},${center.lon}`);
  url.searchParams.set('radius', Math.max(1, Math.min(200, Number(radiusKm)||30)));
  url.searchParams.set('unit', 'km');
  url.searchParams.set('size', String(Math.min(50, size)));
  url.searchParams.set('sort', 'date,asc');
  if (q) url.searchParams.set('keyword', q);

  try{
    const r = await fetch(url.toString());
    if (!r.ok) return [];
    const data = await r.json().catch(()=>null);
    const arr = data?._embedded?.events || [];
    return arr.map(ev=>{
      const vi = ev._embedded?.venues?.[0];
      const img = (ev.images||[]).sort((a,b)=>b.width-a.width)[0]?.url;
      
      // Mapiranje Ticketmaster kategorij v slovenščino
      const rawCategory = (ev.classifications?.[0]?.segment?.name || '').toLowerCase();
      const rawGenre = (ev.classifications?.[0]?.genre?.name || '').toLowerCase();
      const eventName = (ev.name || '').toLowerCase();
      
      let category = 'kultura'; // default
      if (rawCategory.includes('music') || rawGenre.includes('music') || eventName.includes('concert')) {
        category = 'koncert';
      } else if (rawCategory.includes('sports') || rawGenre.includes('sport')) {
        category = 'sport';
      } else if (rawCategory.includes('family') || rawGenre.includes('family') || eventName.includes('otrok')) {
        category = 'otroci';
      } else if (rawCategory.includes('theatre') || rawCategory.includes('arts') || rawGenre.includes('theatre')) {
        category = 'kultura';
      } else if (rawCategory.includes('miscellaneous') || rawGenre.includes('comedy')) {
        category = 'zabava';
      }
      
      return {
        id: ev.id,
        name: ev.name || '',
        description: (ev.info || ev.pleaseNote || '')?.slice(0, 800),
        category: category,
        start: ev.dates?.start?.dateTime || null,
        end: null,
        url: ev.url || '',
        images: img?[img]:[],
        venue: {
          address: [vi?.name, vi?.city?.name, vi?.country?.name].filter(Boolean).join(', '),
          lat: Number(vi?.location?.latitude),
          lon: Number(vi?.location?.longitude)
        },
        featuredUntil: null
      };
    });
  }catch{ return []; }
}

/* --------------------- Eventbrite --------------------- */
async function fetchEventbrite({ q, center, radiusKm, size=50 }){
  if (!EB_TOKEN || !center) return [];
  const url = new URL('https://www.eventbriteapi.com/v3/events/search/');
  url.searchParams.set('location.within', `${Math.max(1, Math.min(200, Number(radiusKm)||30))}km`);
  url.searchParams.set('location.latitude', String(center.lat));
  url.searchParams.set('location.longitude', String(center.lon));
  url.searchParams.set('expand', 'venue');
  url.searchParams.set('page_size', String(Math.min(50, size)));
  if (q) url.searchParams.set('q', q);

  try{
    const r = await fetch(url.toString(), {
      headers: { 'Authorization': `Bearer ${EB_TOKEN}` }
    });
    if (!r.ok) return [];
    const data = await r.json().catch(()=>null);
    const arr = data?.events || [];
    return arr.map(ev=>{
      const v = ev.venue || {};
      const img = ev.logo?.url;
      
      // Mapiranje Eventbrite kategorij v slovenščino  
      const eventName = (ev.name?.text || '').toLowerCase();
      const eventSummary = (ev.summary || '').toLowerCase();
      const rawCategory = (ev.category_id || '').toLowerCase();
      
      let category = 'kultura'; // default
      if (eventName.includes('concert') || eventName.includes('music') || eventSummary.includes('music')) {
        category = 'koncert';
      } else if (eventName.includes('sport') || eventSummary.includes('sport') || rawCategory.includes('sport')) {
        category = 'sport';
      } else if (eventName.includes('food') || eventName.includes('culinar') || eventSummary.includes('food')) {
        category = 'hrana';
      } else if (eventName.includes('business') || eventName.includes('conference') || eventSummary.includes('business')) {
        category = 'za-podjetja';
      } else if (eventName.includes('party') || eventName.includes('club') || eventSummary.includes('party')) {
        category = 'zabava';
      } else if (eventName.includes('family') || eventName.includes('kid') || eventSummary.includes('otrok')) {
        category = 'otroci';
      } else if (eventName.includes('nature') || eventName.includes('outdoor') || eventSummary.includes('nature')) {
        category = 'narava';
      }
      
      return {
        id: ev.id,
        name: ev.name?.text || '',
        description: (ev.summary || '')?.slice(0,800),
        category: category,
        start: ev.start?.utc || null,
        end: ev.end?.utc || null,
        url: ev.url || '',
        images: img?[img]:[],
        venue: {
          address: [v.name, v.address?.city, v.address?.country].filter(Boolean).join(', '),
          lat: Number(v.latitude),
          lon: Number(v.longitude)
        },
        featuredUntil: null
      };
    });
  }catch{ return []; }
}

/* --------------------- filter/sort/paginate --------------------- */
function filterSortPaginate(items, { query, category, center, radiusKm, page, size }){
  const q = norm(query);
  const cat = norm(category);

  let out = items.filter(e=>{
    const matchQ = !q || [e.name, e.description, e.venue?.address].some(v => norm(v).includes(q));
    const matchC = !cat || norm(e.category).includes(cat);
    let matchG = true, dist = null;
    if (center && Number.isFinite(center.lat) && Number.isFinite(center.lon) &&
        Number.isFinite(e.venue?.lat) && Number.isFinite(e.venue?.lon)){
      dist = haversineKm(center, { lat: e.venue.lat, lon: e.venue.lon });
      matchG = dist != null && dist <= (Number(radiusKm) || 30);
    }
    e._distanceKm = dist;
    return matchQ && matchC && matchG;
  });

  const now = Date.now();
  out.sort((a,b)=>{
    const fa = a.featuredUntil && Date.parse(a.featuredUntil) > now ? 1 : 0;
    const fb = b.featuredUntil && Date.parse(b.featuredUntil) > now ? 1 : 0;
    if (fa !== fb) return fb - fa; // featured naprej
    const da = (a._distanceKm ?? Infinity);
    const db = (b._distanceKm ?? Infinity);
    if (da !== db) return da - db;  // najbližji naprej
    const sa = a.start ? Date.parse(a.start) : Infinity;
    const sb = b.start ? Date.parse(b.start) : Infinity;
    return sa - sb;
  });

  const p = Math.max(0, Number(page) || 0);
  const s = Math.max(1, Math.min(50, Number(size) || 20));
  const start = p*s, end = start + s;

  return {
    total: out.length,
    page: p,
    size: s,
    results: out.slice(start, end)
  };
}

/* --------------------- handler --------------------- */
export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };

  const supaReady = (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
  const supabase = supaReady ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY) : null;

  let params = {};
  try{
    if (event.httpMethod === 'GET'){
      const u = new URL(event.rawUrl || ('https://x/?'+event.rawQuery));
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

  // geokodiraj "city", če ni lat/lon
  const cityStr = toStr(params.city || '');
  if (!center && cityStr){
    try{ center = await geocodeCity(cityStr); }catch{}
  }

  const radiusKm = Number(params.radiusKm ?? params.radiuskm ?? 30);
  const page     = Number(params.page || 0);
  const size     = Number(params.size || 20);

  try{
    let items = [];

    // 1) oddaje (Supabase Storage)
    if (supaReady){
      try{ items = await loadAllSubmissions(supabase); }catch(e){ /* če pade, gremo dalje */ }
    }

    // 2) veliki API-ji (če imamo center in ključe)
    const bigFetches = [];
    if (center){
      bigFetches.push(fetchTicketmaster({ q:query, center, radiusKm, size:50 }));
      bigFetches.push(fetchEventbrite({ q:query, center, radiusKm, size:50 }));
    }
    const bigResults = await Promise.allSettled(bigFetches);
    bigResults.forEach(r => { if (r.status === 'fulfilled' && Array.isArray(r.value)) items.push(...r.value); });

    const result = filterSortPaginate(items, { query, category, center, radiusKm, page, size });
    return json({ ok:true, ...result, center });
  }catch(e){
    return json({ ok:false, error:String(e?.message || e) }, 500);
  }
};

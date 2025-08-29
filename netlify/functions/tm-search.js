// netlify/functions/tm-search.js
// Združeno iskanje: Ticketmaster (opcijsko) + Supabase submissions
// + deduplikacija, geokodiranje mest za submissions, sortiranje in paging.

import { createClient } from '@supabase/supabase-js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET,OPTIONS'
};
const json = (d, s = 200) => ({
  statusCode: s,
  headers: { 'Content-Type': 'application/json', ...CORS },
  body: JSON.stringify(d)
});

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TM_KEY = process.env.TICKETMASTER_API_KEY || ''; // lahko prazno

const BUCKET = 'event-images';
const SUBMISSIONS_PREFIX = 'submissions/';

const toRad = (deg) => (deg * Math.PI) / 180;
function haversineKm(a, b) {
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// --- preprosta cache tabela za geokodiranje mest ---
const geoCache = new Map();
async function geocodeCity(city) {
  if (!city) return null;
  const key = city.trim().toLowerCase();
  if (geoCache.has(key)) return geoCache.get(key);

  const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(city)}&limit=1`;
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'NearGo/1.0 (search)' } });
    if (!r.ok) return null;
    const arr = await r.json();
    const res = (arr && arr[0])
      ? { lat: parseFloat(arr[0].lat), lon: parseFloat(arr[0].lon) }
      : null;
    geoCache.set(key, res);
    return res;
  } catch {
    return null;
  }
}

function normalizeTM(ev) {
  try {
    const venue = ev._embedded?.venues?.[0];
    const img = (ev.images || []).sort((a, b) => b.width - a.width)[0]?.url || null;
    return {
      id: `tm_${ev.id}`,
      source: 'ticketmaster',
      name: ev.name,
      url: ev.url || null,
      images: img ? [img] : [],
      start: ev.dates?.start?.dateTime || null,
      end: null,
      category: ev.classifications?.[0]?.segment?.name?.toLowerCase() || null,
      venue: {
        name: venue?.name || '',
        address: [venue?.address?.line1, venue?.city?.name, venue?.country?.countryCode].filter(Boolean).join(', '),
        lat: venue?.location ? parseFloat(venue.location.latitude) : null,
        lon: venue?.location ? parseFloat(venue.location.longitude) : null
      }
    };
  } catch {
    return null;
  }
}

function normalizeSB(obj) {
  const lat = obj.venueLat || obj.lat || null;
  const lon = obj.venueLon || obj.lon || null;
  return {
    id: `sb_${obj.createdAt || obj.eventName}`,
    source: 'provider',
    name: obj.eventName || 'Dogodek',
    url: obj.url || null,
    images: obj.imageName ? [`sb://${obj.imageName}`] : [], // označimo, da je iz storage-a
    start: obj.start || null,
    end: obj.end || null,
    category: (obj.category || '').toLowerCase() || null,
    featuredUntil: obj.featuredUntil || null,
    venue: {
      name: obj.venue || '',
      address: [obj.venue || '', obj.city || obj.city2 || '', obj.country || ''].filter(Boolean).join(', '),
      lat: lat ? parseFloat(lat) : null,
      lon: lon ? parseFloat(lon) : null,
      cityOnly: obj.city || obj.city2 || '' // za geokodiranje, če manjka lat/lon
    }
  };
}

// pretvori "sb://filename.jpg" v javni URL Supabase Storage
async function resolveSbImageUrls(supabase, items) {
  const names = items
    .flatMap(e => (e.images || []))
    .filter(u => typeof u === 'string' && u.startsWith('sb://'))
    .map(u => u.slice(5));

  if (!names.length) return items;

  // preberemo podpisane URL-je (lahko tudi public, če je bucket public)
  const { data, error } = await supabase
    .storage
    .from(BUCKET)
    .createSignedUrls(names.map(n => `public/${n}`), 60 * 60); // 1h

  if (error || !data) return items;

  const map = new Map();
  data.forEach(d => map.set(d.path.replace(/^public\//, ''), d.signedUrl));

  return items.map(e => {
    if (!e.images?.length) return e;
    const out = { ...e, images: e.images.map(u => {
      if (u.startsWith('sb://')) {
        const name = u.slice(5);
        return map.get(name) || null;
      }
      return u;
    }).filter(Boolean) };
    return out;
  });
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS')
    return { statusCode: 200, headers: CORS, body: '' };
  if (event.httpMethod !== 'GET')
    return json({ ok: false, error: 'Method not allowed' }, 405);

  try {
    const q = new URLSearchParams(event.rawQuery || event.queryStringParameters || {});
    const query = (q.get('q') || '').trim();
    const city = (q.get('city') || '').trim();
    const latlon = (q.get('latlon') || '').trim(); // "lat,lon"
    const category = (q.get('category') || '').trim().toLowerCase();
    const radiusKm = Math.max(1, parseInt(q.get('radiuskm') || '50', 10));
    const page = Math.max(0, parseInt(q.get('page') || '0', 10));
    const size = Math.min(50, Math.max(1, parseInt(q.get('size') || '20', 10)));

    // 1) Središče iskanja
    let center = null;
    if (latlon) {
      const [la, lo] = latlon.split(',').map(Number);
      if (!Number.isNaN(la) && !Number.isNaN(lo)) center = { lat: la, lon: lo };
    } else if (city) {
      center = await geocodeCity(city);
    }

    // 2) Supabase: preberemo submissions JSON
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return json({ ok: false, error: 'Manjka SUPABASE_URL ali SUPABASE_SERVICE_ROLE_KEY' }, 500);
    }
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: files, error: listErr } = await supabase
      .storage
      .from(BUCKET)
      .list(SUBMISSIONS_PREFIX, { limit: 1000 });

    if (listErr) {
      return json({ ok: false, error: `Storage list error: ${listErr.message}` }, 500);
    }

    const jsonFiles = (files || []).filter(f => f.name.endsWith('.json'));

    const sbItemsRaw = [];
    for (const f of jsonFiles) {
      const { data, error } = await supabase
        .storage
        .from(BUCKET)
        .download(SUBMISSIONS_PREFIX + f.name);
      if (!error && data) {
        const txt = await data.text();
        try { sbItemsRaw.push(JSON.parse(txt)); } catch {}
      }
    }

    let sbItems = sbItemsRaw.map(normalizeSB);

    // 2a) geokodiranje mest za sbItems brez koordinat (če imamo center)
    if (center) {
      // zberemo unikatna mesta
      const cities = Array.from(
        new Set(sbItems.filter(e => (!e.venue?.lat || !e.venue?.lon) && e.venue?.cityOnly)
          .map(e => e.venue.cityOnly))
      );
      const geoResults = {};
      await Promise.all(cities.map(async c => {
        geoResults[c] = await geocodeCity(c);
      }));

      sbItems = sbItems.map(e => {
        if ((!e.venue?.lat || !e.venue?.lon) && e.venue?.cityOnly && geoResults[e.venue.cityOnly]) {
          return {
            ...e,
            venue: {
              ...e.venue,
              lat: geoResults[e.venue.cityOnly].lat,
              lon: geoResults[e.venue.cityOnly].lon
            }
          };
        }
        return e;
      });
    }

    // 2b) nadomestimo sb:// slike z javnimi URL-ji
    sbItems = await resolveSbImageUrls(supabase, sbItems);

    // 3) Ticketmaster (opcijsko)
    let tmResults = [];
    if (TM_KEY && center) {
      const tmURL = new URL('https://app.ticketmaster.com/discovery/v2/events.json');
      tmURL.searchParams.set('apikey', TM_KEY);
      tmURL.searchParams.set('latlong', `${center.lat},${center.lon}`);
      tmURL.searchParams.set('radius', String(radiusKm));
      tmURL.searchParams.set('unit', 'km');
      if (query) tmURL.searchParams.set('keyword', query);
      tmURL.searchParams.set('size', String(size));
      tmURL.searchParams.set('page', String(page));
      try {
        const r = await fetch(tmURL.toString());
        if (r.ok) {
          const data = await r.json();
          const arr = data?._embedded?.events || [];
          tmResults = arr.map(normalizeTM).filter(Boolean);
        }
      } catch {}
    }

    // 4) lokalni filtri
    function matches(e) {
      if (query) {
        const hay = `${e.name} ${e.venue?.address || ''}`.toLowerCase();
        if (!hay.includes(query.toLowerCase())) return false;
      }
      if (category) {
        if ((e.category || '') !== category) return false;
      }
      if (center && e.venue?.lat && e.venue?.lon) {
        const d = haversineKm(center, { lat: e.venue.lat, lon: e.venue.lon });
        if (d > radiusKm) return false;
      } else if (center && (e.source === 'provider')) {
        // če za provider še vedno nimamo koordinat, ga izločimo pri geo iskanju
        return false;
      }
      return true;
    }

    // 5) kombinacija, deduplikacija, sortiranje
    const combined = [...sbItems, ...tmResults].filter(matches);

    // dedupe: najprej po id; če ga ni, po name|start|address
    const seen = new Set();
    const unique = [];
    for (const e of combined) {
      const key = e.id || `${(e.name||'').toLowerCase()}|${e.start||''}|${(e.venue?.address||'').toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(e);
    }

    // sortiraj po začetku (najprej najbližji v času)
    unique.sort((a,b) => {
      const ta = a.start ? Date.parse(a.start) : Infinity;
      const tb = b.start ? Date.parse(b.start) : Infinity;
      return ta - tb;
    });

    // 6) paging
    const startIdx = page * size;
    const results = unique.slice(startIdx, startIdx + size);

    return json({ ok: true, results, total: unique.length });
  } catch (e) {
    console.error('tm-search error:', e);
    return json({ ok: false, error: e.message || 'Napaka pri iskanju' }, 500);
  }
};

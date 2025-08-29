// netlify/functions/tm-search.js
// Združeno iskanje: Ticketmaster (opcijsko) + Supabase submissions

import { createClient } from '@supabase/supabase-js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET,OPTIONS',
};
const json = (d, s = 200) => ({
  statusCode: s,
  headers: { 'Content-Type': 'application/json', ...CORS },
  body: JSON.stringify(d),
});

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TM_KEY = process.env.TICKETMASTER_API_KEY || ''; // opcijsko

const BUCKET = 'event-images';
const SUBMISSIONS_PREFIX = 'submissions/';

/* ----------------------------- pomočniki ----------------------------- */

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

async function geocodeCity(city) {
  if (!city) return null;
  const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
    city
  )}&limit=1`;
  const r = await fetch(url, { headers: { 'User-Agent': 'NearGo/1.0' } });
  if (!r.ok) return null;
  const arr = await r.json();
  if (!arr?.length) return null;
  return { lat: parseFloat(arr[0].lat), lon: parseFloat(arr[0].lon) };
}

function normalizeTM(ev) {
  try {
    const venue = ev._embedded?.venues?.[0];
    const img =
      (ev.images || []).sort((a, b) => b.width - a.width)[0]?.url || null;
    return {
      id: `tm_${ev.id}`,
      source: 'ticketmaster',
      name: ev.name,
      url: ev.url || null,
      images: img ? [img] : [],
      start: ev.dates?.start?.dateTime || null,
      end: null,
      category:
        ev.classifications?.[0]?.segment?.name?.toLowerCase() || null,
      venue: {
        name: venue?.name || '',
        address: [venue?.address?.line1, venue?.city?.name, venue?.country?.countryCode]
          .filter(Boolean)
          .join(', '),
        lat: venue?.location ? parseFloat(venue.location.latitude) : null,
        lon: venue?.location ? parseFloat(venue.location.longitude) : null,
      },
    };
  } catch {
    return null;
  }
}

function normalizeSB(obj) {
  // JSON, ki ga shrani provider-submit (po novem lahko vsebuje images, lat/lon)
  const lat = obj.venueLat ?? obj.lat ?? null;
  const lon = obj.venueLon ?? obj.lon ?? null;
  return {
    id: `sb_${obj.createdAt || obj.eventName}`,
    source: 'provider',
    name: obj.eventName || 'Dogodek',
    url: obj.url || null,
    images: Array.isArray(obj.images) ? obj.images : [],
    start: obj.start || null,
    end: obj.end || null,
    category: (obj.category || '').toLowerCase() || null,
    venue: {
      name: obj.venue || '',
      address: [obj.venue || '', obj.city || obj.city2 || '', obj.country || '']
        .filter(Boolean)
        .join(', '),
      lat: lat ? parseFloat(lat) : null,
      lon: lon ? parseFloat(lon) : null,
    },
  };
}

/* --------------------------------- API -------------------------------- */

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

    /* 1) središče iskanja */
    let center = null;
    if (latlon) {
      const [la, lo] = latlon.split(',').map(Number);
      if (!Number.isNaN(la) && !Number.isNaN(lo)) center = { lat: la, lon: lo };
    } else if (city) {
      center = await geocodeCity(city);
    }

    /* 2) Ticketmaster (opcijsko, le če imamo center) */
    let tmResults = [];
    if (TM_KEY && center) {
      const tmURL = new URL('https://app.ticketmaster.com/discovery/v2/events.json');
      tmURL.searchParams.set('apikey', TM_KEY);
      tmURL.searchParams.set('latlong', `${center.lat},${center.lon}`);
      tmURL.searchParams.set('radius', String(radiusKm));
      tmURL.searchParams.set('unit', 'km');
      if (query) tmURL.searchParams.set('keyword', query);
      tmURL.searchParams.set('size', String(size));   // enostaven paging
      tmURL.searchParams.set('page', String(page));
      const r = await fetch(tmURL.toString());
      if (r.ok) {
        const data = await r.json();
        const arr = data?._embedded?.events || [];
        tmResults = arr.map(normalizeTM).filter(Boolean);
      }
    }

    /* 3) Supabase submissions (JSON datoteke v Storage) */
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
    const sbItems = [];
    for (const f of jsonFiles) {
      const { data, error } = await supabase
        .storage
        .from(BUCKET)
        .download(SUBMISSIONS_PREFIX + f.name);
      if (!error && data) {
        const txt = await data.text();
        try {
          const obj = JSON.parse(txt);
          sbItems.push(normalizeSB(obj));
        } catch {
          /* ignore malformed */
        }
      }
    }

    /* 4) lokalno filtriranje po query/category/radius */
    function matches(e) {
      if (query) {
        const hay = `${e.name} ${e.venue?.address || ''}`.toLowerCase();
        if (!hay.includes(query.toLowerCase())) return false;
      }
      if (category) {
        if ((e.category || '') !== category) return false;
      }
      // KLJUČNO: če uporabnik išče po lokaciji (center obstaja),
      // dogodki brez koordinat NE gredo skozi.
      if (center) {
        if (!(e.venue?.lat && e.venue?.lon)) return false;
        const d = haversineKm(center, { lat: e.venue.lat, lon: e.venue.lon });
        if (d > radiusKm) return false;
      }
      return true;
    }

    const combined = [...sbItems, ...tmResults].filter(matches);

    // enostaven "paging"
    const start = page * size;
    const results = combined.slice(start, start + size);

    return json({ ok: true, results, total: combined.length });
  } catch (e) {
    return json({ ok: false, error: e.message || 'Napaka pri iskanju' }, 500);
  }
};
```0

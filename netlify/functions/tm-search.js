// Enotna iskana točka NearGo.
// Agregira rezultate iz /providers (veliki API-ji, manjši URL-ji, Supabase oddaje),
// podpira geokodiranje mest, filtriranje po radiju/kategoriji/poizvedbi, deduplikacijo
// in prioritizira izpostavljene (featured). Nikoli ne vrača HTTP 500 – UI vedno dobi 200.

import { runProviders } from '../../providers/index.js'; // <-- PRAVILNA POT

/* -------------------- CORS + JSON helper -------------------- */
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

/* -------------------- Geo utils -------------------- */
const toRad = (deg) => (deg * Math.PI) / 180;
function haversineKm(a, b) {
  if (!a || !b || typeof a.lat !== 'number' || typeof a.lon !== 'number' || typeof b.lat !== 'number' || typeof b.lon !== 'number') {
    return Number.POSITIVE_INFINITY;
  }
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
  const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(city)}&limit=1`;
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'NearGo/1.0 (search)' } });
    if (!r.ok) return null;
    const arr = await r.json();
    if (!arr?.length) return null;
    return { lat: parseFloat(arr[0].lat), lon: parseFloat(arr[0].lon) };
  } catch (err) {
    console.error('Geocode error:', err);
    return null;
  }
}

/* -------------------- Normalizacija -------------------- */
const s = (v) => (v ?? '').toString();

function normalizeEvent(e) {
  // Providers naj vračajo ta format; tukaj samo dodatno zavarujemo polja.
  const venue = e?.venue || {};
  const lat = typeof venue.lat === 'number' ? venue.lat : (venue.latitude ?? null);
  const lon = typeof venue.lon === 'number' ? venue.lon : (venue.longitude ?? null);

  return {
    id: s(e?.id || `${s(e?.source)}_${s(e?.name)}_${s(e?.start)}`),
    source: s(e?.source || 'unknown'),
    name: s(e?.name || 'Dogodek'),
    url: e?.url ? s(e.url) : null,
    images: Array.isArray(e?.images) ? e.images.filter(Boolean) : [],
    start: e?.start || null,
    end: e?.end || null,
    category: (e?.category || '').toString().toLowerCase() || null,
    featuredUntil: e?.featuredUntil || null, // ISO string ali null
    venue: {
      name: s(venue?.name || ''),
      address: s(venue?.address || ''),
      lat: typeof lat === 'number' ? lat : null,
      lon: typeof lon === 'number' ? lon : null,
    },
  };
}

/* -------------------- Handler -------------------- */
export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };
  if (event.httpMethod !== 'GET') return json({ ok: false, error: 'Method not allowed' }, 405);

  try {
    const q = new URLSearchParams(event.rawQuery || event.queryStringParameters || {});
    const query = (q.get('q') || '').trim();
    const city = (q.get('city') || '').trim();
    const latlon = (q.get('latlon') || '').trim(); // "lat,lon"
    const category = (q.get('category') || '').trim().toLowerCase();
    const radiusKm = Math.max(1, parseInt(q.get('radiuskm') || '50', 10));
    const page = Math.max(0, parseInt(q.get('page') || '0', 10));
    const size = Math.min(50, Math.max(1, parseInt(q.get('size') || '20', 10)));

    // Center: CITY > GEO (če je mesto podano, ignoriramo latlon)
    let center = null;
    if (city) {
      center = await geocodeCity(city);
    } else if (latlon) {
      const [la, lo] = latlon.split(',').map(Number);
      if (!Number.isNaN(la) && !Number.isNaN(lo)) center = { lat: la, lon: lo };
    }

    /* ---- 1) Pridobi rezultate iz providerjev ---- */
    let providerResults = [];
    try {
      // runProviders naj INTERN0 lovi napake posameznih providerjev in vrne samo uspešne.
      // Če pa se vseeno kaj zalomi, ta try/catch prepreči 500.
      providerResults = await runProviders({
        center,     // lahko je null — providerji naj to znajo ignorirati
        radiusKm,
        query,
        category,
      });
    } catch (err) {
      console.error('runProviders failed:', err);
      providerResults = []; // ne zruši API-ja, samo brez providerjev
    }

    /* ---- 2) Normaliziraj & varnostno filtriraj ---- */
    const normalized = (providerResults || []).map(normalizeEvent);

    /* ---- 3) Lokalno filtriranje po query/kategoriji/radiju ---- */
    const filtered = normalized.filter((e) => {
      if (query) {
        const hay = `${e.name} ${e.venue.address}`.toLowerCase();
        if (!hay.includes(query.toLowerCase())) return false;
      }
      if (category) {
        if ((e.category || '') !== category) return false;
      }
      if (center && e.venue.lat != null && e.venue.lon != null) {
        const d = haversineKm(center, { lat: e.venue.lat, lon: e.venue.lon });
        if (d > radiusKm) return false;
      }
      return true;
    });

    /* ---- 4) Deduplikacija ---- */
    const seen = new Set();
    const seenKey = new Set();
    const deduped = [];
    for (const e of filtered) {
      const key = `${e.source}:${e.id}`;
      const key2 = `${e.name.toLowerCase()}|${(e.start || '').slice(0, 10)}|${e.venue.address.toLowerCase()}`;
      if (seen.has(key) || seenKey.has(key2)) continue;
      seen.add(key);
      seenKey.add(key2);
      deduped.push(e);
    }

    /* ---- 5) Razvrščanje (featured > bližina > začetek) ---- */
    const nowISO = new Date().toISOString();
    deduped.sort((a, b) => {
      const aFeat = a.featuredUntil && a.featuredUntil >= nowISO;
      const bFeat = b.featuredUntil && b.featuredUntil >= nowISO;
      if (aFeat !== bFeat) return aFeat ? -1 : 1;

      const aDist = center ? haversineKm(center, a.venue) : Number.POSITIVE_INFINITY;
      const bDist = center ? haversineKm(center, b.venue) : Number.POSITIVE_INFINITY;
      if (aDist !== bDist) return aDist - bDist;

      const ta = a.start ? Date.parse(a.start) : Number.POSITIVE_INFINITY;
      const tb = b.start ? Date.parse(b.start) : Number.POSITIVE_INFINITY;
      return ta - tb;
    });

    /* ---- 6) Paging ---- */
    const total = deduped.length;
    const startIdx = page * size;
    const results = deduped.slice(startIdx, startIdx + size);

    return json({ ok: true, results, total, page, size, center });
  } catch (e) {
    // Nikoli 500 do UI – vrnemo 200 z ok:false in logiramo napako
    console.error('Napaka v tm-search:', e);
    return json({ ok: false, error: e.message || 'Napaka pri iskanju', results: [] }, 200);
  }
};

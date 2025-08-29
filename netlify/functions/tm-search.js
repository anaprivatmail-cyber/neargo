// netlify/functions/tm-search.js
// Enotna iskana točka: agregira rezultate iz /providers, geokodira mesta, filtrira, deduplikacija, prioriteta featured.

import { runProviders } from '../../providers/index.js';

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
  } catch {
    return null;
  }
}

function safeStr(v) { return (v ?? '').toString(); }
function normalizeEvent(e) {
  return {
    id: safeStr(e.id || `${safeStr(e.source)}_${safeStr(e.name)}_${safeStr(e.start)}`),
    source: safeStr(e.source || 'unknown'),
    name: safeStr(e.name || 'Dogodek'),
    url: e.url ? safeStr(e.url) : null,
    images: Array.isArray(e.images) ? e.images.filter(Boolean) : [],
    start: e.start || null,
    end: e.end || null,
    category: (e.category || '').toString().toLowerCase() || null,
    featuredUntil: e.featuredUntil || null,
    venue: {
      name: safeStr(e.venue?.name || ''),
      address: safeStr(e.venue?.address || ''),
      lat: (e.venue && typeof e.venue.lat === 'number') ? e.venue.lat : null,
      lon: (e.venue && typeof e.venue.lon === 'number') ? e.venue.lon : null
    }
  };
}

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

    // center: CITY > GEO
    let center = null;
    if (city) {
      center = await geocodeCity(city);
    } else if (latlon) {
      const [la, lo] = latlon.split(',').map(Number);
      if (!Number.isNaN(la) && !Number.isNaN(lo)) center = { lat: la, lon: lo };
    }

    // 1) ponudniki
    const providerResults = await runProviders({
      center, radiusKm, query, category
    });

    // 2) normalizacija
    const normalized = (providerResults || []).map(normalizeEvent);

    // 3) filtriranje
    const matches = normalized.filter((e) => {
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

    // 4) deduplikacija
    const seen = new Set();
    const seenKey = new Set();
    const deduped = [];
    for (const e of matches) {
      const key = `${e.source}:${e.id}`;
      const key2 = `${e.name.toLowerCase()}|${(e.start || '').slice(0, 10)}|${e.venue.address.toLowerCase()}`;
      if (seen.has(key) || seenKey.has(key2)) continue;
      seen.add(key);
      seenKey.add(key2);
      deduped.push(e);
    }

    // 5) razvrsti: featured > bližina > čas
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

    // 6) paging
    const total = deduped.length;
    const start = page * size;
    const results = deduped.slice(start, start + size);

    return json({ ok:true, results, total, page, size, center });
  } catch (e) {
    return json({ ok:false, error: e.message || 'Napaka pri iskanju' }, 500);
  }
};

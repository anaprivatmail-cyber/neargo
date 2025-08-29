// netlify/functions/tm-search.js
// Stabilna enotna točka iskanja: Ticketmaster + Eventbrite + Supabase oddaje,
// geokodiranje mest, filtriranje po q/kategoriji/radiju, deduplikacija,
// prioriteta izpostavljenih, nikoli 500 zaradi enega vira.

import { runProviders } from '../../providers/index.js';

/* ---------- CORS & JSON ---------- */
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

/* ---------- Geo utils ---------- */
const toRad = (deg) => (deg * Math.PI) / 180;
function haversineKm(a, b) {
  if (!a || !b || a.lat == null || a.lon == null || b.lat == null || b.lon == null) {
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
  const u = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(city)}&limit=1`;
  try {
    const r = await fetch(u, { headers: { 'User-Agent': 'NearGo/1.0 (search)' } });
    if (!r.ok) return null;
    const arr = await r.json().catch(() => []);
    if (!arr?.length) return null;
    return { lat: parseFloat(arr[0].lat), lon: parseFloat(arr[0].lon) };
  } catch {
    return null;
  }
}

/* ---------- Normalizacija + ščiti ---------- */
const safeStr = (v) => (v ?? '').toString();

function normalizeEvent(e) {
  try {
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
  } catch {
    return null;
  }
}

/* ---------- Handler ---------- */
export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };
  if (event.httpMethod !== 'GET') return json({ ok: false, error: 'Method not allowed' }, 405);

  try {
    // Varnost: vedno uporabljamo queryStringParameters (Netlify)
    const qp = event.queryStringParameters || {};
    const query    = (qp.q || '').trim();
    const city     = (qp.city || '').trim();
    const latlon   = (qp.latlon || '').trim(); // "lat,lon"
    const category = (qp.category || '').trim().toLowerCase();
    const radiusKm = Math.max(1, parseInt(qp.radiuskm || '50', 10));
    const page     = Math.max(0, parseInt(qp.page     || '0', 10));
    const size     = Math.min(50, Math.max(1, parseInt(qp.size || '20', 10)));
    const source   = (qp.source || '').trim().toLowerCase(); // opcijsko

    // Center: CITY > GEO
    let center = null;
    if (city) {
      center = await geocodeCity(city);
    } else if (latlon) {
      const [la, lo] = latlon.split(',').map(Number);
      if (!Number.isNaN(la) && !Number.isNaN(lo)) center = { lat: la, lon: lo };
    }

    // Klic providerjev – nikoli ne mečemo napake navzgor
    let providerResults = [];
    try {
      providerResults = await runProviders({
        env: {
          SUPABASE_URL: process.env.SUPABASE_URL,
          SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
          TICKETMASTER_API_KEY: process.env.TICKETMASTER_API_KEY,
          EB_PRIVATE_TOKEN: process.env.EB_PRIVATE_TOKEN
        },
        center, radiusKm, query, category, page, size, source
      }) || [];
    } catch (e) {
      // Če se provider-registri sesujejo, vrnemo prazno – front-end še vedno živi
      providerResults = [];
    }

    // Normalizacija in varnostno filtriranje
    const normalized = providerResults.map(normalizeEvent).filter(Boolean);

    // Dodatno lokalno filtriranje
    const filtered = normalized.filter((e) => {
      if (query) {
        const hay = `${e.name} ${e.venue?.address || ''}`.toLowerCase();
        if (!hay.includes(query.toLowerCase())) return false;
      }
      if (category && (e.category || '') !== category) return false;
      if (center && e.venue?.lat != null && e.venue?.lon != null) {
        const d = haversineKm(center, { lat: e.venue.lat, lon: e.venue.lon });
        if (d > radiusKm) return false;
      }
      return true;
    });

    // Deduplikacija (ID + “ime+datum+naslov”)
    const seen = new Set();
    const seen2 = new Set();
    const deduped = [];
    for (const e of filtered) {
      const k1 = `${e.source}:${e.id}`;
      const k2 = `${(e.name || '').toLowerCase()}|${(e.start || '').slice(0, 10)}|${(e.venue?.address || '').toLowerCase()}`;
      if (seen.has(k1) || seen2.has(k2)) continue;
      seen.add(k1); seen2.add(k2);
      deduped.push(e);
    }

    // Razvrščanje: izpostavljeni > bližina > čas
    const nowISO = new Date().toISOString();
    deduped.sort((a, b) => {
      const af = a.featuredUntil && a.featuredUntil >= nowISO;
      const bf = b.featuredUntil && b.featuredUntil >= nowISO;
      if (af !== bf) return af ? -1 : 1;

      const ad = center ? haversineKm(center, a.venue) : Number.POSITIVE_INFINITY;
      const bd = center ? haversineKm(center, b.venue) : Number.POSITIVE_INFINITY;
      if (ad !== bd) return ad - bd;

      const ta = a.start ? Date.parse(a.start) : Number.POSITIVE_INFINITY;
      const tb = b.start ? Date.parse(b.start) : Number.POSITIVE_INFINITY;
      return ta - tb;
    });

    // Paging
    const total = deduped.length;
    const start = page * size;
    const results = deduped.slice(start, start + size);

    return json({ ok: true, results, total, page, size, center });
  } catch (e) {
    // Nikoli ne padamo s 500 brez jasnega sporočila
    return json({ ok: false, error: String(e?.message || e || 'Napaka pri iskanju') }, 200);
  }
};

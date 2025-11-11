// Geo worker: processes geo_queue, geocodes addr -> lat/lon, updates offers and cache
// Invoke: GET/POST /.netlify/functions/geo-worker (optional: ?limit=5&dry=1)

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GEOCODE_EMAIL = process.env.GEOCODE_EMAIL || process.env.CONTACT_EMAIL || '';
const supa = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization'
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS };
  try {
    const url = new URL(event.rawUrl || `http://x${event.path}${event.queryString||''}`);
    const limit = Math.max(1, Math.min(10, Number(url.searchParams.get('limit')) || 5));
    const dry = url.searchParams.get('dry') === '1' || url.searchParams.get('dry') === 'true';

    const { data: rows, error } = await supa
      .from('geo_queue')
      .select('*')
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(limit);
    if (error) throw new Error('geo_queue select failed: ' + error.message);

    if (!rows || rows.length === 0) {
      return json({ ok: true, processed: 0, pending: 0 });
    }

    let processed = 0, succeeded = 0, failed = 0;
    for (const row of rows) {
      processed++;
      try {
        if (dry) { continue; }
        const { lat, lon, source } = await resolveLatLon(row.addr_raw, row.addr_norm);
        if (lat == null || lon == null) throw new Error('geocode returned no coords');
        await updateOffer(row.offer_id, lat, lon);
        await upsertCache(row.addr_raw, row.addr_norm, lat, lon);
        await markQueue(row.id, 'done', null);
        succeeded++;
        // be polite with public geocoders
        await sleep(900);
      } catch (e) {
        failed++;
        await markQueue(row.id, 'failed', String(e.message || e));
      }
    }

    return json({ ok: true, processed, succeeded, failed });
  } catch (err) {
    return json({ ok: false, error: String(err?.message || err) }, 500);
  }
};

async function resolveLatLon(addrRaw, addrNorm) {
  // 1) cache first
  const { data: cached, error: e1 } = await supa
    .from('geocode_cache')
    .select('lat, lon')
    .eq('addr_norm', addrNorm)
    .maybeSingle();
  if (e1) throw new Error('cache lookup failed: ' + e1.message);
  if (cached && cached.lat != null && cached.lon != null) {
    return { lat: cached.lat, lon: cached.lon, source: 'cache' };
  }

  // 2) geocode via Nominatim (public OSM)
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(addrRaw)}&limit=1`;
  const headers = {
    'User-Agent': GEOCODE_EMAIL ? `NearGo/1.0 (${GEOCODE_EMAIL})` : 'NearGo/1.0',
    'Accept': 'application/json'
  };
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`geocode HTTP ${res.status}`);
  const arr = await res.json();
  if (!Array.isArray(arr) || arr.length === 0) return { lat: null, lon: null, source: 'nominatim' };
  const rec = arr[0];
  const lat = rec && rec.lat != null ? Number(rec.lat) : null;
  const lon = rec && rec.lon != null ? Number(rec.lon) : null;
  return { lat, lon, source: 'nominatim' };
}

async function updateOffer(offerId, lat, lon) {
  // offers.id type agnostic: try numeric if looks like number
  let idVal = offerId;
  if (typeof idVal === 'string' && /^\d+$/.test(idVal)) idVal = Number(idVal);
  const { error } = await supa
    .from('offers')
    .update({ venue_lat: lat, venue_lon: lon })
    .eq('id', idVal);
  if (error) throw new Error('offers update failed: ' + error.message);
}

async function upsertCache(addrRaw, addrNorm, lat, lon) {
  const point = { type: 'Point', coordinates: [lon, lat] }; // informational; not sent directly
  const { error } = await supa
    .from('geocode_cache')
    .upsert({ addr_raw: addrRaw, addr_norm: addrNorm, lat, lon }, { onConflict: 'addr_norm' });
  if (error) throw new Error('cache upsert failed: ' + error.message);
}

async function markQueue(id, status, errorMsg) {
  const { error } = await supa
    .from('geo_queue')
    .update({ status, error: errorMsg || null })
    .eq('id', id);
  if (error) throw new Error('queue update failed: ' + error.message);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function json(body, status = 200) { return { statusCode: status, headers: CORS, body: JSON.stringify(body) }; }

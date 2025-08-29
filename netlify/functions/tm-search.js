// /api/search – združeno iskanje (naše oddaje + veliki API-ji) z geokodiranjem in featured blend

import { runProviders } from './providers/index.js';

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

// enostavno geokodiranje prek Nominatim
async function geocodeCity(city) {
  if (!city) return null;
  const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(city)}&limit=1`;
  const r = await fetch(url, { headers: { 'User-Agent': 'NearGo/1.0' } });
  if (!r.ok) return null;
  const arr = await r.json().catch(()=>[]);
  if (!arr?.length) return null;
  return { lat: parseFloat(arr[0].lat), lon: parseFloat(arr[0].lon) };
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };
  if (event.httpMethod !== 'GET')     return json({ ok:false, error:'Method not allowed' }, 405);

  try {
    const q = new URLSearchParams(event.rawQuery || event.queryStringParameters || {});
    const query    = (q.get('q') || '').trim();
    const city     = (q.get('city') || '').trim();
    const latlon   = (q.get('latlon') || '').trim(); // "lat,lon"
    const category = (q.get('category') || '').trim().toLowerCase();
    const radiusKm = Math.max(1, parseInt(q.get('radiuskm') || '50', 10));
    const page     = Math.max(0, parseInt(q.get('page') || '0', 10));
    const size     = Math.min(50, Math.max(1, parseInt(q.get('size') || '20', 10)));
    const source   = (q.get('source') || '').trim().toLowerCase(); // optional filter

    // CENTER: prednost ima latlon; če ni, geokodiramo city
    let center = null;
    if (latlon) {
      const [la, lo] = latlon.split(',').map(Number);
      if (!Number.isNaN(la) && !Number.isNaN(lo)) center = { lat: la, lon: lo };
    } else if (city) {
      center = await geocodeCity(city);
    }

    const env = {
      SUPABASE_URL:             process.env.SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY:process.env.SUPABASE_SERVICE_ROLE_KEY,
      TICKETMASTER_API_KEY:     process.env.TICKETMASTER_API_KEY || '',
      EB_PRIVATE_TOKEN:         process.env.EB_PRIVATE_TOKEN || ''
    };

    const results = await runProviders({
      env,
      center, radiusKm,
      query, category,
      page, size,
      source
    });

    return json({ ok:true, results, total: results.length });
  } catch (e) {
    return json({ ok:false, error: e.message || 'Napaka pri iskanju' }, 500);
  }
};

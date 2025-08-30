// netlify/functions/tm-search.js
import { PROVIDERS_ENABLED, PROVIDERS_ORDER } from '../../providers/index.js';
import { runProviders } from '../../providers/index.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET,OPTIONS'
};
const json = (d, s=200) => ({
  statusCode: s,
  headers: { 'Content-Type':'application/json', ...CORS },
  body: JSON.stringify(d)
});

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode:200, headers:CORS, body:'' };
  if (event.httpMethod !== 'GET')     return json({ ok:false, error:'Method not allowed' }, 405);

  try{
    const q = event.queryStringParameters || {};

    const lat  = q.lat ? parseFloat(q.lat) : null;
    const lon  = q.lon ? parseFloat(q.lon) : null;
    const center = (Number.isFinite(lat) && Number.isFinite(lon)) ? { lat, lon } : null;

    const radiusKm = q.radiuskm ? Math.max(1, parseInt(q.radiuskm, 10)) : 50;
    const size     = q.size     ? Math.min(50, parseInt(q.size, 10)) : 20;
    const page     = q.page     ? Math.max(0, parseInt(q.page, 10)) : 0;

    const ctx = {
      env: process.env,
      center,                             // lahko je null -> takrat runProviders ne filtrira po razdalji
      radiusKm,
      size, page,
      query: (q.q || q.query || '').trim(),
      category: (q.category || '').trim().toLowerCase(),
      source: (q.source || '').trim().toLowerCase() || null
    };

    const items = await runProviders(ctx);
    return json({ ok:true, items });
  }catch(e){
    return json({ ok:false, error:String(e?.message || e) }, 500);
  }
};

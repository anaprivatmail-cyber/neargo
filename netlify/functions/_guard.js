// netlify/functions/_guard.js
// Lightweight rate limit guard using Netlify Blobs.
// Usage: const rl = await rateLimit(event, 'endpoint-key', 30, 60); if (rl.blocked) return tooMany();

import { getStore } from '@netlify/blobs';

export async function rateLimit(event, key = 'default', limit = 30, windowSec = 60){
  try{
    const ip = extractIP(event) || 'unknown';
    const slot = Math.floor(Date.now() / (windowSec * 1000));
    const store = await getStore({ name: 'rate-guard', consistency: 'strong' });
    const k = `${key}:${ip}:${slot}`;
    const cur = await store.getJSON(k).catch(()=>null);
    const cnt = (cur && typeof cur.c === 'number') ? cur.c + 1 : 1;
    await store.setJSON(k, { c: cnt }, { ttl: windowSec });
    if (cnt > limit) return { blocked:true, ip, retryAfter: windowSec };
    return { blocked:false, ip };
  }catch{
    // Fail open: do not block if store unavailable
    return { blocked:false, ip: null };
  }
}

export function tooMany(retryAfter = 60){
  return {
    statusCode: 429,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
      'retry-after': String(retryAfter),
      'Access-Control-Allow-Origin': '*'
    },
    body: JSON.stringify({ ok:false, error:'rate_limited' })
  };
}

function extractIP(event){
  const h = event.headers || {};
  const xff = h['x-forwarded-for'] || h['X-Forwarded-For'];
  if (xff) return String(xff).split(',')[0].trim();
  return h['client-ip'] || h['x-real-ip'] || null;
}

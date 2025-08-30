// netlify/functions/provider-submit.js
// Oddaja dogodka -> shrani JSON v Supabase Storage (event-images/submissions/*)
// + geokodira (city+country -> lat/lon) z Nominatim
// + cache v tabeli public.geo_cache (city, country, lat, lon)
// + doda editToken in vrne editUrl za kasnejše urejanje

import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

/* ----------------- CORS + util ----------------- */
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST,OPTIONS'
};
const json = (d, s = 200) => ({
  statusCode: s,
  headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS },
  body: JSON.stringify(d)
});

/* ----------------- ENV ----------------- */
const SUPABASE_URL              = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const BUCKET = 'event-images';
const SUBMISSIONS_PREFIX = 'submissions/';

/* ----------------- helpers ----------------- */
function slugify(s){
  return String(s || '')
    .toLowerCase()
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}
function randToken(n=24){
  try { return crypto.randomBytes(n).toString('hex'); }
  catch { return Math.random().toString(36).slice(2) + Date.now().toString(36); }
}

function requireFields(p){
  const missing = [];
  const need = [
    ['organizer',      'Ime organizatorja'],
    ['organizerEmail', 'E-pošta'],
    ['eventName',      'Naslov dogodka'],
    ['venue',          'Lokacija (prizorišče)'],
    ['country',        'Država'],
    ['start',          'Začetek'],
    ['end',            'Konec'],
    ['description',    'Opis'],
    ['category',       'Kategorija']
  ];
  if (!p.city && !p.city2) missing.push('Mesto/kraj');
  for (const [k, label] of need) if (!String(p[k] ?? '').trim()) missing.push(label);

  const saleType = p.offerType || p.saleType || 'none';
  if (saleType === 'ticket' || saleType === 'coupon'){
    if (p.price == null || p.price === '')  missing.push('Cena');
    if (p.stock == null || p.stock === '')  missing.push('Zaloga');
  }
  return missing;
}

/* --------- geokodiranje + DB cache (public.geo_cache) --------- */
async function fromCacheOrGeocode(supabase, city, country) {
  const cityQ = String(city || '').trim();
  const countryQ = String(country || '').trim().toUpperCase();
  if (!cityQ || !countryQ) return null;

  const { data: cached, error: cacheErr } = await supabase
    .from('geo_cache')
    .select('id, lat, lon, updated_at')
    .eq('country', countryQ)
    .ilike('city', cityQ)
    .limit(1)
    .maybeSingle();

  if (!cacheErr && cached && Number.isFinite(cached.lat) && Number.isFinite(cached.lon)) {
    return { lat: cached.lat, lon: cached.lon, cached: true };
  }

  const search = [cityQ, countryQ].filter(Boolean).join(', ');
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('q', search);
  url.searchParams.set('format', 'json');
  url.searchParams.set('limit', '1');

  const r = await fetch(url.toString(), {
    headers: { 'User-Agent': 'NearGo/1.0 (getneargo.com)' }
  });

  if (!r.ok) return null;
  const arr = await r.json().catch(()=>[]);
  if (!arr?.length) return null;

  const lat = parseFloat(arr[0].lat);
  const lon = parseFloat(arr[0].lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  try {
    if (cached?.id) {
      await supabase.from('geo_cache')
        .update({ lat, lon, updated_at: new Date().toISOString() })
        .eq('id', cached.id);
    } else {
      await supabase.from('geo_cache')
        .insert({ city: cityQ, country: countryQ, lat, lon });
    }
  } catch {}

  return { lat, lon, cached: false };
}

/* ----------------- handler ----------------- */
export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST')   return json({ ok:false, error:'Method not allowed' }, 405);

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY){
    return json({ ok:false, error:'Manjka SUPABASE_URL ali SUPABASE_SERVICE_ROLE_KEY' }, 500);
  }
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  let payload;
  try{
    payload = JSON.parse(event.body || '{}');
  }catch{
    return json({ ok:false, error:'Neveljaven JSON body' }, 400);
  }

  const missing = requireFields(payload);
  if (missing.length) return json({ ok:false, error:'Manjkajoča polja: ' + missing.join(', ') }, 400);

  try{
    if ((!payload.venueLat || !payload.venueLon) && (payload.city || payload.city2) && payload.country){
      const gc = await fromCacheOrGeocode(supabase, payload.city || payload.city2, payload.country);
      if (gc){ payload.venueLat = gc.lat; payload.venueLon = gc.lon; }
    }

    if (payload.featured){
      const until = new Date(Date.now() + 7*24*3600*1000);
      payload.featuredUntil = until.toISOString();
    }

    const now = new Date();
    const fileName = `${now.toISOString().replace(/[:.]/g,'-')}-${slugify(payload.eventName || 'dogodek')}.json`;
    const key = `${SUBMISSIONS_PREFIX}${fileName}`;

    // === edit token + meta ===
    const editToken = randToken(24);

    const bodyObj = {
      ...payload,
      createdAt: now.toISOString(),
      source: 'provider',
      venue: {
        name: payload.venue || '',
        address: `${payload.venue || ''}, ${payload.city || payload.city2 || ''}, ${payload.country || ''}`.replace(/^[,\s]+|[,\s]+$/g,''),
        lat: payload.venueLat ?? null,
        lon: payload.venueLon ?? null
      },
      images: payload.imagePublicUrl ? [payload.imagePublicUrl] : [],
      edit: { token: editToken, key, updatedAt: now.toISOString() }
    };

    const uint8 = Buffer.from(JSON.stringify(bodyObj, null, 2), 'utf8');

    const { error: uploadError } = await supabase
      .storage
      .from(BUCKET)
      .upload(key, uint8, {
        contentType: 'application/json; charset=utf-8',
        upsert: true
      });

    if (uploadError) {
      return json({ ok:false, error:`Napaka pri shranjevanju v Storage: ${uploadError.message}` }, 500);
    }

    const domain = process.env.DOMAIN || ''; // npr. https://getneargo.com
    const editUrl = domain
      ? `${domain}/?edit=${encodeURIComponent(key)}&token=${encodeURIComponent(editToken)}`
      : `/?edit=${encodeURIComponent(key)}&token=${encodeURIComponent(editToken)}`;

    return json({
      ok:true,
      key,
      lat: bodyObj.venue.lat ?? null,
      lon: bodyObj.venue.lon ?? null,
      editUrl
    });
  }catch(e){
    return json({ ok:false, error:String(e?.message || e) }, 500);
  }
};

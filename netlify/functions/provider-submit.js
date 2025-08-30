// netlify/functions/provider-submit.js
// Oddaja dogodka -> geokodiranje + predpomnilnik (Supabase tabela geo_cache)
// -> shrani JSON v Supabase Storage (bucket: event-images/submissions/*)
// -> pošlje potrditveno e-pošto (če RESEND_API_KEY obstaja)

import { createClient } from '@supabase/supabase-js';

/* ----------------- CORS + util ----------------- */
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST,OPTIONS'
};
const json = (d, s = 200) => ({
  statusCode: s,
  headers: { 'Content-Type': 'application/json', ...CORS },
  body: JSON.stringify(d)
});

/* ----------------- ENV ----------------- */
const SUPABASE_URL              = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const RESEND_API_KEY            = process.env.RESEND_API_KEY || '';
const FROM_EMAIL                = process.env.FROM_EMAIL || 'no-reply@getneargo.com';
const ADMIN_EMAIL               = process.env.ADMIN_EMAIL || 'info@getneargo.com';

const BUCKET = 'event-images';
const SUBMISSIONS_PREFIX = 'submissions/';

/* ----------------- helpers ----------------- */
function slugify(s){
  return String(s || '')
    .toLowerCase()
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')   // odstrani naglase
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function requireFields(p){
  const missing = [];
  const need = [
    ['organizer',       'Ime organizatorja'],
    ['organizerEmail',  'E-pošta'],
    ['eventName',       'Naslov dogodka'],
    ['venue',           'Lokacija (prizorišče)'],
    ['country',         'Država'],
    ['start',           'Začetek'],
    ['end',             'Konec'],
    ['description',     'Opis'],
    ['category',        'Kategorija']
  ];
  if (!p.city) missing.push('Mesto/kraj');
  for (const [k, label] of need) if (!String(p[k] ?? '').trim()) missing.push(label);

  const saleType = p.offerType || p.saleType || 'none';
  if (saleType === 'ticket' || saleType === 'coupon'){
    if (p.price == null || p.price === '')  missing.push('Cena');
    if (p.stock == null || p.stock === '')  missing.push('Zaloga');
  }
  return missing;
}

async function sendEmail(to, subject, html){
  if (!RESEND_API_KEY) return { ok:false, note:'RESEND off' };
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ from: FROM_EMAIL, to, subject, html })
  });
  const data = await r.json().catch(()=> ({}));
  return { ok: r.ok, data };
}

// Geokodiranje z OSM Nominatim (brez ključa). Vrne {lat,lon} ali null.
async function geocodeCityCountry(city, country){
  const q = [city, country].filter(Boolean).join(', ');
  if (!q) return null;
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('q', q);
  url.searchParams.set('format', 'json');
  url.searchParams.set('limit', '1');
  // User-Agent je potreben
  const r = await fetch(url.toString(), {
    headers: { 'User-Agent': 'NearGo/1.0 (getneargo.com)' }
  });
  if (!r.ok) return null;
  const arr = await r.json().catch(()=>[]);
  if (!arr?.length) return null;
  const first = arr[0];
  const lat = parseFloat(first.lat);
  const lon = parseFloat(first.lon);
  if (Number.isFinite(lat) && Number.isFinite(lon)) return { lat, lon };
  return null;
}

/** Vrne {lat,lon} iz predpomnilnika ali ga doda, če ne obstaja */
async function getOrCreateCoords(supabase, city, country){
  const cityNorm = String(city || '').trim();
  const countryNorm = String(country || '').trim();

  if (!cityNorm || !countryNorm) return null;

  // 1) poskusi najti v geo_cache (case-insensitive)
  const { data: cached, error: selErr } = await supabase
    .from('geo_cache')
    .select('id, lat, lon')
    .eq('city', cityNorm)
    .eq('country', countryNorm)
    .limit(1)
    .maybeSingle();

  if (!selErr && cached && Number.isFinite(cached.lat) && Number.isFinite(cached.lon)){
    return { lat: cached.lat, lon: cached.lon, source: 'cache' };
  }

  // 2) geokodiraj
  const gc = await geocodeCityCountry(cityNorm, countryNorm);
  if (!gc) return null;

  // 3) zapiši v geo_cache (če že obstaja isti vnos, naredi UPDATE)
  //    Ker nimamo unique constrainta, naredimo "upsert by hand":
  if (cached?.id){
    await supabase.from('geo_cache')
      .update({ lat: gc.lat, lon: gc.lon, updated_at: new Date().toISOString() })
      .eq('id', cached.id);
  } else {
    await supabase.from('geo_cache')
      .insert({ city: cityNorm, country: countryNorm, lat: gc.lat, lon: gc.lon });
  }

  return { lat: gc.lat, lon: gc.lon, source: 'nominatim' };
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
  }catch(e){
    return json({ ok:false, error:'Neveljaven JSON body' }, 400);
  }

  // validacija
  const missing = requireFields(payload);
  if (missing.length) return json({ ok:false, error:'Manjkajoča polja: ' + missing.join(', ') }, 400);

  try{
    // geokodiraj (obvezno želimo koordinate)
    const coords = await getOrCreateCoords(supabase, payload.city, payload.country);
    if (!coords) {
      return json({ ok:false, error:'Geokodiranje ni uspelo za: ' + [payload.city, payload.country].filter(Boolean).join(', ') }, 422);
    }
    payload.venueLat = coords.lat;
    payload.venueLon = coords.lon;

    // featured (7 dni)
    if (payload.featured){
      const until = new Date(Date.now() + 7*24*3600*1000);
      payload.featuredUntil = until.toISOString();
    }

    const now = new Date();
    const fileName = `${now.toISOString().replace(/[:.]/g,'-')}-${slugify(payload.eventName || 'dogodek')}.json`;
    const path = `${SUBMISSIONS_PREFIX}${fileName}`;

    // ZAPIS – UTF-8 (Buffer) -> odpravlja “Cannot convert argument to a ByteString…”
    const bodyObj = { ...payload, createdAt: now.toISOString(), source: 'provider' };
    const uint8 = Buffer.from(JSON.stringify(bodyObj, null, 2), 'utf8');

    const { error: uploadError } = await supabase
      .storage
      .from(BUCKET)
      .upload(path, uint8, {
        contentType: 'application/json; charset=utf-8',
        upsert: true
      });

    if (uploadError) {
      return json({ ok:false, error:`Napaka pri shranjevanju v Storage: ${uploadError.message}` }, 500);
    }

    // mail organizatorju (če je vnešen in če imamo ključ)
    if (payload.organizerEmail){
      await sendEmail(
        payload.organizerEmail,
        'NearGo – potrditev prejema objave',
        `
          <p>Hvala za oddajo dogodka <b>${payload.eventName || ''}</b>.</p>
          <p>Vaš vnos bomo hitro pregledali. ${payload.featured ? 'Izbrali ste izpostavitev (7 dni).' : ''}</p>
          <p>Ekipa NearGo</p>
        `
      );
    }

    // mail adminu (informativno)
    const saleType = payload.offerType || payload.saleType || 'none';
    await sendEmail(
      ADMIN_EMAIL,
      'NearGo – nova objava dogodka',
      `
        <p><b>${payload.eventName || ''}</b></p>
        <p>${payload.city || ''}, ${payload.country || ''}</p>
        <p>Koordinate: ${payload.venueLat}, ${payload.venueLon} (vir: ${coords.source})</p>
        <p>Cena: ${payload.price ?? '—'} | Tip: ${saleType} | Zaloga: ${payload.stock ?? '—'} | Featured: ${payload.featured ? 'DA' : 'NE'}</p>
        <pre style="white-space:pre-wrap">${JSON.stringify(payload, null, 2)}</pre>
      `
    );

    return json({ ok:true, key:path, lat: payload.venueLat, lon: payload.venueLon });
  }catch(e){
    return json({ ok:false, error:String(e?.message || e) }, 500);
  }
};

// netlify/functions/provider-submit.js
// Shrani oddajo v Supabase Storage (JSON, UTF-8), doda geolokacijo (po mestu/državi)
// in (po želji) pošlje e-pošto prek Resend.

import { createClient } from '@supabase/supabase-js';

/* ---------- CORS + util ---------- */
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

/* ---------- ENV ---------- */
const SUPABASE_URL              = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const RESEND_API_KEY            = process.env.RESEND_API_KEY || '';
const FROM_EMAIL                = process.env.FROM_EMAIL || 'no-reply@getneargo.com';
const ADMIN_EMAIL               = process.env.ADMIN_EMAIL || 'info@getneargo.com';

const BUCKET = 'event-images';
const SUBMISSIONS_PREFIX = 'submissions/';

/* ---------- helpers ---------- */
function slugify(s){
  return String(s || '')
    .toLowerCase()
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '') // naglasi
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
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
    if (p.price == null || p.price === '') missing.push('Cena');
    if (p.stock == null || p.stock === '') missing.push('Zaloga');
  }
  return missing;
}

async function sendEmail(to, subject, html){
  if (!RESEND_API_KEY) return { ok:false, note:'RESEND off' };
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM_EMAIL, to, subject, html })
  });
  const data = await r.json().catch(()=> ({}));
  return { ok: r.ok, data };
}

// OSM Nominatim geokodiranje (brez ključa)
async function geocodeCityCountry(city, country){
  const q = [city, country].filter(Boolean).join(', ');
  if (!q) return null;
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('q', q);
  url.searchParams.set('format', 'json');
  url.searchParams.set('limit', '1');
  const r = await fetch(url.toString(), { headers: { 'User-Agent': 'NearGo/1.0 (getneargo.com)' } });
  if (!r.ok) return null;
  const arr = await r.json().catch(()=>[]);
  if (!arr?.length) return null;
  const lat = parseFloat(arr[0].lat);
  const lon = parseFloat(arr[0].lon);
  return (Number.isFinite(lat) && Number.isFinite(lon)) ? { lat, lon } : null;
}

/* ---------- handler ---------- */
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
    // geokodiraj, če nimamo koordinat
    if ((!payload.venueLat || !payload.venueLon) && (payload.city || payload.city2)){
      const gc = await geocodeCityCountry(payload.city || payload.city2, payload.country);
      if (gc){ payload.venueLat = gc.lat; payload.venueLon = gc.lon; }
    }

    // featured (7 dni)
    if (payload.featured){
      payload.featuredUntil = new Date(Date.now() + 7*24*3600*1000).toISOString();
    }

    const now = new Date();
    const fileName = `${now.toISOString().replace(/[:.]/g,'-')}-${slugify(payload.eventName || 'dogodek')}.json`;
    const path = `${SUBMISSIONS_PREFIX}${fileName}`;

    // Zapis kot UTF-8 (Buffer) — odpravi “ByteString >255” napako
    const bodyObj = { ...payload, createdAt: now.toISOString(), source: 'provider' };
    const bytes = Buffer.from(JSON.stringify(bodyObj, null, 2), 'utf8');

    const { error: uploadError } = await supabase
      .storage
      .from(BUCKET)
      .upload(path, bytes, { contentType: 'application/json; charset=utf-8', upsert: true });

    if (uploadError) return json({ ok:false, error:`Napaka pri shranjevanju v Storage: ${uploadError.message}` }, 500);

    // mail organizatorju (če imamo ključ)
    if (payload.organizerEmail){
      await sendEmail(
        payload.organizerEmail,
        'NearGo – potrditev prejema objave',
        `<p>Hvala za oddajo dogodka <b>${payload.eventName || ''}</b>.</p>
         <p>Vaš vnos bomo hitro pregledali. ${payload.featured ? 'Izbrali ste izpostavitev (7 dni).' : ''}</p>
         <p>Ekipa NearGo</p>`
      );
    }

    // mail adminu
    const saleType = payload.offerType || payload.saleType || 'none';
    await sendEmail(
      ADMIN_EMAIL,
      'NearGo – nova objava dogodka',
      `<p><b>${payload.eventName || ''}</b></p>
       <p>${payload.city || payload.city2 || ''}, ${payload.country || ''}</p>
       <p>Cena: ${payload.price ?? '—'} | Tip: ${saleType} | Zaloga: ${payload.stock ?? '—'} | Featured: ${payload.featured ? 'DA' : 'NE'}</p>
       <pre style="white-space:pre-wrap">${JSON.stringify(payload, null, 2)}</pre>`
    );

    return json({ ok:true, key:path });
  }catch(e){
    return json({ ok:false, error:String(e?.message || e) }, 500);
  }
};

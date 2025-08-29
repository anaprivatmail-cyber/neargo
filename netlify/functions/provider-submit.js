// netlify/functions/provider-submit.js
// Shrani oddajo v Supabase Storage (JSON, UTF-8, Blob), geokodira lokacijo in opcijsko pošlje e-pošto prek Resend

import { createClient } from '@supabase/supabase-js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
};
const json = (d, s = 200) => ({
  statusCode: s,
  headers: { 'Content-Type': 'application/json', ...CORS },
  body: JSON.stringify(d),
});

const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const FROM_EMAIL     = process.env.FROM_EMAIL     || 'no-reply@getneargo.com';
const ADMIN_EMAIL    = process.env.ADMIN_EMAIL    || 'info@getneargo.com';

// Supabase (service role – premosti RLS)
const SUPABASE_URL              = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// kam shranimo JSON oddaje
const BUCKET = 'event-images';
const SUBMISSIONS_PREFIX = 'submissions/';

function slugify(s){
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

// — Geokodiranje z Nominatim (OpenStreetMap)
async function geocodeAddress({ venue, city, country }) {
  const q = [venue, city, country].filter(Boolean).join(', ');
  if (!q) return null;
  const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=1`;
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': 'NearGo/1.0 (+https://getneargo.com)' },
    });
    if (!r.ok) return null;
    const arr = await r.json();
    if (!arr?.length) return null;
    return { lat: parseFloat(arr[0].lat), lon: parseFloat(arr[0].lon) };
  } catch {
    return null;
  }
}

async function sendEmail(to, subject, html){
  if (!RESEND_API_KEY) return { ok:false, note:'RESEND_API_KEY ni nastavljen' };
  try{
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({ from: FROM_EMAIL, to, subject, html }),
    });
    const data = await r.json().catch(()=> ({}));
    return { ok: r.ok, data };
  }catch(e){
    return { ok:false, error: e?.message || 'Resend request failed' };
  }
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST')   return json({ ok:false, error:'Method not allowed' }, 405);

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return json({ ok:false, error:'Manjka SUPABASE_URL ali SUPABASE_SERVICE_ROLE_KEY' }, 500);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const payload = JSON.parse(event.body || '{}');
    const now = new Date();

    // dopolni featured veljavnost +7 dni
    if (payload.featured){
      const until = new Date(Date.now() + 7*24*3600*1000);
      payload.featuredUntil = until.toISOString();
    }

    // če nimamo koordinat, jih poizkusi izračunati iz naslova (venue + city + country)
    if ((payload.venue && payload.city) && !(payload.venueLat && payload.venueLon)) {
      const geo = await geocodeAddress({
        venue: payload.venue,
        city: payload.city,
        country: payload.country,
      });
      if (geo) {
        payload.venueLat = geo.lat;
        payload.venueLon = geo.lon;
      }
    }

    // ime JSON datoteke
    const fileName = `${now.toISOString().replace(/[:.]/g,'-')}-${slugify(payload.eventName || 'dogodek')}.json`;
    const path = `${SUBMISSIONS_PREFIX}${fileName}`;

    // — Shranimo kot UTF-8 JSON (Blob). To lepo prenese šumnike, emoji ipd.
    const bodyObj = {
      ...payload,
      createdAt: now.toISOString(),
      source: 'provider',
    };
    const jsonString = JSON.stringify(bodyObj, null, 2);

    let blob;
    try {
      // Node 18+ ima global Blob
      blob = new Blob([jsonString], { type: 'application/json; charset=utf-8' });
    } catch {
      // fallback za okolja brez global Blob
      const { Blob: NodeBlob } = await import('buffer');
      blob = new NodeBlob([jsonString], { type: 'application/json; charset=utf-8' });
    }

    const { error: uploadError } = await supabase
      .storage
      .from(BUCKET)
      .upload(path, blob, {
        contentType: 'application/json; charset=utf-8',
        upsert: true,
      });

    if (uploadError) {
      return json({ ok:false, error:`Napaka pri shranjevanju v Storage: ${uploadError.message}` }, 500);
    }

    // potrdilo organizatorju (če je e-pošta podana in so ključi)
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

    // obvestilo adminu
    await sendEmail(
      ADMIN_EMAIL,
      'NearGo – nova objava dogodka',
      `
        <p>Nova objava: <b>${payload.eventName || ''}</b></p>
        <p>Mesto: ${payload.city || payload.city2 || ''} | Cena: ${payload.price ?? '—'} | Featured: ${payload.featured ? 'DA':'NE'}</p>
        <pre style="white-space:pre-wrap">${JSON.stringify(payload, null, 2)}</pre>
      `
    );

    return json({ ok:true, key: path });

  } catch (e) {
    return json({ ok:false, error: e.message || 'Napaka pri shranjevanju' }, 500);
  }
};
```0

// netlify/functions/provider-submit.js
// Oddaja dogodka -> shrani JSON v Supabase Storage (event-images/submissions/*)
// + geokodira (city+country -> lat/lon) z Nominatim
// + cache v tabeli public.geo_cache (city, country, lat, lon)
// + POŠILJANJE POTRDITVENE E-POŠTE prek Brevo (Sendinblue)

import { createClient } from '@supabase/supabase-js';

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

const BREVO_API_KEY = process.env.BREVO_API_KEY || '';
const FROM_EMAIL    = process.env.FROM_EMAIL || 'no-reply@getneargo.com';
const FROM_NAME     = process.env.FROM_NAME || 'NearGo';

const BUCKET = 'event-images';
const SUBMISSIONS_PREFIX = 'submissions/';

/* ----------------- helpers ----------------- */
function slugify(s){
  return String(s || '')
    .toLowerCase()
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')   // odstrani naglase (č,š,ž…)
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

  // 1) poskusi iz cache
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

  // 2) Nominatim klic
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

  // 3) zapiši/posodobi cache
  try {
    if (cached?.id) {
      await supabase.from('geo_cache')
        .update({ lat, lon, updated_at: new Date().toISOString() })
        .eq('id', cached.id);
    } else {
      await supabase.from('geo_cache')
        .insert({ city: cityQ, country: countryQ, lat, lon });
    }
  } catch { /* ni kritično za oddajo */ }

  return { lat, lon, cached: false };
}

/* --------- Pošlji e-pošto prek Brevo --------- */
async function sendMailBrevo({ to, subject, html, text }) {
  if (!BREVO_API_KEY) return { ok:false, skipped:true, reason:'BREVO_API_KEY missing' };
  const body = {
    sender: { email: FROM_EMAIL, name: FROM_NAME },
    to: [{ email: to }],
    subject,
    htmlContent: html,
    textContent: text || html.replace(/<[^>]+>/g,' ')
  };
  const r = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'api-key': BREVO_API_KEY
    },
    body: JSON.stringify(body)
  });
  if (!r.ok) {
    const msg = await r.text().catch(()=>r.statusText);
    throw new Error(`Brevo error: ${r.status} ${msg}`);
  }
  return { ok:true };
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

  // validacija
  const missing = requireFields(payload);
  if (missing.length) return json({ ok:false, error:'Manjkajoča polja: ' + missing.join(', ') }, 400);

  try{
    // geokodiraj, če ni koordinat
    if ((!payload.venueLat || !payload.venueLon) && (payload.city || payload.city2) && payload.country){
      const city = payload.city || payload.city2;
      const cc   = payload.country;
      const gc = await fromCacheOrGeocode(supabase, city, cc);
      if (gc){ payload.venueLat = gc.lat; payload.venueLon = gc.lon; }
    }

    // featured (7 dni)
    if (payload.featured){
      const until = new Date(Date.now() + 7*24*3600*1000);
      payload.featuredUntil = until.toISOString();
    }

    const now = new Date();
    const fileName = `${now.toISOString().replace(/[:.]/g,'-')}-${slugify(payload.eventName || 'dogodek')}.json`;
    const path = `${SUBMISSIONS_PREFIX}${fileName}`;

    // ZAPIS – robustno UTF-8 (Buffer)
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

    // === Potrditveni e-mail ===
    try{
      const details = `
        <p><b>${payload.eventName}</b></p>
        <p>${payload.venue}${payload.city ? ', ' + payload.city : ''}${payload.country ? ', ' + payload.country : ''}</p>
        <p><b>Začetek:</b> ${payload.start || ''}<br><b>Konec:</b> ${payload.end || ''}</p>
        <p><b>Kategorija:</b> ${payload.category}</p>
      `;
      const html = `
        <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif">
          <h2>NearGo – potrditev oddaje dogodka</h2>
          <p>Pozdravljeni, <b>${payload.organizer}</b>! Vaša objava je bila prejeta.</p>
          ${details}
          <p>Opis:</p>
          <blockquote style="border-left:4px solid #0bbbd6;padding-left:10px">${(payload.description||'').replace(/\n/g,'<br>')}</blockquote>
          ${payload.featured ? '<p><b>Izpostavitev:</b> vključena (7 dni)</p>' : ''}
          <p>Odgovorite na ta e-poštni naslov, če želite karkoli dopolniti.</p>
          <p>Hvala,<br>ekipa NearGo</p>
        </div>
      `;
      await sendMailBrevo({
        to: payload.organizerEmail,
        subject: 'NearGo – potrditev oddaje dogodka',
        html
      });
    }catch(e){
      // ne blokiramo oddaje, le zabeležimo
      console.warn('Email send failed:', e?.message || e);
    }

    return json({ ok:true, key:path, lat: payload.venueLat ?? null, lon: payload.venueLon ?? null });
  }catch(e){
    return json({ ok:false, error:String(e?.message || e) }, 500);
  }
};

// netlify/functions/provider-submit.js
// Oddaja dogodka -> shrani JSON v Supabase Storage (event-images/submissions/*)
// + geokodira (city+country -> lat/lon) z Nominatim
// + cache v tabeli public.geo_cache (city, country, lat, lon)
// + doda editToken in vrne editUrl za kasnejše urejanje
// + POŠLJE E-POŠTO organizatorju z “Uredi dogodek” povezavo (Resend)

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

// za e-pošto (Resend)
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const EMAIL_FROM     = process.env.EMAIL_FROM || 'NearGo <noreply@getneargo.com>';
const PUBLIC_DOMAIN  = process.env.DOMAIN || ''; // npr. https://getneargo.com

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

/* --------- Email (Resend) --------- */
async function sendMail({ to, subject, html }) {
  if (!RESEND_API_KEY) {
    console.warn('RESEND_API_KEY manjka — e-pošte ne pošiljam.');
    return { ok:false, skipped:true };
  }
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ from: EMAIL_FROM, to:[to], subject, html })
  });
  if (!r.ok) {
    const txt = await r.text().catch(()=> '');
    throw new Error('Resend mail error: ' + txt);
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

    const baseUrl = PUBLIC_DOMAIN || '';
    const editUrl = baseUrl
      ? `${baseUrl}/?edit=${encodeURIComponent(key)}&token=${encodeURIComponent(editToken)}`
      : `/?edit=${encodeURIComponent(key)}&token=${encodeURIComponent(editToken)}`;

    // --- POŠLJI E-POŠTO (best-effort; če spodleti, oddaja vseeno uspe) ---
    try{
      await sendMail({
        to: payload.organizerEmail,
        subject: `Urejanje dogodka: ${payload.eventName || 'Vaš dogodek'}`,
        html: `
          <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;line-height:1.5;color:#0b1b2b">
            <h2 style="margin:0 0 10px 0">Hvala za oddajo dogodka na NearGo</h2>
            <p style="margin:0 0 10px 0">Dogodek: <b>${escapeHtml(payload.eventName || '')}</b></p>
            <p style="margin:0 0 10px 0">Če želite dogodek kasneje popraviti, uporabite povezavo:</p>
            <p style="margin:12px 0"><a href="${editUrl}" style="background:#0bbbd6;color:#fff;text-decoration:none;padding:10px 14px;border-radius:10px;display:inline-block">Uredi dogodek</a></p>
            <p style="margin:10px 0 0 0; font-size:13px; color:#5b6b7b">Povezavo skrbno shranite. Kdor ima to povezavo, lahko ureja vaš vnos.</p>
          </div>
        `
      });
    }catch(e){
      console.warn('Email send failed:', e.message || e);
      // ne prekinemo – oddaja je še vedno ok
    }

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

/* --------- malenkostna util funkcija za HTML escapanje --------- */
function escapeHtml(s=''){
  return String(s)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#039;');
         }

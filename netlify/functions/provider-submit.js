// netlify/functions/provider-submit.js
// Oddaja dogodka -> OBVEZNO geokodiranje (city + country -> lat/lon) prek OSM Nominatim.
// Če koordinat ne dobimo, vrnemo 400 in NE shranimo.
// Zapis JSON kot UTF-8 Blob (varno za šumnike).

import { createClient } from '@supabase/supabase-js';

/* ---------- CORS + util ---------- */
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

/* ---------- ENV ---------- */
const SUPABASE_URL              = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const BUCKET = 'event-images';
const SUBMISSIONS_PREFIX = 'submissions/';

/* ---------- helpers ---------- */
function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '') // odstrani naglase
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}
function cleanStr(v) {
  return String(v ?? '')
    .replace(/[\u0000-\u001f]+/g, ' ')
    .trim();
}
function requireFields(p) {
  const missing = [];
  const need = [
    ['organizer', 'Ime organizatorja'],
    ['organizerEmail', 'E-pošta'],
    ['eventName', 'Naslov dogodka'],
    ['venue', 'Lokacija (prizorišče)'],
    ['city', 'Mesto/kraj (ali city2)'],
    ['country', 'Država'],
    ['start', 'Začetek'],
    ['end', 'Konec'],
    ['description', 'Opis'],
    ['category', 'Kategorija'],
  ];
  if (!p.city && !p.city2) missing.push('Mesto/kraj');
  for (const [k, label] of need) if (!cleanStr(p[k] ?? p[`${k}2`])) missing.push(label);

  const saleType = p.offerType || p.saleType || 'none';
  if (saleType === 'ticket' || saleType === 'coupon') {
    if (p.price == null || p.price === '') missing.push('Cena');
    if (p.stock == null || p.stock === '') missing.push('Zaloga');
  }
  return missing;
}

/** Geokodiranje z OSM Nominatim (brez ključa). Vrne {lat, lon} ali null. */
async function geocodeCityCountry(city, country, timeoutMs = 7000) {
  const q = [cleanStr(city), cleanStr(country)].filter(Boolean).join(', ');
  if (!q) return null;

  const controller = new AbortController();
  const to = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const url = new URL('https://nominatim.openstreetmap.org/search');
    url.searchParams.set('q', q);
    url.searchParams.set('format', 'json');
    url.searchParams.set('limit', '1');

    // ASCII User-Agent, da ne sproži ByteString težav
    const r = await fetch(url.toString(), {
      headers: { 'User-Agent': 'NearGo/1.0' },
      signal: controller.signal,
    });
    if (!r.ok) return null;

    const arr = await r.json().catch(() => []);
    if (!arr?.length) return null;

    const lat = Number(arr[0].lat);
    const lon = Number(arr[0].lon);
    return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
  } catch {
    return null;
  } finally {
    clearTimeout(to);
  }
}

/* ---------- handler ---------- */
export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return json({ ok: false, error: 'Method not allowed' }, 405);

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return json({ ok: false, error: 'Manjka SUPABASE_URL ali SUPABASE_SERVICE_ROLE_KEY' }, 500);
  }
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch {
    return json({ ok: false, error: 'Neveljaven JSON body' }, 400);
  }

  // osnovna validacija
  const missing = requireFields(payload);
  if (missing.length) return json({ ok: false, error: 'Manjkajoča polja: ' + missing.join(', ') }, 400);

  try {
    // 1) Če ni podanih koordinat, POSKUSIMO geokodirati
    const hasCoords =
      (payload.venueLat != null && payload.venueLon != null) ||
      (payload.venue && payload.venue.lat != null && payload.venue.lon != null);

    let lat = hasCoords
      ? Number(payload.venueLat ?? payload.venue?.lat)
      : NaN;
    let lon = hasCoords
      ? Number(payload.venueLon ?? payload.venue?.lon)
      : NaN;

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      const gc = await geocodeCityCountry(payload.city || payload.city2, payload.country);
      if (gc) { lat = gc.lat; lon = gc.lon; }
    }

    // 2) Če še vedno nimamo koordinat, zavrnemo oddajo
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return json({
        ok: false,
        error:
          'Lokacije ni bilo mogoče določiti. Preveri "Mesto/kraj" in "Država" (npr. "Celje, SI" ali "London, GB").',
      }, 400);
    }

    // 3) Zgradimo čist JSON
    const now = new Date();
    const fileName = `${now.toISOString().replace(/[:.]/g, '-')}-${slugify(payload.eventName || 'dogodek')}.json`;
    const path = `${SUBMISSIONS_PREFIX}${fileName}`;

    const bodyObj = {
      ...payload,
      organizer: cleanStr(payload.organizer),
      organizerEmail: cleanStr(payload.organizerEmail),
      eventName: cleanStr(payload.eventName),
      venue: typeof payload.venue === 'object'
        ? { ...payload.venue, address: cleanStr(payload.venue.address || payload.venue) }
        : { address: cleanStr(payload.venue) },
      city: cleanStr(payload.city || payload.city2),
      description: cleanStr(payload.description),
      category: cleanStr(payload.category),
      venueLat: lat,
      venueLon: lon,
      // poskrbimo, da je tudi v venue objektu:
      ...(payload.venue && typeof payload.venue === 'object'
        ? { venue: { ...payload.venue, lat, lon } }
        : { venue: { address: cleanStr(payload.venue), lat, lon } }),
      createdAt: now.toISOString(),
      source: 'provider',
      // featured (7 dni)
      ...(payload.featured
        ? { featuredUntil: new Date(now.getTime() + 7 * 24 * 3600 * 1000).toISOString() }
        : {}),
    };

    // 4) Zapis kot UTF-8 Blob (odpravi ByteString napako)
    const blob = new Blob([JSON.stringify(bodyObj, null, 2)], {
      type: 'application/json; charset=utf-8',
    });

    const { error: uploadError } = await supabase
      .storage
      .from(BUCKET)
      .upload(path, blob, {
        contentType: 'application/json; charset=utf-8',
        upsert: true,
      });

    if (uploadError) {
      return json({ ok: false, error: `Napaka pri shranjevanju v Storage: ${uploadError.message}` }, 500);
    }

    return json({ ok: true, key: path, geocoded: true });
  } catch (e) {
    return json({ ok: false, error: String(e?.message || e) }, 500);
  }
};

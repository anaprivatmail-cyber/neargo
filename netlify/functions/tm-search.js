// netlify/functions/tm-search.js
// NearGo – več-izvorni iskalnik dogodkov (trenutno vključen Ticketmaster)
// Filtri: q, city/country ali latlong & radius, startDate, endDate, page, size, categories, lang
// Deluje na Node 18+ (Netlify Functions)

// ---------------- CORS ----------------
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

// ---------------- nastavitve iz okolja ----------------
const DEFAULT_SIZE = Number(process.env.DEFAULT_SIZE || '20');
const DEFAULT_RADIUS_KM = Number(process.env.DEFAULT_RADIUS_KM || '50');

// API ključi (trenutno uporabljen Ticketmaster)
const TM_API_KEY = process.env.TM_API_KEY;

// ---------------- pomočniki ----------------
function json(body, status = 200, extraHeaders = {}) {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS_HEADERS, ...extraHeaders },
    body: JSON.stringify(body),
  };
}

function parseBool(v) {
  if (v === undefined || v === null) return false;
  return ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
}

function safeNumber(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

// ISO pomočniki
function toISOStart(dateStr) {
  // pričakujemo YYYY-MM-DD ali poljuben parseable datum
  const d = dateStr ? new Date(dateStr) : null;
  return d && !isNaN(d) ? new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0)).toISOString() : null;
}
function toISOEnd(dateStr) {
  const d = dateStr ? new Date(dateStr) : null;
  return d && !isNaN(d) ? new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59)).toISOString() : null;
}

// pretvorba jezika v locale (za TM; če ni podpore, bomo uporabili "*")
function langToLocale(lang) {
  if (!lang) return '*';
  const m = String(lang).trim().toLowerCase();
  if (m === 'sl') return 'sl-SI';
  if (m === 'en') return 'en-US';
  if (m === 'de') return 'de-DE';
  if (m === 'it') return 'it-IT';
  if (m === 'hr') return 'hr-HR';
  return '*';
}

// geokodiranje mesta z Nominatim (brez ključa)
async function geocodeCity(city, country) {
  if (!city) return null;
  const base = 'https://nominatim.openstreetmap.org/search';
  const params = new URLSearchParams({
    q: country ? `${city}, ${country}` : city,
    format: 'json',
    limit: '1',
  });
  const res = await fetch(`${base}?${params.toString()}`, {
    headers: { 'User-Agent': 'NearGo/1.0 (netlify function)' },
  });
  if (!res.ok) return null;
  const list = await res.json();
  if (!Array.isArray(list) || !list.length) return null;
  const it = list[0];
  return { lat: Number(it.lat), lon: Number(it.lon) };
}

// pretvori niz "lat,lon" v {lat, lon}
function parseLatLong(s) {
  if (!s) return null;
  const parts = String(s).split(',').map(x => Number(x.trim()));
  if (parts.length !== 2 || parts.some(n => !Number.isFinite(n))) return null;
  return { lat: parts[0], lon: parts[1] };
}

// kategorije -> Ticketmaster classificationName / segmentName namigi
const CATEGORY_MAP = {
  music: ['Music'],
  koncerti: ['Music'],
  family: ['Family'],
  otroci: ['Family'],
  kultura: ['Arts & Theatre', 'Arts', 'Theatre'],
  sports: ['Sports'],
  food: ['Food', 'Food & Drink', 'Festivals'],
  festivals: ['Festival', 'Festivals'],
  film: ['Film'],
};

// normalizacija niza (za deduplikacijo)
function norm(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// deduplikacijski ključ
function makeKey(ev) {
  return `${norm(ev.name)}|${ev.start ?? ''}|${norm(ev.venue?.name ?? '')}|${norm(ev.source)}`;
}

// ---------------- Ticketmaster ----------------
async function fetchTicketmaster(q) {
  if (!TM_API_KEY) {
    return { source: 'ticketmaster', count: 0, results: [], error: 'TM_API_KEY missing' };
  }

  const base = 'https://app.ticketmaster.com/discovery/v2/events.json';
  const params = new URLSearchParams();

  params.set('apikey', TM_API_KEY);
  params.set('size', String(q.size));
  params.set('page', String(q.page));
  params.set('sort', 'date,asc');

  // ključne besede
  if (q.query) params.set('keyword', q.query);

  // geo
  if (q.latlon) {
    params.set('latlong', `${q.latlon.lat},${q.latlon.lon}`);
    params.set('radius', String(q.radiusKm));
    params.set('unit', 'km');
  } else if (q.city) {
    params.set('city', q.city);
  }
  if (q.country) params.set('countryCode', q.country.toUpperCase());

  // datumski filtri
  if (q.startDateISO) params.set('startDateTime', q.startDateISO);
  if (q.endDateISO) params.set('endDateTime', q.endDateISO);

  // locale
  params.set('locale', langToLocale(q.lang));

  // kategorije → classificationName (poskus)
  if (q.categories && q.categories.length) {
    const names = [];
    q.categories.forEach(c => {
      const m = CATEGORY_MAP[c];
      if (m) names.push(...m);
    });
    if (names.length) params.set('classificationName', names.join(','));
  }

  const url = `${base}?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) {
    const t = await res.text().catch(() => res.statusText);
    return { source: 'ticketmaster', count: 0, results: [], error: `HTTP ${res.status} ${t}` };
  }
  const data = await res.json();

  const rawEvents = data?._embedded?.events || [];
  const out = rawEvents.map(tmToUnified).filter(Boolean);

  return { source: 'ticketmaster', count: out.length, results: out, error: null };
}

// pretvorba TM dogodka v naš enoten zapis
function tmToUnified(e) {
  if (!e) return null;

  const images = Array.isArray(e.images)
    ? e.images
        .filter(img => img?.url)
        .sort((a, b) => (b.width || 0) - (a.width || 0))
        .map(img => img.url)
    : [];

  const venue = (e._embedded?.venues && e._embedded?.venues[0]) || {};
  const performers = Array.isArray(e._embedded?.attractions)
    ? e._embedded.attractions.map(a => ({ name: a?.name })).filter(p => p.name)
    : [];

  const price =
    Array.isArray(e.priceRanges) && e.priceRanges.length
      ? {
          min: e.priceRanges[0]?.min ?? null,
          max: e.priceRanges[0]?.max ?? null,
          currency: e.priceRanges[0]?.currency ?? null,
        }
      : null;

  const segment = e.classifications?.[0]?.segment?.name || null;

  return {
    id: `ticketmaster:${e.id}`,
    source: 'ticketmaster',
    sourceId: e.id,
    name: e.name || null,
    description: e.info || e.pleaseNote || e.description || null,
    url: e.url || null,
    start: e.dates?.start?.dateTime || null,
    end: e.dates?.end?.dateTime || null,
    timezone: e.dates?.timezone || e.dates?.start?.timezone || null,
    venue: {
      name: venue.name || null,
      address: venue.address?.line1 || null,
      city: venue.city?.name || null,
      country: venue.country?.countryCode || null,
      lat: venue.location ? Number(venue.location.latitude) : null,
      lon: venue.location ? Number(venue.location.longitude) : null,
    },
    performers,
    images,
    price,
    categories: segment ? [segment] : [],
  };
}

// ---------------- glavni handler ----------------
exports.handler = async (event) => {
  // CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS };
  }

  try {
    // --- parametri ---
    const url = new URL(event.rawUrl || `http://x${event.path}${event.rawQuery ? '?' + event.rawQuery : ''}`);
    const sp = url.searchParams;

    const q = {
      query: sp.get('q') || sp.get('query') || null,
      city: sp.get('city') || null,
      country: (sp.get('country') || '').trim(),
      latlon: parseLatLong(sp.get('latlong')),
      radiusKm: safeNumber(sp.get('radius') || sp.get('radiusKm'), DEFAULT_RADIUS_KM),
      startDateISO: sp.get('startDateTime') || toISOStart(sp.get('startDate')),
      endDateISO: sp.get('endDateTime') || toISOEnd(sp.get('endDate')),
      page: Math.max(0, safeNumber(sp.get('page'), 0)),
      size: Math.max(1, Math.min(200, safeNumber(sp.get('size'), DEFAULT_SIZE))),
      categories: (sp.get('categories') || sp.get('cats') || '')
        .split(',')
        .map(s => s.trim().toLowerCase())
        .filter(Boolean),
      lang: (sp.get('lang') || sp.get('locale') || 'sl').trim().toLowerCase(),
      debug: parseBool(sp.get('debug')),
    };

    // geokodiranje, če je city in ni latlon
    if (!q.latlon && q.city) {
      const geo = await geocodeCity(q.city, q.country);
      if (geo) q.latlon = geo;
    }

    // --- poizvedbe po virih (trenutno Ticketmaster) ---
    const results = [];
    const metaSources = [];
    const errors = [];

    // Ticketmaster
    const tm = await fetchTicketmaster(q);
    metaSources.push({ source: 'ticketmaster', count: tm.count });
    if (tm.error) errors.push({ source: 'ticketmaster', error: tm.error });
    results.push(...tm.results);

    // TODO: Eventbrite / Songkick / SeatGeek / drugi (po dodanih ključih)
    // metaSources.push({ source: 'eventbrite', count: 0 });

    // --- deduplikacija ---
    const seen = new Set();
    const unique = [];
    for (const ev of results) {
      const key = makeKey(ev);
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(ev);
    }

    const payload = {
      ok: true,
      locale: q.lang,
      query: {
        query: q.query,
        city: q.city,
        country: q.country,
        latlon: q.latlon ? `${q.latlon.lat},${q.latlon.lon}` : null,
        radiusKm: q.radiusKm,
        startDateTime: q.startDateISO,
        endDateTime: q.endDateISO,
        page: q.page,
        size: q.size,
        categories: q.categories,
      },
      meta: {
        sourcesUsed: metaSources,
        errors,
      },
      page: q.page,
      size: q.size,
      count: unique.length,
      results: unique,
      ...(q.debug ? { _debug: { tmUrlNote: 'URL sestavljen v kodi; poglej funkcijo fetchTicketmaster()' } } : {}),
    };

    return json(payload, 200, { 'Cache-Control': 'public, max-age=60' });
  } catch (err) {
    return json(
      {
        ok: false,
        error: err?.message || String(err),
      },
      500
    );
  }
};

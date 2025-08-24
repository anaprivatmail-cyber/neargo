// Netlify Function: tm-search
// Node >= 18 (priporočeno 20)
// ENV: TICKETMASTER_API_KEY (obvezno za TM)
//      EVENTBRITE_TOKEN (opcijsko)
//      SONGKICK_API_KEY (opcijsko)
//      SEATGEEK_CLIENT_ID, SEATGEEK_CLIENT_SECRET (opcijsko)
//      DEFAULT_SIZE (opcijsko, npr. 20) DEFAULT_RADIUS_KM (opcijsko, npr. 50)

const DEFAULT_SIZE = parseInt(process.env.DEFAULT_SIZE || '20', 10);
const DEFAULT_RADIUS_KM = parseInt(process.env.DEFAULT_RADIUS_KM || '50', 10);

const TM_API_KEY = process.env.TICKETMASTER_API_KEY;
const EB_TOKEN = process.env.EVENTBRITE_TOKEN;
const SK_KEY = process.env.SONGKICK_API_KEY;
const SG_ID = process.env.SEATGEEK_CLIENT_ID;
const SG_SECRET = process.env.SEATGEEK_CLIENT_SECRET;

// ------- helpers -------

const okJson = (body) => ({
  statusCode: 200,
  headers: cors(),
  body: JSON.stringify(body),
});

const badJson = (code, message, extra = {}) => ({
  statusCode: code,
  headers: cors(),
  body: JSON.stringify({ ok: false, error: message, ...extra }),
});

function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json; charset=utf-8',
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function mapLang(lang = 'en') {
  // Ticketmaster uporablja oblike "sl-si", "de-de", ...
  const lower = String(lang).toLowerCase();
  if (lower === 'sl') return 'sl-si';
  if (lower === 'en') return 'en-us';
  if (lower === 'de') return 'de-de';
  if (lower === 'it') return 'it-it';
  if (lower === 'hr') return 'hr-hr';
  return `${lower}-${lower}`;
}

function parseQuery(event) {
  const url = new URL(event.rawUrl || `https://x.y${event.rawQuery ? '?' + event.rawQuery : ''}`);
  const q = (url.searchParams.get('q') || '').trim();
  const city = (url.searchParams.get('city') || '').trim();
  const country = (url.searchParams.get('country') || '').trim().toUpperCase();
  const lat = parseFloat(url.searchParams.get('lat') || url.searchParams.get('latitude') || '');
  const lon = parseFloat(url.searchParams.get('lon') || url.searchParams.get('lng') || url.searchParams.get('longitude') || '');
  const radiusKm = parseInt(url.searchParams.get('radiusKm') || url.searchParams.get('radius') || DEFAULT_RADIUS_KM, 10);
  const startDate = (url.searchParams.get('startDate') || '').trim(); // ISO
  const endDate = (url.searchParams.get('endDate') || '').trim();     // ISO
  const page = Math.max(0, parseInt(url.searchParams.get('page') || '0', 10));
  const size = Math.min(200, Math.max(1, parseInt(url.searchParams.get('size') || DEFAULT_SIZE, 10)));
  const lang = (url.searchParams.get('lang') || 'en').trim().toLowerCase();
  const categories = (url.searchParams.get('categories') || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  return { q, city, country, lat, lon, radiusKm, startDate, endDate, page, size, lang, categories };
}

function unifyItem({
  id,
  source,
  sourceId,
  title,
  description,
  url,
  start,
  end,
  timezone,
  venue,
  performers = [],
  images = [],
  price = null,
  categories = [],
  purchase = null,
}) {
  return {
    id: `${source}:${sourceId || id}`,
    source,
    sourceId: sourceId || id,
    title,
    description,
    url,
    time: { start, end, timezone },
    venue, // { name, address, city, country, lat, lon }
    performers, // [{name}]
    images, // [{url, width, height}]
    price, // { min, max, currency, promo }
    categories, // ["music","children","food","culture",...]
    purchase, // { url, affiliate }
  };
}

function dedupe(items) {
  const seen = new Map();
  const norm = (s) => (s || '').toLowerCase().replace(/\s+/g, ' ').trim();
  for (const it of items) {
    const key = [
      norm(it.title),
      it.time?.start?.slice(0,16) || '',
      norm(`${it.venue?.city||''}-${it.venue?.name||''}`)
    ].join('|');
    if (!seen.has(key)) seen.set(key, it);
  }
  return Array.from(seen.values());
}

// ------- sources -------

// Ticketmaster
async function fetchTicketmaster(params) {
  if (!TM_API_KEY) return { items: [], count: 0, error: 'TICKETMASTER_API_KEY missing' };
  const {
    q, city, country, lat, lon, radiusKm, startDate, endDate, page, size, lang,
  } = params;

  const locale = mapLang(lang);
  const sp = new URLSearchParams({
    apikey: TM_API_KEY,
    locale,
    size: String(size),
    page: String(page),
    sort: 'date,asc',
  });

  if (q) sp.set('keyword', q);
  if (city) sp.set('city', city);
  if (country) sp.set('countryCode', country);
  if (!isNaN(lat) && !isNaN(lon)) {
    sp.set('latlong', `${lat},${lon}`);
    sp.set('radius', String(radiusKm));
    sp.set('unit', 'km');
  }
  if (startDate) sp.set('startDateTime', new Date(startDate).toISOString());
  if (endDate) sp.set('endDateTime', new Date(endDate).toISOString());

  const url = `https://app.ticketmaster.com/discovery/v2/events.json?${sp.toString()}`;
  const res = await fetch(url);
  if (!res.ok) {
    return { items: [], count: 0, error: `TM ${res.status}` };
  }
  const data = await res.json();

  const events = data._embedded?.events || [];
  const items = events.map((e) => {
    const images = (e.images || []).map(img => ({ url: img.url, width: img.width, height: img.height }));
    const venue = (() => {
      const v = e._embedded?.venues?.[0];
      return v ? {
        name: v.name || '',
        address: [v.address?.line1, v.address?.line2].filter(Boolean).join(', ') || '',
        city: v.city?.name || '',
        country: v.country?.countryCode || '',
        lat: v.location ? parseFloat(v.location.latitude) : undefined,
        lon: v.location ? parseFloat(v.location.longitude) : undefined,
      } : null;
    })();

    const priceRanges = e.priceRanges?.[0] || null;
    const price = priceRanges ? {
      min: priceRanges.min,
      max: priceRanges.max,
      currency: priceRanges.currency,
    } : null;

    const cats = [];
    const seg = e.classifications?.[0];
    if (seg?.segment?.name) cats.push(seg.segment.name.toLowerCase());
    if (seg?.genre?.name) cats.push(seg.genre.name.toLowerCase());
    if (seg?.subGenre?.name) cats.push(seg.subGenre.name.toLowerCase());

    const purchaseUrl = e.url || e._embedded?.attractions?.[0]?.url || null;

    return unifyItem({
      id: e.id,
      source: 'ticketmaster',
      sourceId: e.id,
      title: e.name,
      description: e.info || e.pleaseNote || '',
      url: e.url || '',
      start: e.dates?.start?.dateTime || null,
      end: e.dates?.end?.dateTime || null,
      timezone: e.dates?.timezone || null,
      venue,
      performers: (e._embedded?.attractions || []).map(a => ({ name: a.name })),
      images,
      price,
      categories: cats,
      purchase: purchaseUrl ? { url: purchaseUrl, affiliate: null } : null,
    });
  });

  const count = Number(data.page?.totalElements || items.length);
  return { items, count, error: null };
}

// Eventbrite (pripravljeno; vklop z EVENTBRITE_TOKEN)
async function fetchEventbrite(params) {
  if (!EB_TOKEN) return { items: [], count: 0, error: 'EVENTBRITE_TOKEN missing' };
  const { q, city, country, lat, lon, radiusKm, startDate, endDate, page, size, lang } = params;

  const sp = new URLSearchParams({
    expand: 'venue,category,subcategory,format',
    'page_size': String(size),
    'page': String(page + 1), // EB je 1-based
    'locale': lang || 'en',
    'q': q || '',
  });

  // Lokacija: lat/lon prednost
  if (!isNaN(lat) && !isNaN(lon)) {
    sp.set('location.within', `${radiusKm}km`);
    sp.set('location.latitude', String(lat));
    sp.set('location.longitude', String(lon));
  } else if (city) {
    sp.set('location.within', `${radiusKm}km`);
    sp.set('location.address', city + (country ? `, ${country}` : ''));
  }

  if (startDate) sp.set('start_date.range_start', new Date(startDate).toISOString());
  if (endDate) sp.set('start_date.range_end', new Date(endDate).toISOString());

  const url = `https://www.eventbriteapi.com/v3/events/search/?${sp.toString()}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${EB_TOKEN}` } });
  if (!res.ok) return { items: [], count: 0, error: `EB ${res.status}` };
  const data = await res.json();

  const items = (data.events || []).map((e) => {
    const v = e.venue || {};
    const price = null; // Public pricing pogosto ni na voljo brez dodatnih klicev
    const cats = [e.category?.name, e.subcategory?.name, e.format?.name].filter(Boolean).map(s => s.toLowerCase());

    return unifyItem({
      id: e.id,
      source: 'eventbrite',
      sourceId: e.id,
      title: e.name?.text || '',
      description: e.description?.text || '',
      url: e.url || '',
      start: e.start?.utc ? new Date(e.start.utc).toISOString() : null,
      end: e.end?.utc ? new Date(e.end.utc).toISOString() : null,
      timezone: e.start?.timezone || null,
      venue: {
        name: v.name || '',
        address: [v.address?.address_1, v.address?.address_2].filter(Boolean).join(', ') || '',
        city: v.address?.city || '',
        country: v.address?.country || '',
        lat: v.latitude ? parseFloat(v.latitude) : undefined,
        lon: v.longitude ? parseFloat(v.longitude) : undefined,
      },
      performers: [],
      images: e.logo ? [{ url: e.logo.original?.url || e.logo.url }] : [],
      price,
      categories: cats,
      purchase: e.url ? { url: e.url, affiliate: null } : null,
    });
  });

  return { items, count: Number(data.pagination?.object_count || items.length), error: null };
}

// Songkick (pripravljeno)
async function fetchSongkick(params) {
  if (!SK_KEY) return { items: [], count: 0, error: 'SONGKICK_API_KEY missing' };
  const { q, city, lat, lon, radiusKm, page, size } = params;

  // Uporabimo Metro area search (za mesta) ali lokacijo
  let url;
  if (city) {
    const s = new URLSearchParams({ query: city, apikey: SK_KEY });
    const resCity = await fetch(`https://api.songkick.com/api/3.0/search/locations.json?${s.toString()}`);
    if (!resCity.ok) return { items: [], count: 0, error: `SK city ${resCity.status}` };
    const j = await resCity.json();
    const metroId = j.resultsPage?.results?.location?.[0]?.metroArea?.id;
    if (!metroId) return { items: [], count: 0, error: null };
    url = `https://api.songkick.com/api/3.0/metro_areas/${metroId}/calendar.json?apikey=${SK_KEY}&per_page=${size}&page=${page+1}`;
  } else if (!isNaN(lat) && !isNaN(lon)) {
    url = `https://api.songkick.com/api/3.0/events.json?location=geo:${lat},${lon}&radius=${radiusKm}&apikey=${SK_KEY}&per_page=${size}&page=${page+1}`;
  } else if (q) {
    url = `https://api.songkick.com/api/3.0/events.json?apikey=${SK_KEY}&per_page=${size}&page=${page+1}&artist_name=${encodeURIComponent(q)}`;
  } else {
    return { items: [], count: 0, error: null };
  }

  const res = await fetch(url);
  if (!res.ok) return { items: [], count: 0, error: `SK ${res.status}` };
  const data = await res.json();

  const events = data.resultsPage?.results?.event || [];
  const items = events.map(e => {
    const v = e.venue || {};
    const performers = (e.performance || []).map(p => ({ name: p.artist?.displayName }));
    return unifyItem({
      id: e.id,
      source: 'songkick',
      sourceId: String(e.id),
      title: e.displayName,
      description: '',
      url: e.uri || '',
      start: e.start?.datetime || (e.start?.date ? `${e.start.date}T00:00:00Z` : null),
      end: null,
      timezone: null,
      venue: {
        name: v.displayName || '',
        address: '',
        city: e.location?.city || '',
        country: '',
        lat: e.location?.lat,
        lon: e.location?.lng,
      },
      performers,
      images: [],
      price: null,
      categories: ['music'],
      purchase: e.uri ? { url: e.uri, affiliate: null } : null,
    });
  });

  return { items, count: Number(data.resultsPage?.totalEntries || items.length), error: null };
}

// SeatGeek (pripravljeno)
async function fetchSeatGeek(params) {
  if (!SG_ID || !SG_SECRET) return { items: [], count: 0, error: 'SEATGEEK creds missing' };
  const { q, city, lat, lon, radiusKm, page, size } = params;

  const sp = new URLSearchParams({
    client_id: SG_ID,
    client_secret: SG_SECRET,
    per_page: String(size),
    page: String(page + 1),
  });
  if (q) sp.set('q', q);
  if (!isNaN(lat) && !isNaN(lon)) {
    sp.set('lat', String(lat));
    sp.set('lon', String(lon));
    sp.set('range', `${radiusKm}km`);
  } else if (city) {
    sp.set('venue.city', city);
  }

  const url = `https://api.seatgeek.com/2/events?${sp.toString()}`;
  const res = await fetch(url);
  if (!res.ok) return { items: [], count: 0, error: `SG ${res.status}` };
  const data = await res.json();

  const items = (data.events || []).map(e => {
    const v = e.venue || {};
    let cats = [];
    if (e.type) cats.push(e.type.toLowerCase());
    if (e.taxonomies) cats = cats.concat(e.taxonomies.map(t => t.name.toLowerCase()));
    const price = e.stats ? { min: e.stats.lowest_price, max: e.stats.highest_price, currency: 'USD' } : null;

    return unifyItem({
      id: e.id,
      source: 'seatgeek',
      sourceId: String(e.id),
      title: e.title,
      description: '',
      url: e.url,
      start: e.datetime_utc || null,
      end: null,
      timezone: null,
      venue: {
        name: v.name || '',
        address: v.address || '',
        city: v.city || '',
        country: v.country || '',
        lat: v.location?.lat,
        lon: v.location?.lon,
      },
      performers: (e.performers || []).map(p => ({ name: p.name })),
      images: e.performers?.[0]?.image ? [{ url: e.performers[0].image }] : [],
      price,
      categories: cats,
      purchase: e.url ? { url: e.url, affiliate: null } : null,
    });
  });

  return { items, count: Number(data.meta?.total || items.length), error: null };
}

// ------- handler -------

export const handler = async (event) => {
  try {
    if (event.httpMethod === 'OPTIONS') return okJson({ ok: true });

    const params = parseQuery(event);
    const { lang } = params;

    // Pokliči vire (TM obvezno, ostali če so ključi nastavljeni)
    const calls = [
      fetchTicketmaster(params),
    ];
    if (EB_TOKEN) calls.push(fetchEventbrite(params));
    if (SK_KEY) calls.push(fetchSongkick(params));
    if (SG_ID && SG_SECRET) calls.push(fetchSeatGeek(params));

    const results = await Promise.allSettled(calls);
    const perSource = [];
    const errors = [];

    for (const r of results) {
      if (r.status === 'fulfilled') {
        perSource.push(r.value);
        if (r.value.error) errors.push(r.value.error);
      } else {
        errors.push(String(r.reason || 'unknown'));
      }
      // majhen razmik, da ne zadenemo rate-limita
      await sleep(50);
    }

    const all = perSource.flatMap(s => s.items || []);
    const deduped = dedupe(all);

    // Filtriranje po kategorijah, če je zahtevano
    if (params.categories?.length) {
      const wanted = new Set(params.categories);
      for (let i = deduped.length - 1; i >= 0; i--) {
        const has = (deduped[i].categories || []).some(c => wanted.has(c));
        if (!has) deduped.splice(i, 1);
      }
    }

    return okJson({
      ok: true,
      locale: lang,
      query: {
        q: params.q,
        city: params.city,
        country: params.country,
        latlon: (!isNaN(params.lat) && !isNaN(params.lon)) ? [params.lat, params.lon] : null,
        radiusKm: params.radiusKm,
        startDate: params.startDate || null,
        endDate: params.endDate || null,
        page: params.page,
        size: params.size,
        categories: params.categories,
      },
      meta: {
        sourcesUsed: [
          { source: 'ticketmaster', count: perSource[0]?.items?.length || 0 },
          ...(EB_TOKEN ? [{ source: 'eventbrite', count: (perSource.find(s => s.items?.[0]?.source === 'eventbrite')?.items || []).length }] : []),
          ...(SK_KEY ? [{ source: 'songkick', count: (perSource.find(s => s.items?.[0]?.source === 'songkick')?.items || []).length }] : []),
          ...(SG_ID && SG_SECRET ? [{ source: 'seatgeek', count: (perSource.find(s => s.items?.[0]?.source === 'seatgeek')?.items || []).length }] : []),
        ],
      },
      errors,
      page: params.page,
      size: params.size,
      count: deduped.length,
      results: deduped,
    });
  } catch (err) {
    return badJson(500, 'search_failed', { detail: String(err?.message || err) });
  }
};

// netlify/functions/search.js
// Unified event search across multiple providers with dedup + CORS

// ---------- helpers ----------
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Accept-Language',
};

const ok = (body, status = 200) => ({
  statusCode: status,
  headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  body: JSON.stringify(body),
});

const err = (message, status = 500, extra = {}) =>
  ok({ ok: false, error: { message, ...extra } }, status);

const norm = (s = '') =>
  s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const toISO = (d) => (d ? new Date(d).toISOString() : null);

const parseLang = (event) => {
  const q = new URLSearchParams(event.queryStringParameters || {});
  const p = (q.get('lang') || q.get('locale') || '').toLowerCase();
  if (p) return p;
  const hdr = (event.headers?.['accept-language'] || '').split(',')[0] || '';
  return (hdr || process.env.APP_LOCALE_DEFAULT || 'en').toLowerCase();
};

// make sure we never explode if one provider fails
const settled = async (p) => {
  try {
    return await p;
  } catch (e) {
    return { ok: false, error: String(e) };
  }
};

const pick = (obj, keys) =>
  Object.fromEntries(keys.filter((k) => obj[k] !== undefined).map((k) => [k, obj[k]]));

// ---------- query parsing ----------
function parseQuery(event) {
  const q = new URLSearchParams(event.queryStringParameters || {});
  const query = (q.get('q') || '').trim();
  const city = (q.get('city') || '').trim();
  const country = (q.get('country') || '').trim();
  const latlong = (q.get('latlong') || '').trim(); // "46.05,14.51"
  const radius = (q.get('radius') || '').trim(); // "100km" or "100"
  const startDateTime = (q.get('startDateTime') || '').trim(); // ISO or empty
  const page = Math.max(0, parseInt(q.get('page') || '0', 10));
  const size = Math.min(50, Math.max(1, parseInt(q.get('size') || '20', 10))); // cap 50

  // normalize radius form
  let r = '';
  if (radius) {
    const n = parseFloat(radius);
    r = isFinite(n) ? `${n}km` : radius;
  }

  return { query, city, country, latlong, radius: r, startDateTime, page, size };
}

// ---------- unified schema ----------
// event:
// {
//   id, source, sourceId,
//   name, description,
//   url,
//   start, end, timezone,
//   venue: { name, address, city, country, lat, lon },
//   performers: [{name}],
//   images: [url],
//   price: { min, max, currency }
// }

function fingerprint(e) {
  const k = [
    norm(e.name || ''),
    (e.start || '').slice(0, 10), // date only
    norm(e.venue?.city || ''),
  ].join('|');

  // If we have coordinates, strengthen the hash with rounded coords
  const lat = e.venue?.lat, lon = e.venue?.lon;
  const geo =
    typeof lat === 'number' && typeof lon === 'number'
      ? `|${lat.toFixed(3)},${lon.toFixed(3)}`
      : '';
  return k + geo;
}

function dedupe(list) {
  const seen = new Map();
  for (const e of list) {
    const fp = fingerprint(e);
    if (!seen.has(fp)) {
      seen.set(fp, e);
    } else {
      // merge images/performers/urls if duplicates
      const prev = seen.get(fp);
      prev.images = Array.from(new Set([...(prev.images || []), ...(e.images || [])]));
      prev.performers = Array.from(
        new Set([...(prev.performers || []), ...(e.performers || [])].map((p) => p.name))
      ).map((name) => ({ name }));
      if (!prev.url && e.url) prev.url = e.url;
    }
  }
  return Array.from(seen.values());
}

// ---------- providers ----------
async function fetchTicketmaster(q, lang) {
  const key = process.env.TICKETMASTER_API_KEY;
  if (!key) return { source: 'ticketmaster', results: [] };

  const params = new URLSearchParams();
  if (q.query) params.set('keyword', q.query);
  if (q.city) params.set('city', q.city);
  if (q.country) params.set('countryCode', q.country);
  if (q.latlong) params.set('latlong', q.latlong);
  if (q.radius) params.set('radius', String(parseFloat(q.radius)));
  if (q.startDateTime) params.set('startDateTime', new Date(q.startDateTime).toISOString());
  params.set('size', String(q.size));
  params.set('page', String(q.page));
  params.set('sort', 'date,asc');
  params.set('locale', lang); // e.g., "sl", "en", "de"

  const url = `https://app.ticketmaster.com/discovery/v2/events.json?${params.toString()}&apikey=${encodeURIComponent(
    key
  )}`;

  const res = await fetch(url, { headers: { 'User-Agent': 'neargo/1.0' } });
  if (!res.ok) throw new Error(`TM ${res.status}`);
  const data = await res.json();

  const events = (data?._embedded?.events || []).map((ev) => {
    const venue = ev._embedded?.venues?.[0] || {};
    const price = ev.priceRanges?.[0] || {};
    return {
      id: `ticketmaster:${ev.id}`,
      source: 'ticketmaster',
      sourceId: ev.id,
      name: ev.name,
      description: ev.info || ev.pleaseNote || '',
      url: ev.url,
      start: toISO(ev.dates?.start?.dateTime || ev.dates?.start?.localDate),
      end: toISO(ev.dates?.end?.dateTime),
      timezone: ev.dates?.timezone || venue.timezone || null,
      venue: {
        name: venue.name || '',
        address: venue.address?.line1 || '',
        city: venue.city?.name || '',
        country: venue.country?.countryCode || '',
        lat: venue.location ? Number(venue.location.latitude) : undefined,
        lon: venue.location ? Number(venue.location.longitude) : undefined,
      },
      performers: (ev._embedded?.attractions || []).map((a) => ({ name: a.name })),
      images: (ev.images || []).map((i) => i.url).filter(Boolean),
      price: price ? pick(price, ['min', 'max', 'currency']) : undefined,
    };
  });

  return { source: 'ticketmaster', results: events, rawCount: events.length };
}

async function fetchEventbrite(q, _lang) {
  const token = process.env.EVENTBRITE_TOKEN;
  if (!token) return { source: 'eventbrite', results: [] };

  const params = new URLSearchParams();
  if (q.query) params.set('q', q.query);
  if (q.city) params.set('location.address', [q.city, q.country].filter(Boolean).join(', '));
  if (q.latlong) params.set('location.latitude', q.latlong.split(',')[0].trim());
  if (q.latlong) params.set('location.longitude', q.latlong.split(',')[1].trim());
  if (q.radius) params.set('location.within', q.radius);
  if (q.startDateTime) params.set('start_date.range_start', new Date(q.startDateTime).toISOString());
  params.set('expand', 'venue,format,category,ticket_classes');
  params.set('page', String(q.page + 1)); // EB is 1-based
  params.set('page_size', String(q.size));

  const url = `https://www.eventbriteapi.com/v3/events/search/?${params.toString()}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'neargo/1.0' },
  });
  if (!res.ok) throw new Error(`EB ${res.status}`);
  const data = await res.json();

  const events = (data.events || []).map((ev) => {
    const venue = ev.venue || {};
    let lat, lon;
    if (venue?.latitude && venue?.longitude) {
      lat = Number(venue.latitude);
      lon = Number(venue.longitude);
    }
    // price guess from ticket classes
    const t = Array.isArray(ev.ticket_classes) ? ev.ticket_classes : [];
    const prices = t
      .map((tc) => tc.cost)
      .filter(Boolean)
      .map((c) => ({ value: Number(c.value) / 100, currency: c.currency }));
    const min = prices.length ? Math.min(...prices.map((p) => p.value)) : undefined;
    const max = prices.length ? Math.max(...prices.map((p) => p.value)) : undefined;

    return {
      id: `eventbrite:${ev.id}`,
      source: 'eventbrite',
      sourceId: ev.id,
      name: ev.name?.text || '',
      description: ev.summary || ev.description?.text || '',
      url: ev.url,
      start: toISO(ev.start?.utc || ev.start?.local),
      end: toISO(ev.end?.utc || ev.end?.local),
      timezone: ev.start?.timezone || null,
      venue: {
        name: venue.name || '',
        address: [venue.address_1, venue.address_2].filter(Boolean).join(', '),
        city: venue.address?.city || '',
        country: venue.address?.country || '',
        lat,
        lon,
      },
      performers: [], // EB doesn't expose performers directly
      images: ev.logo?.url ? [ev.logo.url] : [],
      price: prices.length ? { min, max, currency: prices[0].currency } : undefined,
    };
  });

  return { source: 'eventbrite', results: events, rawCount: events.length };
}

async function fetchSongkick(q, _lang) {
  const key = process.env.SONGKICK_API_KEY;
  if (!key) return { source: 'songkick', results: [] };

  const params = new URLSearchParams();
  if (q.query) params.set('query', q.query);
  if (q.latlong) params.set('location', `geo:${q.latlong}`);
  else if (q.city || q.country) params.set('location', `city:${[q.city, q.country].filter(Boolean).join(',')}`);
  if (q.startDateTime) params.set('min_date', new Date(q.startDateTime).toISOString().slice(0, 10));
  params.set('page', String(q.page + 1));
  params.set('per_page', String(q.size));

  const url = `https://api.songkick.com/api/3.0/search/events.json?apikey=${encodeURIComponent(
    key
  )}&${params.toString()}`;

  const res = await fetch(url, { headers: { 'User-Agent': 'neargo/1.0' } });
  if (!res.ok) throw new Error(`SK ${res.status}`);
  const data = await res.json();
  const events = (data.resultsPage?.results?.event || []).map((ev) => {
    const venue = ev.venue || {};
    const loc = ev.location || {};
    const perf = (ev.performance || []).map((p) => ({ name: p.artist?.displayName }));
    return {
      id: `songkick:${ev.id}`,
      source: 'songkick',
      sourceId: String(ev.id),
      name: ev.displayName || '',
      description: '',
      url: ev.uri,
      start: toISO(ev.start?.datetime || ev.start?.date),
      end: null,
      timezone: null,
      venue: {
        name: venue.displayName || '',
        address: '',
        city: venue.metroArea?.displayName || '',
        country: venue.metroArea?.country?.displayName || '',
        lat: typeof loc.lat === 'number' ? loc.lat : undefined,
        lon: typeof loc.lng === 'number' ? loc.lng : undefined,
      },
      performers: perf,
      images: [],
      price: undefined,
    };
  });

  return { source: 'songkick', results: events, rawCount: events.length };
}

async function fetchSeatGeek(q, _lang) {
  const clientId = process.env.SEATGEEK_CLIENT_ID;
  if (!clientId) return { source: 'seatgeek', results: [] };

  const params = new URLSearchParams();
  if (q.query) params.set('q', q.query);
  if (q.latlong) {
    const [lat, lon] = q.latlong.split(',').map((s) => s.trim());
    params.set('lat', lat);
    params.set('lon', lon);
    if (q.radius) params.set('range', q.radius);
  } else if (q.city) {
    params.set('geoip', q.city);
  }
  if (q.startDateTime) params.set('datetime_utc.gte', new Date(q.startDateTime).toISOString());
  params.set('per_page', String(q.size));
  params.set('page', String(q.page));
  params.set('client_id', clientId);

  const url = `https://api.seatgeek.com/2/events?${params.toString()}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'neargo/1.0' } });
  if (!res.ok) throw new Error(`SG ${res.status}`);
  const data = await res.json();

  const events = (data.events || []).map((ev) => {
    const venue = ev.venue || {};
    return {
      id: `seatgeek:${ev.id}`,
      source: 'seatgeek',
      sourceId: String(ev.id),
      name: ev.title || '',
      description: '',
      url: ev.url,
      start: toISO(ev.datetime_utc),
      end: null,
      timezone: venue.timezone || null,
      venue: {
        name: venue.name || '',
        address: venue.address || '',
        city: venue.city || '',
        country: venue.country || '',
        lat: typeof venue.location?.lat === 'number' ? venue.location.lat : venue.lat,
        lon: typeof venue.location?.lon === 'number' ? venue.location.lon : venue.lon,
      },
      performers: (ev.performers || []).map((p) => ({ name: p.name })),
      images: (ev.performers || []).map((p) => p.image).filter(Boolean),
      price: ev.stats?.lowest_price
        ? { min: ev.stats.lowest_price, max: ev.stats.highest_price, currency: 'USD' }
        : undefined,
    };
  });

  return { source: 'seatgeek', results: events, rawCount: events.length };
}

// ---------- handler ----------
exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return ok({}, 204);

  const lang = parseLang(event);
  const q = parseQuery(event);

  try {
    const providers = [
      settled(fetchTicketmaster(q, lang)),
      settled(fetchEventbrite(q, lang)),
      settled(fetchSongkick(q, lang)),
      settled(fetchSeatGeek(q, lang)),
    ];

    const res = await Promise.all(providers);

    const used = [];
    const errors = [];
    let combined = [];

    for (const r of res) {
      if (r?.results) {
        used.push({ source: r.source, count: r.results.length });
        combined = combined.concat(r.results);
      } else {
        // shape from settled() on error
        errors.push(r?.error || 'unknown error');
      }
    }

    const deduped = dedupe(combined);

    const page = q.page;
    const size = q.size;
    const start = page * size;
    const paged = deduped.slice(start, start + size);

    return ok({
      ok: true,
      locale: lang,
      query: q,
      meta: { sourcesUsed: used, errors },
      page,
      size,
      count: deduped.length,
      results: paged,
    });
  } catch (e) {
    return err('search failed', 500, { detail: String(e?.message || e) });
  }
};

// netlify/functions/tm-search.js
// Unified event search (for now: Ticketmaster). Ready to add more providers.
// Returns JSON in a stable shape, de-duplicated, with locale support.

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With'
};

exports.handler = async (event) => {
  try {
    if (event.httpMethod === 'OPTIONS') {
      return { statusCode: 200, headers: CORS_HEADERS, body: '' };
    }

    // --- Locale / language ---------------------------------------------------
    // Prefer ?lang=…; fallback to Accept-Language; default en
    const url = new URL(event.rawUrl || `https://dummy${event.path}${event.rawQuery ? '?' + event.rawQuery : ''}`);
    const q = (url.searchParams.get('q') || url.searchParams.get('query') || '').trim();
    const city = (url.searchParams.get('city') || '').trim();
    const country = (url.searchParams.get('country') || url.searchParams.get('countryCode') || '').trim().toUpperCase();
    const latlong = (url.searchParams.get('latlong') || url.searchParams.get('ll') || '').trim(); // "46.05,14.51"
    const radius = url.searchParams.get('radius') || '';
    const startDateTime = url.searchParams.get('startDateTime') || ''; // ISO8601
    const page = parseInt(url.searchParams.get('page') || '0', 10) || 0;
    const size = Math.min(parseInt(url.searchParams.get('size') || '20', 10) || 20, 200);
    const langParam = (url.searchParams.get('lang') || '').trim();
    const acceptLang = (event.headers && (event.headers['accept-language'] || event.headers['Accept-Language'])) || '';
    const locale = langParam || (acceptLang.split(',')[0] || 'en').toLowerCase();

    // --- Aggregation pipeline -----------------------------------------------
    const results = [];
    const seen = new Set();

    // Provider: Ticketmaster Discovery API
    const TM_KEY = process.env.TICKETMASTER_API_KEY || process.env.TICKETMASTER_CLIENT_ID;
    if (!TM_KEY) {
      return json(500, { ok: false, error: 'Missing TICKETMASTER_API_KEY (or TICKETMASTER_CLIENT_ID) in Netlify Environment.' });
    }

    const tmParams = new URLSearchParams({
      apikey: TM_KEY,
      locale: normalizeTicketmasterLocale(locale),
      size: String(size),
      page: String(page),
    });

    if (q) tmParams.set('keyword', q);
    if (city) tmParams.set('city', city);
    if (country) tmParams.set('countryCode', country);
    if (latlong) tmParams.set('latlong', latlong);
    if (radius) tmParams.set('radius', radius);
    if (startDateTime) tmParams.set('startDateTime', startDateTime);

    const tmUrl = `https://app.ticketmaster.com/discovery/v2/events.json?${tmParams.toString()}`;
    const tmRes = await fetch(tmUrl);
    if (!tmRes.ok) {
      const text = await tmRes.text();
      throw new Error(`Ticketmaster HTTP ${tmRes.status}: ${text}`);
    }
    const tmJson = await tmRes.json();
    const tmItems = (((tmJson || {})._embedded || {}).events || []).map(mapTicketmasterEvent);

    for (const ev of tmItems) {
      const key = `${ev.source}:${ev.id}`;
      if (!seen.has(key)) {
        seen.add(key);
        results.push(ev);
      }
    }

    // TODO: Providers you’ll add next:
    // - Eventbrite
    // - SeatGeek
    // - StubHub (if API access)
    // - Your own DB or partner feeds
    // Each provider should map into the same unified shape as mapTicketmasterEvent.

    return json(200, {
      ok: true,
      locale,
      query: { q, city, country, latlong, radius, startDateTime, page, size },
      count: results.length,
      results,
    });

  } catch (err) {
    return json(500, {
      ok: false,
      error: err.message || String(err),
    });
  }
};

// ---------- helpers ----------

function json(statusCode, obj) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...CORS_HEADERS,
    },
    body: JSON.stringify(obj),
  };
}

function normalizeTicketmasterLocale(locale) {
  // TM expects e.g. "en-us", "sl-si". We’ll pass through, but ensure dash format.
  return locale.replace('_', '-').toLowerCase();
}

function mapTicketmasterEvent(ev) {
  // Unified shape
  const firstDate = (ev.dates && ev.dates.start) || {};
  const venue = (((ev._embedded || {}).venues) || [])[0] || {};
  const city = (venue.city && venue.city.name) || '';
  const country = (venue.country && (venue.country.countryCode || venue.country.name)) || '';
  const classification = (ev.classifications && ev.classifications[0]) || {};
  const segment = (classification.segment && classification.segment.name) || '';
  const genre = (classification.genre && classification.genre.name) || '';
  const promoter = ev.promoter && ev.promoter.name;

  return {
    source: 'ticketmaster',
    id: ev.id,
    name: ev.name,
    description: (ev.info || ev.pleaseNote || ev.description || '').trim() || null,
    url: ev.url,
    status: (ev.dates && ev.dates.status && ev.dates.status.code) || null,
    startDate: firstDate.localDate || firstDate.dateTime || null,
    startTime: firstDate.localTime || null,
    timezone: (ev.dates && ev.dates.timezone) || null,
    endDate: null, // TM rarely gives explicit end
    images: Array.isArray(ev.images) ? ev.images.map(i => i.url).filter(Boolean) : [],
    priceRange: Array.isArray(ev.priceRanges)
      ? ev.priceRanges.map(p => ({ type: p.type, currency: p.currency, min: p.min, max: p.max }))
      : [],
    classification: { segment, genre },
    promoter: promoter || null,
    venue: {
      id: venue.id || null,
      name: venue.name || null,
      address: (venue.address && venue.address.line1) || null,
      city,
      country,
      postalCode: venue.postalCode || null,
      lat: venue.location ? Number(venue.location.latitude) : (venue.latitude ? Number(venue.latitude) : null),
      lon: venue.location ? Number(venue.location.longitude) : (venue.longitude ? Number(venue.longitude) : null),
    },
    raw: ev, // keep original for debugging / future fields
  };
}

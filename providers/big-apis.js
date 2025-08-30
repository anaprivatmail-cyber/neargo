// providers/big-apis.js
// Ticketmaster + Eventbrite (združeno), z normalizacijo

import { makeMatcher } from './types.js';

/* ----------------------- Ticketmaster ----------------------- */
function normalizeTM(ev) {
  try {
    const venue = ev._embedded?.venues?.[0];
    const img = (ev.images || []).sort((a, b) => b.width - a.width)[0]?.url || null;
    return {
      id: `tm_${ev.id}`,
      source: 'ticketmaster',
      name: ev.name,
      url: ev.url || null,
      images: img ? [img] : [],
      start: ev.dates?.start?.dateTime || null,
      end: null,
      category: ev.classifications?.[0]?.segment?.name?.toLowerCase() || null,
      venue: {
        name: venue?.name || '',
        address: [venue?.address?.line1, venue?.city?.name, venue?.country?.countryCode].filter(Boolean).join(', '),
        lat: venue?.location ? parseFloat(venue.location.latitude) : null,
        lon: venue?.location ? parseFloat(venue.location.longitude) : null
      }
    };
  } catch { return null; }
}

async function fetchTicketmaster({ TM_KEY, center, radiusKm, query, category, size, page }) {
  if (!TM_KEY || !center) return [];
  const u = new URL('https://app.ticketmaster.com/discovery/v2/events.json');
  u.searchParams.set('apikey', TM_KEY);
  u.searchParams.set('latlong', `${center.lat},${center.lon}`);
  u.searchParams.set('radius', String(radiusKm));
  u.searchParams.set('unit', 'km');
  if (query) u.searchParams.set('keyword', query);
  if (size)  u.searchParams.set('size', String(size));
  if (page)  u.searchParams.set('page', String(page));
  const r = await fetch(u.toString());
  if (!r.ok) return [];
  const data = await r.json().catch(()=>null);
  const arr = data?._embedded?.events || [];
  const out = arr.map(normalizeTM).filter(Boolean);

  const matches = makeMatcher({ query, category, center, radiusKm });
  return out.filter(matches);
}

/* ----------------------- Eventbrite ----------------------- */
function normalizeEB(ev) {
  try {
    const venue = ev.venue || {};
    const img = ev.logo?.url || null;
    return {
      id: `eb_${ev.id}`,
      source: 'eventbrite',
      name: ev.name?.text || ev.name || 'Dogodek',
      url: ev.url || null,
      images: img ? [img] : [],
      start: ev.start?.utc ? new Date(ev.start.utc).toISOString() : null,
      end: ev.end?.utc ? new Date(ev.end.utc).toISOString() : null,
      category: (ev.category?.short_name || ev.category?.name || '').toLowerCase() || null,
      venue: {
        name: venue.name || '',
        address: [venue.address?.address_1, venue.address?.city, venue.address?.country].filter(Boolean).join(', '),
        lat: venue.latitude ? parseFloat(venue.latitude) : null,
        lon: venue.longitude ? parseFloat(venue.longitude) : null
      }
    };
  } catch { return null; }
}

async function fetchEventbrite({ EB_TOKEN, center, radiusKm, query, category, size, page }) {
  if (!EB_TOKEN || !center) return [];
  const base = 'https://www.eventbriteapi.com/v3/events/search/';
  const u = new URL(base);
  u.searchParams.set('location.within', `${radiusKm}km`);
  u.searchParams.set('location.latitude', String(center.lat));
  u.searchParams.set('location.longitude', String(center.lon));
  if (query)    u.searchParams.set('q', query);
  if (size)     u.searchParams.set('page_size', String(size)); // EB ima page_size
  if (page)     u.searchParams.set('page', String(page + 1));  // 1-based

  const r = await fetch(u.toString(), {
    headers: { Authorization: `Bearer ${EB_TOKEN}` }
  });
  if (!r.ok) return [];
  const data = await r.json().catch(()=>null);
  const events = (data?.events || []).map(normalizeEB).filter(Boolean);

  const matches = makeMatcher({ query, category, center, radiusKm });
  return events.filter(matches);
}

/* ----------------------- Public API (za registry) ----------------------- */
export async function fetchBigApis(opts) {
  const { TICKETMASTER_API_KEY, EB_PRIVATE_TOKEN } = opts.env;
  const center   = opts.center;
  const radiusKm = opts.radiusKm;
  const shared = {
    center, radiusKm,
    query: opts.query, category: opts.category,
    size: opts.size, page: opts.page
  };

  const [tm, eb] = await Promise.all([
    fetchTicketmaster({ TM_KEY: TICKETMASTER_API_KEY, ...shared }),
    fetchEventbrite ({ EB_TOKEN: EB_PRIVATE_TOKEN,      ...shared })
  ]);

  return [...tm, ...eb];
}

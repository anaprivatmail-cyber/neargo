// tm-search.js — združeno iskanje: Ticketmaster + Eventbrite + opcijski lokalni JSON/RSS
import fetch from "node-fetch";

const TM_KEY     = process.env.TM_API_KEY;          // <-- nujno
const EB_TOKEN   = process.env.EB_PRIVATE_TOKEN;    // <-- priporočljivo
const DEFAULT_RADIUS = Number(process.env.DEFAULT_RADIUS_KM || 50);
const SEARCH_SIZE   = Number(process.env.SEARCH_SIZE || 20);

/**
 * Pomagala
 */
const safe = (v, d = null) => (v === undefined || v === null ? d : v);
const toISO = (s) => {
  try { return s ? new Date(s).toISOString() : null; } catch { return null; }
};
const normItem = (src, tag) => ({
  source: tag,
  id: src.id || `${tag}_${Math.random().toString(36).slice(2)}`,
  name: safe(src.name, "Dogodek"),
  url: src.url || src.short_url || "",
  start: src.start || src.startDate || src.start_time || null,
  end: src.end || src.endDate || src.end_time || null,
  images: src.images || (src.image ? [src.image] : []),
  venue: {
    name: safe(src.venue?.name, null),
    address: safe(src.venue?.address, null),
    lat: safe(src.venue?.lat, null),
    lon: safe(src.venue?.lon, null),
  },
});

/**
 * Ticketmaster Discovery API
 * https://developer.ticketmaster.com/products-and-docs/apis/discovery-api/v2/
 */
async function fetchTicketmaster({ q, latlon, radiuskm, page, size, category }) {
  if (!TM_KEY) return [];
  const params = new URLSearchParams({
    apikey: TM_KEY,
    size: String(size),
    page: String(page),
    sort: "date,asc",
  });
  if (q) params.set("keyword", q);
  if (latlon) {
    params.set("latlong", latlon);
    params.set("radius", String(radiuskm));
    params.set("unit", "km");
  }
  if (category) params.set("classificationName", category);

  const url = `https://app.ticketmaster.com/discovery/v2/events.json?${params}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`TM HTTP ${r.status}`);
  const data = await r.json();
  const events = data._embedded?.events || [];

  return events.map(ev => {
    const img = (ev.images || []).sort((a,b)=> (b.width*b.height)-(a.width*a.height));
    const venue = ev._embedded?.venues?.[0] || {};
    const addr = [venue.name, venue.address?.line1, venue.city?.name, venue.country?.countryCode]
      .filter(Boolean).join(", ");
    return normItem({
      id: ev.id,
      name: ev.name,
      url: ev.url,
      start: toISO(ev.dates?.start?.dateTime),
      end: toISO(ev.dates?.end?.dateTime),
      images: img.length ? [img[0].url] : [],
      venue: {
        name: venue.name || null,
        address: addr || null,
        lat: venue.location?.latitude ? Number(venue.location.latitude) : null,
        lon: venue.location?.longitude ? Number(venue.location.longitude) : null,
      },
    }, "ticketmaster");
  });
}

/**
 * Eventbrite API
 * https://www.eventbrite.com/platform/api#/reference/event-search/list/search-events
 */
async function fetchEventbrite({ q, latlon, radiuskm, page, size, category }) {
  if (!EB_TOKEN) return [];
  const headers = { Authorization: `Bearer ${EB_TOKEN}` };

  const params = new URLSearchParams({
    expand: "venue",
    "page_size": String(size),
    "page": String(page + 1),
    "sort_by": "date",
  });
  if (q) params.set("q", q);
  let lat=null, lon=null;
  if (latlon) {
    [lat, lon] = latlon.split(",").map(Number);
    params.set("location.latitude", String(lat));
    params.set("location.longitude", String(lon));
    params.set("location.within", `${radiuskm}km`);
  }
  if (category) params.set("categories", category);

  const url = `https://www.eventbriteapi.com/v3/events/search/?${params}`;
  const r = await fetch(url, { headers });
  if (!r.ok) throw new Error(`EB HTTP ${r.status}`);
  const data = await r.json();
  const events = data.events || [];

  return events.map(ev => {
    const v = ev.venue || {};
    const addr = [v.name, v.address?.address_1, v.address?.city, v.address?.country].filter(Boolean).join(", ");
    return normItem({
      id: ev.id,
      name: ev.name?.text,
      url: ev.url,
      start: toISO(ev.start?.utc),
      end: toISO(ev.end?.utc),
      images: ev.logo?.url ? [ev.logo.url] : [],
      venue: {
        name: v.name || null,
        address: addr || null,
        lat: v.latitude ? Number(v.latitude) : null,
        lon: v.longitude ? Number(v.longitude) : null,
      },
    }, "eventbrite");
  });
}

/**
 * (opcijsko) Lokalni JSON viri (FEEDS_JSON = URL1,URL2,...)
 * Format zapisa na URL-ju: polje objektov s polji name,url,start,end,images[],venue{address,lat,lon}
 */
async function fetchLocalJSON() {
  const list = (process.env.FEEDS_JSON || "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);
  if (!list.length) return [];
  const out = [];
  await Promise.all(list.map(async (u) => {
    try {
      const r = await fetch(u, { timeout: 6000 });
      if (!r.ok) return;
      const arr = await r.json();
      if (Array.isArray(arr)) {
        arr.forEach(x => out.push(normItem(x, "local")));
      }
    } catch {}
  }));
  return out;
}

export async function handler(event) {
  try {
    const p = new URLSearchParams(event.rawQuery || "");
    const q        = (p.get("q") || "").trim();
    const city     = (p.get("city") || "").trim();
    const latlon   = (p.get("latlon") || "").trim();
    const radiuskm = Number(p.get("radiuskm") || DEFAULT_RADIUS);
    const size     = Math.min(Number(p.get("size") || SEARCH_SIZE), 50);
    const page     = Math.max(Number(p.get("page") || 0), 0);
    const category = (p.get("category") || "").trim();

    // Če je samo city, ga posreduj kar kot keyword za oba API-ja
    const qFinal = q || city;

    const args = { q: qFinal, latlon, radiuskm, page, size, category };

    const [tm, eb, local] = await Promise.allSettled([
      fetchTicketmaster(args),
      fetchEventbrite(args),
      fetchLocalJSON(),
    ]);

    const results = [
      ...(tm.status === "fulfilled" ? tm.value : []),
      ...(eb.status === "fulfilled" ? eb.value : []),
      ...(local.status === "fulfilled" ? local.value : []),
    ];

    // Sort po začetku, fallback po imenu
    results.sort((a,b) => {
      const A = a.start ? Date.parse(a.start) : Infinity;
      const B = b.start ? Date.parse(b.start) : Infinity;
      if (A !== B) return A - B;
      return (a.name || "").localeCompare(b.name || "");
    });

    return {
      statusCode: 200,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
      body: JSON.stringify({ ok: true, results, count: results.length }),
    };
  } catch (err) {
    return {
      statusCode: 200,
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({ ok: false, error: String(err) }),
    };
  }
}

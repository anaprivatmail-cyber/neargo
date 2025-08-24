// Netlify Function: tm-search
// Node >= 18 (fetch je na voljo). Vse odgovore vrnemo v enotnem formatu.

const DEFAULT_SIZE = Number(process.env.SEARCH_DEFAULT_SIZE || 20);
const DEFAULT_RADIUS_KM = Number(process.env.SEARCH_DEFAULT_RADIUS_KM || 50);

// ENV – Ticketmaster (že imaš)
const TM_API_KEY = process.env.TICKETMASTER_API_KEY;

// ENV – SeatGeek (opcijsko)
const SG_CLIENT_ID = process.env.SEATGEEK_CLIENT_ID; // npr. "abc123"
const SG_CLIENT_SECRET = process.env.SEATGEEK_CLIENT_SECRET; // opcijsko

// ENV – Eventbrite (opcijsko, Personal OAuth token)
const EB_TOKEN = process.env.EVENTBRITE_API_TOKEN; // "Bearer <token>" ne dodaj, samo token

// ENV – dodatni URL-ji za “scraping” (opcijsko, vejica-seznam)
const CUSTOM_SOURCE_URLS = (process.env.CUSTOM_SOURCE_URLS || "")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

// Majhen util za čakanje
const delay = (ms) => new Promise(res => setTimeout(res, ms));

// Preprost timeout za fetch
async function fetchWithTimeout(url, options = {}, timeoutMs = 12000) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: ctrl.signal });
    return res;
  } finally {
    clearTimeout(id);
  }
}

// Normalizacija locale (npr. "sl" -> "sl-SI" za Ticketmaster)
function normalizeLocale(lang) {
  if (!lang) return undefined;
  const lower = lang.toLowerCase();
  if (lower === "sl") return "sl-SI";
  if (lower === "en") return "en-US";
  return lang;
}

// Parsiranje query parametrov
function parseQuery(event) {
  const url = new URL(event.rawUrl || (`https://dummy${event.path}?${event.rawQuery || ""}`));
  const q = url.searchParams.get("q") || "";
  const city = url.searchParams.get("city") || "";
  const country = url.searchParams.get("country") || "";
  const latlong = url.searchParams.get("latlong") || ""; // "46.05,14.51"
  const radius = url.searchParams.get("radius") || "";   // km
  const startDateTime = url.searchParams.get("startDateTime") || ""; // ISO
  const page = Number(url.searchParams.get("page") || 0);
  const size = Math.min(Math.max(Number(url.searchParams.get("size") || DEFAULT_SIZE), 1), 200);

  // Napredni filtri
  const category = url.searchParams.get("category") || "";  // music, food, kids, culture, sports …
  const kids = url.searchParams.get("kids") === "true";
  const freeOnly = url.searchParams.get("freeOnly") === "true";
  const priceMin = url.searchParams.get("priceMin");
  const priceMax = url.searchParams.get("priceMax");

  const lang = url.searchParams.get("lang") || url.searchParams.get("locale") || "sl";

  return {
    query: q.trim(),
    city: city.trim(),
    country: country.trim(),
    latlong: latlong.trim(),
    radius: radius.trim(),
    startDateTime: startDateTime.trim(),
    page,
    size,
    category: category.trim().toLowerCase(),
    kids,
    freeOnly,
    priceMin: priceMin ? Number(priceMin) : undefined,
    priceMax: priceMax ? Number(priceMax) : undefined,
    lang: lang.trim()
  };
}

// ---------- ENOTNI SCHEMA ----------
/*
{
  id, source, sourceId,
  name, description,
  url,
  start, end, timezone,
  venue: { name, address, city, country, lat, lon },
  performers: [{ name }],
  images: [url],
  price: { min, max, currency },
  tags: [string]
}
*/

function unifyTicketmaster(ev) {
  const venue = ev._embedded?.venues?.[0] || {};
  const priceRange = ev.priceRanges?.[0] || {};
  const images = Array.isArray(ev.images) ? ev.images.map(i => i.url).filter(Boolean) : [];

  return {
    id: `tm_${ev.id}`,
    source: "ticketmaster",
    sourceId: ev.id,
    name: ev.name || "",
    description: ev.info || ev.pleaseNote || "",
    url: ev.url || "",
    start: ev.dates?.start?.dateTime || null,
    end: null,
    timezone: ev.dates?.timezone || undefined,
    venue: {
      name: venue.name || "",
      address: [venue.address?.line1, venue.address?.line2].filter(Boolean).join(", "),
      city: venue.city?.name || "",
      country: venue.country?.countryCode || "",
      lat: venue.location?.latitude ? Number(venue.location.latitude) : undefined,
      lon: venue.location?.longitude ? Number(venue.location.longitude) : undefined
    },
    performers: (ev._embedded?.attractions || []).map(a => ({ name: a.name })).slice(0, 5),
    images,
    price: {
      min: priceRange.min,
      max: priceRange.max,
      currency: priceRange.currency
    },
    tags: (ev.classifications || [])
      .flatMap(c => [c.segment?.name, c.genre?.name, c.subGenre?.name])
      .filter(Boolean)
  };
}

function unifySeatGeek(ev) {
  const venue = ev.venue || {};
  const performers = (ev.performers || []).map(p => ({ name: p.name }));
  return {
    id: `sg_${ev.id}`,
    source: "seatgeek",
    sourceId: String(ev.id),
    name: ev.title || "",
    description: "",
    url: ev.url || "",
    start: ev.datetime_utc || null,
    end: null,
    timezone: venue.timezone || undefined,
    venue: {
      name: venue.name || "",
      address: venue.address || "",
      city: venue.city || "",
      country: venue.country || "",
      lat: venue.location ? venue.location.lat : venue.lat,
      lon: venue.location ? venue.location.lon : venue.lon
    },
    performers,
    images: ev.performers?.[0]?.image ? [ev.performers[0].image] : [],
    price: {
      min: ev.stats?.lowest_price,
      max: ev.stats?.highest_price,
      currency: "USD" // SeatGeek vrača USD; lahko izpelješ po venue.country
    },
    tags: ev.type ? [ev.type] : []
  };
}

function unifyEventbrite(ev, venue) {
  // ev je Event, venue razširjen
  const images = ev.logo?.url ? [ev.logo.url] : [];
  return {
    id: `eb_${ev.id}`,
    source: "eventbrite",
    sourceId: String(ev.id),
    name: ev.name?.text || "",
    description: ev.summary || ev.description?.text || "",
    url: ev.url || "",
    start: ev.start?.utc || null,
    end: ev.end?.utc || null,
    timezone: ev.start?.timezone || undefined,
    venue: {
      name: venue?.name || "",
      address: venue?.address?.address_1 || "",
      city: venue?.address?.city || "",
      country: venue?.address?.country || "",
      lat: venue?.latitude ? Number(venue.latitude) : undefined,
      lon: venue?.longitude ? Number(venue.longitude) : undefined
    },
    performers: [], // Eventbrite ne vrne vedno “performers”
    images,
    price: { min: undefined, max: undefined, currency: undefined }, // potreben dodatni klic /ticket_classes
    tags: ev.category_id ? [String(ev.category_id)] : []
  };
}

// Heš ključ za deduplikacijo (ime+datum+city normalizirano)
function dedupeKey(e) {
  const name = (e.name || "").toLowerCase().replace(/\s+/g, " ").trim();
  const date = (e.start || "").slice(0, 10);
  const city = (e.venue?.city || "").toLowerCase().trim();
  return `${name}|${date}|${city}`;
}

function dedupe(items) {
  const seen = new Set();
  const out = [];
  for (const it of items) {
    const k = dedupeKey(it);
    if (!seen.has(k)) {
      seen.add(k);
      out.push(it);
    }
  }
  return out;
}

// Filterji po kategorijah/otroci/brezplačno/cena
function applyFilters(items, filters) {
  const {
    category, kids, freeOnly, priceMin, priceMax
  } = filters;

  return items.filter(e => {
    if (category) {
      const tags = (e.tags || []).map(t => (t || "").toLowerCase());
      const name = (e.name || "").toLowerCase();
      const desc = (e.description || "").toLowerCase();
      const hay = [...tags, name, desc].join(" ");
      if (!hay.includes(category)) return false;
    }
    if (kids) {
      const hay = `${(e.name||"")} ${(e.description||"")} ${(e.tags||[]).join(" ")}`.toLowerCase();
      const kidsWords = ["kids", "otroci", "family", "družina", "children", "otroški"];
      if (!kidsWords.some(w => hay.includes(w))) return false;
    }
    if (freeOnly) {
      // zelo preprosta logika: če imamo cene in min>0 => ni free
      const min = e.price?.min;
      if (typeof min === "number" && min > 0) return false;
    }
    if (typeof priceMin === "number" && e.price?.min != null && e.price.min < priceMin) return false;
    if (typeof priceMax === "number" && e.price?.max != null && e.price.max > priceMax) return false;

    return true;
  });
}

// ---------- SOURCES ----------

// Ticketmaster
async function searchTicketmaster(params) {
  const out = { source: "ticketmaster", count: 0, results: [], error: null };

  if (!TM_API_KEY) return out;

  const {
    query, city, country, latlong, radius, startDateTime, page, size, lang
  } = params;

  const locale = normalizeLocale(lang);
  const u = new URL("https://app.ticketmaster.com/discovery/v2/events.json");
  u.searchParams.set("apikey", TM_API_KEY);
  if (query) u.searchParams.set("keyword", query);
  if (city) u.searchParams.set("city", city);
  if (country) u.searchParams.set("countryCode", country);
  if (latlong) u.searchParams.set("latlong", latlong);
  u.searchParams.set("radius", radius || String(DEFAULT_RADIUS_KM));
  u.searchParams.set("unit", "km");
  u.searchParams.set("size", String(size));
  u.searchParams.set("page", String(page));
  if (startDateTime) u.searchParams.set("startDateTime", startDateTime);
  if (locale) u.searchParams.set("locale", locale);

  try {
    const res = await fetchWithTimeout(u.toString());
    if (!res.ok) throw new Error(`TM ${res.status}`);
    const data = await res.json();

    const events = data._embedded?.events || [];
    const unified = events.map(unifyTicketmaster);
    out.results = unified;
    out.count = unified.length;
    return out;
  } catch (err) {
    out.error = err.message;
    return out;
  }
}

// SeatGeek
async function searchSeatGeek(params) {
  const out = { source: "seatgeek", count: 0, results: [], error: null };
  if (!SG_CLIENT_ID) return out;

  const {
    query, city, latlong, radius, page, size
  } = params;

  const u = new URL("https://api.seatgeek.com/2/events");
  u.searchParams.set("client_id", SG_CLIENT_ID);
  if (SG_CLIENT_SECRET) u.searchParams.set("client_secret", SG_CLIENT_SECRET);
  if (query) u.searchParams.set("q", query);
  if (city) u.searchParams.set("venue.city", city);
  if (latlong) {
    const [lat, lon] = latlong.split(",").map(Number);
    if (!isNaN(lat) && !isNaN(lon)) {
      u.searchParams.set("lat", String(lat));
      u.searchParams.set("lon", String(lon));
      u.searchParams.set("range", `${radius || DEFAULT_RADIUS_KM}km`);
    }
  }
  u.searchParams.set("per_page", String(size));
  u.searchParams.set("page", String(page + 1)); // SeatGeek je 1-based

  try {
    const res = await fetchWithTimeout(u.toString());
    if (!res.ok) throw new Error(`SG ${res.status}`);
    const data = await res.json();
    const unified = (data.events || []).map(unifySeatGeek);
    out.results = unified;
    out.count = unified.length;
    return out;
  } catch (err) {
    out.error = err.message;
    return out;
  }
}

// Eventbrite
async function searchEventbrite(params) {
  const out = { source: "eventbrite", count: 0, results: [], error: null };
  if (!EB_TOKEN) return out;

  const { query, city, country, page, size } = params;

  const u = new URL("https://www.eventbriteapi.com/v3/events/search/");
  if (query) u.searchParams.set("q", query);
  if (city) u.searchParams.set("location.address", city);
  if (country) u.searchParams.set("location.country", country);
  u.searchParams.set("expand", "venue");
  u.searchParams.set("page", String(page + 1));
  u.searchParams.set("page_size", String(size));

  try {
    const res = await fetchWithTimeout(u.toString(), {
      headers: { Authorization: `Bearer ${EB_TOKEN}` }
    });
    if (!res.ok) throw new Error(`EB ${res.status}`);
    const data = await res.json();
    const unified = (data.events || []).map(ev => unifyEventbrite(ev, ev.venue));
    out.results = unified;
    out.count = unified.length;
    return out;
  } catch (err) {
    out.error = err.message;
    return out;
  }
}

// JSON-LD “Event” scraping iz poljubnih URL-jev
async function scrapeJsonLdEventsFrom(url, size) {
  const out = { source: url, count: 0, results: [], error: null };
  try {
    const res = await fetchWithTimeout(url, {}, 10000);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();

    // poberemo vse <script type="application/ld+json"> in iščemo @type "Event"
    const scripts = Array.from(html.matchAll(
      /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
    ));
    const events = [];
    for (const m of scripts) {
      try {
        const json = JSON.parse(m[1]);
        const arr = Array.isArray(json) ? json : [json];
        for (const item of arr.flat(Infinity)) {
          const type = (item['@type'] || item.type || "").toString().toLowerCase();
          if (type.includes("event")) {
            events.push(item);
          }
        }
      } catch (_) { /* ignore posamezne parse napake */ }
    }

    const unified = events.slice(0, size).map((ev, i) => ({
      id: `scrape_${i}_${Buffer.from(url).toString("base64").slice(0,12)}`,
      source: "custom-url",
      sourceId: ev?.identifier || undefined,
      name: ev?.name || "",
      description: ev?.description || "",
      url: ev?.url || url,
      start: ev?.startDate || null,
      end: ev?.endDate || null,
      timezone: undefined,
      venue: {
        name: ev?.location?.name || "",
        address: ev?.location?.address?.streetAddress || "",
        city: ev?.location?.address?.addressLocality || "",
        country: ev?.location?.address?.addressCountry || "",
        lat: undefined,
        lon: undefined
      },
      performers: Array.isArray(ev?.performer) ? ev.performer.map(p => ({ name: p.name })) : [],
      images: Array.isArray(ev?.image) ? ev.image : (ev?.image ? [ev.image] : []),
      price: undefined,
      tags: []
    }));

    out.results = unified;
    out.count = unified.length;
    return out;
  } catch (err) {
    out.error = err.message;
    return out;
  }
}

async function searchCustomUrls(params) {
  const size = params.size;
  const sources = CUSTOM_SOURCE_URLS.slice(0, 6); // varnostno omejimo
  const tasks = sources.map(u => scrapeJsonLdEventsFrom(u, size));
  const parts = await Promise.allSettled(tasks);
  const merged = [];
  const errors = [];
  for (const p of parts) {
    if (p.status === "fulfilled") {
      merged.push(...p.value.results);
      if (p.value.error) errors.push({ source: p.value.source, error: p.value.error });
    } else {
      errors.push({ source: "custom", error: p.reason?.message || String(p.reason) });
    }
  }
  return {
    source: "custom-urls",
    count: merged.length,
    results: merged,
    error: errors.length ? JSON.stringify(errors) : null
  };
}

// ---------- HANDLER ----------
exports.handler = async (event) => {
  try {
    const params = parseQuery(event);

    // Pokličemo vse vire paralelno (samo tiste, ki imajo ključ/konfiguracijo)
    const jobs = [
      searchTicketmaster(params),
      searchSeatGeek(params),
      searchEventbrite(params),
      searchCustomUrls(params)
    ];

    const settled = await Promise.allSettled(jobs);

    const results = [];
    const sourcesUsed = [];
    const errors = [];

    for (const r of settled) {
      if (r.status === "fulfilled") {
        const { source, count, results: arr, error } = r.value;
        if (count || error !== null) {
          sourcesUsed.push({ source, count });
        }
        if (error) errors.push({ source, error });
        results.push(...(arr || []));
      } else {
        errors.push({ source: "unknown", error: r.reason?.message || String(r.reason) });
      }
    }

    // Dedup + filtri
    let unified = dedupe(results);
    unified = applyFilters(unified, params);

    // Paginacija po združenih rezultatih (če želiš globalno paginirati)
    const start = params.page * params.size;
    const end = start + params.size;
    const pageItems = unified.slice(start, end);

    const body = {
      ok: true,
      locale: params.lang,
      query: {
        query: params.query,
        city: params.city,
        country: params.country,
        latlong: params.latlong,
        radius: params.radius || String(DEFAULT_RADIUS_KM),
        startDateTime: params.startDateTime,
        category: params.category,
        kids: params.kids,
        freeOnly: params.freeOnly,
        priceMin: params.priceMin,
        priceMax: params.priceMax,
        page: params.page,
        size: params.size
      },
      meta: {
        sourcesUsed,
        totalMerged: unified.length,
        page: params.page,
        size: params.size
      },
      errors,
      results: pageItems
    };

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*"
      },
      body: JSON.stringify(body)
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*"
      },
      body: JSON.stringify({ ok: false, error: err.message })
    };
  }
};

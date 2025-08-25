// netlify/functions/tm-search.js
// NearGo – meta-iskalnik (1. vir: Ticketmaster). Pripravljeno za dodajanje drugih virov.
// URL: /.netlify/functions/tm-search?q=metallica&city=London&radius=100&lang=sl

const DEFAULT_SIZE = Number(process.env.SEARCH_SIZE || 20);
const DEFAULT_RADIUS_KM = Number(process.env.DEFAULT_RADIUS_KM || 50);

// ENV – Ticketmaster (imaš že)
const TM_API_KEY = process.env.TICKETMASTER_API_KEY;

// Map jezika v locale Ticketmaster
function mapLocale(lang) {
  if (!lang) return "en";
  const m = { sl: "sl", en: "en", de: "de", it: "it", hr: "hr", fr: "fr" };
  return m[lang.toLowerCase()] || "en";
}

// Pomaga pri varnem branju lastnosti
const get = (obj, path, fallback = undefined) =>
  path.split(".").reduce((o, k) => (o && o[k] != null ? o[k] : undefined), obj) ?? fallback;

// Enoten model dogodka
function normalizeTicketmaster(event) {
  const images = Array.isArray(event.images)
    ? event.images.map((i) => i.url).filter(Boolean)
    : [];
  const venue = get(event, "_embedded.venues[0]", {});
  const priceRanges = event.priceRanges?.[0];

  return {
    id: `tm_${event.id}`,
    source: "ticketmaster",
    sourceId: event.id,
    name: event.name,
    description: event.info || event.pleaseNote || "",
    url: event.url,
    start: get(event, "dates.start.dateTime", null),
    end: null,
    timezone: get(event, "dates.timezone", null),
    venue: {
      name: venue.name || "",
      address: [venue.address?.line1, venue.city?.name, venue.country?.countryCode]
        .filter(Boolean)
        .join(", "),
      city: venue.city?.name || "",
      country: venue.country?.countryCode || "",
      lat: venue.location?.latitude ? Number(venue.location.latitude) : null,
      lon: venue.location?.longitude ? Number(venue.location.longitude) : null,
    },
    performers:
      get(event, "_embedded.attractions", [])?.map((a) => ({ name: a.name })).slice(0, 10) ||
      [],
    images,
    category: event.classifications?.[0]?.segment?.name || null,
    price: priceRanges
      ? { min: priceRanges.min, max: priceRanges.max, currency: priceRanges.currency }
      : null,
  };
}

async function searchTicketmaster({ q, city, country, latlon, radiusKm, size, lang, page }) {
  if (!TM_API_KEY) return { results: [], error: "Missing TICKETMASTER_API_KEY" };

  const params = new URLSearchParams();
  params.set("apikey", TM_API_KEY);
  if (q) params.set("keyword", q);
  if (city) params.set("city", city);
  if (country) params.set("countryCode", country);
  if (radiusKm) params.set("radius", String(radiusKm));
  if (latlon) params.set("latlong", latlon); // "46.05,14.51"
  params.set("unit", "km");
  params.set("size", String(size || DEFAULT_SIZE));
  params.set("page", String(page || 0));
  params.set("locale", mapLocale(lang));

  const url = `https://app.ticketmaster.com/discovery/v2/events.json?${params.toString()}`;
  const res = await fetch(url, { headers: { "User-Agent": "NearGo/1.0" } });

  if (!res.ok) {
    return { results: [], error: `Ticketmaster HTTP ${res.status}` };
  }

  const data = await res.json();
  const raw = data._embedded?.events || [];
  const results = raw.map(normalizeTicketmaster);
  return { results, error: null };
}

function okJson(obj) {
  return new Response(JSON.stringify(obj), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
    },
  });
}

export const handler = async (event) => {
  try {
    if (event.httpMethod === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET,POST,OPTIONS",
          "access-control-allow-headers": "content-type",
        },
      });
    }

    const u = new URL(event.rawUrl);
    const q = u.searchParams.get("q") || "";
    const city = u.searchParams.get("city") || "";
    const country = u.searchParams.get("country") || "";
    const latlon = u.searchParams.get("latlon") || "";
    const radiusKm = Number(u.searchParams.get("radius") || DEFAULT_RADIUS_KM);
    const size = Number(u.searchParams.get("size") || DEFAULT_SIZE);
    const page = Number(u.searchParams.get("page") || 0);
    const lang = u.searchParams.get("lang") || "sl";

    const used = [];
    const errors = [];

    // Ticketmaster
    const tm = await searchTicketmaster({ q, city, country, latlon, radiusKm, size, lang, page });
    used.push({ source: "ticketmaster", count: tm.results.length });
    if (tm.error) errors.push({ source: "ticketmaster", error: tm.error });

    // TODO: eventbrite, songkick, seatgeek ... (pripravljeno, samo dodamo adapterje)

    return okJson({
      ok: true,
      locale: lang,
      query: { q, city, country, latlon, radiusKm, page, size },
      meta: { sourcesUsed: used, errors },
      results: tm.results, // za zdaj samo TM
    });
  } catch (err) {
    return okJson({ ok: false, error: String(err) });
  }
};

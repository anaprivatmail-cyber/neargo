// providers/types.js
// Skupne pomožne funkcije in “tip” za normaliziran dogodek

export const toRad = (deg) => (deg * Math.PI) / 180;
export function haversineKm(a, b) {
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// Mehki ključ za deduplikacijo (različni viri istega eventa)
export function softKey(e) {
  const name = (e.name || "").toLowerCase().trim();
  const when = (e.start || "").slice(0, 16); // do minut
  const where = (e.venue?.address || "").toLowerCase().replace(/\s+/g, " ").trim();
  return `${name}__${when}__${where}`;
}

// Majhen util za filtriranje po radiju, kategoriji in iskalnem nizu
export function makeMatcher({ query, category, center, radiusKm }) {
  const q = (query || "").trim().toLowerCase();
  const c = (category || "").trim().toLowerCase();
  return function matches(e) {
    if (q) {
      const hay = `${e.name} ${e.venue?.name || ""} ${e.venue?.address || ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (c) {
      if ((e.category || "").toLowerCase() !== c) return false;
    }
    if (center && e.venue?.lat && e.venue?.lon) {
      const d = haversineKm(center, { lat: e.venue.lat, lon: e.venue.lon });
      if (d > radiusKm) return false;
    }
    return true;
  };
}

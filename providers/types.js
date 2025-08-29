// Skupne pomožne funkcije in “tip” za normaliziran dogodek

/* ------------------ Geo ------------------ */
export const toRad = (deg) => (deg * Math.PI) / 180;

function isNum(n) {
  return typeof n === "number" && Number.isFinite(n);
}

export function haversineKm(a, b) {
  // Vrnemo Infinity, če česarkoli manjka – klicatelj naj to poravna (npr. sortiranje po razdalji)
  if (!a || !b || !isNum(a.lat) || !isNum(a.lon) || !isNum(b.lat) || !isNum(b.lon)) {
    return Number.POSITIVE_INFINITY;
  }
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/* ------------------ Besedilo / normalizacija ------------------ */
// odstrani diakritiko, poravna whitespace, lower-case
export function normalizeText(v = "") {
  const s = String(v);
  // Odstrani diakritiko, če je podpora za Unicode regex
  const noDia = s.normalize ? s.normalize("NFD").replace(/\p{Diacritic}/gu, "") : s;
  return noDia.toLowerCase().replace(/\s+/g, " ").trim();
}

/* ------------------ Deduplikacija ------------------ */
// Mehki ključ za deduplikacijo (različni viri istega eventa)
export function softKey(e = {}) {
  const name = normalizeText(e.name || "");
  // Do minut (YYYY-MM-DDTHH:mm), če start obstaja
  const when = typeof e.start === "string" ? e.start.slice(0, 16) : "";
  const where = normalizeText(e.venue?.address || "");
  return `${name}__${when}__${where}`;
}

/* ------------------ Filtriranje ------------------ */
// Majhen util za filtriranje po radiju, kategoriji in iskalnem nizu
export function makeMatcher({ query, category, center, radiusKm }) {
  const q = normalizeText(query || "");
  const c = normalizeText(category || "");
  return function matches(e = {}) {
    // q: iščemo po imenu, imenu prizorišča in naslovu – vse normalizirano
    if (q) {
      const hay = normalizeText(
        `${e.name || ""} ${e.venue?.name || ""} ${e.venue?.address || ""}`
      );
      if (!hay.includes(q)) return false;
    }

    // c: točno ujemanje kanoničnega imena kategorije (providerji naj vračajo lower-case)
    if (c) {
      const ec = normalizeText(e.category || "");
      if (ec !== c) return false;
    }

    // radij: le če imamo center in koordinate eventa
    if (center && isNum(e?.venue?.lat) && isNum(e?.venue?.lon)) {
      const d = haversineKm(center, { lat: e.venue.lat, lon: e.venue.lon });
      if (d > (radiusKm || 0)) return false;
    }
    return true;
  };
}

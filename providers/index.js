// providers/index.js
import { softKey, makeMatcher, haversineKm } from './types.js';
import { fetchSupabaseSubmissions } from './supabase-submissions.js';
import { fetchBigApis } from './big-apis.js';

export const PROVIDERS_ORDER = [
  'supabase-submissions',
  'big-apis',
  // 'small-urls', // ko/če vključiš
];

export const PROVIDERS_ENABLED = {
  'supabase-submissions': true,
  'big-apis': true,
  // 'small-urls': false,
};

async function callProvider(name, ctx) {
  if (!PROVIDERS_ENABLED[name]) return [];

  if (name === 'supabase-submissions') {
    const res = await fetchSupabaseSubmissions({
      SUPABASE_URL: ctx?.env?.SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY: ctx?.env?.SUPABASE_SERVICE_ROLE_KEY,
      center: ctx.center,
      radiusKm: ctx.radiusKm,
      query: ctx.query,
      category: ctx.category,
      page: ctx.page,
      size: ctx.size
    });

    // res je lahko { items, all } ali že polje
    const items = Array.isArray(res) ? res : (res.items || []);
    // shranimo “all” zaradi featured-blend; fallback na items, če all ni
    ctx._sbAll = (res && res.all) ? res.all : items;

    return items;
  }

  if (name === 'big-apis') {
    return await fetchBigApis({ env: ctx.env || {}, ...ctx });
  }

  return [];
}

export async function runProviders(ctx) {
  ctx = ctx || {};

  // Filtriranje po viru: ?source=provider|supabase|ticketmaster|eventbrite
  if (ctx.source) {
    const src = String(ctx.source).toLowerCase();
    if (src === 'provider' || src === 'supabase') {
      return await callProvider('supabase-submissions', ctx);
    }
    if (src === 'ticketmaster' || src === 'eventbrite') {
      const arr = await callProvider('big-apis', ctx);
      return arr.filter(e => e.source === src);
    }
  }

  // Kliči vse po vrstnem redu
  const chunks = [];
  for (const name of PROVIDERS_ORDER) {
    // eslint-disable-next-line no-await-in-loop
    const part = await callProvider(name, ctx);
    chunks.push(part);
  }

  // Zlij in deduplikacija (mehki ključ)
  const merged = [];
  const seen = new Set();
  const pushUnique = (arr) => {
    for (const e of arr) {
      const key = `${e.id}__${softKey(e)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(e);
    }
  };
  chunks.forEach(pushUnique);

  // Feature blend: najprej featured iz naših oddaj, nato ostalo
  const now = Date.now();
  const isFeatured = (e) => !!e.featuredUntil && Date.parse(e.featuredUntil) > now;

  const matches = makeMatcher({
    query: ctx.query,
    category: ctx.category,
    center: ctx.center,
    radiusKm: ctx.radiusKm
  });

  const featured = (ctx._sbAll || []).filter(isFeatured).filter(matches);
  const notFeatured = merged.filter(e => !isFeatured(e));

  // Sort po razdalji (če je center) sicer po času
  const sortByNearThenTime = (a, b) => {
    if (
      ctx.center &&
      a?.venue?.lat != null && a?.venue?.lon != null &&
      b?.venue?.lat != null && b?.venue?.lon != null
    ) {
      const da = haversineKm(ctx.center, { lat: a.venue.lat, lon: a.venue.lon });
      const db = haversineKm(ctx.center, { lat: b.venue.lat, lon: b.venue.lon });
      if (da !== db) return da - db;
    }
    const ta = a.start ? Date.parse(a.start) : Number.POSITIVE_INFINITY;
    const tb = b.start ? Date.parse(b.start) : Number.POSITIVE_INFINITY;
    return ta - tb;
  };

  featured.sort(sortByNearThenTime);
  notFeatured.sort(sortByNearThenTime);

  const blended = [...featured, ...notFeatured];

  // Paging
  const size = (ctx.size || 20);
  const start = (ctx.page || 0) * size;
  return blended.slice(start, start + size);
}

// (neobvezno, priročno)
export default runProviders;

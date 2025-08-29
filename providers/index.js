import { softKey, makeMatcher } from './types.js';
import { fetchSupabaseSubmissions } from './supabase-submissions.js';
import { fetchBigApis } from './big-apis.js';
import { haversineKm } from './types.js';

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
      SUPABASE_URL: ctx.env.SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY: ctx.env.SUPABASE_SERVICE_ROLE_KEY,
      center: ctx.center, radiusKm: ctx.radiusKm,
      query: ctx.query, category: ctx.category,
      page: ctx.page, size: ctx.size
    });
    // shranimo “all” zaradi featured blend
    ctx._sbAll = res.all || [];
    return res.items;
  }
  if (name === 'big-apis') {
    return await fetchBigApis({ env: ctx.env, ...ctx });
  }
  return [];
}

export async function runProviders(ctx) {
  // 'source' filter (npr. source=ticketmaster | eventbrite | supabase)
  if (ctx.source) {
    if (ctx.source === 'supabase') {
      return await callProvider('supabase-submissions', ctx);
    }
    if (ctx.source === 'ticketmaster' || ctx.source === 'eventbrite') {
      return await callProvider('big-apis', ctx).then(arr =>
        arr.filter(e => e.source === ctx.source)
      );
    }
  }

  // Kliči vse po vrstnem redu
  const chunks = [];
  for (const name of PROVIDERS_ORDER) {
    // eslint-disable-next-line no-await-in-loop
    const part = await callProvider(name, ctx);
    chunks.push(part);
  }

  // Zlij, deduplikacija (mehki ključ) + prioriteta bližine
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
    query: ctx.query, category: ctx.category,
    center: ctx.center, radiusKm: ctx.radiusKm
  });

  const featured = (ctx._sbAll || []).filter(isFeatured).filter(matches);
  const notFeatured = merged.filter(e => !isFeatured(e));

  // Sort po razdalji (če imamo center in koordinate), sicer po času
  const sortByNearThenTime = (a, b) => {
    if (ctx.center && a.venue?.lat && a.venue?.lon && b.venue?.lat && b.venue?.lon) {
      const da = haversineKm(ctx.center, { lat: a.venue.lat, lon: a.venue.lon });
      const db = haversineKm(ctx.center, { lat: b.venue.lat, lon: b.venue.lon });
      return da - db;
    }
    return String(a.start || '').localeCompare(String(b.start || ''));
  };

  featured.sort(sortByNearThenTime);
  notFeatured.sort(sortByNearThenTime);

  const blended = [...featured, ...notFeatured];

  // “Paging” na koncu
  const start = (ctx.page || 0) * (ctx.size || 20);
  const out = blended.slice(start, start + (ctx.size || 20));
  return out;
}

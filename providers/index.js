// providers/index.js
import { PROVIDERS_ORDER, PROVIDERS_ENABLED } from "./config.js";
import { normalizeGeneric } from "./types.js";
import { haversineKm } from "./utils.js";

import { fetchSupabaseSubmissions } from "./supabase-submissions.js";
import { fetchTicketmaster } from "./ticketmaster.js";
import { fetchBig2 } from "./big2.js";
import { fetchSmallUrls } from "./small-urls.js";

const HANDLERS = {
  "supabase-submissions": fetchSupabaseSubmissions,
  "ticketmaster": fetchTicketmaster,
  "big2": fetchBig2,
  "small-urls": fetchSmallUrls
};

function isFeaturedNow(ev) {
  if (!ev) return false;
  if (ev.featured === true) return true;
  if (!ev.featuredUntil) return false;
  try { return new Date(ev.featuredUntil).getTime() > Date.now(); }
  catch { return false; }
}

export async function fetchAllProviders(ctx) {
  const tasks = PROVIDERS_ORDER
    .filter(name => PROVIDERS_ENABLED[name] && HANDLERS[name])
    .map(name => HANDLERS[name](ctx).catch(() => []));

  const settled = await Promise.allSettled(tasks);
  const raw = settled.flatMap(s => (s.status === "fulfilled" ? s.value : []));
  const norm = raw.map(e => normalizeGeneric(e));

  // dedupe (id + mehki ključ)
  const byId = new Map();
  const soft = new Set();
  for (const ev of norm) {
    const softKey = `${(ev.name||"").toLowerCase()}|${ev.start||""}|${(ev.venue?.address||"").toLowerCase()}`;
    if (!byId.has(ev.id) && !soft.has(softKey)) {
      byId.set(ev.id, ev);
      soft.add(softKey);
    }
  }
  let list = Array.from(byId.values());

  // filtri
  if (ctx.query) {
    const q = ctx.query.toLowerCase();
    list = list.filter(e => `${e.name} ${e.venue?.address||""}`.toLowerCase().includes(q));
  }
  if (ctx.category) {
    const c = ctx.category.toLowerCase();
    list = list.filter(e => (e.category||"") === c);
  }
  if (ctx.center && ctx.radiusKm) {
    list = list.filter(e => {
      const v = e.venue || {};
      if (v.lat == null || v.lon == null) return true;
      return haversineKm(ctx.center, { lat: v.lat, lon: v.lon }) <= ctx.radiusKm;
    });
  }

  // sort: (1) aktivni featured, (2) “provider” najvišje, (3) po datumu
  list.sort((a,b) => {
    const fa = isFeaturedNow(a) ? -1 : 0;
    const fb = isFeaturedNow(b) ? -1 : 0;
    if (fa !== fb) return fa - fb;
    const sa = a.source === "provider" ? -1 : 0;
    const sb = b.source === "provider" ? -1 : 0;
    if (sa !== sb) return sa - sb;
    return String(a.start || "").localeCompare(String(b.start || ""));
  });

  // paging
  const page = Math.max(0, ctx.page || 0);
  const size = Math.min(50, Math.max(1, ctx.size || 20));
  const start = page * size;
  const results = list.slice(start, start + size);

  return { results, total: list.length, all: list };
}

/** Za vrtiljak “Izpostavljeno”: najprej aktivni featured, nato najbližje prihodnje */
export function pickFeaturedFirst(list, center, n = 12) {
  const now = Date.now();
  const upcoming = (e) => !e.start || new Date(e.start).getTime() >= now;

  const featured = list.filter(e => isFeaturedNow(e) && upcoming(e));
  const rest = list.filter(e => !isFeaturedNow(e) && upcoming(e));

  if (center) {
    const dist = (e) => (e.venue?.lat != null && e.venue?.lon != null)
      ? haversineKm(center, { lat: e.venue.lat, lon: e.venue.lon })
      : 999999;
    rest.sort((a,b) => dist(a) - dist(b));
  }

  const out = [...featured];
  for (const x of rest) {
    if (out.length >= n) break;
    out.push(x);
  }
  return out.slice(0, n);
}

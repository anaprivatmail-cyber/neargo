// Branje “naših” oddaj iz Supabase Storage (bucket: event-images/submissions/)
import { createClient } from '@supabase/supabase-js';
import { makeMatcher } from './types.js';

const BUCKET = 'event-images';
const SUBMISSIONS_PREFIX = 'submissions/';
// (opcijsko) če slike hraniš javno v istem bucketu
const PUBLIC_IMAGES_PREFIX = 'public/';

function okShape(payload) {
  // Vedno vrni enak objekt – runProviders računa na to.
  return { items: payload.items || [], total: payload.total || 0, all: payload.all || [] };
}

export async function fetchSupabaseSubmissions(opts) {
  const {
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
    center, radiusKm,
    query, category,
    page = 0, size = 20
  } = opts || {};

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return okShape({ items: [], total: 0, all: [] });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // 1) Naštej JSON-e oddaj
  const { data: files, error: listErr } = await supabase
    .storage
    .from(BUCKET)
    .list(SUBMISSIONS_PREFIX, { limit: 1000 });

  if (listErr || !files?.length) {
    return okShape({ items: [], total: 0, all: [] });
  }

  // 2) Preberi, normaliziraj
  const all = [];
  for (const f of files) {
    if (!f?.name || !f.name.endsWith('.json')) continue;

    const { data: blob, error: dlErr } = await supabase
      .storage
      .from(BUCKET)
      .download(SUBMISSIONS_PREFIX + f.name);

    if (dlErr || !blob) continue;

    try {
      const txt = await blob.text();
      const obj = JSON.parse(txt);

      const lat = obj.venueLat ?? obj.lat ?? null;
      const lon = obj.venueLon ?? obj.lon ?? null;

      // Slika: 1) če je v payload-u URL 2) poskusi public/<imageName> (če obstaja)
      const images = [];
      if (obj.imagePublicUrl) {
        images.push(String(obj.imagePublicUrl));
      } else if (obj.imageName) {
        const { data: pub } = supabase
          .storage
          .from(BUCKET)
          .getPublicUrl(PUBLIC_IMAGES_PREFIX + String(obj.imageName));
        if (pub?.publicUrl) images.push(pub.publicUrl);
      }

      all.push({
        id: `sb_${obj.createdAt || obj.eventName || f.name}`,
        source: 'supabase',
        featuredUntil: obj.featuredUntil || null,
        name: obj.eventName || 'Dogodek',
        url: obj.url || null,
        images,
        start: obj.start || null,
        end: obj.end || null,
        category: (obj.category || '').toString().toLowerCase() || null,
        venue: {
          name: obj.venue || '',
          address: [obj.venue || '', obj.city || obj.city2 || '', obj.country || '']
            .filter(Boolean)
            .join(', '),
          lat: lat != null ? Number(lat) : null,
          lon: lon != null ? Number(lon) : null
        }
      });
    } catch {
      // pokvarjen JSON – preskoči
      continue;
    }
  }

  // 3) Lokalni filter (query, category, radius)
  const matches = makeMatcher({ query, category, center, radiusKm });
  const filtered = all.filter(matches);

  // 4) Paging
  const start = page * size;
  const items = filtered.slice(start, start + size);

  return okShape({ items, total: filtered.length, all });
}

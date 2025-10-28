// providers/supabase-submissions.js
import { createClient } from '@supabase/supabase-js';
import { makeMatcher } from './types.js';

const BUCKET = 'event-images';
const SUBMISSIONS_PREFIX = 'submissions/';

export async function fetchSupabaseSubmissions(opts) {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, center, radiusKm, query, category, page, size } = opts;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return { items: [], total: 0 };

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: files, error } = await supabase
    .storage
    .from(BUCKET)
    .list(SUBMISSIONS_PREFIX, { limit: 1000 });

  if (error) return { items: [], total: 0 };

  const items = [];
  for (const f of (files || [])) {
    if (!f.name.endsWith('.json')) continue;
    const { data, error: dErr } = await supabase.storage.from(BUCKET).download(SUBMISSIONS_PREFIX + f.name);
    if (dErr || !data) continue;
    try {
      const obj = JSON.parse(await data.text());
      const lat = obj.venueLat ?? obj.lat ?? null;
      const lon = obj.venueLon ?? obj.lon ?? null;

      const images = [];
      if (obj.imagePublicUrl) images.push(obj.imagePublicUrl);

      items.push({
        id: `sb_${obj.createdAt || obj.eventName}`,
        source: 'supabase',
        featuredUntil: obj.featuredUntil || null,
        name: obj.eventName || 'Dogodek',
        url: obj.url || null,
        images,
        start: obj.start || null,
        end: obj.end || null,
        category: (obj.category || '').toLowerCase() || null,
        venue: {
          name: obj.venue || '',
          address: [obj.venue || '', obj.city || obj.city2 || '', obj.country || ''].filter(Boolean).join(', '),
          lat: lat ? parseFloat(lat) : null,
          lon: lon ? parseFloat(lon) : null
        }
      });
    } catch { /* ignore malformed */ }
  }

  const matches = makeMatcher({ query, category, center, radiusKm });
  const filtered = items.filter(matches);
  const startIdx = (page || 0) * (size || 20);
  return { items: filtered.slice(startIdx, startIdx + (size || 20)), total: filtered.length, all: items };
}

// netlify/functions/provider-list.js
import { createClient } from '@supabase/supabase-js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET,OPTIONS'
};
const json = (d, s = 200) => ({
  statusCode: s,
  headers: { 'Content-Type': 'application/json', ...CORS },
  body: JSON.stringify(d)
});

const SUPABASE_URL              = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = 'event-images';
const SUBMISSIONS_DIR = 'submissions';

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };
  if (event.httpMethod !== 'GET') return json({ ok:false, error:'Method not allowed' }, 405);

  try {
    const qs = new URLSearchParams(event.rawQuery || '');
    const onlyFeatured = ['1','true','yes'].includes((qs.get('featured') || '').toLowerCase());
    const limit  = Math.max(0, Number(qs.get('limit') || 0));
    const offset = Math.max(0, Number(qs.get('offset') || 0));

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return json({ ok:false, error:'Manjka SUPABASE_URL ali SUPABASE_SERVICE_ROLE_KEY' }, 500);
    }
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: files, error } = await supabase.storage.from(BUCKET).list(SUBMISSIONS_DIR, { limit: 1000 });
    if (error) throw new Error('Storage list error: ' + error.message);

    let items = [];
    for (const f of files || []) {
      if (!f.name?.toLowerCase().endsWith('.json')) continue;
      const path = `${SUBMISSIONS_DIR}/${f.name}`;
      const { data, error: dlErr } = await supabase.storage.from(BUCKET).download(path);
      if (dlErr) continue;
      try {
        const txt = await data.text();
        const obj = JSON.parse(txt);
        items.push(obj);
      } catch {}
    }

    if (onlyFeatured) {
      items = items.filter(it =>
        it.featured ||
        (it.featuredUntil && new Date(it.featuredUntil) > new Date())
      );
    }

    items.sort((a, b) => new Date(a.start || 0) - new Date(b.start || 0));

    const total = items.length;
    const sliced = limit ? items.slice(offset, offset + limit) : items;
    return json({ ok:true, total, offset, limit, results: sliced });

  } catch (e) {
    return json({ ok:false, message: e.message || 'Napaka' }, 500);
  }
};

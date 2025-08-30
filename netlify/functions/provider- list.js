// netlify/functions/provider-list.js
// Vrne seznam oddanih dogodkov iz Supabase Storage:
// bucket `event-images`, mapica `submissions/…json`

import { createClient } from '@supabase/supabase-js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET,OPTIONS'
};
const json = (d, s = 200) => ({
  statusCode: s,
  headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS },
  body: JSON.stringify(d)
});

const SUPABASE_URL              = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = 'event-images';
const SUBMISSIONS_DIR = 'submissions';

export const handler = async (event) => {
  // CORS preflight
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };
  if (event.httpMethod !== 'GET')     return json({ ok:false, error:'Method not allowed' }, 405);

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return json({ ok:false, error:'Manjka SUPABASE_URL ali SUPABASE_SERVICE_ROLE_KEY' }, 500);
  }

  try {
    const qs = new URLSearchParams(event.rawQuery || '');
    const onlyFeatured = ['1','true','yes'].includes((qs.get('featured') || '').toLowerCase());
    const limit  = Math.max(0, Number(qs.get('limit')  || 0));
    const offset = Math.max(0, Number(qs.get('offset') || 0));

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Preberi listing datotek (do 1000 je čisto dovolj za MVP)
    const { data: files, error } = await supabase
      .storage
      .from(BUCKET)
      .list(SUBMISSIONS_DIR, { limit: 1000 });

    if (error) throw new Error('Storage list error: ' + error.message);

    // Prenesi in parsaj vsako .json datoteko
    const items = [];
    for (const f of files || []) {
      if (!f.name?.toLowerCase().endsWith('.json')) continue;
      const path = `${SUBMISSIONS_DIR}/${f.name}`;

      const { data, error: dlErr } = await supabase.storage.from(BUCKET).download(path);
      if (dlErr) continue;

      try {
        const txt = await data.text();
        const obj = JSON.parse(txt);
        items.push(obj);
      } catch { /* ignoriraj pokvarjene zapise */ }
    }

    // Filtriraj "featured", če je zahtevano
    const now = Date.now();
    let out = onlyFeatured
      ? items.filter(it =>
          it?.featured ||
          (it?.featuredUntil && Date.parse(it.featuredUntil) > now)
        )
      : items;

    // Uredi: najprej po datumu začetka, nato po nastanku
    out.sort((a, b) => {
      const sa = a?.start ? Date.parse(a.start) : Infinity;
      const sb = b?.start ? Date.parse(b.start) : Infinity;
      if (sa !== sb) return sa - sb;
      const ca = a?.createdAt ? Date.parse(a.createdAt) : 0;
      const cb = b?.createdAt ? Date.parse(b.createdAt) : 0;
      return cb - ca;
    });

    const total  = out.length;
    const sliced = limit ? out.slice(offset, offset + limit) : out;

    return json({ ok:true, total, offset, limit, results: sliced });
  } catch (e) {
    return json({ ok:false, error: String(e?.message || e) }, 500);
  }
};

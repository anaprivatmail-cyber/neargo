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

/* --- dodatno: normalizacija v obliko, ki jo pričakuje index (venue.lat/lon/address, images[]) --- */
function normalizeProvider(obj){
  const address = [obj.venue, obj.city || obj.city2, obj.country].filter(Boolean).join(', ');
  const images  = obj.imagePublicUrl ? [obj.imagePublicUrl] : (Array.isArray(obj.images) ? obj.images : []);
  return {
    ...obj,
    name: obj.eventName || obj.name || '',
    images,
    url: obj.url || null,
    venue: {
      address,
      // 🔧 sprememba: sprejme tudi lat/lon/latitude/longitude oblike
      lat: parseFloat(obj.venueLat || obj.lat || obj.latitude) || null,
      lon: parseFloat(obj.venueLon || obj.lon || obj.longitude) || null
    }
  };
}

/* izračun razdalje (km) */
function haversineKm(a, b){
  if (!a || !b || !Number.isFinite(a.lat) || !Number.isFinite(a.lon) || !Number.isFinite(b.lat) || !Number.isFinite(b.lon)) return null;
  const toRad = d => d * Math.PI/180;
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const la1 = toRad(a.lat), la2 = toRad(b.lat);
  const x = Math.sin(dLat/2)**2 + Math.cos(la1)*Math.cos(la2)*Math.sin(dLon/2)**2;
  return 2*R*Math.asin(Math.sqrt(x));
}

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

    // opcijsko: bližina za razvrščanje (npr. latlon=46.05,14.51 & radiuskm=50)
    let center = null;
    const latlon = qs.get('latlon');
    const radiusKm = Number(qs.get('radiuskm') || qs.get('radiusKm') || 0);
    if (latlon) {
      const [la, lo] = String(latlon).split(',').map(Number);
      if (Number.isFinite(la) && Number.isFinite(lo)) center = { lat: la, lon: lo };
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Preberi listing datotek (do 1000 je čisto dovolj za MVP)
    const { data: files, error } = await supabase
      .storage
      .from(BUCKET)
      .list(SUBMISSIONS_DIR, { limit: 1000 });

    if (error) throw new Error('Storage list error: ' + error.message);

    // Prenesi in parsaj vsako .json datoteko (+ zapiši path za povezavo s koledarjem)
    const raw = [];
    const submissionPaths = [];
    for (const f of files || []) {
      if (!f.name?.toLowerCase().endsWith('.json')) continue;
      const path = `${SUBMISSIONS_DIR}/${f.name}`;
      const { data, error: dlErr } = await supabase.storage.from(BUCKET).download(path);
      if (dlErr) continue;
      try {
        const txt = await data.text();
        const obj = JSON.parse(txt);
        obj._submission_path = path; // interno za koledar mapping
        raw.push(obj);
        submissionPaths.push(path);
      } catch { /* ignoriraj pokvarjene zapise */ }
    }

    // Bulk lookup koledarjev (provider_calendars.event_submission_key = path)
    let calMap = new Map();
    if (submissionPaths.length) {
      try {
        const { data: cals } = await supabase
          .from('provider_calendars')
          .select('id,event_submission_key')
          .in('event_submission_key', submissionPaths);
        (cals||[]).forEach(c => calMap.set(c.event_submission_key, c.id));
      } catch (e) {
        console.warn('[provider-list] calendar lookup failed:', e?.message || e);
      }
    }

    // Filtriraj "featured", če je zahtevano
    const now = Date.now();
    let out = onlyFeatured
      ? raw.filter(it =>
          it?.featured ||
          (it?.featuredUntil && Date.parse(it.featuredUntil) > now)
        )
      : raw;
// 🔧 odstrani pretečene dogodke (če imajo samo start, jih šteje 2h po začetku)
out = out.filter(e => {
  const end = e.end ? Date.parse(e.end) : (e.start ? Date.parse(e.start) + 2 * 3600 * 1000 : 0);
  return !Number.isNaN(end) && end >= Date.now();
});
    // normaliziraj v format, ki ga frontend pričakuje (venue.lat/lon/address, images[])
    out = out.map(o => {
      const n = normalizeProvider(o);
      const cid = calMap.get(o._submission_path || '') || null;
      if (cid) n.calendar_id = cid;
      return n;
    });

    // ——— STREŽNIŠKA UTRDITEV ———
    // 1) Skrij razprodane ponudbe (kuponi/vstopnice)
    out = out.filter(e => {
      try{
        const kind = String(e.offerType || '').toLowerCase();
        if ((kind === 'coupon' || kind === 'ticket') && Number(e.stock || 0) <= 0) return false;
        return true;
      }catch{ return true; }
    });

    // 2) (opcijsko) Skrij še neobjavljene kupone – če je omogočeno z env var
    //    PROVIDER_HIDE_PREPUB_COUPONS=1 => skrije kupon dokler now < publish_at (ali start, če publish_at manjka)
    const HIDE_PREPUB = String(process.env.PROVIDER_HIDE_PREPUB_COUPONS || '0') !== '0';
    if (HIDE_PREPUB) {
      const nowMs = Date.now();
      out = out.filter(e => {
        try{
          const kind = String(e.offerType || '').toLowerCase();
          if (kind !== 'coupon') return true; // zaenkrat omejeno na kupon ponudbe
          const pubTs = Date.parse(e.publish_at || e.start || '') || NaN;
          if (!Number.isFinite(pubTs)) return true; // brez datuma ne omejuj
          return nowMs >= pubTs; // pokaži šele po objavi
        }catch{ return true; }
      });
    }

    // opcijsko: če je center podan, izračunaj razdaljo in (po želji) izloči preveč oddaljene
    if (center) {
      out.forEach(e=>{
        e._distanceKm = haversineKm(center, e.venue);
      });
      // če je podan radius, izloči oddaljene; sicer pusti vse, le sortira
      if (Number.isFinite(radiusKm) && radiusKm > 0) {
        out = out.filter(e => e._distanceKm == null || e._distanceKm <= radiusKm);
      }
    }

    // Uredi: najprej po bližini (če center), potem po datumu začetka, nato po nastanku (čim manj sprememb)
    out.sort((a, b) => {
      if (center) {
        const da = a._distanceKm ?? Infinity;
        const db = b._distanceKm ?? Infinity;
        if (da !== db) return da - db;
      }
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

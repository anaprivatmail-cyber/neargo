// netlify/functions/tm-search.js
// NearGo – več-izvorni iskalnik: Ticketmaster, Eventbrite, Songkick, SeatGeek + ICS/JSON feedi.
// Filtri: q, city/latlong+radius, datumi od–do, categories=music,sports,children,food,culture, lang, page/size.
// Zahteva Node 18/20 (na Netlify nastavite NODE_VERSION=20).

export const handler = async (event) => {
  try {
    if (event.httpMethod === 'OPTIONS') return json(204, {});
    const q = parseQuery(event);
    const lang = parseLang(event);

    // Geokodiranje mesta -> lat/lon (če ni podan latlong)
    let { lat, lon } = q;
    if ((lat == null || lon == null) && q.city) {
      const g = await geocodeCity(`${q.city}${q.country ? ', ' + q.country : ''}`, lang);
      if (g) { lat = g.lat; lon = g.lon; }
    }

    // Aktivni viri (ključ prisoten?)
    const active = {
      tm: !!process.env.TICKETMASTER_API_KEY,
      eb: !!process.env.EVENTBRITE_TOKEN,
      sk: !!process.env.SONGKICK_API_KEY,
      sg: !!process.env.SEATGEEK_CLIENT_ID,
      feeds: true
    };

    // Poženemo vse vire vzporedno; napaka enega ne podre celote
    const jobs = [];
    if (active.tm) jobs.push(safe(fetchTicketmaster({ ...q, lang, lat, lon })));
    if (active.eb) jobs.push(safe(fetchEventbrite({ ...q, lang, lat, lon })));
    if (active.sk && lat!=null && lon!=null) jobs.push(safe(fetchSongkick({ ...q, lang, lat, lon })));
    if (active.sg) jobs.push(safe(fetchSeatGeek({ ...q, lang, lat, lon })));
    jobs.push(safe(fetchFeeds({ ...q, lang, lat, lon }))); // ICS/JSON: FEED_URLS ali /data/feeds.json

    const settled = await Promise.all(jobs);

    const used = [];
    const errors = [];
    let all = [];

    for (const r of settled) {
      if (r.ok) {
        used.push({ source: r.source, count: r.results.length });
        all = all.concat(r.results);
      } else {
        errors.push({ source: r.source || 'unknown', error: r.error });
      }
    }

    // Normalizacija + deduplikacija
    let results = normalize(all);

    // Filtar po kategorijah (če podane)
    if (q.categories.length) {
      const want = new Set(q.categories.map(s=>s.toLowerCase()));
      results = results.filter(ev => {
        const tags = new Set((ev.categories||[]).map(s=>s.toLowerCase()));
        for (const c of want) if (tags.has(c)) return true;
        return false;
      });
    }

    // Sort po začetku
    results.sort((a,b) => (new Date(a.start||0)) - (new Date(b.start||0)));

    // Paginacija
    const startIdx = q.page * q.size;
    const pageItems = results.slice(startIdx, startIdx + q.size);

    return json(200, {
      ok: true,
      locale: lang,
      query: { ...q, lat, lon },
      meta: { sourcesUsed: used, errors, total: results.length, page: q.page, size: q.size },
      results: pageItems
    });

  } catch (e) {
    return json(500, { ok:false, error: e?.message || String(e) });
  }
};

/* -------------------- helpers -------------------- */
const json = (code, data) => ({
  statusCode: code,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,OPTIONS',
    'access-control-allow-headers': 'Content-Type,Accept-Language'
  },
  body: JSON.stringify(data)
});

const safe = async (p) => {
  try { const v = await p; return { ok:true, ...v }; }
  catch (e) { return { ok:false, error: e?.message || String(e) }; }
};

const parseLang = (event) => {
  const p = new URLSearchParams(event.queryStringParameters || {});
  const explicit = (p.get('lang') || p.get('locale') || '').toLowerCase();
  if (explicit) return explicit;
  const hdr = (event.headers?.['accept-language'] || '').split(',')[0] || '';
  return (hdr || 'en').toLowerCase();
};

function parseQuery(event) {
  const p = new URLSearchParams(event.queryStringParameters || {});
  const num = (k, def, min=undefined, max=undefined) => {
    let v = Number(p.get(k));
    if (!isFinite(v)) v = def;
    if (min!=null) v = Math.max(min, v);
    if (max!=null) v = Math.min(max, v);
    return v;
  };

  // lat,long
  let lat=null, lon=null;
  const ll = (p.get('latlong') || p.get('ll') || '').trim();
  if (ll && /^[\d.\-]+,[\d.\-]+$/.test(ll)) {
    const [a,b] = ll.split(',').map(Number); lat=a; lon=b;
  }

  // radius km
  const radiusStr = (p.get('radius') || '').trim();
  const radiusKm = isFinite(Number(radiusStr)) ? Number(radiusStr) : 50;

  // datumi -> ISO
  const normISO = (s) => {
    if (!s) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return `${s}T00:00:00Z`;
    if (/Z$/.test(s)) return s;
    if (/T/.test(s)) return s + 'Z';
    return s;
  };

  return {
    q: (p.get('q') || p.get('query') || '').trim(),
    city: (p.get('city') || '').trim(),
    country: (p.get('country') || p.get('countryCode') || '').trim(),
    lat, lon,
    radiusKm,
    startISO: normISO((p.get('start') || p.get('startDate') || p.get('startDateTime') || '').trim()),
    endISO:   normISO((p.get('end')   || p.get('endDate')   || p.get('endDateTime')   || '').trim()),
    page: num('page', 0, 0),
    size: num('size', 20, 1, 50),
    categories: (p.get('categories') || '').split(',').map(s=>s.trim().toLowerCase()).filter(Boolean)
  };
}

async function geocodeCity(q, lang) {
  const u = new URL('https://nominatim.openstreetmap.org/search');
  u.searchParams.set('q', q);
  u.searchParams.set('format', 'json');
  u.searchParams.set('limit', '1');
  u.searchParams.set('accept-language', lang || 'en');
  const r = await fetch(u, { headers: { 'User-Agent': 'NearGo/1.0 (getneargo.com)' }});
  if (!r.ok) return null;
  const j = await r.json();
  if (!Array.isArray(j) || !j.length) return null;
  return { lat: Number(j[0].lat), lon: Number(j[0].lon) };
}

const normTxt = (s='') => s.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase();

function catsFromText(t='') {
  const s = normTxt(t);
  const tags = new Set();
  if (/(music|concert|gig|band|rock|jazz|hip ?hop|classical)/.test(s)) tags.add('music');
  if (/(sport|match|game|football|soccer|basketball|tennis|hockey|baseball)/.test(s)) tags.add('sports');
  if (/(child|kid|family|otro(c|k)|druzin)/.test(s)) tags.add('children');
  if (/(food|drink|culinary|degust|restaurant|street ?food|vino|beer|wine)/.test(s)) tags.add('food');
  if (/(culture|theatre|theater|museum|gallery|film|cinema|opera|ballet|festival)/.test(s)) tags.add('culture');
  return Array.from(tags);
}

function normalize(list) {
  const out = [];
  const seen = new Set();
  for (const e of list) {
    const id = e.externalId
      || `${normTxt(e.name||'')}|${(e.start||'').slice(0,10)}|${normTxt(e.city||'')}|${normTxt(e.venue||'')}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      source: e.source,
      name: e.name || '',
      url: e.url || '',
      start: e.start || '',
      end: e.end || '',
      timezone: e.timezone || '',
      venue: e.venue || '',
      address: e.address || '',
      city: e.city || '',
      country: e.country || '',
      lat: e.lat ?? null,
      lon: e.lon ?? null,
      image: e.image || '',
      categories: e.categories || [],
      priceMin: e.priceMin ?? null,
      priceMax: e.priceMax ?? null,
      currency: e.currency || ''
    });
  }
  return out;
}

/* -------------------- SOURCES -------------------- */
// Ticketmaster
async function fetchTicketmaster({ q, city, lat, lon, radiusKm, startISO, endISO, page, size, lang }) {
  const api = process.env.TICKETMASTER_API_KEY;
  const u = new URL('https://app.ticketmaster.com/discovery/v2/events.json');
  u.searchParams.set('apikey', api);
  if (q) u.searchParams.set('keyword', q);
  if (city) u.searchParams.set('city', city);
  if (lat!=null && lon!=null) {
    u.searchParams.set('latlong', `${lat},${lon}`);
    u.searchParams.set('radius', String(Math.max(1, radiusKm||50)));
    u.searchParams.set('unit', 'km');
  }
  if (startISO) u.searchParams.set('startDateTime', startISO);
  if (endISO)   u.searchParams.set('endDateTime', endISO);
  u.searchParams.set('size', String(size));
  u.searchParams.set('page', String(page));
  u.searchParams.set('locale', lang || '*');

  const r = await fetch(u, { headers: { 'Accept-Language': lang || 'en' } });
  if (!r.ok) throw Object.assign(new Error(`Ticketmaster ${r.status}`), { source:'ticketmaster' });
  const j = await r.json();

  const items = (j?._embedded?.events || []).map(ev => {
    const v = ev._embedded?.venues?.[0] || {};
    const pr = ev.priceRanges?.[0] || {};
    return {
      source: 'ticketmaster',
      externalId: ev.id,
      name: ev.name || '',
      url: ev.url || '',
      start: ev.dates?.start?.dateTime || ev.dates?.start?.localDate || '',
      end:   ev.dates?.end?.dateTime || '',
      timezone: ev.dates?.timezone || '',
      venue: v.name || '',
      address: [v.address?.line1, v.city?.name].filter(Boolean).join(', '),
      city: v.city?.name || '',
      country: v.country?.countryCode || v.country?.name || '',
      lat: Number(v.location?.latitude ?? v.latitude ?? NaN) || null,
      lon: Number(v.location?.longitude ?? v.longitude ?? NaN) || null,
      image: (ev.images||[]).sort((a,b)=>(b.width*b.height)-(a.width*a.height))[0]?.url || '',
      priceMin: pr.min ?? null, priceMax: pr.max ?? null, currency: pr.currency || '',
      categories: catsFromText([ev.name, ev.classifications?.map(c=>c.segment?.name).join(' '), ev.classifications?.map(c=>c.genre?.name).join(' ')].join(' '))
    };
  });
  return { source: 'ticketmaster', results: items };
}

// Eventbrite
async function fetchEventbrite({ q, city, lat, lon, radiusKm, startISO, endISO, page, size, lang }) {
  const token = process.env.EVENTBRITE_TOKEN;
  if (!token) return { source: 'eventbrite', results: [] };
  const u = new URL('https://www.eventbriteapi.com/v3/events/search/');
  if (q) u.searchParams.set('q', q);
  if (lat!=null && lon!=null) {
    u.searchParams.set('location.latitude', String(lat));
    u.searchParams.set('location.longitude', String(lon));
    u.searchParams.set('location.within', `${Math.max(1, radiusKm||50)}km`);
  } else if (city) {
    u.searchParams.set('location.address', city);
    u.searchParams.set('location.within', `${Math.max(1, radiusKm||50)}km`);
  }
  if (startISO) u.searchParams.set('start_date.range_start', startISO);
  if (endISO)   u.searchParams.set('start_date.range_end', endISO);
  u.searchParams.set('expand', 'venue,category,format');
  u.searchParams.set('page', String(page+1));
  u.searchParams.set('page_size', String(size));

  const r = await fetch(u, { headers: { Authorization: `Bearer ${token}` }});
  if (!r.ok) throw Object.assign(new Error(`Eventbrite ${r.status}`), { source:'eventbrite' });
  const j = await r.json();

  const items = (j.events||[]).map(ev => {
    const v = ev.venue || {};
    return {
      source: 'eventbrite',
      externalId: ev.id,
      name: ev.name?.text || '',
      url: ev.url || '',
      start: ev.start?.utc || ev.start?.local || '',
      end:   ev.end?.utc || ev.end?.local || '',
      timezone: ev.start?.timezone || '',
      venue: v.name || '',
      address: [v.address?.address_1, v.address?.city].filter(Boolean).join(', '),
      city: v.address?.city || '',
      country: v.address?.country || '',
      lat: Number(v.latitude ?? NaN) || null,
      lon: Number(v.longitude ?? NaN) || null,
      image: ev.logo?.url || '',
      priceMin: null, priceMax: null, currency: '',
      categories: catsFromText([ev.name?.text, ev.summary, ev.category?.name, ev.format?.name].join(' '))
    };
  });
  return { source: 'eventbrite', results: items };
}

// Songkick (potrebuje lat/lon)
async function fetchSongkick({ q, lat, lon, startISO, endISO, page, size }) {
  const key = process.env.SONGKICK_API_KEY;
  if (!key || lat==null || lon==null) return { source: 'songkick', results: [] };
  const u = new URL('https://api.songkick.com/api/3.0/events.json');
  u.searchParams.set('apikey', key);
  u.searchParams.set('location', `geo:${lat},${lon}`);
  if (q) u.searchParams.set('query', q);
  if (startISO) u.searchParams.set('min_date', startISO.slice(0,10));
  if (endISO)   u.searchParams.set('max_date', endISO.slice(0,10));
  u.searchParams.set('per_page', String(Math.min(50, size)));
  u.searchParams.set('page', String(page+1));

  const r = await fetch(u);
  if (!r.ok) throw Object.assign(new Error(`Songkick ${r.status}`), { source:'songkick' });
  const j = await r.json();

  const items = (j.resultsPage?.results?.event || []).map(ev => {
    const v = ev.venue || {};
    return {
      source: 'songkick',
      externalId: String(ev.id),
      name: ev.displayName || '',
      url: ev.uri || '',
      start: ev.start?.datetime ? new Date(ev.start.datetime).toISOString()
           : ev.start?.date ? `${ev.start.date}T00:00:00Z` : '',
      end: '',
      timezone: '',
      venue: v.displayName || '',
      address: '',
      city: ev.location?.city || v.metroArea?.displayName || '',
      country: v.metroArea?.country?.displayName || '',
      lat: Number(v.lat ?? ev.location?.lat ?? NaN) || null,
      lon: Number(v.lng ?? ev.location?.lng ?? NaN) || null,
      image: '',
      priceMin: null, priceMax: null, currency: '',
      categories: catsFromText([ev.type, ev.displayName].join(' '))
    };
  });
  return { source: 'songkick', results: items };
}

// SeatGeek
async function fetchSeatGeek({ q, lat, lon, radiusKm, startISO, endISO, page, size }) {
  const id = process.env.SEATGEEK_CLIENT_ID;
  if (!id) return { source: 'seatgeek', results: [] };
  const u = new URL('https://api.seatgeek.com/2/events');
  u.searchParams.set('client_id', id);
  const secret = process.env.SEATGEEK_CLIENT_SECRET;
  if (secret) u.searchParams.set('client_secret', secret);
  if (q) u.searchParams.set('q', q);
  if (lat!=null && lon!=null) {
    u.searchParams.set('lat', String(lat));
    u.searchParams.set('lon', String(lon));
    const miles = Math.max(1, Math.round((radiusKm||50) * 0.621371));
    u.searchParams.set('range', `${miles}mi`);
  }
  if (startISO) u.searchParams.set('datetime_utc.gte', startISO);
  if (endISO)   u.searchParams.set('datetime_utc.lte', endISO);
  u.searchParams.set('per_page', String(size));
  u.searchParams.set('page', String(page+1));

  const r = await fetch(u);
  if (!r.ok) throw Object.assign(new Error(`SeatGeek ${r.status}`), { source:'seatgeek' });
  const j = await r.json();

  const items = (j.events||[]).map(ev => {
    const v = ev.venue || {};
    return {
      source: 'seatgeek',
      externalId: String(ev.id),
      name: ev.title || '',
      url: ev.url || '',
      start: ev.datetime_utc || '',
      end: '',
      timezone: v.timezone || '',
      venue: v.name || '',
      address: [v.address, v.extended_address].filter(Boolean).join(', '),
      city: v.city || '',
      country: v.country || '',
      lat: Number(v.location?.lat ?? v.lat ?? NaN) || null,
      lon: Number(v.location?.lon ?? v.lon ?? NaN) || null,
      image: ev.performers?.find(p=>p.image)?.image || '',
      priceMin: ev.stats?.lowest_price ?? null,
      priceMax: ev.stats?.highest_price ?? null,
      currency: 'USD',
      categories: catsFromText([ev.type, ev.title, (ev.taxonomies||[]).map(t=>t.name).join(' ')].join(' '))
    };
  });
  return { source: 'seatgeek', results: items };
}

/* -------------------- FEEDS (ICS/JSON) -------------------- */
// Bere: FEED_URLS (env, vejice) + /data/feeds.json (če obstaja na strani).
async function fetchFeeds({ q, city, lat, lon, radiusKm, startISO, endISO, lang }) {
  const urls = new Set();

  // 1) iz env
  (process.env.FEED_URLS || '')
    .split(',').map(s=>s.trim()).filter(Boolean)
    .forEach(u => urls.add(u));

  // 2) iz /data/feeds.json na tvoji strani (če obstaja)
  const base = process.env.URL || process.env.DEPLOY_PRIME_URL || '';
  if (base) {
    try {
      const r = await fetch(`${base.replace(/\/+$/,'')}/data/feeds.json`, { headers: { 'Cache-Control':'no-cache' }});
      if (r.ok) {
        const arr = await r.json();
        (Array.isArray(arr)?arr:[]).forEach(u => { if (typeof u === 'string') urls.add(u); });
      }
    } catch {}
  }

  const results = [];
  const tasks = Array.from(urls).map(u => safe(fetchOneFeed(u)));
  const done = await Promise.all(tasks);
  for (const d of done) if (d.ok) results.push(...d.results);

  // osnovni filtri
  let rows = results;
  if (q) {
    const qn = normTxt(q);
    rows = rows.filter(e => normTxt(`${e.name} ${e.venue} ${e.city} ${e.address}`).includes(qn));
  }
  if (city) {
    const cn = normTxt(city);
    rows = rows.filter(e => normTxt(`${e.city} ${e.venue} ${e.address}`).includes(cn));
  }
  if (startISO) rows = rows.filter(e => !e.start || new Date(e.start) >= new Date(startISO));
  if (endISO)   rows = rows.filter(e => !e.start || new Date(e.start) <= new Date(endISO));
  if (lat!=null && lon!=null && radiusKm) {
    const R = radiusKm;
    rows = rows.filter(e => {
      if (e.lat==null || e.lon==null) return true; // brez geo – pustimo
      const d = haversine(lat, lon, e.lat, e.lon);
      return d <= R;
    });
  }

  return { source: 'feeds', results: rows };
}

async function fetchOneFeed(url) {
  const r = await fetch(url, { headers: { 'User-Agent':'NearGo/1.0' }});
  if (!r.ok) throw Object.assign(new Error(`FEED ${r.status}`), { source:'feeds' });
  const ct = (r.headers.get('content-type') || '').toLowerCase();
  const text = await r.text();

  if (/text\/calendar|ics/.test(ct) || /BEGIN:VCALENDAR/.test(text)) {
    return { source:'feeds', results: parseICS(text, url) };
  }
  // JSON format: [{name,start,end,venue,city,country,lat,lon,url,image,categories:[...]}, ...]
  try {
    const arr = JSON.parse(text);
    const items = (Array.isArray(arr)?arr:[]).map(x => ({
      source: 'feed',
      externalId: x.id || `${x.name}|${x.start}|${x.venue}|${x.city}`,
      name: x.name || '',
      url: x.url || '',
      start: x.start || '',
      end: x.end || '',
      timezone: x.timezone || '',
      venue: x.venue || '',
      address: x.address || '',
      city: x.city || '',
      country: x.country || '',
      lat: x.lat ?? null,
      lon: x.lon ?? null,
      image: x.image || '',
      categories: Array.isArray(x.categories) ? x.categories : catsFromText([x.name, x.venue].join(' '))
    }));
    return { source:'feeds', results: items };
  } catch {
    // RSS/Atom lahko dodamo kasneje
    return { source:'feeds', results: [] };
  }
}

function parseICS(ics, url) {
  const lines = ics.replace(/\r/g,'').split('\n');
  const unfolded = [];
  for (const line of lines) {
    if (line.startsWith(' ') || line.startsWith('\t')) {
      unfolded[unfolded.length-1] = (unfolded[unfolded.length-1]||'') + line.slice(1);
    } else unfolded.push(line);
  }
  const evs = [];
  let cur = null;
  for (const ln of unfolded) {
    if (/^BEGIN:VEVENT/i.test(ln)) { cur = {}; continue; }
    if (/^END:VEVENT/i.test(ln)) { if (cur) evs.push(cur); cur=null; continue; }
    if (!cur) continue;
    const [k, ...rest] = ln.split(':');
    const v = rest.join(':');
    const key = k.split(';')[0].toUpperCase();
    if (key === 'SUMMARY') cur.SUMMARY = v;
    else if (key === 'DTSTART' || key === 'DTSTART;VALUE=DATE') cur.DTSTART = v;
    else if (key === 'DTEND'   || key === 'DTEND;VALUE=DATE')   cur.DTEND = v;
    else if (key === 'LOCATION') cur.LOCATION = v;
    else if (key === 'DESCRIPTION') cur.DESCRIPTION = v;
    else if (key === 'URL') cur.URL = v;
    else if (key === 'UID') cur.UID = v;
  }
  const toISO = (s) => {
    if (!s) return '';
    if (/^\d{8}$/.test(s)) return `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}T00:00:00Z`;
    if (/^\d{8}T\d{6}Z$/.test(s)) {
      const y=s.slice(0,4), m=s.slice(4,6), d=s.slice(6,8), hh=s.slice(9,11), mm=s.slice(11,13), ss=s.slice(13,15);
      return `${y}-${m}-${d}T${hh}:${mm}:${ss}Z`;
    }
    return s;
  };
  return evs.map(e => {
    const place = e.LOCATION || '';
    const city = place.split(',').slice(-2, -1)[0]?.trim() || '';
    return {
      source: 'feed',
      externalId: e.UID || `${e.SUMMARY}|${e.DTSTART}|${place}|${url}`,
      name: e.SUMMARY || '',
      url: e.URL || '',
      start: toISO(e.DTSTART),
      end: toISO(e.DTEND),
      timezone: '',
      venue: place || '',
      address: place || '',
      city,
      country: '',
      lat: null, lon: null,
      image: '',
      categories: catsFromText([e.SUMMARY, place].join(' '))
    };
  });
}

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const toRad = (x)=> x*Math.PI/180;
  const dLat = toRad(lat2-lat1);
  const dLon = toRad(lon2-lon1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;
  return 2*R*Math.asin(Math.sqrt(a));
}

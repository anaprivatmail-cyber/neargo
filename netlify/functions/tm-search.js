// netlify/functions/tm-search.js
// Meta-iskalnik: Ticketmaster + Eventbrite + Lokalni viri (RSS/Atom, ICS, JSON)
// Filtri: kategorije (tags), lokacija (mesto/latlon + radij), datumski interval

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET,OPTIONS'
};
const json = (data, status = 200) => ({
  statusCode: status,
  headers: { 'Content-Type': 'application/json', ...CORS },
  body: JSON.stringify(data)
});

// ---------- ENV ----------
const TM_API_KEY       = process.env.TM_API_KEY || '';            // Ticketmaster
const EB_PRIVATE_TOKEN = process.env.EB_PRIVATE_TOKEN || '';       // Eventbrite

// Lokalne povezave (CSV v ENV)
const FEEDS_RSS  = (process.env.FEEDS_RSS  || '').split(',').map(s => s.trim()).filter(Boolean);
const FEEDS_ICS  = (process.env.FEEDS_ICS  || '').split(',').map(s => s.trim()).filter(Boolean);
const FEEDS_JSON = (process.env.FEEDS_JSON || '').split(',').map(s => s.trim()).filter(Boolean);

// ---------- POMOŽNO ----------
const norm = (s) => String(s || '').toLowerCase();
const anyIncl = (text, arr) => {
  const t = norm(text);
  return arr.some((k) => t.includes(k));
};
const safeNum = (v) => Number.isFinite(Number(v)) ? Number(v) : null;

// Hevristične ključne besede za oznake (po potrebi dopolni)
const KW = {
  otroci: ['otroci','otrok','družina','druzina','family','kids','child','children','babies','toddlers'],
  kultura: ['kultura','theatre','theater','film','kino','gallery','galerija','opera','ballet','museum','muzej','exhibition','razstava','art','arts','performing'],
  glasba: ['koncert','music','band','dj','rock','metal','jazz','classical','hip hop','electronic','festival'],
  hrana: ['food','street food','kulinar','wine','vino','beer','pivo','craft','tasting','degust','market','trznica','tržnica'],
  narava: ['nature','hike','hiking','trek','outdoor','park','trail','mountain','hrib','gozd','forest','beach','river','camp'],
  sport: ['sport','run','tek','marathon','nogomet','football','basket','kolo','cycling','ski','smu','yoga','joga','fitness'],
  zabava: ['party','zabava','stand up','standup','comedy','club','nightlife'],
  biznis: ['business','networking','sales','marketing','leadership','finance','accounting'],
  tech: ['tech','it','developer','programming','code','ai','ml','startup','blockchain'],
  izobrazevanje: ['workshop','delavnica','seminar','class','course','tečaj','predavanje'],
  dobrodelno: ['charity','dobrodel','fundraiser']
};

// ---------- TAGGING ----------
function tagByBlob(blob) {
  const tags = new Set();
  Object.entries(KW).forEach(([k, words]) => { if (anyIncl(blob, words)) tags.add(k); });
  return [...tags];
}

// ---------- MAPIRANJE TM/EB ----------
function mapTMtoTags(e) {
  const tags = new Set();
  const seg = norm(e.classifications?.[0]?.segment?.name);
  const gen = norm(e.classifications?.[0]?.genre?.name);
  const sgen = norm(e.classifications?.[0]?.subGenre?.name);
  const all = [seg, gen, sgen].join(' ');
  if (anyIncl(all, ['music'])) tags.add('glasba').add('koncert');
  if (anyIncl(all, ['arts & theatre','arts and theatre','theatre'])) tags.add('kultura');
  if (anyIncl(all, ['family'])) tags.add('otroci');
  if (anyIncl(all, ['sports'])) tags.add('sport');
  if (anyIncl(all, ['film'])) tags.add('kultura');
  if (anyIncl(all, ['miscellaneous','variety'])) tags.add('zabava');

  const blob = `${e.name||''} ${e.info||''} ${e.pleaseNote||''}`;
  tagByBlob(blob).forEach(t => tags.add(t));
  return [...tags];
}
function mapEBtoTags(e) {
  const tags = new Set();
  const cat = norm(e.category?.name);
  const sub = norm(e.subcategory?.name);
  const fmt = norm(e.format?.name);
  const all = [cat, sub, fmt].join(' ');
  if (anyIncl(all, ['music'])) tags.add('glasba').add('koncert');
  if (anyIncl(all, ['performing & visual arts','arts'])) tags.add('kultura');
  if (anyIncl(all, ['film & media','film'])) tags.add('kultura');
  if (anyIncl(all, ['family','kids','school','education'])) { tags.add('otroci'); tags.add('izobrazevanje'); }
  if (anyIncl(all, ['food & drink'])) tags.add('hrana');
  if (anyIncl(all, ['outdoors','travel & outdoor'])) tags.add('narava');
  if (anyIncl(all, ['sports'])) tags.add('sport');
  if (anyIncl(all, ['business'])) tags.add('biznis');
  if (anyIncl(all, ['science & tech','technology'])) tags.add('tech');

  const blob = `${e.name?.text||''} ${e.description?.text||''}`;
  tagByBlob(blob).forEach(t => tags.add(t));
  return [...tags];
}
function mapTM(e) {
  const venue = e._embedded?.venues?.[0] || {};
  return {
    id: `tm_${e.id}`,
    source: 'ticketmaster',
    sourceId: e.id,
    name: e.name || null,
    description: e.info || e.pleaseNote || null,
    url: e.url || null,
    start: e.dates?.start?.dateTime || null,
    end: e.dates?.end?.dateTime || null,
    timezone: e.dates?.timezone || null,
    venue: {
      name: venue.name || null,
      address: [venue.address?.line1, venue.city?.name, venue.state?.name || venue.state?.stateCode, venue.country?.countryCode].filter(Boolean).join(', ') || null,
      city: venue.city?.name || null,
      country: venue.country?.countryCode || null,
      lat: venue.location?.latitude ? Number(venue.location.latitude) : null,
      lon: venue.location?.longitude ? Number(venue.location.longitude) : null
    },
    performers: (e._embedded?.attractions || []).map(a => ({ name: a.name })),
    images: (e.images || []).map(i => i.url).filter(Boolean),
    price: null,
    language: e.locale || null,
    tags: mapTMtoTags(e)
  };
}
function mapEB(e) {
  return {
    id: `eb_${e.id}`,
    source: 'eventbrite',
    sourceId: e.id,
    name: e.name?.text || null,
    description: e.description?.text || null,
    url: e.url || null,
    start: e.start?.utc || null,
    end: e.end?.utc || null,
    timezone: e.start?.timezone || null,
    venue: {
      name: e.venue?.name || null,
      address: e.venue?.address?.localized_address_display || null,
      city: e.venue?.address?.city || null,
      country: e.venue?.address?.country || null,
      lat: e.venue?.address?.latitude ? Number(e.venue.address.latitude) : null,
      lon: e.venue?.address?.longitude ? Number(e.venue.address.longitude) : null
    },
    performers: [],
    images: e.logo?.url ? [e.logo.url] : [],
    price: null,
    language: e.language || null,
    tags: mapEBtoTags(e)
  };
}

// ---------- PARSERJI LOKALNIH VIROV ----------
const fetchText = (url, opts={}) =>
  fetch(url, { ...opts, headers: { 'User-Agent':'NearGoBot/1.0 (+https://getneargo.com)', ...(opts.headers||{}) } }).then(r => {
    if (!r.ok) throw new Error(`Fetch ${url} -> ${r.status}`);
    return r.text();
  });

// RSS/Atom
async function parseRSS(url){
  try{
    const xml = await fetchText(url);
    const items = [];
    const entryBlocks = xml.match(/<(item|entry)[\s\S]*?<\/(item|entry)>/gi) || [];
    entryBlocks.forEach(block=>{
      const pick = (tagArr) => {
        for (const t of tagArr){
          const m = block.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)<\\/${t}>`, 'i'));
          if (m) return m[1].replace(/<!\[CDATA\[|\]\]>/g,'').trim();
        }
        return null;
      };
      const name = pick(['title']);
      const desc = pick(['content','summary','description']);
      const link = (block.match(/<link[^>]*>([\s\\S]*?)<\/link>/i)?.[1] ||
                   block.match(/<link[^>]*href="([^"]+)"/i)?.[1] || '').trim();
      const date = pick(['updated','published','pubDate','dc:date']);
      const where = pick(['category','tags']);
      const address = (pick(['location','where']) || '').trim();

      const it = {
        id: `rss_${Math.random().toString(36).slice(2)}`,
        source: 'rss',
        sourceId: null,
        name,
        description: desc,
        url: link || null,
        start: date ? new Date(date).toISOString() : null,
        end: null,
        timezone: null,
        venue: { name: null, address: address || null, city: null, country: null, lat: null, lon: null },
        performers: [],
        images: [],
        price: null,
        language: null,
        tags: tagByBlob(`${name||''} ${desc||''} ${where||''}`)
      };
      items.push(it);
    });
    return items;
  }catch(e){ return []; }
}

// ICS
async function parseICS(url){
  try{
    const ics = await fetchText(url);
    const items = [];
    const blocks = ics.split(/BEGIN:VEVENT/).slice(1);
    blocks.forEach(b=>{
      const pick = (k)=> (b.match(new RegExp(`${k}:(.*)`))||[])[1]?.trim() || '';
      const dt = (v)=> v ? new Date(v.replace(/Z?$/,'Z')).toISOString() : null;
      const name = pick('SUMMARY');
      const desc = pick('DESCRIPTION');
      const loc  = pick('LOCATION');
      const urlm = pick('URL');
      const start= dt(pick('DTSTART').replace(/.*:/,''));
      const end  = dt(pick('DTEND').replace(/.*:/,''));
      const it = {
        id: `ics_${Math.random().toString(36).slice(2)}`,
        source: 'ics',
        sourceId: null,
        name: name || null,
        description: desc || null,
        url: urlm || null,
        start, end,
        timezone: null,
        venue: { name: null, address: loc || null, city: null, country: null, lat: null, lon: null },
        performers: [],
        images: [],
        price: null,
        language: null,
        tags: tagByBlob(`${name||''} ${desc||''} ${loc||''}`)
      };
      items.push(it);
    });
    return items;
  }catch(e){ return []; }
}

// JSON (pričakujemo: title/name, description, url, start, end, venue{ name,address,city,country,lat,lon } ali address/lat/lon)
async function parseJSON(url){
  try{
    const txt = await fetchText(url);
    const data = JSON.parse(txt);
    const list = Array.isArray(data) ? data : (data.events || data.items || []);
    return (list||[]).map((e)=>{
      const name = e.title || e.name || null;
      const desc = e.description || null;
      const start= e.start || e.startUtc || e.start_time || null;
      const end  = e.end || e.endUtc || e.end_time || null;
      const images = [];
      if (e.image) images.push(e.image);
      if (Array.isArray(e.images) && e.images.length) images.push(...e.images);
      const venue = e.venue || {};
      const address = venue.address || e.address || e.location || null;

      const it = {
        id: `json_${e.id || Math.random().toString(36).slice(2)}`,
        source: 'json',
        sourceId: e.id || null,
        name,
        description: desc,
        url: e.url || null,
        start, end,
        timezone: e.timezone || null,
        venue: {
          name: venue.name || null,
          address,
          city: venue.city || null,
          country: venue.country || null,
          lat: safeNum(venue.lat || e.lat || e.latitude),
          lon: safeNum(venue.lon || e.lon || e.lng || e.longitude)
        },
        performers: [],
        images,
        price: e.price || null,
        language: e.language || null,
        tags: tagByBlob(`${name||''} ${desc||''} ${address||''} ${(e.tags||[]).join(' ')}`)
      };
      return it;
    });
  }catch(e){ return []; }
}

// CSV kategorije → ujemanje
function matchCategories(item, wantedCsv) {
  if (!wantedCsv) return true;
  const wanted = wantedCsv.split(',').map((s) => norm(s.trim())).filter(Boolean);
  if (wanted.length === 0) return true;
  const itemTags = (item.tags || []).map(norm);
  return wanted.some((w) => itemTags.includes(w));
}

// ---------- KLICI API ----------
async function fetchTicketmaster(params) {
  if (!TM_API_KEY) return { items: [], note: 'TM disabled' };
  const base = 'https://app.ticketmaster.com/discovery/v2/events.json';
  const qs = new URLSearchParams();
  if (params.q) qs.set('keyword', params.q);
  if (params.city) qs.set('city', params.city);
  if (params.country) qs.set('countryCode', params.country);
  if (params.latlon && params.radiuskm) {
    qs.set('latlong', params.latlon);
    qs.set('radius', String(params.radiuskm));
    qs.set('unit', 'km');
  }
  if (params.startDate) qs.set('startDateTime', params.startDate);
  if (params.endDate) qs.set('endDateTime', params.endDate);
  qs.set('size', String(params.size || 20));
  qs.set('apikey', TM_API_KEY);

  const url = `${base}?${qs.toString()}`;
  const r = await fetch(url);
  if (!r.ok) return { items: [], error: `TM ${r.status}` };
  const data = await r.json();
  const list = data._embedded?.events || [];
  return { items: list.map(mapTM), total: data.page?.totalElements || list.length };
}

async function fetchEventbrite(params) {
  if (!EB_PRIVATE_TOKEN) return { items: [], note: 'EB disabled' };
  const base = 'https://www.eventbriteapi.com/v3/events/search/';
  const qs = new URLSearchParams();
  if (params.q) qs.set('q', params.q);
  if (params.city) qs.set('location.address', params.city);
  if (params.latlon) {
    const [lat, lon] = params.latlon.split(',').map(Number);
    if (!Number.isNaN(lat) && !Number.isNaN(lon)) {
      qs.set('location.latitude', String(lat));
      qs.set('location.longitude', String(lon));
      if (params.radiuskm) qs.set('location.within', `${params.radiuskm}km`);
    }
  }
  if (params.startDate) qs.set('start_date.range_start', params.startDate);
  if (params.endDate) qs.set('start_date.range_end', params.endDate);
  qs.set('expand', 'venue,category,subcategory,format,logo');
  qs.set('page', String((params.page || 0) + 1)); // 1-based
  qs.set('page_size', String(params.size || 20));

  const url = `${base}?${qs.toString()}`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${EB_PRIVATE_TOKEN}` } });
  if (!r.ok) return { items: [], error: `EB ${r.status}` };
  const data = await r.json();
  const list = (data.events || []).map(mapEB);
  return { items: list, total: data.pagination?.object_count || list.length };
}

// Lokalni viri (RSS/ICS/JSON)
async function fetchLocal(params){
  const tasks = [];
  for (const u of FEEDS_RSS)  tasks.push(parseRSS(u));
  for (const u of FEEDS_ICS)  tasks.push(parseICS(u));
  for (const u of FEEDS_JSON) tasks.push(parseJSON(u));

  const settled = await Promise.allSettled(tasks);
  let items = [];
  settled.forEach(s => { if (s.status === 'fulfilled' && Array.isArray(s.value)) items.push(...s.value); });

  // grobo geo-filtriranje po besedilu, če je podano mesto
  if (params.city) {
    const cityn = norm(params.city);
    items = items.filter(it => norm(`${it.venue?.address||''} ${it.venue?.city||''}`).includes(cityn) || !it.venue?.address);
  }

  // tags filter
  if (params.category) items = items.filter(it => matchCategories(it, params.category));
  return { items, total: items.length };
}

// ---------- HANDLER ----------
export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };

  try {
    const qs = new URLSearchParams(event.rawQuery || '');
    const params = {
      q: qs.get('q') || '',
      city: qs.get('city') || '',
      country: qs.get('country') || '',
      latlon: qs.get('latlon') || '',
      radiuskm: Number(qs.get('radiuskm') || qs.get('radius') || 50),
      startDate: qs.get('startDate') || qs.get('startDateTime') || '',
      endDate: qs.get('endDate') || qs.get('endDateTime') || '',
      page: Number(qs.get('page') || 0),
      size: Number(qs.get('size') || process.env.DEFAULT_SIZE || 20),
      category: qs.get('category') || ''
    };

    const meta = { sourcesUsed: [], errors: [] };
    const out = [];

    // Ticketmaster
    const tm = await fetchTicketmaster(params);
    meta.sourcesUsed.push({ source: 'ticketmaster', count: tm.items?.length || 0 });
    if (tm.error) meta.errors.push(tm.error);
    out.push(...(tm.items || []));

    // Eventbrite
    const eb = await fetchEventbrite(params);
    meta.sourcesUsed.push({ source: 'eventbrite', count: eb.items?.length || 0 });
    if (eb.error) meta.errors.push(eb.error);
    out.push(...(eb.items || []));

    // Lokalno (RSS/ICS/JSON)
    if (FEEDS_RSS.length || FEEDS_ICS.length || FEEDS_JSON.length) {
      const loc = await fetchLocal(params);
      meta.sourcesUsed.push({ source: 'local-feeds', count: loc.items.length, rss: FEEDS_RSS.length, ics: FEEDS_ICS.length, json: FEEDS_JSON.length });
      out.push(...loc.items);
    }

    // Dedup: name + start + venue.name
    const seen = new Set();
    let uniq = [];
    for (const it of out) {
      const key = `${norm(it.name)}|${it.start||''}|${norm(it.venue?.name||'')}`;
      if (seen.has(key)) continue;
      seen.add(key);
      uniq.push(it);
    }

    // Filter kategorij
    if (params.category) uniq = uniq.filter((it) => matchCategories(it, params.category));

    // Sort po datumu
    uniq.sort((a,b) => new Date(a.start||0) - new Date(b.start||0));

    return json({ ok:true, query:params, size:params.size, count:uniq.length, meta, results:uniq });
  } catch (e) {
    return json({ ok:false, message:e.message || 'Napaka' }, 500);
  }
};

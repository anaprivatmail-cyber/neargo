// netlify/functions/tm-search.js
// Meta-iskalnik (Ticketmaster + Eventbrite) z geokodiranjem mestnih imen (Dunaj → Vienna → lat/lon)

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET,OPTIONS'
};
const json = (data, status=200) => ({
  statusCode: status,
  headers: { 'Content-Type':'application/json', ...CORS },
  body: JSON.stringify(data)
});

const TM_API_KEY       = process.env.TM_API_KEY || '';
const EB_PRIVATE_TOKEN = process.env.EB_PRIVATE_TOKEN || '';

const norm = s => String(s||'').toLowerCase();
const anyIncl = (text, arr) => {
  const t = norm(text);
  return arr.some(k => t.includes(k));
};

// ključne besede (po potrebi razširi)
const KW = {
  otroci:['otroci','otrok','družina','druzina','family','kids','child','children','babies','toddlers','schule','šola'],
  kultura:['kultura','theatre','theater','film','kino','gallery','galerija','opera','ballet','museum','muzej','exhibition','razstava','art','arts','performing'],
  glasba:['koncert','music','band','dj','rock','metal','jazz','classical','hip hop','electronic','festival'],
  hrana:['food','street food','kulinar','wine','vino','beer','pivo','craft','tasting','degust','market','tržnica','trznica','gastronomy'],
  narava:['nature','hike','hiking','trek','outdoor','park','trail','mountain','hrib','gozd','forest','beach','river','camp'],
  sport:['sport','run','tek','marathon','nogomet','football','basket','kolo','cycling','ski','smu','yoga','joga','fitness'],
  zabava:['party','zabava','stand up','standup','comedy','club','nightlife'],
  biznis:['business','networking','sales','marketing','leadership','finance','accounting'],
  tech:['tech','it','developer','programming','code','ai','ml','startup','blockchain'],
  izobrazevanje:['workshop','delavnica','seminar','class','course','tečaj','predavanje'],
  dobrodelno:['charity','dobrodel','fundraiser']
};

function mapTMtoTags(e){
  const tags = new Set();
  const seg = norm(e.classifications?.[0]?.segment?.name);
  const gen = norm(e.classifications?.[0]?.genre?.name);
  const sgen = norm(e.classifications?.[0]?.subGenre?.name);
  const all = [seg,gen,sgen].join(' ');
  if (anyIncl(all,['music'])) tags.add('glasba').add('koncert');
  if (anyIncl(all,['arts & theatre','arts and theatre','theatre'])) tags.add('kultura');
  if (anyIncl(all,['family'])) tags.add('otroci');
  if (anyIncl(all,['sports'])) tags.add('sport');
  if (anyIncl(all,['film'])) tags.add('kultura');
  if (anyIncl(all,['miscellaneous','variety'])) tags.add('zabava');
  const blob = `${e.name||''} ${e.info||''} ${e.pleaseNote||''}`;
  Object.entries(KW).forEach(([k,words])=>{ if(anyIncl(blob,words)) tags.add(k); });
  return Array.from(tags);
}

function mapEBtoTags(e){
  const tags = new Set();
  const all = [norm(e.category?.name), norm(e.subcategory?.name), norm(e.format?.name)].join(' ');
  if (anyIncl(all,['music'])) tags.add('glasba').add('koncert');
  if (anyIncl(all,['performing & visual arts','arts'])) tags.add('kultura');
  if (anyIncl(all,['film & media','film'])) tags.add('kultura');
  if (anyIncl(all,['family','kids','school','education'])) { tags.add('otroci'); tags.add('izobrazevanje'); }
  if (anyIncl(all,['food & drink'])) tags.add('hrana');
  if (anyIncl(all,['outdoors','travel & outdoor'])) tags.add('narava');
  if (anyIncl(all,['sports'])) tags.add('sport');
  if (anyIncl(all,['business'])) tags.add('biznis');
  if (anyIncl(all,['science & tech','technology'])) tags.add('tech');
  const blob = `${e.name?.text||''} ${e.description?.text||''}`;
  Object.entries(KW).forEach(([k,words])=>{ if(anyIncl(blob,words)) tags.add(k); });
  return Array.from(tags);
}

function matchCategories(item, wantedCsv){
  if (!wantedCsv) return true;
  const wanted = wantedCsv.split(',').map(s=>norm(s.trim())).filter(Boolean);
  if (!wanted.length) return true;
  const itemTags = (item.tags||[]).map(norm);
  return wanted.some(w => itemTags.includes(w));
}

// --- geokodiranje imena mesta → lat,lon (npr. "Dunaj" → "48.2082,16.3738")
async function geocodeCity(city, country=''){
  const q = new URLSearchParams({
    q: country ? `${city}, ${country}` : city,
    format: 'json',
    addressdetails: '1',
    limit: '1'
  });
  const url = `https://nominatim.openstreetmap.org/search?${q.toString()}`;
  const r = await fetch(url, { headers: { 'User-Agent':'NearGo/1.0 (getneargo.com)' }});
  if (!r.ok) return null;
  const arr = await r.json();
  if (!Array.isArray(arr) || !arr.length) return null;
  const hit = arr[0];
  const lat = Number(hit.lat), lon = Number(hit.lon);
  if (Number.isNaN(lat) || Number.isNaN(lon)) return null;
  return `${lat.toFixed(5)},${lon.toFixed(5)}`;
}

// --- enotna shema
function mapTM(e){
  const venue = e._embedded?.venues?.[0] || {};
  return {
    id:`tm_${e.id}`,
    source:'ticketmaster',
    sourceId:e.id,
    name:e.name||null,
    description:e.info||e.pleaseNote||null,
    url:e.url||null,
    start:e.dates?.start?.dateTime||null,
    end:e.dates?.end?.dateTime||null,
    timezone:e.dates?.timezone||null,
    venue:{
      name:venue.name||null,
      address:[venue.address?.line1, venue.city?.name, venue.state?.name||venue.state?.stateCode, venue.country?.countryCode].filter(Boolean).join(', ')||null,
      city:venue.city?.name||null,
      country:venue.country?.countryCode||null,
      lat: venue.location?.latitude ? Number(venue.location.latitude) : null,
      lon: venue.location?.longitude ? Number(venue.location.longitude) : null
    },
    performers:(e._embedded?.attractions||[]).map(a=>({name:a.name})),
    images:(e.images||[]).map(i=>i.url).filter(Boolean),
    price:null,
    language:e.locale||null,
    tags: mapTMtoTags(e)
  };
}

function mapEB(e){
  return {
    id:`eb_${e.id}`,
    source:'eventbrite',
    sourceId:e.id,
    name:e.name?.text||null,
    description:e.description?.text||null,
    url:e.url||null,
    start:e.start?.utc||null,
    end:e.end?.utc||null,
    timezone:e.start?.timezone||null,
    venue:{
      name:e.venue?.name||null,
      address:e.venue?.address?.localized_address_display||null,
      city:e.venue?.address?.city||null,
      country:e.venue?.address?.country||null,
      lat: e.venue?.address?.latitude ? Number(e.venue.address.latitude) : null,
      lon: e.venue?.address?.longitude ? Number(e.venue.address.longitude) : null
    },
    performers:[],
    images: e.logo?.url ? [e.logo.url] : [],
    price:null,
    language:e.language||null,
    tags: mapEBtoTags(e)
  };
}

async function fetchTicketmaster(params){
  if (!TM_API_KEY) return { items:[], error:'TM_API_KEY manjka' };
  const base = 'https://app.ticketmaster.com/discovery/v2/events.json';
  const qs = new URLSearchParams();
  if (params.q) qs.set('keyword', params.q);
  if (params.city) qs.set('city', params.city);
  if (params.country) qs.set('countryCode', params.country);
  if (params.latlon && params.radiuskm){
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
  if (!r.ok) return { items:[], error:`TM ${r.status}` };
  const data = await r.json();
  const list = data._embedded?.events || [];
  return { items:list.map(mapTM), total:data.page?.totalElements || list.length };
}

async function fetchEventbrite(params){
  if (!EB_PRIVATE_TOKEN) return { items:[], note:'EB token ni nastavljen (neobvezno)' };
  const base = 'https://www.eventbriteapi.com/v3/events/search/';
  const qs = new URLSearchParams();
  if (params.q) qs.set('q', params.q);
  if (params.city) qs.set('location.address', params.city);
  if (params.latlon){
    const [lat, lon] = params.latlon.split(',').map(Number);
    if (!Number.isNaN(lat) && !Number.isNaN(lon)){
      qs.set('location.latitude', String(lat));
      qs.set('location.longitude', String(lon));
      if (params.radiuskm) qs.set('location.within', `${params.radiuskm}km`);
    }
  }
  if (params.startDate) qs.set('start_date.range_start', params.startDate);
  if (params.endDate) qs.set('start_date.range_end', params.endDate);
  qs.set('expand', 'venue,category,subcategory,format,logo');
  qs.set('page', String((params.page||0)+1)); // 1-based
  qs.set('page_size', String(params.size || 20));
  const url = `${base}?${qs.toString()}`;
  const r = await fetch(url, { headers: { Authorization:`Bearer ${EB_PRIVATE_TOKEN}` }});
  if (!r.ok) return { items:[], error:`EB ${r.status}` };
  const data = await r.json();
  const list = (data.events||[]).map(mapEB);
  return { items:list, total:data.pagination?.object_count || list.length };
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode:200, headers:CORS, body:'' };
  try{
    const qs = new URLSearchParams(event.rawQuery || '');
    const params = {
      q: qs.get('q')||'',
      city: qs.get('city')||'',
      country: qs.get('country')||'',
      latlon: qs.get('latlon') || '',
      radiuskm: Number(qs.get('radiuskm') || qs.get('radius') || 50),
      startDate: qs.get('startDate') || qs.get('startDateTime') || '',
      endDate: qs.get('endDate') || qs.get('endDateTime') || '',
      page: Number(qs.get('page') || 0),
      size: Number(qs.get('size') || process.env.DEFAULT_SIZE || 20),
      category: qs.get('category') || ''
    };

    // Če je podan city, ga najprej geokodiramo (reši “Dunaj”, “Benetke”, …)
    if (!params.latlon && params.city){
      const ll = await geocodeCity(params.city, params.country);
      if (ll) params.latlon = ll;
    }

    const results = [];
    const meta = { sourcesUsed:[], errors:[] };

    const tm = await fetchTicketmaster(params);
    meta.sourcesUsed.push({ source:'ticketmaster', count:(tm.items||[]).length });
    if (tm.error) meta.errors.push(tm.error);
    results.push(...(tm.items||[]));

    const eb = await fetchEventbrite(params);
    if (eb.items){
      meta.sourcesUsed.push({ source:'eventbrite', count:eb.items.length });
      if (eb.error) meta.errors.push(eb.error);
      results.push(...eb.items);
    }

    // dedupe
    const seen = new Set();
    let uniq = [];
    for (const it of results){
      const key = `${norm(it.name)}|${it.start||''}|${norm(it.venue?.name||'')}`;
      if (seen.has(key)) continue;
      seen.add(key);
      uniq.push(it);
    }

    // filter po kategoriji
    if (params.category){
      uniq = uniq.filter(it => matchCategories(it, params.category));
    }

    uniq.sort((a,b)=> new Date(a.start||0) - new Date(b.start||0));

    return json({ ok:true, query:params, count:uniq.length, meta, results:uniq });
  }catch(e){
    return json({ ok:false, message:e.message||'Napaka' }, 500);
  }
};

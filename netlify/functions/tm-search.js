// netlify/functions/tm-search.js
// Iskanje dogodkov: Ticketmaster + Eventbrite (+ feedi, če jih dodaš).
// Podpira okoljske spremenljivke:
//  - TM_API_KEY ali TICKETMASTER_API_KEY
//  - EB_PRIVATE_TOKEN (Eventbrite)
//  - DEFAULT_RADIUS_KM (opcijsko), SEARCH_SIZE (opcijsko)

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return res('', 204);

  try {
    const qs = new URLSearchParams(event.rawQuery || '');
    const q       = (qs.get('q') || '').trim();
    const city    = (qs.get('city') || '').trim();
    const latlon  = (qs.get('latlon') || '').trim(); // "lat,lon"
    const radius  = Number(qs.get('radiuskm') || process.env.DEFAULT_RADIUS_KM || 50);
    const page    = Math.max(0, Number(qs.get('page') || 0));
    const size    = Math.min(50, Math.max(1, Number(qs.get('size') || process.env.SEARCH_SIZE || 20)));
    const debug   = ['1','true','yes'].includes((qs.get('debug')||'').toLowerCase());

    const TM_KEY  = process.env.TM_API_KEY || process.env.TICKETMASTER_API_KEY || '';
    const EB_KEY  = process.env.EB_PRIVATE_TOKEN || '';

    let results = [];
    const notes = [];

    // ---- Ticketmaster Discovery API ----
    if (TM_KEY) {
      try {
        const tm = await fetchTicketmaster({ q, city, latlon, radius, page, size, TM_KEY });
        results.push(...tm.results);
        if (tm.note) notes.push(`TM: ${tm.note}`);
      } catch (e) {
        notes.push(`TM error: ${e.message}`);
      }
    } else {
      notes.push('TM key missing (TM_API_KEY ali TICKETMASTER_API_KEY).');
    }

    // ---- Eventbrite ----
    if (EB_KEY) {
      try {
        const eb = await fetchEventbrite({ q, city, latlon, radius, page, size, EB_KEY });
        results.push(...eb.results);
        if (eb.note) notes.push(`EB: ${eb.note}`);
      } catch (e) {
        notes.push(`EB error: ${e.message}`);
      }
    } else {
      notes.push('EB token missing (EB_PRIVATE_TOKEN).');
    }

    // Odstrani duplikate po URL + imenu (preprosto)
    const seen = new Set();
    results = results.filter(it=>{
      const k = `${(it.url||'').toLowerCase()}|${(it.name||'').toLowerCase()}`;
      if (seen.has(k)) return false; seen.add(k); return true;
    });

    // Sortiraj po datumu
    results.sort((a,b) => new Date(a.start||0) - new Date(b.start||0));

    const payload = { ok:true, results, total: results.length };
    if (debug) payload.debug = notes;
    return json(payload);
  } catch (e) {
    return json({ ok:false, error: e.message || 'Napaka tm-search' }, 500);
  }
};

// ---------------- helpers ----------------

async function fetchTicketmaster({ q, city, latlon, radius, page, size, TM_KEY }) {
  // Gradnja queryja
  const p = new URLSearchParams({
    apikey: TM_KEY,
    size: String(size),
    page: String(page),
    sort: 'date,asc'
  });

  if (q) p.set('keyword', q);

  // Lokacija: najprej latlon, sicer city, sicer countryCode=SI (spremeni po želji)
  if (latlon) {
    // TM podpira latlong & radius
    const [lat, lon] = latlon.split(',').map(s=>s.trim());
    p.set('latlong', `${lat},${lon}`);
    p.set('radius', String(radius));
    p.set('unit', 'km');
  } else if (city) {
    p.set('city', city);
    p.set('countryCode', guessCountryFromCity(city)); // osnoven “guess”
    p.set('radius', String(radius));
    p.set('unit', 'km');
  } else {
    p.set('countryCode', 'SI');
    p.set('radius', String(radius));
    p.set('unit', 'km');
  }

  const url = `https://app.ticketmaster.com/discovery/v2/events.json?${p.toString()}`;
  const r = await fetch(url, { headers: { 'accept':'application/json' }});
  if (!r.ok) {
    const txt = await r.text().catch(()=>r.statusText);
    throw new Error(`TM HTTP ${r.status} – ${txt.slice(0,120)}`);
  }
  const data = await r.json();
  const arr = (data._embedded?.events || []).map(ev => mapTM(ev));
  return { results: arr, note: `fetched ${arr.length}` };
}

function mapTM(ev){
  const img = (ev.images||[]).sort((a,b)=>b.width-a.width)[0]?.url;
  const venue = ev._embedded?.venues?.[0];
  return {
    source: 'ticketmaster',
    id: ev.id,
    name: ev.name,
    url: ev.url,
    start: ev.dates?.start?.dateTime || ev.dates?.start?.localDate,
    end: ev.dates?.end?.dateTime || null,
    images: img ? [img] : [],
    venue: {
      name: venue?.name || '',
      address: [venue?.address?.line1, venue?.city?.name, venue?.country?.countryCode].filter(Boolean).join(', '),
      lat: venue?.location?.latitude ? Number(venue.location.latitude) : null,
      lon: venue?.location?.longitude ? Number(venue.location.longitude) : null
    },
    price: null,
    category: (ev.classifications?.[0]?.segment?.name || '').toLowerCase()
  };
}

async function fetchEventbrite({ q, city, latlon, radius, page, size, EB_KEY }) {
  const p = new URLSearchParams({
    'expand': 'venue,category',
    'page': String(page+1),           // EB strane od 1 naprej
    'page_size': String(size),
    'sort_by': 'date'
  });
  if (q) p.set('q', q);
  if (latlon) {
    const [lat, lon] = latlon.split(',').map(s=>s.trim());
    p.set('location.within', `${radius}km`);
    p.set('location.latitude', lat);
    p.set('location.longitude', lon);
  } else if (city) {
    p.set('location.within', `${radius}km`);
    p.set('location.address', city);
  }

  const url = `https://www.eventbriteapi.com/v3/events/search/?${p.toString()}`;
  const r = await fetch(url, { headers: { 'Authorization': `Bearer ${EB_KEY}` }});
  if (!r.ok) {
    const txt = await r.text().catch(()=>r.statusText);
    throw new Error(`EB HTTP ${r.status} – ${txt.slice(0,120)}`);
  }
  const data = await r.json();
  const arr = (data.events || []).map(ev => mapEB(ev));
  return { results: arr, note: `fetched ${arr.length}` };
}

function mapEB(ev){
  const v = ev.venue || {};
  return {
    source: 'eventbrite',
    id: ev.id,
    name: ev.name?.text || '',
    url: ev.url,
    start: ev.start?.utc || ev.start?.local || null,
    end: ev.end?.utc || ev.end?.local || null,
    images: ev.logo?.url ? [ev.logo.url] : [],
    venue: {
      name: v.name || '',
      address: [v.address?.localized_address_display].filter(Boolean).join(', '),
      lat: v.latitude ? Number(v.latitude) : null,
      lon: v.longitude ? Number(v.longitude) : null
    },
    price: null,
    category: (ev.category?.name || '').toLowerCase()
  };
}

function guessCountryFromCity(city){
  // zelo poenostavljeno – če zazna znane mesta, doda countryCode
  const c = city.toLowerCase();
  if (['ljubljana','maribor','celje','koper','kranj'].some(m=>c.includes(m))) return 'SI';
  if (['vienna','wien','graz','linz','salzburg'].some(m=>c.includes(m))) return 'AT';
  if (['zagreb','split','rijeka','osijek'].some(m=>c.includes(m))) return 'HR';
  if (['trieste','udine','venice','milano','roma','rome'].some(m=>c.includes(m))) return 'IT';
  if (['munich','münchen','berlin','hamburg'].some(m=>c.includes(m))) return 'DE';
  if (['prague','praha'].some(m=>c.includes(m))) return 'CZ';
  if (['budapest'].some(m=>c.includes(m))) return 'HU';
  if (['london','manchester','bristol'].some(m=>c.includes(m))) return 'GB';
  return 'SI';
}

function cors(){
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type, authorization',
    'access-control-allow-methods': 'GET,POST,OPTIONS'
  };
}
function res(body, status=200, headers={}) {
  return { statusCode: status, headers: { ...cors(), ...headers }, body };
}
function json(data, status=200) {
  return res(JSON.stringify(data), status, { 'content-type':'application/json' });
}

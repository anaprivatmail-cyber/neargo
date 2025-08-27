// netlify/functions/tm-search.js
export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return ok('', 204);

  try {
    const qs = new URLSearchParams(event.rawQuery || '');
    const q        = (qs.get('q') || '').trim();
    let   city     = (qs.get('city') || '').trim();
    const latlon   = (qs.get('latlon') || '').trim();
    const radiuskm = Number(qs.get('radiuskm') || 50);
    const category = (qs.get('category') || '').trim();
    const page     = Math.max(0, Number(qs.get('page') || 0));
    const size     = Math.max(1, Math.min(50, Number(qs.get('size') || 20)));

    // datumi
    const dateFrom = (qs.get('dateFrom') || '').trim(); // YYYY-MM-DD
    const dateTo   = (qs.get('dateTo')   || '').trim();

    // --- CITY aliases ---
    const ALIASES = {
      "dunaj":"vienna","wien":"vienna","vienna":"vienna",
      "gradec":"graz","graz":"graz",
      "celovec":"klagenfurt","klagenfurt":"klagenfurt",
      "maribor":"maribor","ljubljana":"ljubljana",
      "zagreb":"zagreb","trst":"trieste","trieste":"trieste",
      "benetke":"venice","venezia":"venice","venice":"venice",
      "salzburg":"salzburg"
    };
    const CITY_LATLON = {
      vienna:"48.20849,16.37208", graz:"47.07071,15.4395",
      klagenfurt:"46.6247,14.3053", maribor:"46.5547,15.6467",
      ljubljana:"46.0511,14.5051", zagreb:"45.815,15.9819",
      trieste:"45.6495,13.7768", venice:"45.4408,12.3155",
      salzburg:"47.8095,13.0550"
    };

    let lat = null, lon = null, cityCanonical = null;
    if (latlon) {
      const [la, lo] = latlon.split(',').map(Number);
      if (!isNaN(la) && !isNaN(lo)) { lat = la; lon = lo; }
    } else if (city) {
      const key = city.toLowerCase();
      cityCanonical = ALIASES[key] || city;
      if (CITY_LATLON[cityCanonical]) {
        const [la, lo] = CITY_LATLON[cityCanonical].split(',').map(Number);
        lat = la; lon = lo;
        city = ''; // Ticketmaster: raje uporabimo geo, če ga imamo
      }
    }

    // ----- Ticketmaster iskanje -----
    const TM_KEY = process.env.TM_API_KEY;
    const EB_TOKEN = process.env.EB_PRIVATE_TOKEN; // če ga uporabljaš

    const tmParams = new URLSearchParams();
    tmParams.set('apikey', TM_KEY);

    if (q) tmParams.set('keyword', q);
    if (lat != null && lon != null) {
      tmParams.set('latlong', `${lat},${lon}`);
      tmParams.set('radius', String(radiuskm));
      tmParams.set('unit', 'km');
    } else if (city) {
      tmParams.set('city', cityCanonical || city);
    }

    // datumi -> Ticketmaster prefers ISO with time; razširimo na 00:00–23:59
    const mk = (d, end=false) => d ? new Date(d + (end ? "T23:59:59" : "T00:00:00")).toISOString() : '';
    if (dateFrom) tmParams.set('startDateTime', mk(dateFrom));
    if (dateTo)   tmParams.set('endDateTime',   mk(dateTo, true));

    // paginacija
    tmParams.set('size', String(size));
    tmParams.set('page', String(page));

    // klic
    let results = [];
    try {
      const url = `https://app.ticketmaster.com/discovery/v2/events.json?${tmParams.toString()}`;
      const r = await fetch(url);
      const j = await r.json();
      const arr = j?._embedded?.events || [];
      results = arr.map(ev => {
        const venue = ev?._embedded?.venues?.[0] || {};
        const loc = {
          address: [venue?.name, venue?.address?.line1, venue?.city?.name, venue?.country?.countryCode].filter(Boolean).join(", "),
          lat: venue?.location ? Number(venue.location.latitude) : null,
          lon: venue?.location ? Number(venue.location.longitude) : null
        };
        return {
          id: ev?.id,
          name: ev?.name,
          url: ev?.url,
          start: ev?.dates?.start?.dateTime || ev?.dates?.start?.localDate || null,
          end: ev?.dates?.end?.dateTime || null,
          venue: loc,
          images: (ev?.images || []).map(i => i.url),
          category: ev?.classifications?.[0]?.segment?.name?.toLowerCase() || ''
        };
      });
    } catch (e) {
      // nadaljujemo – lahko dodaš Eventbrite ali druge vire
    }

    // dodatno filtriranje po kategoriji (mehko)
    if (category) {
      const KEYWORDS = {
        koncert: ["concert","konzert","koncert","tour","live"],
        kultura: ["theatre","theater","opera","ballet","museum","muzej","art","kultura","film","kino"],
        otroci:  ["kids","children","otroci","family","družina","puppet","animation"],
        hrana:   ["food","street food","culinary","kulinar","wine","vino","beer","pivo"],
        narava:  ["hike","trek","trail","outdoor","nature","narava","park"],
        sport:   ["match","tekma","liga","sport","šport","marathon","run","cycling","ski"]
      };
      const keys = KEYWORDS[category] || [];
      results = results.filter(ev => {
        const hay = `${ev.category||''} ${ev.name||''}`.toLowerCase();
        return keys.some(k => hay.includes(k));
      });
    }

    return json({ ok:true, page, size, results });
  } catch (e) {
    return json({ ok:false, error: e.message || 'Napaka' }, 500);
  }
};

/* helpers */
function cors(){
  return {
    'access-control-allow-origin':'*',
    'access-control-allow-headers':'content-type',
    'access-control-allow-methods':'GET,POST,OPTIONS'
  };
}
function ok(body, status=200, headers={}) {
  return { statusCode: status, headers: { ...cors(), ...headers }, body };
}
function json(data, status=200) {
  return ok(JSON.stringify(data), status, { 'content-type':'application/json; charset=utf-8' });
}

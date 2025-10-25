/* ----------------------- Ticketmaster ----------------------- */
function normalizeTM(ev) {
  try {
    const venue = ev._embedded?.venues?.[0];
    const img = (ev.images || []).sort((a, b) => b.width - a.width)[0]?.url || null;

    let category = ev.classifications?.[0]?.segment?.name?.toLowerCase() || '';
    if (!category) {
      const text = `${ev.name || ''} ${ev.info || ''} ${ev.description || ''}`.toLowerCase();
      if (text.includes('concert') || text.includes('music')) category = 'glasba';
      else if (text.includes('theatre') || text.includes('drama')) category = 'kultura';
      else if (text.includes('child') || text.includes('kids')) category = 'otroci';
      else if (text.includes('business') || text.includes('company')) category = 'podjetje';
      else category = 'drugo';
    }

    return {
      id: `tm_${ev.id}`,
      source: 'ticketmaster',
      name: ev.name,
      url: ev.url || null,
      images: img ? [img] : [],
      start: ev.dates?.start?.dateTime || null,
      end: null,
      category,
      venue: {
        name: venue?.name || '',
        address: [venue?.address?.line1, venue?.city?.name, venue?.country?.countryCode].filter(Boolean).join(', '),
        lat: venue?.location ? parseFloat(venue.location.latitude) : null,
        lon: venue?.location ? parseFloat(venue.location.longitude) : null
      }
    };
  } catch { return null; }
}

/* ----------------------- Eventbrite ----------------------- */
function normalizeEB(ev) {
  try {
    const venue = ev.venue;
    const img = ev.logo?.url || null;

    let category = ev.category?.name?.toLowerCase() || '';
    if (!category) {
      const text = `${ev.name?.text || ''} ${ev.description?.text || ''}`.toLowerCase();
      if (text.includes('concert') || text.includes('music') || text.includes('glasba')) category = 'glasba';
      else if (text.includes('food') || text.includes('hrana')) category = 'hrana';
      else if (text.includes('child') || text.includes('kids') || text.includes('otroci')) category = 'otroci';
      else if (text.includes('business') || text.includes('podjetje')) category = 'podjetje';
      else if (text.includes('sport') || text.includes('šport')) category = 'sport';
      else category = 'kultura';
    }

    return {
      id: `eb_${ev.id}`,
      source: 'eventbrite',
      name: ev.name?.text || ev.name,
      url: ev.url || null,
      images: img ? [img] : [],
      start: ev.start?.utc || null,
      end: ev.end?.utc || null,
      category,
      venue: {
        name: venue?.name || '',
        address: venue?.address ? [venue.address.address_1, venue.address.city, venue.address.country].filter(Boolean).join(', ') : '',
        lat: venue?.latitude ? parseFloat(venue.latitude) : null,
        lon: venue?.longitude ? parseFloat(venue.longitude) : null
      }
    };
  } catch { return null; }
}

/* ----------------------- Main Function ----------------------- */
export async function fetchBigApis(ctx) {
  const results = [];
  
  // Ticketmaster API poziv (če je API ključ prisoten)
  if (ctx.env.TICKETMASTER_API_KEY && ctx.center) {
    try {
      const tmUrl = `https://app.ticketmaster.com/discovery/v2/events.json?apikey=${ctx.env.TICKETMASTER_API_KEY}&latlong=${ctx.center.lat},${ctx.center.lon}&radius=${ctx.radiusKm || 50}&unit=km&size=100`;
      const tmResp = await fetch(tmUrl);
      if (tmResp.ok) {
        const tmData = await tmResp.json();
        const events = tmData._embedded?.events || [];
        events.forEach(ev => {
          const normalized = normalizeTM(ev);
          if (normalized) results.push(normalized);
        });
      }
    } catch (e) {
      console.error('Ticketmaster API error:', e);
    }
  }

  // Eventbrite API poziv (če je API ključ prisoten)
  if (ctx.env.EVENTBRITE_API_KEY && ctx.center) {
    try {
      const ebUrl = `https://www.eventbriteapi.com/v3/events/search/?location.latitude=${ctx.center.lat}&location.longitude=${ctx.center.lon}&location.within=${ctx.radiusKm || 50}km&expand=venue&token=${ctx.env.EVENTBRITE_API_KEY}`;
      const ebResp = await fetch(ebUrl);
      if (ebResp.ok) {
        const ebData = await ebResp.json();
        const events = ebData.events || [];
        events.forEach(ev => {
          const normalized = normalizeEB(ev);
          if (normalized) results.push(normalized);
        });
      }
    } catch (e) {
      console.error('Eventbrite API error:', e);
    }
  }

  return results;
}

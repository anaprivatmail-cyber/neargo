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

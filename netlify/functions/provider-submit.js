// netlify/functions/provider-submit.js
export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: cors(), body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return json({ ok:false, message:'Use POST' }, 405);
  }

  try {
    const body = JSON.parse(event.body || '{}');
    // minimalna validacija
    const required = ['name','start','city','country'];
    for (const k of required) {
      if (!body[k]) return json({ok:false, message:`Manjka polje: ${k}`}, 400);
    }

    // normalizacija
    const item = {
      id: 'prov_' + Date.now().toString(36),
      source: 'provider',
      name: body.name?.slice(0,200),
      description: body.description?.slice(0,2000) || '',
      start: body.start,
      city: body.city,
      country: (body.country || '').toUpperCase().slice(0,2),
      venue: body.venue || '',
      lat: body.lat ? Number(body.lat) : null,
      lon: body.lon ? Number(body.lon) : null,
      image: body.image || '',
      priceMin: body.priceMin ? Number(body.priceMin) : null,
      buyUrl: body.buyUrl || '',
      featured: !!body.featured,
      createdAt: new Date().toISOString()
    };

    // Shrani v Netlify Blobs (brez baze – preprosto)
    const store = await import('@netlify/blobs');
    const bucket = store.blobStore('providers'); // samodejno ustvarjen
    await bucket.setJSON(item.id + '.json', item);

    return json({ ok:true, id:item.id });
  } catch (e) {
    return json({ ok:false, message:e.message || 'Napaka' }, 500);
  }
};

function cors() {
  return {
    'Access-Control-Allow-Origin':'*',
    'Access-Control-Allow-Headers':'Content-Type',
    'Access-Control-Allow-Methods':'GET,POST,OPTIONS'
  };
}
function json(data, status=200) {
  return { statusCode: status, headers: { 'Content-Type':'application/json', ...cors() }, body: JSON.stringify(data) };
}

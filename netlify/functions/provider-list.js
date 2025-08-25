// netlify/functions/provider-list.js
export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: cors(), body: '' };
  }
  try {
    const qs = new URLSearchParams(event.rawQuery || '');
    const onlyFeatured = ['1','true','yes'].includes((qs.get('featured')||'').toLowerCase());

    const store = await import('@netlify/blobs');
    const bucket = store.blobStore('providers');
    const list = await bucket.list(); // { blobs:[{key}] }
    const items = [];
    for (const b of (list.blobs||[])) {
      if (!b.key.endsWith('.json')) continue;
      const it = await bucket.getJSON(b.key);
      if (!it) continue;
      if (onlyFeatured && !it.featured) continue;
      items.push(it);
    }
    items.sort((a,b) => new Date(a.start||0) - new Date(b.start||0));
    return json({ ok:true, results: items });
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

// netlify/functions/provider-list.js
export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return res('', 204);
  try{
    const qs = new URLSearchParams(event.rawQuery||'');
    const onlyFeatured = ['1','true','yes'].includes((qs.get('featured')||'').toLowerCase());
    const limit  = Math.max(0, Number(qs.get('limit') || 0));
    const offset = Math.max(0, Number(qs.get('offset') || 0));

    let items = [];

    // nova shramba
    try{
      const { getStore } = await import('@netlify/blobs');
      const store = getStore({ name:'neargo' });
      const listing = await store.list({ prefix:'events/' });
      for (const b of listing.blobs||[]){
        if (!b.key.endsWith('.json')) continue;
        const obj = await store.getJSON(b.key);
        if (obj) items.push(obj);
      }
    }catch(e){ /* fallback ni panike */ }

    // fallback – stara shramba
    if (!items.length){
      try{
        const blobs = await import('@netlify/blobs');
        if (typeof blobs.blobStore === 'function'){
          const bucket = blobs.blobStore('providers');
          const list = await bucket.list();
          for (const b of (list.blobs||[])){
            if (!b.key.endsWith('.json')) continue;
            const it = await bucket.getJSON(b.key);
            if (it) items.push(it);
          }
        }
      }catch(e){}
    }

    if (onlyFeatured){
      items = items.filter(it => it.featured || (it.featuredUntil && new Date(it.featuredUntil) > new Date()));
    }

    items.sort((a,b)=> new Date(a.start||0) - new Date(b.start||0));

    const total = items.length;
    const sliced = limit ? items.slice(offset, offset+limit) : items;
    return json({ ok:true, total, offset, limit, results:sliced });

  }catch(e){
    return json({ ok:false, message:e.message||'Napaka' }, 500);
  }
};

function cors(){
  return {
    'access-control-allow-origin':'*',
    'access-control-allow-headers':'content-type',
    'access-control-allow-methods':'GET,POST,OPTIONS'
  };
}
function res(body,status=200,headers={}){ return { statusCode:status, headers:{...cors(),...headers}, body }; }
function json(data,status=200){ return res(JSON.stringify(data),status,{'content-type':'application/json'}); }

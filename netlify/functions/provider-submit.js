// netlify/functions/provider-submit.js
// Shrani v Netlify Blobs in po želji pošlje e-pošto prek Resend

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST,OPTIONS'
};
const json = (d,s=200)=>({statusCode:s,headers:{'Content-Type':'application/json',...CORS},body:JSON.stringify(d)});

const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const FROM_EMAIL     = process.env.FROM_EMAIL || 'no-reply@getneargo.com';
const ADMIN_EMAIL    = process.env.ADMIN_EMAIL || 'info@getneargo.com';

function slugify(s){ return String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,''); }

async function sendEmail(to, subject, html){
  if (!RESEND_API_KEY) return { ok:false, note:'RESEND_API_KEY ni nastavljen' };
  const r = await fetch('https://api.resend.com/emails',{
    method:'POST',
    headers:{ 'Content-Type':'application/json', 'Authorization':`Bearer ${RESEND_API_KEY}` },
    body: JSON.stringify({ from: FROM_EMAIL, to, subject, html })
  });
  const data = await r.json().catch(()=> ({}));
  return { ok: r.ok, data };
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode:200, headers:CORS, body:'' };
  if (event.httpMethod !== 'POST') return json({ ok:false, error:'Method not allowed' }, 405);

  try{
    const payload = JSON.parse(event.body||'{}');
    const now = new Date();
    const key = `events/${now.toISOString().replace(/[:.]/g,'-')}-${slugify(payload.eventName||'dogodek')}.json`;

    // označi featured do +7 dni, če je navedeno
    if (payload.featured){
      const until = new Date(Date.now()+7*24*3600*1000);
      payload.featuredUntil = until.toISOString();
    }

    // shrani v blobs
    const { getStore } = await import('@netlify/blobs');
    const store = getStore({ name:'neargo' });
    await store.setJSON(key, {
      ...payload,
      createdAt: now.toISOString(),
      source: 'provider'
    });

    // e-pošta organizatorju (če ključ obstaja)
    if (payload.organizerEmail){
      await sendEmail(payload.organizerEmail, 'NearGo – potrditev prejema objave', `
        <p>Hvala za oddajo dogodka <b>${payload.eventName||''}</b>.</p>
        <p>Vaš vnos bomo hitro pregledali. ${payload.featured ? 'Izbrali ste izpostavitev (7 dni).' : ''}</p>
        <p>Ekipa NearGo</p>
      `);
    }
    // obvestilo adminu
    await sendEmail(ADMIN_EMAIL, 'NearGo – nova objava dogodka', `
      <p>Nova objava: <b>${payload.eventName||''}</b></p>
      <p>Mesto: ${payload.city||payload.city2||''} | Cena: ${payload.price ?? '—'} | Featured: ${payload.featured? 'DA':'NE'}</p>
      <pre style="white-space:pre-wrap">${JSON.stringify(payload,null,2)}</pre>
    `);

    return json({ ok:true, key });
  }catch(e){
    return json({ ok:false, error:e.message||'Napaka pri shranjevanju' }, 500);
  }
};

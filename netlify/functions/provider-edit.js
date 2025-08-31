// netlify/functions/provider-edit.js
import { createClient } from '@supabase/supabase-js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
};
const res = (body, s=200, type='text/html') => ({
  statusCode: s,
  headers: { 'Content-Type': type+'; charset=utf-8', ...CORS },
  body
});
const json = (d, s=200) => res(JSON.stringify(d), s, 'application/json');

const SUPABASE_URL              = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = 'event-images';

function htmlShell(content){
  return `<!doctype html><meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Uredi dogodek – NearGo</title>
  <style>
    body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;margin:16px;color:#0b1b2b}
    .card{max-width:720px;margin:0 auto;background:#fff;border:1px solid #cfe1ee;border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.08);padding:14px}
    h1{font-size:20px;margin:0 0 10px}
    label{display:block;font-weight:800;font-size:13px;margin-top:10px}
    input,textarea,select{width:100%;border:1px solid #cfe1ee;border-radius:10px;padding:10px;font-size:15px}
    textarea{min-height:140px}
    .row{display:grid;grid-template-columns:1fr 1fr;gap:10px}
    .actions{display:flex;gap:8px;margin-top:12px}
    .btn{background:#0bbbd6;border:none;color:#fff;border-radius:10px;padding:10px 14px;font-weight:900;cursor:pointer}
    .link{background:transparent;border:1px solid #cfe1ee;color:#0b1b2b}
    .muted{color:#5b6b7b}
  </style>
  <div class="card">${content}</div>`;
}

async function loadEvent(supabase, key){
  const { data, error } = await supabase.storage.from(BUCKET).download(key);
  if (error) throw new Error(error.message);
  const text = await data.text();
  return JSON.parse(text);
}
async function saveEvent(supabase, key, obj){
  const bytes = Buffer.from(JSON.stringify(obj, null, 2), 'utf8');
  const { error } = await supabase.storage.from(BUCKET)
    .upload(key, bytes, { contentType:'application/json; charset=utf-8', upsert:true });
  if (error) throw new Error(error.message);
}

function sanitizePatch(p){
  // dovolimo le ta polja
  const allowed = ['eventName','venue','city','country','start','end','url',
                   'description','category','imagePublicUrl','featured','featuredUntil',
                   'price','stock','maxPerOrder','offerType'];
  const out = {};
  for (const k of allowed) if (k in p) out[k] = p[k];
  return out;
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY)
    return json({ ok:false, error:'Manjkajo SUPABASE kredenciali' }, 500);

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  if (event.httpMethod === 'GET'){
    const u = new URL(event.rawUrl || `https://x.local${event.rawQuery?('?'+event.rawQuery):''}`);
    const key   = u.searchParams.get('key') || '';
    const token = u.searchParams.get('token') || '';
    const mode  = u.searchParams.get('mode') || '';

    if (!key || !token) return res(htmlShell('<p>Manjka key ali token.</p>'));
    try{
      const obj = await loadEvent(supabase, key);
      if (obj.secretEditToken !== token) return res(htmlShell('<p>Napačen ali potekel žeton.</p>'));

      if (mode === 'json') return json({ ok:true, data: obj });

      // preprost HTML urejevalnik
      const form = `
        <h1>Uredi dogodek</h1>
        <p class="muted">Po spremembi klikni <b>Shrani</b>. (Povezave ne deli naprej.)</p>
        <form id="f">
          <label>Naslov dogodka <input name="eventName" value="${(obj.eventName||'').replace(/"/g,'&quot;')}"></label>
          <div class="row">
            <label>Prizorišče <input name="venue" value="${(obj.venue||'').replace(/"/g,'&quot;')}"></label>
            <label>Mesto/kraj <input name="city" value="${(obj.city||'').replace(/"/g,'&quot;')}"></label>
          </div>
          <div class="row">
            <label>Začetek <input type="datetime-local" name="start" value="${(obj.start||'').replace('Z','')}"></label>
            <label>Konec <input type="datetime-local"  name="end"   value="${(obj.end||'').replace('Z','')}"></label>
          </div>
          <label>Povezava (URL) <input name="url" value="${(obj.url||'').replace(/"/g,'&quot;')}"></label>
          <label>Kategorija
            <select name="category">
              ${['koncert','kultura','otroci','hrana','narava','sport','za-podjetja'].map(c=>`<option value="${c}" ${obj.category===c?'selected':''}>${c}</option>`).join('')}
            </select>
          </label>
          <label>Opis <textarea name="description">${(obj.description||'').replace(/</g,'&lt;')}</textarea></label>
          <label>Slika (javni URL) <input name="imagePublicUrl" value="${(obj.imagePublicUrl||'').replace(/"/g,'&quot;')}"></label>
          <div class="actions">
            <button type="button" class="btn" id="save">Shrani</button>
            <a class="btn link" href="/">Nazaj na NearGo</a>
          </div>
        </form>
        <script>
          const key = ${JSON.stringify(key)};
          const token = ${JSON.stringify(token)};
          const f = document.getElementById('f');
          document.getElementById('save').onclick = async () => {
            const fd = new FormData(f);
            const patch = Object.fromEntries(fd.entries());
            const r = await fetch(location.pathname, {
              method:'POST',
              headers:{'content-type':'application/json'},
              body: JSON.stringify({ key, token, patch })
            });
            const data = await r.json().catch(()=>({}));
            alert(data.ok ? 'Shranjeno.' : ('Napaka: ' + (data.error||'')));
            if (data.ok) location.reload();
          };
        </script>
      `;
      return res(htmlShell(form));
    }catch(e){
      return res(htmlShell(`<p>Napaka: ${String(e?.message||e)}</p>`));
    }
  }

  if (event.httpMethod === 'POST'){
    try{
      const body = JSON.parse(event.body || '{}');
      const key   = body.key   || '';
      const token = body.token || '';
      const patch = sanitizePatch(body.patch || {});
      if (!key || !token) return json({ ok:false, error:'Manjka key/token' }, 400);

      const obj = await loadEvent(supabase, key);
      if (obj.secretEditToken !== token) return json({ ok:false, error:'Neveljaven žeton' }, 403);

      const merged = { ...obj, ...patch, updatedAt: new Date().toISOString() };
      await saveEvent(supabase, key, merged);
      return json({ ok:true });
    }catch(e){
      return json({ ok:false, error: String(e?.message || e) }, 500);
    }
  }

  return json({ ok:false, error:'Method not allowed' }, 405);
};

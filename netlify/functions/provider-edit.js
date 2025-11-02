// netlify/functions/provider-edit.js
import { createClient } from '@supabase/supabase-js';
// ...veljavna logika za Netlify funkcijo...
async function geocodeIfNeeded(supabase, city, country){
  const cityQ = String(city || '').trim();
  const countryQ = String(country || '').trim().toUpperCase();
  if (!cityQ || !countryQ) return null;

  const { data: cached } = await supabase
    .from('geo_cache')
    .select('id, lat, lon')
    .eq('country', countryQ)
    .ilike('city', cityQ)
    .limit(1)
    .maybeSingle();

  if (cached && Number.isFinite(cached.lat) && Number.isFinite(cached.lon)) {
    return { lat: cached.lat, lon: cached.lon, cached: true };
  }

  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('q', [cityQ, countryQ].join(', '));
  url.searchParams.set('format','json');
  url.searchParams.set('limit','1');

  const r = await fetch(url.toString(), { headers:{'User-Agent':'NearGo/1.0 (getneargo.com)'} });
  if (!r.ok) return null;
  const arr = await r.json().catch(()=>[]);
  if (!arr?.length) return null;

  const lat = parseFloat(arr[0].lat), lon = parseFloat(arr[0].lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  try{
    if (cached?.id) {
      await supabase.from('geo_cache').update({ lat, lon, updated_at: new Date().toISOString() }).eq('id', cached.id);
    } else {
      await supabase.from('geo_cache').insert({ city: cityQ, country: countryQ, lat, lon });
    }
  }catch{}
  return { lat, lon, cached:false };
}
function fmtDate(s){ try{ return new Date(s).toLocaleString(); }catch{ return s||''; } }

function htmlShell(content){
  return `<!doctype html><meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Uredi dogodek – NearGo</title>
  <style>
    body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;margin:16px;color:#0b1b2b;background:#f7fbff}
    .card{max-width:760px;margin:0 auto;background:#fff;border:1px solid #cfe1ee;border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.08);padding:14px}
    h1{font-size:20px;margin:0 0 10px}
    label{display:block;font-weight:800;font-size:13px;margin-top:10px}
    input,textarea,select{width:100%;border:1px solid #cfe1ee;border-radius:10px;padding:10px;font-size:15px}
    textarea{min-height:140px}
    .row{display:grid;grid-template-columns:1fr 1fr;gap:10px}
    .actions{display:flex;gap:8px;margin-top:12px;flex-wrap:wrap}
    .btn{background:#0bbbd6;border:none;color:#fff;border-radius:10px;padding:10px 14px;font-weight:900;cursor:pointer}
    .btn.danger{background:#e83c3c}
    .link{background:transparent;border:1px solid #cfe1ee;color:#0b1b2b}
    .muted{color:#5b6b7b}
    .count{font-size:12px;color:#5b6b7b;float:right;margin-top:4px}
    .preview{margin-top:14px;border-top:1px dashed #cfe1ee;padding-top:12px;display:none}
    .spot{border:1px solid #cfe1ee;border-radius:12px;overflow:hidden}
    .spot img{width:100%;height:180px;object-fit:cover;display:block}
    .spot .meta{padding:10px}
    .warn{font-size:12px;color:#7b3b00;background:#fff6e6;border:1px solid #ffd9a8;border-radius:8px;padding:8px;margin-top:8px}
    .featBox{border:1px dashed #cfe1ee;border-radius:10px;padding:10px;margin-top:10px}
  </style>
  <div class="card">${content}</div>`;
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY)
    return json({ ok:false, error:'Manjka SUPABASE kredencial' }, 500);

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

      const isFeatured = !!(obj.featured || (obj.featuredUntil && new Date(obj.featuredUntil) > new Date()));
      const featUntil  = obj.featuredUntil ? fmtDate(obj.featuredUntil) : '';

      const form = `
        <h1>Uredi dogodek</h1>
        <p class="muted">Po spremembi klikni <b>Shrani</b>. (Povezave ne deli naprej.)</p>
        <form id="f">
          <div class="row">
            <label>Ime organizatorja <input name="organizer" value="${(obj.organizer||'').replace(/"/g,'&quot;')}"></label>
            <label>E-pošta organizatorja <input name="organizerEmail" value="${(obj.organizerEmail||'').replace(/"/g,'&quot;')}"></label>
          </div>
          <label>Naslov dogodka <input name="eventName" value="${(obj.eventName||'').replace(/"/g,'&quot;')}"></label>
          <div class="row">
            <label>Prizorišče <input name="venue" value="${(obj.venue||'').replace(/"/g,'&quot;')}"></label>
            <label>Mesto/kraj <input name="city" value="${(obj.city||obj.city2||'').replace(/"/g,'&quot;')}"></label>
          </div>
          <div class="row">
            <label>Država (ISO, npr. SI) <input name="country" value="${(obj.country||'').replace(/"/g,'&quot;')}"></label>
            <label>Povezava (URL) <input name="url" value="${(obj.url||'').replace(/"/g,'&quot;')}"></label>
          </div>
          <div class="row">
            <label>Začetek <input type="datetime-local" name="start" value="${(obj.start||'').replace('Z','')}"></label>
            <label>Konec <input type="datetime-local"  name="end"   value="${(obj.end||'').replace('Z','')}"></label>
          </div>
          <div class="row">
            <label>Tip ponudbe
              <select name="offerType">
                ${['none','ticket','coupon'].map(v=>`<option value="${v}" ${obj.offerType===v?'selected':''}>${v}</option>`).join('')}
              </select>
            </label>
            <label>Cena <input type="number" step="0.01" name="price" value="${obj.price ?? ''}"></label>
          </div>
          <div class="row">
            <label>Zaloga <input type="number" step="1" name="stock" value="${obj.stock ?? ''}"></label>
            <label>Max na naročilo <input type="number" step="1" name="maxPerOrder" value="${obj.maxPerOrder ?? ''}"></label>
          </div>
          <label>Kategorija
            <div id="providerEditCategoryChips" style="display:flex;gap:10px;flex-wrap:wrap;margin-top:6px"></div>
            <input type="hidden" name="category" id="category" value="${obj.category||''}">
            <script>
            // User-specified emoji chips for category selection in provider-edit form
            (function(){
              var cats = [
                { key: "koncert", emoji: "🎸", label: "Koncerti" },
                { key: "kultura", emoji: "🎭", label: "Kultura" },
                { key: "otroci", emoji: "🧸", label: "Otroci" },
                { key: "hrana", emoji: "🍔", label: "Hrana" },
                { key: "narava", emoji: "🌳", label: "Narava" },
                { key: "sport", emoji: "⚽", label: "Šport" },
                { key: "zabava", emoji: "🎉", label: "Zabava" },
                { key: "za-podjetja", emoji: "🏢", label: "Za podjetja" }
              ];
              function renderChips(){
                var wrap = document.getElementById("providerEditCategoryChips");
                var input = document.getElementById("category");
                if(!wrap || !input) return;
                wrap.innerHTML = "";
                cats.forEach(function(cat){
                  var chip = document.createElement("button");
                  chip.className = "chip cat" + (input.value === cat.key ? " active" : "");
                  chip.type = "button";
                  chip.setAttribute("data-cat", cat.key);
                  chip.innerHTML = '<span class="cat-icon">'+cat.emoji+'</span>' + '<span class="cat-label" style="display:none;">'+cat.label+'</span>';
                  chip.addEventListener("mouseenter", function(){ chip.querySelector(".cat-label").style.display = "block"; });
                  chip.addEventListener("mouseleave", function(){ if(!chip.classList.contains("active")) chip.querySelector(".cat-label").style.display = "none"; });
                  chip.addEventListener("touchstart", function(){ chip.querySelector(".cat-label").style.display = "block"; });
                  chip.addEventListener("touchend", function(){ if(!chip.classList.contains("active")) chip.querySelector(".cat-label").style.display = "none"; });
                  chip.addEventListener("click", function(){
                    var all = wrap.querySelectorAll(".cat");
                    all.forEach(function(b){ b.classList.remove("active"); b.querySelector(".cat-label").style.display = "none"; });
                    chip.classList.add("active");
                    chip.querySelector(".cat-label").style.display = "block";
                    input.value = cat.key;
                  });
                  wrap.appendChild(chip);
                });
              }
              document.addEventListener("DOMContentLoaded", renderChips);
            })();
            </script>
          </label>
          <label>Opis (max ${DESC_MAX})
            <span class="count"><span id="cnt">0</span> / ${DESC_MAX}</span>
            <textarea id="desc" name="description" maxlength="${DESC_MAX}">${(obj.description||'').replace(/</g,'&lt;')}</textarea>
          </label>
          <label>Slika (javni URL) <input name="imagePublicUrl" value="${(obj.imagePublicUrl||'').replace(/"/g,'&quot;')}"></label>

          <div class="featBox">
            <label class="chk"><input type="checkbox" id="featured" name="featured" ${isFeatured?'checked':''}> Izpostavi (7 dni) – <b>brezplačno</b></label>
            ${featUntil ? `<div class="muted">Trenutno aktivno do: <b>${featUntil}</b></div>` : ''}
            <div class="warn">Izpostavitev je brezplačna; lahko jo kadar koli izklopite.</div>
            <div class="actions" style="margin-top:8px">
              <button type="button" class="btn danger" id="cancelFeat">Prekliči izpostavitev</button>
            </div>
          </div>

          <div class="actions">
            <button type="button" class="btn" id="preview">Predogled</button>
            <button type="button" class="btn" id="save">Shrani</button>
            <a class="btn link" href="/">Nazaj na NearGo</a>
          </div>
        </form>

        <div class="preview" id="pv">
          <div class="spot">
            <img id="pvImg" src="${(obj.imagePublicUrl||'https://picsum.photos/1200/600?blur=1')}" alt="">
            <div class="meta">
              <b id="pvTitle">${(obj.eventName||'Dogodek').replace(/</g,'&lt;')}</b>
              <div class="muted" id="pvAddr">${[(obj.venue||''),(obj.city||obj.city2||''),(obj.country||'')].filter(Boolean).join(', ').replace(/</g,'&lt;')}</div>
              <div class="muted" id="pvTime">${fmtDate(obj.start)}</div>
              <p id="pvDesc" style="margin:8px 0 0 0">${(obj.description||'').replace(/</g,'&lt;')}</p>
            </div>
          </div>
        </div>

        <script>
          const DESC_MAX=${DESC_MAX};
          const key=${JSON.stringify(key)};
          const token=${JSON.stringify(token)};
          const f=document.getElementById('f');
          const desc=document.getElementById('desc');
          const cnt=document.getElementById('cnt');
          const pv=document.getElementById('pv');
          const featuredEl=document.getElementById('featured');
          const cancelBtn=document.getElementById('cancelFeat');

          const updateCount=()=>{ cnt.textContent = (desc.value||'').length; };
          updateCount();
          desc.addEventListener('input', updateCount);

          cancelBtn.onclick=()=>{
            if(confirm('Preklic izpostavitve: nadaljujem?')){
              featuredEl.checked=false;
            }
          };

          document.getElementById('preview').onclick=()=>{
            const fd=new FormData(f);
            const v=Object.fromEntries(fd.entries());
            document.getElementById('pvImg').src = v.imagePublicUrl || 'https://picsum.photos/1200/600?blur=1';
            document.getElementById('pvTitle').innerHTML = (v.eventName||'Dogodek');
            document.getElementById('pvAddr').innerHTML = [v.venue,v.city,v.country].filter(Boolean).join(', ');
            document.getElementById('pvTime').textContent = v.start || '';
            document.getElementById('pvDesc').textContent = v.description || '';
            pv.style.display='block';
            pv.scrollIntoView({behavior:'smooth', block:'start'});
          };

          document.getElementById('save').onclick=async()=>{
            if((desc.value||'').length > DESC_MAX){
              alert('Opis je predolg. Največ ' + DESC_MAX + ' znakov.');
              return;
            }
            const fd=new FormData(f);
            if(!featuredEl.checked) fd.set('featured','false');
            const patch=Object.fromEntries(fd.entries());
            if(patch.featured==='false'){ patch.featuredUntil = null; }

            const r=await fetch(location.pathname, {
              method:'POST',
              headers:{'content-type':'application/json'},
              body:JSON.stringify({ key, token, patch })
            });
            const data=await r.json().catch(()=>({}));
            if(!data.ok){ alert('Napaka: ' + (data.error||'')); return; }
            alert('Shranjeno.');
            location.reload();
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

      const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
      const obj = await loadEvent(supabase, key);
      if (obj.secretEditToken !== token) return json({ ok:false, error:'Neveljaven žeton' }, 403);

      if (typeof patch.description === 'string' && patch.description.length > DESC_MAX){
        return json({ ok:false, error:`Opis je predolg (${patch.description.length}). Največ ${DESC_MAX} znakov.` }, 400);
      }

      if (patch.featured === false) {
        patch.featuredUntil = null;
      }

      let merged = { ...obj, ...patch };
      const cityBefore = obj.city || obj.city2 || '';
      const cityAfter  = merged.city || merged.city2 || '';
      if ((cityAfter && cityAfter !== cityBefore) || (merged.country && merged.country !== obj.country) || (!merged.venueLat || !merged.venueLon)) {
        const g = await geocodeIfNeeded(supabase, cityAfter, merged.country);
        if (g){ merged.venueLat = g.lat; merged.venueLon = g.lon; }
      }
      merged.updatedAt = new Date().toISOString();

      await saveEvent(supabase, key, merged);
      return json({ ok:true });
    }catch(e){
      return json({ ok:false, error: String(e?.message || e) }, 500);
    }
  }

  return json({ ok:false, error:'Method not allowed' }, 405);
};

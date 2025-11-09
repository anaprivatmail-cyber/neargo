// assets/provider-rating.js
// Frontend widget for provider rating (three sliders + submit)
// Usage: renderProviderRatingWidget({ mount: HTMLElement, providerId: 'abc', userEmail: 'x@y' })

export function renderProviderRatingWidget(opts){
  const mount = opts.mount; if(!mount) return;
  const providerId = opts.providerId; const email = opts.userEmail || '';
  mount.innerHTML = ''
    + '<div class="pr-widget" style="border:1px solid #cfe1ee;padding:14px;border-radius:14px;background:#fff;max-width:420px">'
    +   '<h3 style="margin:0 0 10px;font-size:18px;font-weight:900;letter-spacing:-0.5px">Ocena ponudnika</h3>'
    +   '<p style="margin:0 0 12px;font-size:13px;color:#5b6b7b">Premakni drsnike – izračunamo kombinirano oceno (Q/V/E). 0–100 vsaka os, teže 40/30/30.</p>'
    +   slider('Kakovost','quality')
    +   slider('Vrednost','value')
    +   slider('Izkušnja','experience')
    +   '<textarea id="prComment" placeholder="Komentar (opcijsko)" style="width:100%;margin-top:8px;font:14px system-ui;min-height:70px;padding:8px;border:1px solid #cfe1ee;border-radius:10px"></textarea>'
    +   '<div style="display:flex;align-items:center;justify-content:space-between;margin-top:12px">'
    +     '<div id="prScore" style="font-weight:800;color:#0bbbd6">Skupna: 0.0</div>'
    +     '<button id="prSubmit" class="btn mini" style="background:#0bbbd6;color:#fff;border:none;padding:8px 14px;border-radius:10px;font-weight:800">Shrani oceno</button>'
    +   '</div>'
    +   '<div id="prMsg" style="margin-top:8px;font-size:12px;color:#5b6b7b"></div>'
    + '</div>';
  function slider(label,key){
    return '<label style="display:block;margin-top:8px;font-size:13px;font-weight:600">'+label
      + '<input type="range" min="0" max="100" step="1" value="0" data-axis="'+key+'" style="width:100%;display:block;margin-top:4px">'
      + '<span id="prVal_'+key+'" style="font-size:11px;color:#0b1b2b;font-weight:700;display:inline-block;margin-top:4px">0</span>'
      + '</label>';
  }
  function recompute(){
    const q = Number(mount.querySelector('input[data-axis="quality"]').value||0);
    const v = Number(mount.querySelector('input[data-axis="value"]').value||0);
    const x = Number(mount.querySelector('input[data-axis="experience"]').value||0);
    mount.querySelector('#prVal_quality').textContent=q;
    mount.querySelector('#prVal_value').textContent=v;
    mount.querySelector('#prVal_experience').textContent=x;
    const combined = (q*0.4 + v*0.3 + x*0.3)/20; // scale to 0..5
    mount.querySelector('#prScore').textContent = 'Skupna: '+combined.toFixed(2);
    return {q,v,x,combined};
  }
  mount.querySelectorAll('input[data-axis]').forEach(inp=>{
    inp.addEventListener('input', recompute);
  });
  recompute();
  const submit = mount.querySelector('#prSubmit');
  submit.addEventListener('click', async ()=>{
    submit.disabled=true; const {q,v,x,combined} = recompute();
    const comment = mount.querySelector('#prComment').value.trim();
    if(!providerId || !email){ showMsg('Manjka email ali ID ponudnika.', true); submit.disabled=false; return; }
    try{
      const payload = { provider_id: providerId, email, quality:q, value:v, experience:x, comment };
      const r = await fetch('/api/provider-rate',{ method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) }).then(x=>x.json());
      if(r && r.ok){ showMsg('Shranjeno. Badge: '+(r.badge||'—')+'  (Q:'+q+' V:'+v+' E:'+x+' Score:'+combined.toFixed(2)+')', false); }
      else showMsg('Napaka pri shranjevanju: '+(r && r.error ? r.error : '???'), true);
    }catch(e){ showMsg('Napaka povezave.', true); }
    submit.disabled=false;
  });
  async function preload(){
    if(!providerId || !email) return;
    try{
      const r = await fetch('/api/provider-ratings?provider_id='+encodeURIComponent(providerId)+'&email='+encodeURIComponent(email)).then(x=>x.json());
      if(r && r.userRating){
        mount.querySelector('input[data-axis="quality"]').value = r.userRating.score_quality;
        mount.querySelector('input[data-axis="value"]').value = r.userRating.score_value;
        mount.querySelector('input[data-axis="experience"]').value = r.userRating.score_experience;
        mount.querySelector('#prComment').value = r.userRating.comment || '';
        recompute();
      }
      if(r && r.badge){ showMsg('Badge trenutno: '+r.badge, false); }
    }catch{}
  }
  function showMsg(m, bad){ const box=mount.querySelector('#prMsg'); if(!box) return; box.textContent=m; box.style.color = bad?'#d64c4c':'#0b6b4b'; }
  preload();
}

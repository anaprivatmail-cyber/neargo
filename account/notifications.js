// Simple client to call notifications prefs endpoints
import { supabase } from '/assets/supabase-client.js';

const form = document.getElementById('prefs');
const info = document.getElementById('info');
const radius = document.getElementById('radius');
const radiusLbl = document.getElementById('radiusLbl');

radius.addEventListener('input', ()=> radiusLbl.textContent = radius.value + ' km');

async function getPrefs(){
  try{
    const s = await supabase.auth.getSession();
    const email = s?.data?.session?.user?.email;
    if (!email){ info.textContent = 'Prijavite se za upravljanje obvestil.'; return; }
    const res = await fetch('/.netlify/functions/notifications-prefs-get?email='+encodeURIComponent(email));
    const j = await res.json();
    if (!j.ok) return;
    const p = j.prefs || {};
    // populate
    if (p.mode) document.querySelector(`input[name=mode][value="${p.mode}"]`).checked = true;
    if (Array.isArray(p.categories)){
      p.categories.forEach(c=>{ const cb = document.querySelector(`input[name=cat][value="${c}"]`); if(cb) cb.checked = true; });
    }
    if (p.radius_km) radius.value = p.radius_km; radiusLbl.textContent = radius.value + ' km';
    if (p.location){ try{ const m = p.location.coordinates || p.location; if (Array.isArray(m)) { document.getElementById('lng').value = m[0]; document.getElementById('lat').value = m[1]; } }catch(_){} }
    info.textContent = j.changes_left ? `Preostale menjave: ${j.changes_left} / 5` : '';
  }catch(e){ console.warn(e); }
}

form.addEventListener('submit', async (e)=>{
  e.preventDefault();
  const s = await supabase.auth.getSession();
  const email = s?.data?.session?.user?.email;
  if (!email){ info.textContent = 'Prijavite se.'; return; }
  const mode = form.mode.value;
  const cats = [...form.querySelectorAll('input[name="cat"]:checked')].map(i=>i.value).slice(0,2);
  const radius_km = Number(radius.value);
  const lat = Number(document.getElementById('lat').value) || null;
  const lng = Number(document.getElementById('lng').value) || null;
  const body = { email, mode, categories: cats, radius_km, location: (lat && lng) ? { lat, lng } : null };
  info.textContent = 'Shranjujem…';
  try{
    const res = await fetch('/.netlify/functions/notifications-prefs-upsert', { method:'POST', headers:{ 'content-type':'application/json' }, body: JSON.stringify(body) });
    const j = await res.json();
    if (j.ok){ info.textContent = `Shranjeno.`; } else { info.textContent = 'Napaka: '+(j.error||'unknown'); }
  }catch(e){ info.textContent = 'Napaka pri povezavi'; }
});

getPrefs();

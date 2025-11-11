function getEndTs(e){ const cand=e.end||e.until||e.endsAt||e.ends_at||e.finish||e.stop||e.start; const t=new Date(cand).getTime(); return Number.isFinite(t)?t:NaN; }
function qs(o){ return new URLSearchParams(o).toString(); }

export async function loadFeatured(){
  const now=Date.now(); let items=[];
  const uniq=arr=>{ const seen=new Set(); return arr.filter(e=>{ const k=((e.name||"").toLowerCase()+"|"+(e.start||"")+"|"+(e.venue?.address||"")); if(seen.has(k)) return false; seen.add(k); return true; }); };
  try{
    const paid=await fetch(`/api/provider-list?${qs({featured:1, limit:200})}`).then(r=>r.json()).then(d=>d?.results||[]).catch(()=>[]);
    const api =await fetch(`/api/search?${qs({size:200,page:0})}`).then(r=>r.json()).then(d=>d?.results||[]).catch(()=>[]);
    items=uniq([...(paid||[]), ...(api||[])]);
  }catch{}
  items=items.filter(e=> Number.isFinite(getEndTs(e)) && getEndTs(e)>=now);
  const box=document.getElementById("carousel"); box.innerHTML='';
  if(!items.length){ box.innerHTML=`<div class="card" style="color:var(--muted)">Trenutno ni izpostavljenih dogodkov.</div>`; return; }
  items.slice(0,20).forEach(e=>{
    const card=document.createElement("div"); card.className="spot"; card.style.flex="0 0 85%";
    card.innerHTML=`<img src="${(e.images&&e.images[0])||'https://picsum.photos/600/400'}" alt="" loading="lazy"><div class="meta"><b>${e.name||'Dogodek'}</b></div>`;
    box.appendChild(card);
  });
}
export function initFeatured(){
  navigator.geolocation.getCurrentPosition(
    p=>{ window.GEO=`${p.coords.latitude.toFixed(5)},${p.coords.longitude.toFixed(5)}`; loadFeatured(); },
    ()=>{ loadFeatured(); },
    { enableHighAccuracy:true, timeout:8000, maximumAge:0 }
  );
}

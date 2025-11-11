let topMap=null, topMarkers=[];
export function refreshTopMap(){
  const node=document.getElementById("map"); if(!node) return;
  if(!topMap){
    topMap=L.map("map").setView([46.05,14.51],6);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{attribution:"© OSM"}).addTo(topMap);
  }
}
export function clearMarkers(arr){ try{arr.forEach(m=>m.remove());}catch{} }
export function setMarkersOn(map, items, filtered){
  const ms=[];
  items.forEach(e=>{
    const lat=e.venue?.lat, lon=e.venue?.lon;
    if(Number.isFinite(+lat) && Number.isFinite(+lon)){
      const m=L.marker([+lat,+lon]).addTo(map);
      const id=(e.id?`ev-${String(e.id).replace(/[^a-z0-9]/gi,'')}`:`ev-${(e.name||'').toLowerCase().replace(/[^a-z0-9]/g,'')}-${(e.start||'').replace(/[^0-9]/g,'')}`).slice(0,64);
      m.bindPopup(`<a href="#${id}">${(e.name||"Dogodek").toString().slice(0,80)}</a>`);
      m.on('click',()=>{
        const el=document.getElementById(id);
        if(el){ el.scrollIntoView({behavior:"smooth", block:"start"}); el.classList.add('highlight'); setTimeout(()=>el.classList.remove('highlight'),1200); }
        else if(e.url){ window.open(e.url,'_blank','noopener'); }
      });
      ms.push(m);
    }
  });
  return ms;
}
export async function loadAllForTopMap(){
  if(!topMap) return;
  clearMarkers(topMarkers);
  try{
    const [intRes, extRes]=await Promise.all([
      fetch(`/api/provider-list?size=500&page=0`).then(r=>r.json()).catch(()=>({})),
      fetch(`/api/search?size=500&page=0`).then(r=>r.json()).catch(()=>({}))
    ]);
    const all=[...(intRes?.results||[]), ...(extRes?.results||[])];
    topMarkers=setMarkersOn(topMap, all, false);
    if(topMarkers.length){
      const g=new L.featureGroup(topMarkers);
      topMap.fitBounds(g.getBounds().pad(0.2));
    }
  }catch{}
}
export function renderMapDetail(e){
  const host=document.getElementById("mapDetail"); host.innerHTML="";
  const card=document.createElement("div"); card.className="card";
  const img=(e.images&&e.images[0])||"https://picsum.photos/600/400";
  const addr=(e.venue?.address||"");
  const gmHref=(e.venue?.lat && e.venue?.lon)
      ? `https://www.google.com/maps?q=${e.venue.lat},${e.venue.lon}`
      : (addr ? `https://www.google.com/maps?q=${encodeURIComponent(addr)}` : "");
  card.innerHTML=`
    <img src="${img}" alt="" loading="lazy" style="width:100%;height:160px;object-fit:cover;border-radius:14px 14px 0 0">
    <div class="meta" style="padding:10px">
      <b>${e.name||"Dogodek"}</b>
      <div style="color:var(--muted);font-size:13px">
        ${ gmHref ? `<a href="${gmHref}" target="_blank" rel="noopener" style="color:inherit;text-decoration:underline">📍 ${addr||'Google Maps'}</a>` : addr }
      </div>
    </div>`;
  host.appendChild(card);
  const y=host.getBoundingClientRect().top + window.pageYOffset - 64;
  window.scrollTo({top:y, behavior:"smooth"});
}
export function initMaps(){
  document.addEventListener('map:open', ()=>{ refreshTopMap(); loadAllForTopMap(); });
}

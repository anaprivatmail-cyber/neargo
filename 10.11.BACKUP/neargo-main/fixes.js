<script>
/* === NearGo 2025 — Popravki za kupon, sliko, oddajo, filtriranje, izpostavljene dogodke in markerje === */

// Pomagalne funkcije
const $ = s => document.querySelector(s);
function haversineKm(a,b){const R=6371,toRad=d=>d*Math.PI/180;const dLat=toRad(b.lat-a.lat),dLon=toRad(b.lon-a.lon);
const x=Math.sin(dLat/2)**2+Math.cos(toRad(a.lat))*Math.cos(toRad(b.lat))*Math.sin(dLon/2)**2;return 2*R*Math.asin(Math.sqrt(x));}

// 1. Pridobi koordinate iz naslova/mesta prek Nominatim (OpenStreetMap)
async function fetchLatLon(address, city) {
  try {
    const q = [address, city].filter(Boolean).join(', ');
    const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`, { headers: {"Accept-Language":"sl"} });
    const data = await res.json();
    if (data && data[0]) return { lat: +data[0].lat, lon: +data[0].lon };
  } catch (e) {
    console.warn("Geokodiranje ni uspelo:", e);
  }
  return { lat: null, lon: null };
}

// 2. Upravljanje polj kupona (PERCENT / VALUE / FREEBIE)
(function initCouponUI(){
  const kindSel=$("#couponKind"), lblP=$("#lblPercent"), lblV=$("#lblValue"), lblF=$("#lblFreebie");
  function upd(){
    const v=kindSel.value;
    lblP.style.display=v==="PERCENT"?"block":"none";
    $("#couponPercent").disabled=v!=="PERCENT";
    lblV.style.display=v==="VALUE"?"block":"none";
    $("#couponValue").disabled=v!=="VALUE";
    lblF.style.display=v==="FREEBIE"?"block":"none";
    $("#couponFreebie").disabled=v!=="FREEBIE";
  }
  if(kindSel) { kindSel.addEventListener("change",upd); upd(); }
})();

// 3. Predogled slike v obrazcu
$("#image")?.addEventListener("change",e=>{
  const f=e.target.files[0];
  if(!f) return;
  const reader=new FileReader();
  reader.onload=ev=>{
    const img=$("#imgPreview");
    img.src=ev.target.result;
    img.style.display="block";
    $("#fileName").textContent=f.name;
  };
  reader.readAsDataURL(f);
});

// 4. Oddaja dogodka (valida obvezna polja, preračuna koordinati, preveri kupon, pošlje sliko)
$("#btnSubmitEvent")?.addEventListener("click", async e=>{
  e.preventDefault();
  const msg=$("#orgMsg");
  msg.textContent="⏳ Pošiljam..."; msg.style.color="var(--muted)";
  const must=["#orgName","#orgFullName","#orgEmail","#eventName","#venue","#city2","#country","#start","#end","#category","#desc"];
  for(const sel of must){
    const el=$(sel);
    if(!el?.value.trim()){
      msg.textContent="❌ Izpolni obvezna polja z *.";
      msg.style.color="var(--bad)";
      el?.focus();
      return;
    }
  }
  // pridobi naslov & mesto za lat/lon
  const venue=$("#venue").value.trim(), city=$("#city2").value.trim();
  const coords=await fetchLatLon(venue,city);

  // pripravi payload
  const payload={
    organizer:$("#orgName").value.trim(),
    organizerFullName:$("#orgFullName").value.trim(),
    organizerEmail:$("#orgEmail").value.trim(),
    eventName:$("#eventName").value.trim(),
    venue, city, country:$("#country").value,
    start:$("#start").value,
    end:$("#end").value,
    description:$("#desc").value.trim(),
    category:$("#category").value,
    offerType:$("#offerType").value,
    featured:$("#featured")?.checked||false,
    stock:+($("#stock")?.value||0),
    venueLat:coords.lat,
    venueLon:coords.lon,
    imagePublicUrl:null
  };

  // kupon – uporabi samo aktivno polje
  if(payload.offerType==="coupon"){
    const kind=$("#couponKind").value;
    if(kind==="PERCENT") payload.couponPercentOff=+($("#couponPercent").value||0);
    if(kind==="VALUE") payload.couponValueEur=+($("#couponValue").value||0);
    if(kind==="FREEBIE") payload.couponFreebieLabel=$("#couponFreebie").value||"";
  }

  // naloži sliko v storage
  const f=$("#image")?.files?.[0];
  if(f){
    const up=new FormData(); up.append("file",f);
    try{
      const ur=await fetch("/api/provider-upload",{method:"POST",body:up}).then(x=>x.json());
      if(ur.ok) payload.imagePublicUrl=ur.url||ur.imagePublicUrl;
    }catch{
      msg.textContent="⚠️ Napaka pri nalaganju slike.";
      msg.style.color="var(--bad)";
      return;
    }
  }

  // pošlji podatke
  try{
    const res=await fetch("/api/provider-submit",{method:"POST",headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}).then(x=>x.json());
    if(res && res.ok){
      msg.textContent="✅ Dogodek oddan. E‑mail poslan.";
      msg.style.color="var(--ok)";
      setTimeout(()=>{ msg.textContent=""; },6000);
    }else{
      msg.textContent="❌ Napaka: "+(res.error||"Oddaja ni uspela.");
      msg.style.color="var(--bad)";
    }
  }catch{
    msg.textContent="❌ Strežniška napaka.";
    msg.style.color="var(--bad)";
  }
});

// 5. Popravi iskanje: filtriraj po radiju in prikaži markerje
const _oldDoSearch=window.doSearch;
window.doSearch=async function(page=0,byGeo=false){
  await _oldDoSearch(page,byGeo);
  if(!window.GEO || !window.mapSearch) return;
  const [gl,go]=GEO.split(',').map(Number), center={lat:gl,lon:go};
  const rad=+($("#radius")?.value||30);
  // odstrani stare markerje
  mapSearch.eachLayer(l=>{if(l instanceof L.Marker) mapSearch.removeLayer(l);});
  // dodaj markerje za rezultate znotraj radija
  const cards=[...document.querySelectorAll("#results .spot")];
  const markers=[];
  cards.forEach(card=>{
    const lat=+card.dataset.lat||+card.dataset.venueLat||0;
    const lon=+card.dataset.lon||+card.dataset.venueLon||0;
    if(!Number.isFinite(lat)||!Number.isFinite(lon)) return;
    const d=haversineKm(center,{lat,lon});
    if(d > rad) return;
    const name=card.querySelector("b")?.innerText||"Dogodek";
    const addr=card.querySelector(".muted")?.innerText||"";
    const id=card.id;
    const m=L.marker([lat,lon]).addTo(mapSearch);
    m.bindPopup(`<b>${name}</b><br>${addr}<br><a href="#${id}" style="color:#0077cc">Odpri kartico</a>`);
    markers.push(m);
  });
  if(markers.length){
    const g=L.featureGroup(markers);
    mapSearch.fitBounds(g.getBounds().pad(0.25));
  }
};

// 6. Izpostavljeni dogodki: filtriraj pretekle, prednost lokalnim, nato app dogodki, hitrejši karusel
window.loadFeatured=async function(){
  const now=Date.now();
  let internal=[], external=[];
  // pridobi vpisane (featured) in zunanje dogodke
  try{internal=await fetch(`/api/provider-list?featured=1&limit=200`).then(r=>r.json()).then(d=>d.results||[]);}catch{}
  try{external=await fetch(`/api/search?size=200&page=0`).then(r=>r.json()).then(d=>d.results||[]);}catch{}
  // odstrani pretečene
  const seen=new Set();
  let items=[...internal,...external].filter(e=>{
    const end=e.end?Date.parse(e.end):(e.start?Date.parse(e.start)+2*3600*1000:0);
    return Number.isFinite(end)&&end>=now;
  }).filter(e=>{
    const key=(e.name||"")+e.start;
    if(seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  // sort by distance if available
  if(window.GEO){
    const [gl,go]=GEO.split(',').map(Number);
    items.sort((a,b)=>{
      const da=(a.venue?.lat&&a.venue?.lon)?haversineKm({lat:gl,lon:go},a.venue):99999;
      const db=(b.venue?.lat&&b.venue?.lon)?haversineKm({lat:gl,lon:go},b.venue):99999;
      return da-db;
    });
  }
  // če manj kot 10, dopolni z app dogodki
  if(items.length<10){
    const need=10-items.length;
    const extras=external.filter(x=>!items.find(y=>y.id===x.id)).slice(0,need);
    items=items.concat(extras);
  }

  // prikaži karusel (max 20)
  const box=$("#carousel");
  box.innerHTML="";
  if(!items.length){
    box.innerHTML=`<div class="card muted">Trenutno ni izpostavljenih dogodkov.</div>`;
    return;
  }
  items.slice(0,20).forEach(e=>{
    const card=renderSpotCard(e);
    card.style.flex="0 0 85%";
    box.appendChild(card);
  });
  // karusel: hitrejše, gladko, brez blokiranja
  let pos=0,paused=false,speed=2.0;
  function animate(){
    if(!paused){
      pos+=speed;
      if(pos>=box.scrollWidth) pos=0;
      box.scrollLeft=pos;
    }
    requestAnimationFrame(animate);
  }
  animate();
  box.addEventListener("mouseenter",()=>paused=true);
  box.addEventListener("mouseleave",()=>paused=false);
  box.addEventListener("click",()=>{paused=true; setTimeout(()=>paused=false,1500);});
};

// 7. Inicializiraj mapSearch, če še ni
document.addEventListener("DOMContentLoaded",()=>{
  if(!window.mapSearch){
    window.mapSearch=L.map("mapSearch",{zoomSnap:0.25,zoomControl:true}).setView([46.05,14.51],7);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{attribution:"© OpenStreetMap"}).addTo(mapSearch);
  }
});
</script>

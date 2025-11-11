let pickMap, pickMarker, pickCircle, pickRadiusKm=30;
function updatePickLbl(){ const lbl=document.getElementById("pickRadiusLbl"); if(lbl) lbl.textContent=`Polmer: ${pickRadiusKm} km`; }
function openPick(){
  const modal=document.getElementById("pickModal"); modal.style.display="flex";
  setTimeout(()=>{
    if(!pickMap){
      pickMap=L.map("pickMap").setView([46.05,14.51],7);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{attribution:"© OSM"}).addTo(pickMap);
      pickMarker=L.marker([46.05,14.51],{draggable:true}).addTo(pickMap);
      pickCircle=L.circle([46.05,14.51],{radius:pickRadiusKm*1000,color:"#0bbbd6"}).addTo(pickMap);
      pickMarker.on("move",e=>{ pickCircle.setLatLng(e.latlng); });
    }
    try{ pickMap.invalidateSize(); }catch{}
  },20);
  updatePickLbl();
}
function closePick(){ const modal=document.getElementById("pickModal"); if(modal) modal.style.display="none"; }
export function initPicker(){
  document.getElementById("pickClose")?.addEventListener("click", closePick);
  document.getElementById("pickMinus")?.addEventListener("click",()=>{ pickRadiusKm=Math.max(1,pickRadiusKm-5); try{ pickCircle.setRadius(pickRadiusKm*1000);}catch{} updatePickLbl(); });
  document.getElementById("pickPlus")?.addEventListener("click",()=>{ pickRadiusKm=Math.min(50,pickRadiusKm+5); try{ pickCircle.setRadius(pickRadiusKm*1000);}catch{} updatePickLbl(); });
  document.getElementById("pickUseGPS")?.addEventListener("click",()=>navigator.geolocation.getCurrentPosition(p=>{
    const lat=p.coords.latitude, lon=p.coords.longitude;
    try{ pickMap.setView([lat,lon],11); pickMarker.setLatLng([lat,lon]); pickCircle.setLatLng([lat,lon]); }catch{}
  }));
  document.getElementById("pickApply")?.addEventListener("click",()=>{
    if(!pickMarker){ closePick(); return; }
    const {lat,lng}=pickMarker.getLatLng();
  window.GEO=`${lat.toFixed(5)},${lng.toFixed(5)}`;
    const radius=document.getElementById("radius"), radiusLbl=document.getElementById("radiusLbl");
  if(radius && radiusLbl){ radius.value=pickRadiusKm; radiusLbl.textContent=`Polmer: ${pickRadiusKm} km (premer ${pickRadiusKm*2} km)`; }
    closePick(); try{ window.doSearch?.(0,true); }catch{}
  });
  document.getElementById("pickSearch")?.addEventListener("keydown", async (e)=>{
    if(e.key!=="Enter") return;
    const q=e.target.value.trim(); if(!q) return;
    try{
      const r=await fetch(`https://nominatim.openstreetmap.org/search?${new URLSearchParams({q,format:"json",limit:1})}`,{ headers:{ "Accept-Language":"sl" }});
      const d=await r.json();
      if(d && d[0]){
        const lat=+d[0].lat, lon=+d[0].lon;
        pickMap.setView([lat,lon],11); pickMarker.setLatLng([lat,lon]); pickCircle.setLatLng([lat,lon]);
      }
    }catch{}
  });
                                                                                                                                    }

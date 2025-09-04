"use strict";

/* Helpers */
const $ = s => document.querySelector(s);
const el = (t,c)=>{const x=document.createElement(t); if(c) x.className=c; return x;};
const qs = o => new URLSearchParams(o).toString();
const euro = v => Number.isFinite(+v) ? new Intl.NumberFormat('sl-SI',{style:'currency',currency:'EUR'}).format(+v) : '';
const priceCents = v => Math.round(Number(v||0)*100);

/* Tema */
const theme=$("#theme");
const applyTheme=v=>document.body.classList.toggle("dark", v==="dark");
applyTheme(localStorage.getItem("theme")||"light");
if(theme){
  theme.checked=document.body.classList.contains("dark");
  theme.onchange=()=>{const m=theme.checked?"dark":"light"; localStorage.setItem("theme",m); applyTheme(m);};
}

/* Navigacija */
$("#btnOrganizers")?.addEventListener("click",()=> $("#orgPanel").scrollIntoView({behavior:"smooth"}));
$("#btnMap")?.addEventListener("click",()=> $("#mapPanelTop").scrollIntoView({behavior:"smooth"}));
$("#btnStart")?.addEventListener("click",()=>{ $("#searchPanel").classList.add("show"); $("#q").focus(); });
$("#btnChecker")?.addEventListener("click",()=> location.href="/checker.html");

/* Leaflet maps */
let markersTop=[], markersSearch=[];
function clearMarkers(arr){ arr.forEach(m=>m.remove()); arr.length=0; }
function setMarkersOn(mapInst, arr){
  const bag=[];
  arr.forEach(e=>{
    const lat=e.venue?.lat, lon=e.venue?.lon;
    if(Number.isFinite(lat) && Number.isFinite(lon)){
      const name=e.name||"Dogodek";
      const m=L.marker([lat,lon]).addTo(mapInst).bindPopup(`<b>${name}</b>`);
      m._event = e; bag.push(m);
    }
  });
  if(bag.length){ const g=new L.featureGroup(bag); mapInst.fitBounds(g.getBounds().pad(0.2)); }
  return bag;
}

/* Zgornji zemljevid = VSE dogodke */
const mapTop = L.map("mapTop").setView([46.05,14.51],6);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{attribution:"© OSM"}).addTo(mapTop);
async function refreshTopMap(){
  let providerAll=[], apiAll=[];
  try{ const rP = await fetch(`/api/provider-list?limit=500`); const dP = await rP.json().catch(()=>({})); providerAll = (dP&&dP.ok&&dP.results)||[]; }catch{}
  try{ const rA = await fetch(`/api/search?${qs({radiuskm:500,size:400,page:0})}`); const dA = await rA.json().catch(()=>({})); apiAll = (dA&&dA.ok&&dA.results)||[]; }catch{}
  const seen=new Set();
  const all=[...providerAll,...apiAll].filter(e=>{ const k=`${(e.name||'').toLowerCase()}|${e.start||''}`; if(seen.has(k)) return false; seen.add(k); return true; });
  clearMarkers(markersTop); markersTop=setMarkersOn(mapTop, all);
}
refreshTopMap();

/* Spodnji zemljevid = samo rezultati iskanja */
const mapSearch = L.map("mapSearch").setView([46.05,14.51],6);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{attribution:"© OSM"}).addTo(mapSearch);
function setSearchMarkers(items){ clearMarkers(markersSearch); markersSearch=setMarkersOn(mapSearch,items); }

/* Iskanje – live */
$("#radius")?.addEventListener("input",()=>{ $("#radiusLbl").textContent = `${$("#radius").value} km`; doSearch(0,false); });
document.querySelectorAll(".cat").forEach(btn=>{
  btn.addEventListener("click",()=>{

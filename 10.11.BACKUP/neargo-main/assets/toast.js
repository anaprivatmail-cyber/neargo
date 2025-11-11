export function initToast(){
  const t=document.getElementById("toast"), show=(msg,ok=true)=>{ t.textContent=msg; t.className="toast "+(ok?"ok":"bad"); t.style.display="flex"; setTimeout(()=>t.style.display="none",4000); };
  if(location.hash==="#success"){ show("Plačilo uspešno ✅ — vstopnica/kupon in račun so poslani na e-pošto.", true); history.replaceState(null,"",location.pathname+location.search); }
  if(location.hash==="#cancel"){ show("Plačilo preklicano. ❌", false); history.replaceState(null,"",location.pathname+location.search); }
  window._toast=show;
}

export function initToast(){
  const t = document.getElementById('toast');
  const show = (msg, ok=true) => {
    if(!t) return;
    t.textContent = msg; t.className = "toast " + (ok?"ok":"bad");
    t.style.display="flex"; setTimeout(()=>t.style.display="none", 4000);
  };
  window._toast = show;
  if(location.hash==="#success"){ show("Plačilo uspešno ✅ — poslano na e-pošto.", true); history.replaceState(null,"",location.pathname+location.search); }
  if(location.hash==="#cancel"){  show("Plačilo preklicano. ❌", false); history.replaceState(null,"",location.pathname+location.search); }
}

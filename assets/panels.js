export function wirePanels(){
  function showPanel(id){
    ["searchPanel","mapPanel","orgPanel","providerTermsPanel"].forEach(pid=>{
      const n=document.getElementById(pid); if(n){ n.classList.remove("show"); n.style.display="none"; }
    });
    const el=document.getElementById(id); if(!el) return;
    el.classList.add("show"); el.style.display="block";
    const h=(document.querySelector('header')?.getBoundingClientRect().height)||64;
    const y=el.getBoundingClientRect().top + window.pageYOffset - (h+10);
    window.scrollTo({top:y, behavior:"smooth"});
  }
  document.getElementById("btnStart")?.addEventListener("click",()=>showPanel("searchPanel"));
  document.getElementById("btnMap")?.addEventListener("click",()=>{ showPanel("mapPanel"); document.dispatchEvent(new CustomEvent('map:open')); });
  document.getElementById("btnCloseMap")?.addEventListener("click",()=>showPanel("searchPanel"));
  window.showPanel = showPanel;
}

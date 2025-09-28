export function initBuy(){
  document.addEventListener('click', (ev)=>{
    const btn=ev.target.closest('[data-act]'); if(!btn) return;
    // share/ics/buy logiko dodava kasneje
  }, {passive:true});
}

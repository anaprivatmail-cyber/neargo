export function initI18n(){
  const wrap=document.getElementById("langWrap"),
        menu=document.getElementById("langMenu"),
        hidden=document.getElementById("lang"),
        label=document.getElementById("langLabel");
  const SUP=[["sl","SL"],["en","EN"],["de","DE"],["hr","HR"],["it","IT"]];
  if(menu) menu.innerHTML=SUP.map(([v,t])=>`<button type="button" data-val="${v}">${t}</button>`).join("");
  if(hidden) hidden.innerHTML=SUP.map(([v,t],i)=>`<option value="${v}" ${i===0?'selected':''}>${t}</option>`).join("");
  const pref=(navigator.language||"sl").slice(0,2).toLowerCase();
  const initial=(SUP.find(([v])=>v===pref)||SUP[0])[0];
  try{ hidden.value=initial; label.textContent=initial.toUpperCase(); }catch{}
  let open=false; const setOpen=s=>{ open=(s!==undefined)?s:!open; if(menu) menu.style.display=open?"block":"none"; };
  wrap?.addEventListener("click",(e)=>{ if(!e.target.closest(".lang-menu")){ e.stopPropagation(); setOpen(); } }, {passive:true});
  document.addEventListener("click",(e)=>{ if(!wrap?.contains(e.target)) setOpen(false); }, {passive:true});
  menu?.addEventListener("click",(e)=>{
    const b=e.target.closest("button[data-val]"); if(!b) return;
    hidden.value=b.dataset.val; label.textContent=b.textContent;
    try{ localStorage.setItem("lang", b.dataset.val); }catch{}
    hidden.dispatchEvent(new Event("change",{bubbles:true}));
    setOpen(false);
  });
}

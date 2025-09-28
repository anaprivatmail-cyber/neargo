export function initTheme(){
  const btn=document.getElementById("btnThemeToggle"), icon=btn?.querySelector('#themeIcon');
  function apply(mode){ document.body.classList.toggle('dark', mode==='dark'); try{localStorage.setItem('theme',mode);}catch{}; if(icon) icon.textContent=mode==='dark'?'☀️':'🌙'; }
  apply(localStorage.getItem('theme')||'light');
  btn?.addEventListener('click',()=>apply(document.body.classList.contains('dark')?'light':'dark'),{passive:true});
}

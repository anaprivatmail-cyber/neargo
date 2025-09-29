// assets/main.js
function cacheBustValue(){ return (window.__BUILD_TS__ || String(Date.now())); }

async function loadPart(id, url){
  const host = document.getElementById(id);
  if (!host) return;
  if (id === 'topbar') host.innerHTML = ''; // čist start za header
  const sep = url.includes('?') ? '&' : '?';
  const html = await fetch(`${url}${sep}v=${encodeURIComponent(cacheBustValue())}`, { cache: 'no-cache' }).then(r=>r.text());
  host.insertAdjacentHTML('beforeend', html);
}

function syncHeaderHeight(){
  const nav = document.querySelector('header .nav');
  if (!nav) return;
  const h = nav.offsetHeight || 108;
  document.documentElement.style.setProperty('--header-h', `${h}px`);
}

document.addEventListener('DOMContentLoaded', async () => {
  // naloži samo navbar (vse ostalo v indexu ostane nedotaknjeno)
  await loadPart('topbar', '/partials/navbar.html');

  // jezikovni meni – odpiranje z .open, zapiranje ob kliku izven
  const wrap = document.getElementById('langWrap');
  const menu = document.getElementById('langMenu');
  if (wrap && menu){
    wrap.classList.remove('open'); menu.hidden = true;
    wrap.addEventListener('click', (e)=>{
      if (e.target.closest('.lang-menu')) return;
      e.stopPropagation();
      const opened = wrap.classList.toggle('open');
      menu.hidden = !opened;
    });
    document.addEventListener('click', ()=>{ wrap.classList.remove('open'); menu.hidden = true; });
  }

  // dinamična višina glave (da se vsebina začne pod njo)
  syncHeaderHeight();
  if ('ResizeObserver' in window){
    const nav = document.querySelector('header .nav');
    if (nav) new ResizeObserver(syncHeaderHeight).observe(nav);
  }
  window.addEventListener('resize', syncHeaderHeight, { passive:true });
  setTimeout(syncHeaderHeight, 150);
});

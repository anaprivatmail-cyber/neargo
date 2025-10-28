// ========== Nea Assistantka: prikaz/skritje in osnovni chat handler ==========
document.addEventListener('DOMContentLoaded', function() {
  var neaBtn = document.getElementById('neaBtn');
  var neaModal = document.getElementById('neaModal');
  var neaClose = document.getElementById('neaClose');
  var neaChatForm = document.getElementById('neaChatForm');
  var neaInput = document.getElementById('neaInput');
  var neaChatLog = document.getElementById('neaChatLog');
  if (neaBtn && neaModal) {
    neaBtn.addEventListener('click', function() {
      neaModal.style.display = 'flex';
      setTimeout(function(){ neaInput && neaInput.focus(); }, 200);
    });
  }
  if (neaClose && neaModal) {
    neaClose.addEventListener('click', function() {
      neaModal.style.display = 'none';
    });
  }
  if (neaChatForm && neaInput && neaChatLog) {
    neaChatForm.addEventListener('submit', function(e) {
      e.preventDefault();
      var msg = neaInput.value.trim();
      if (!msg) return;
      // Prikaži uporabnikov vnos v chatu
      var userMsg = document.createElement('div');
      userMsg.className = 'nea-chat-msg user';
      userMsg.textContent = msg;
      neaChatLog.appendChild(userMsg);
      neaInput.value = '';
      neaChatLog.scrollTop = neaChatLog.scrollHeight;
      // Prikaži "Nea razmišlja..."
      var neaMsg = document.createElement('div');
      neaMsg.className = 'nea-chat-msg nea';
      neaMsg.textContent = 'Nea razmišlja ...';
      neaChatLog.appendChild(neaMsg);
      neaChatLog.scrollTop = neaChatLog.scrollHeight;
      // TODO: Klic AI ali iskalne funkcije za odgovor
      setTimeout(function(){
        neaMsg.textContent = 'To je demo odgovor. (Integracija AI/iskanja v naslednjem koraku)';
        neaChatLog.scrollTop = neaChatLog.scrollHeight;
      }, 1200);
    });
  }
});
// assets/main.js
function cacheBust(){ return (window.__BUILD_TS__ || String(Date.now())); }

async function loadPart(id, url){
  const host = document.getElementById(id);
  if (!host) return;
  if (id === 'topbar') host.innerHTML = ''; // čist header
  const sep = url.includes('?') ? '&' : '?';
  const html = await fetch(`${url}${sep}v=${encodeURIComponent(cacheBust())}`, {cache:'no-cache'}).then(r=>r.text());
  host.insertAdjacentHTML('beforeend', html);
}

function syncHeaderHeight(){
  const nav = document.querySelector('header .nav');
  if (!nav) return;
  const h = nav.offsetHeight || 108;
  document.documentElement.style.setProperty('--header-h', `${h}px`);
}

document.addEventListener('DOMContentLoaded', async () => {
  // 1) naložimo vse dele v pravem vrstnem redu
  await loadPart('topbar', '/partials/navbar.html');
  await loadPart('app',    '/partials/hero.html');
  await loadPart('app',    '/partials/search.html');
  await loadPart('app',    '/partials/map.html');
  await loadPart('app',    '/organizers.html');
  await loadPart('app',    '/partials/footer-modals.html');

  // 2) jezikovni meni – odpiranje z .open, zapiranje ob kliku izven
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

  // 3) višina glave
  syncHeaderHeight();
  if ('ResizeObserver' in window){
    const nav = document.querySelector('header .nav');
    if (nav) new ResizeObserver(syncHeaderHeight).observe(nav);
  }
  window.addEventListener('resize', syncHeaderHeight, {passive:true});
  setTimeout(syncHeaderHeight, 150);

  // 4) zaženi tvoj app (vsa logika, ki je bila prej v indexu)
  if (typeof window.appInit === 'function') window.appInit();
});

// assets/header-account.js
// Lightweight header account dropdown that shows a short menu when clicking the avatar
// Supports both `#btnAccount` and legacy `#btnMine` anchors.

(function(){
  'use strict';

  const MENU_ITEMS = [
    { id: 'mi-rewards', label: 'Nagrade', url: '/my.html#rewardsHistory', icon: '🎁' },
    { id: 'mi-store', label: 'Unovči točke', url: '/my.html#pointsStore', icon: '🏬' },
    { id: 'mi-progress', label: 'Napredek do nagrade', url: '/my.html#pointsProgressWrap', icon: '📈' },
    { id: 'mi-my', label: 'Moje vstopnice & kuponi', url: '/my.html', icon: '🎟️' },
    { id: 'mi-tickets', label: 'Vstopnice', url: '/my.html#tickets', icon: '🎫' },
    { id: 'mi-coupons', label: 'Kuponi', url: '/my.html#coupons', icon: '🏷️' },
    { id: 'mi-purchases', label: 'Zgodovina nakupov', url: '/my.html#purchases', icon: '🧾' }
  ];

  async function getSupabase(){
    if (window.supabase) return window.supabase;
    try{ const mod = await import('/assets/supabase-client.js'); return mod.supabase; }catch(e){ return null; }
  }

  function buildMenu(){
    let menu = document.getElementById('accountMenu');
    if (menu) return menu;
    menu = document.createElement('div');
    menu.id = 'accountMenu';
    menu.className = 'account-menu';
    menu.style.position = 'absolute';
    menu.style.minWidth = '220px';
    menu.style.background = 'var(--card)';
    menu.style.border = '1px solid var(--chipborder)';
    menu.style.borderRadius = '12px';
    menu.style.boxShadow = '0 8px 24px rgba(0,0,0,0.12)';
    menu.style.padding = '6px';
    menu.style.zIndex = 2000;
    menu.hidden = true;

    MENU_ITEMS.forEach(it=>{
      const a = document.createElement('a');
      a.id = it.id; a.href = it.url; a.className = 'account-menu-item';
      a.style.display = 'flex'; a.style.alignItems = 'center'; a.style.gap = '10px'; a.style.padding = '8px 10px'; a.style.borderRadius='8px';
      a.style.color = 'var(--text)'; a.style.textDecoration='none';
      a.innerHTML = `<span style="font-size:18px">${it.icon}</span><span style="font-weight:800">${it.label}</span>`;
      menu.appendChild(a);
    });

    document.body.appendChild(menu);
    return menu;
  }

  async function render(){
    const supabase = await getSupabase();
    const sessionRes = await (supabase?.auth?.getSession ? supabase.auth.getSession() : Promise.resolve({ data: { session: null } }));
    const isLoggedIn = !!sessionRes?.data?.session?.user?.id;
    console.debug('[header-account] render()', { isLoggedIn });
    const btn = document.getElementById('btnAccount') || document.getElementById('btnMine');
    const menu = buildMenu();
    if (!btn) { console.debug('[header-account] no button found (#btnAccount or #btnMine)'); return; }

    // Always attach the click handler so the menu can be tested even when
    // the user isn't logged in. If not logged in, clicking a menu link
    // will redirect to the login flow.

    btn.setAttribute('aria-haspopup','true');
    btn.setAttribute('aria-expanded', 'false');

    // Capture-phase handler: runs before other click handlers and stops
    // propagation so other scripts (e.g. app.js) can't override the toggle.
    function __neargo_avatar_capture_handler(ev){
      try{ ev.preventDefault(); ev.stopPropagation(); }catch(_){ }
      console.debug('[header-account] avatar clicked (capture), menu.hidden before:', menu.hidden);
      const rect = btn.getBoundingClientRect();
      menu.style.top = (rect.bottom + 6) + 'px';
      const preferredLeft = rect.left;
      const maxLeft = Math.max(8, window.innerWidth - (menu.offsetWidth || 240) - 8);
      menu.style.left = Math.min(preferredLeft, maxLeft) + 'px';
      menu.style.right = 'auto';
      menu.hidden = !menu.hidden;
      btn.setAttribute('aria-expanded', String(!menu.hidden));
      console.debug('[header-account] menu.hidden after (capture):', menu.hidden);
    }
    btn.addEventListener('click', __neargo_avatar_capture_handler, { capture: true });
    // Reposition the menu each time the user clicks the avatar (handles scroll/resize)
    btn.addEventListener('click', (e)=>{
      e.preventDefault();
      console.debug('[header-account] avatar clicked, menu.hidden before:', menu.hidden);
  const rect = btn.getBoundingClientRect();
  // position menu under the button using left/top (more reliable across layouts)
  menu.style.top = (rect.bottom + 6) + 'px';
  // Align menu left edge with button's left edge, but ensure it doesn't overflow right edge
  const preferredLeft = rect.left;
  const maxLeft = Math.max(8, window.innerWidth - (menu.offsetWidth || 240) - 8);
  menu.style.left = Math.min(preferredLeft, maxLeft) + 'px';
  // Clear right in case it was set previously
  menu.style.right = 'auto';
      menu.hidden = !menu.hidden;
      btn.setAttribute('aria-expanded', String(!menu.hidden));
      console.debug('[header-account] menu.hidden after:', menu.hidden);
    });

    // Intercept clicks on menu links when not logged in so we can direct
    // users to the login flow instead of navigating away.
    menu.addEventListener('click', (e)=>{
      const a = e.target.closest('a');
      if (!a) return;
      if (!isLoggedIn){
        e.preventDefault();
        if (window.redirectToLogin) {
          try{ window.redirectToLogin({ action: 'points', url: a.href }); }catch(_){ location.href = '/login.html'; }
        } else if (window.Auth) {
          try{ Auth.open(); }catch(_){ location.href = '/login.html'; }
        } else {
          location.href = '/login.html';
        }
      }
    });

    // Click outside to close
    document.addEventListener('click', (e)=>{ if (!menu.contains(e.target) && !btn.contains(e.target)) { menu.hidden = true; btn.setAttribute('aria-expanded','false'); } });
  }

  document.addEventListener('DOMContentLoaded', ()=>{ render(); });
  (async ()=>{ const s = await getSupabase(); s?.auth?.onAuthStateChange && s.auth.onAuthStateChange(()=>render()); })();

})();

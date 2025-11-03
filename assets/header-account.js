// assets/header-account.js — polished, accessible account dropdown
// Features:
// - Injects scoped styles for a clean dropdown
// - Inline SVG icons for consistent look
// - Keyboard navigation (ArrowUp/Down, Enter, Escape)
// - Uses Supabase client when available for sign-out, falls back to logout endpoint
// - Works with #btnAccount or legacy #btnMine
console.debug('[header-account] module loaded');

(function(){
  'use strict';

  // Inline SVG icons (simple, compact)
  const ICONS = {
    user: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 12c2.761 0 5-2.239 5-5s-2.239-5-5-5-5 2.239-5 5 2.239 5 5 5z" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 20c0-3.313 2.687-6 6-6h4c3.313 0 6 2.687 6 6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    gift: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M20 12v8a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M12 12v9" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M12 3l1.5 3 3-1.5-1.5 3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    bell: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M15 17h5l-1.403-1.403A2.997 2.997 0 0 1 18 13V10a6 6 0 1 0-12 0v3c0 .737-.293 1.44-.813 1.97L4 17h5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    edit: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3 21v-3.75L14.81 5.44a2 2 0 0 1 2.83 0l1.92 1.92a2 2 0 0 1 0 2.83L7.75 21H3z" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    door: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3 21h18" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M7 21V7a2 2 0 0 1 2-2h6v16" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M15 11a1 1 0 1 1-2 0 1 1 0 0 1 2 0z" fill="currentColor"/></svg>'
  };

  const MENU_ITEMS = [
    { id: 'mi-my', label: 'Moje', url: '/my.html', icon: ICONS.user },
    { id: 'mi-rewards', label: 'Nagrade', url: '/my.html#rewardsHistory', icon: ICONS.gift },
    { id: 'mi-premium', label: 'Premium obvestila', url: '/premium.html#earlyNotifySection', icon: ICONS.bell },
    { id: 'mi-edit', label: 'Uredi profil', url: '/my.html#profile', icon: ICONS.edit },
    { id: 'mi-signout', label: 'Odjava', action: 'signout', icon: ICONS.door }
  ];

  function injectStyles(){
    if (document.getElementById('account-menu-styles')) return;
    const css = `
      .account-menu{position:absolute; min-width:220px; background:var(--card); border:1px solid var(--chipborder); border-radius:12px; box-shadow:0 8px 30px rgba(0,0,0,.12); padding:6px; z-index:2200; font-weight:800}
      .account-menu .account-menu-item{display:flex; align-items:center; gap:10px; padding:10px 12px; border-radius:8px; color:var(--text); text-decoration:none}
      .account-menu .account-menu-item:focus, .account-menu .account-menu-item:hover{outline:none; background:rgba(11,187,214,.06)}
      .account-menu .account-menu-item svg{flex:0 0 20px; height:20px}
      @media (max-width:520px){ .account-menu{min-width:180px} }
    `;
    const s = document.createElement('style'); s.id = 'account-menu-styles'; s.appendChild(document.createTextNode(css)); document.head.appendChild(s);
  }

  async function getSupabase(){
    if (window.supabase) return window.supabase;
    try{ const mod = await import('/assets/supabase-client.js'); return mod.supabase; }catch(e){ console.warn('[header-account] supabase import failed', e); return null; }
  }

  function createMenu(){
    let menu = document.getElementById('accountMenu');
    if (menu) return menu;
    injectStyles();
    menu = document.createElement('div');
    menu.id = 'accountMenu';
    menu.className = 'account-menu';
    menu.setAttribute('role','menu');
    menu.hidden = true;

    MENU_ITEMS.forEach(it=>{
      const a = document.createElement('a');
      a.href = it.url || '#';
      a.id = it.id || '';
      a.className = 'account-menu-item';
      a.setAttribute('role','menuitem');
      a.setAttribute('tabindex','-1');
      a.dataset.action = it.action || '';
      a.innerHTML = `<span aria-hidden="true">${it.icon || ''}</span><span style="font-weight:800">${it.label}</span>`;
      menu.appendChild(a);
    });

    document.body.appendChild(menu);
    return menu;
  }

  function position(menu, anchor){
    const rect = anchor.getBoundingClientRect();
    menu.style.top = (rect.bottom + 8 + window.scrollY) + 'px';
    const preferredLeft = rect.left + window.scrollX;
    const maxLeft = Math.max(8, document.documentElement.clientWidth - (menu.offsetWidth || 240) - 8 + window.scrollX);
    menu.style.left = Math.min(preferredLeft, maxLeft) + 'px';
  }

  async function signOutSequence(){
    const supabase = await getSupabase();
    try{
      if (supabase?.auth?.signOut){ await supabase.auth.signOut(); window.location.reload(); return; }
    }catch(e){ console.warn('[header-account] supabase signOut failed', e); }
    // Fallback to logout endpoint
    try{ window.location.href = '/.netlify/functions/logout'; }catch(e){ console.warn('logout redirect failed', e); }
  }

  async function render(){
    const supabase = await getSupabase();
    const sessionRes = await (supabase?.auth?.getSession ? supabase.auth.getSession() : Promise.resolve({ data: { session: null } }));
    const isLoggedIn = !!sessionRes?.data?.session?.user?.id;
    console.debug('[header-account] render()', { isLoggedIn });

    const btn = document.getElementById('btnAccount') || document.getElementById('btnMine');
    if (!btn){ console.debug('[header-account] no avatar button (#btnAccount or #btnMine)'); return; }

    const menu = createMenu();
    btn.setAttribute('aria-haspopup','true');
    btn.setAttribute('aria-expanded','false');

    // Toggle function
    const toggle = (show) => {
      if (!menu) return;
      menu.hidden = !show;
      btn.setAttribute('aria-expanded', String(show));
      if (show){ // focus first item
        const first = menu.querySelector('[role="menuitem"]');
        first && first.setAttribute('tabindex','0') && first.focus();
      } else {
        // reset tabindex
        menu.querySelectorAll('[role="menuitem"]').forEach(n=>n.setAttribute('tabindex','-1'));
      }
    };

    // Primary click handler (capture to beat other handlers)
    function onAvatarClick(ev){
      try{ ev.preventDefault(); ev.stopPropagation(); }catch(_){ }
      const willOpen = menu.hidden === true;
      position(menu, btn);
      toggle(willOpen);
    }
    btn.addEventListener('click', onAvatarClick, { capture:true });

    // Click on menu items
    menu.addEventListener('click', async (e)=>{
      const a = e.target.closest('[role="menuitem"]');
      if (!a) return;
      const action = a.dataset.action;
      if (action === 'signout'){
        e.preventDefault();
        await signOutSequence();
        return;
      }
      // If not logged in, redirect to login first
      if (!isLoggedIn){ e.preventDefault(); try{ window.redirectToLogin ? window.redirectToLogin({ action:'nav', url: a.href }) : (location.href='/login.html'); }catch(_){ location.href='/login.html'; } return; }
      // allow navigation otherwise
    });

    // Keyboard navigation inside the menu
    menu.addEventListener('keydown', (e)=>{
      const items = Array.from(menu.querySelectorAll('[role="menuitem"]'));
      const idx = items.indexOf(document.activeElement);
      if (e.key === 'ArrowDown'){ e.preventDefault(); const next = items[(idx+1)%items.length]; next.focus(); }
      else if (e.key === 'ArrowUp'){ e.preventDefault(); const prev = items[(idx-1+items.length)%items.length]; prev.focus(); }
      else if (e.key === 'Escape'){ toggle(false); btn.focus(); }
      else if (e.key === 'Enter'){ document.activeElement && document.activeElement.click(); }
    });

    // Close when clicking outside
    document.addEventListener('click', (e)=>{ if (!menu.contains(e.target) && !btn.contains(e.target)) { toggle(false); } });

    // Fallback onclick for older handlers
    try{ btn.onclick = (e)=>{ try{ e.preventDefault(); }catch(_){ } position(menu, btn); toggle(menu.hidden === true); }; }catch(_){ }

    // Watch auth changes to re-render state if needed
    try{ if (supabase?.auth?.onAuthStateChange) supabase.auth.onAuthStateChange(()=>render()); }catch(_){ }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', render); else setTimeout(render,0);

})();

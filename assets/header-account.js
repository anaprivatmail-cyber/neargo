// assets/header-account.js
// Account dropdown for the header avatar. Shows quick links with icons and handles Supabase sign-out.

(function(){
  'use strict';

  const STYLE_ID = 'account-menu-styles';
  const MENU_CORE = [
    { id: 'mi-dashboard', label: 'Moje vstopnice & kuponi', url: '/my.html', icon: '�️' },
    { id: 'mi-rewards', label: 'Točke & nagrade', url: '/account/rewards.html', icon: '�' },
    { id: 'mi-favourites', label: 'Najljubše', url: '/account/favorites.html', icon: '⭐' },
    { id: 'mi-notifications', label: 'Obvestila', url: '/account/notifications.html', icon: '🔔' },
    { id: 'mi-inbox', label: 'Sporočila', url: '/account/inbox.html', icon: '💬' },
    { id: 'mi-account', label: 'Profil & nastavitve', url: '/account/account.html', icon: '⚙️' }
  ];
  const MENU_ORGANIZER = { id: 'mi-organizers', label: 'Za organizatorje', url: '/organizers.html', icon: '🛠️' };

  const state = {
    menu: null,
    btn: null,
    supabase: null,
    supabasePromise: null,
    session: null,
    observer: null,
    globalBound: false
  };

  const STYLE_CSS = `
.account-menu{position:absolute;min-width:240px;max-width:320px;background:var(--card,#fff);border:1px solid var(--chipborder,#cfe1ee);border-radius:16px;box-shadow:0 18px 38px rgba(10,35,55,0.14);padding:8px;z-index:2200;font-family:inherit;color:var(--text,#0b1b2b);}
.account-menu[hidden]{display:none;}
.account-menu__header{display:flex;align-items:center;gap:12px;padding:10px 12px 12px;border-bottom:1px solid rgba(11,30,60,0.08);}
.account-menu__avatar{width:44px;height:44px;border-radius:14px;background:linear-gradient(135deg,#0bbbd6,#7de3f0);color:#082f3f;font-weight:900;font-size:18px;display:flex;align-items:center;justify-content:center;}
.account-menu__user{flex:1;min-width:0;}
.account-menu__name{font-weight:900;font-size:15px;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.account-menu__email{font-size:12px;color:var(--muted,#5b6b7b);margin-top:2px;word-break:break-all;}
.account-menu__meta{font-size:12px;font-weight:800;color:var(--primary,#0bbbd6);margin-top:4px;}
.account-menu__meta--premium{color:#d97706;}
.account-menu__list{display:flex;flex-direction:column;padding:6px 2px;}
.account-menu__item{display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:12px;color:inherit;text-decoration:none;font-weight:750;transition:background .12s ease,transform .12s ease;}
.account-menu__item:hover,.account-menu__item:focus{background:rgba(11,187,214,0.12);outline:none;transform:translateX(2px);}
.account-menu__icon{font-size:18px;width:24px;text-align:center;flex:0 0 24px;}
.account-menu__label{flex:1;display:flex;align-items:center;justify-content:space-between;gap:10px;}
.account-menu__badge{font-size:11px;font-weight:800;padding:2px 8px;border-radius:999px;background:rgba(11,187,214,0.15);color:var(--primary,#0bbbd6);}
.account-menu__footer{padding:4px;}
.account-menu__signout{width:100%;display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:12px;border:0;background:none;font-weight:800;color:#d64c4c;cursor:pointer;transition:background .12s ease,transform .12s ease;}
.account-menu__signout:hover,.account-menu__signout:focus{background:rgba(214,76,76,0.12);outline:none;transform:translateX(2px);}
@media(max-width:640px){.account-menu{left:16px !important;right:16px !important;width:auto;min-width:0;}}
`;

  function injectStyles(){
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = STYLE_CSS;
    document.head.appendChild(style);
  }

  async function getSupabase(){
    if (state.supabase) return state.supabase;
    if (window.supabase){ state.supabase = window.supabase; return state.supabase; }
    if (!state.supabasePromise){
      state.supabasePromise = import('/assets/supabase-client.js').then(mod=>mod.supabase).catch(()=>null);
    }
    state.supabase = await state.supabasePromise;
    return state.supabase;
  }

  async function refreshSession(){
    const supabase = await getSupabase();
    if (supabase?.auth?.getSession){
      try{
        const { data } = await supabase.auth.getSession();
        state.session = data?.session || null;
      }catch{
        state.session = null;
      }
    }
    return state.session;
  }


  function fallbackIdentity(){
    return {
      email: localStorage.getItem('user_email') || '',
      name: localStorage.getItem('user_name') || ''
    };
  }

  function resolvePoints(){
    if (typeof window !== 'undefined' && Number.isFinite(window.MY_POINTS)) return Number(window.MY_POINTS);
    const badge = document.getElementById('pointsBadge');
    if (badge){
      const parsed = parseInt(badge.textContent, 10);
      if (!Number.isNaN(parsed)) return parsed;
    }
    const stored = localStorage.getItem('ng_points');
    const parsedStored = stored ? parseInt(stored, 10) : NaN;
    return Number.isNaN(parsedStored) ? null : parsedStored;
  }

  function resolveIdentity(){
    const sessionUser = state.session?.user || null;
    const fallback = fallbackIdentity();
    const email = (sessionUser?.email || fallback.email || '').trim();
    const metadataName = sessionUser?.user_metadata?.full_name
      || sessionUser?.user_metadata?.name
      || sessionUser?.user_metadata?.display_name
      || '';
    const emailName = email ? email.split('@')[0] : '';
    const name = (metadataName || fallback.name || emailName || '').trim();
    return {
      email,
      name,
      premium: typeof window !== 'undefined' && window.IS_PREMIUM === true,
      points: resolvePoints()
    };
  }

  function hasIdentity(identity){
    return !!(state.session?.user?.id || identity.email);
  }

  function initials(identity){
    const source = identity.name || identity.email;
    if (!source) return '🙂';
    const parts = source.trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return (source[0] || '🙂').toUpperCase();
    if (parts.length === 1) return parts[0].substring(0,2).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }

  function buildMenuItems(identity){
    const items = MENU_CORE.map(it=>({ ...it }));
    // Only include the premium menu item for users with an identity (logged in).
    // For unauthenticated users we will show a separate header-level Premium CTA.
    if (identity?.email) {
      const premiumItem = identity.premium
        ? { id: 'mi-premium', label: 'Premium aktivno', url: '/premium.html', icon: '💎', badge: 'AKTIVNO' }
        : { id: 'mi-premium', label: 'Postani Premium', url: '/premium.html', icon: '💎', badge: 'Novo' };
      items.splice(1, 0, premiumItem);
    }
    items.push({ ...MENU_ORGANIZER });
    return items;
  }

  // Toggle header-level Premium CTA visibility based on auth state.
  function updateHeaderPremiumVisibility(){
    const hp = document.getElementById('headerPremiumBtn');
    const existingGlobal = document.getElementById('btnPremiumTop') || document.getElementById('btnPremium');
    // If a global premium button exists in the page, do nothing.
    if (existingGlobal) {
      if (hp) hp.remove();
      return;
    }
    const identity = resolveIdentity();
    const loggedIn = hasIdentity(identity);
    if (!hp){
      return; // nothing to toggle if not injected
    }
    // Show the header premium CTA only for unauthenticated users
    hp.style.display = loggedIn ? 'none' : '';
  }

  function buildMenu(identity){
    injectStyles();
    let { menu } = state;
    if (!menu){
      menu = document.createElement('div');
      menu.id = 'accountMenu';
      menu.className = 'account-menu';
      menu.setAttribute('role', 'menu');
      document.body.appendChild(menu);
      state.menu = menu;
    }

    menu.innerHTML = '';

    const header = document.createElement('div');
    header.className = 'account-menu__header';

    const avatar = document.createElement('div');
    avatar.className = 'account-menu__avatar';
    avatar.textContent = initials(identity);

    const userWrap = document.createElement('div');
    userWrap.className = 'account-menu__user';

    const nameEl = document.createElement('div');
    nameEl.className = 'account-menu__name';
    nameEl.textContent = identity.name || 'Moj račun';

    const emailEl = document.createElement('div');
    emailEl.className = 'account-menu__email';
    emailEl.textContent = identity.email || 'Dodaj e-pošto';

    userWrap.appendChild(nameEl);
    userWrap.appendChild(emailEl);

    if (identity.points !== null && identity.points !== undefined){
      const points = document.createElement('div');
      points.className = 'account-menu__meta';
      points.textContent = `${identity.points} točk`;
      userWrap.appendChild(points);
    }

    if (identity.premium){
      const premium = document.createElement('div');
      premium.className = 'account-menu__meta account-menu__meta--premium';
      premium.textContent = 'Premium aktivno';
      userWrap.appendChild(premium);
    }

    header.appendChild(avatar);
    header.appendChild(userWrap);
    menu.appendChild(header);

    const list = document.createElement('div');
    list.className = 'account-menu__list';
    buildMenuItems(identity).forEach(item => {
      const link = document.createElement('a');
      link.id = item.id;
      link.href = item.url;
      link.className = 'account-menu__item';
      link.setAttribute('role', 'menuitem');
      link.innerHTML = `\n        <span class="account-menu__icon">${item.icon}</span>\n        <span class="account-menu__label">${item.label}${item.badge ? `<span class="account-menu__badge">${item.badge}</span>` : ''}</span>`;
      list.appendChild(link);
    });
    menu.appendChild(list);

    const footer = document.createElement('div');
    footer.className = 'account-menu__footer';
    const signout = document.createElement('button');
    signout.type = 'button';
    signout.className = 'account-menu__signout';
    signout.innerHTML = '<span class="account-menu__icon">🚪</span><span class="account-menu__label">Odjava</span>';
    signout.addEventListener('click', handleSignOut, { once: true });
    footer.appendChild(signout);
    menu.appendChild(footer);

    menu.hidden = true;
    return menu;
  }

  function reposition(){
    if (!state.menu || !state.btn || state.menu.hidden) return;
    const rect = state.btn.getBoundingClientRect();
    const preferredWidth = state.menu.offsetWidth || 260;
    const scrollX = window.pageXOffset || window.scrollX || 0;
    const scrollY = window.pageYOffset || window.scrollY || 0;
    const maxLeft = Math.max(16, window.innerWidth - preferredWidth - 16);
    const left = Math.min(Math.max(16, rect.left + scrollX), maxLeft);
    state.menu.style.left = `${left}px`;
    state.menu.style.top = `${rect.bottom + scrollY + 8}px`;
  }

  function openMenu(){
    if (!state.menu || !state.btn) return;
    state.menu.hidden = false;
    state.btn.setAttribute('aria-expanded', 'true');
    reposition();
    bindGlobal();
    requestAnimationFrame(()=>{
      const first = state.menu.querySelector('.account-menu__item');
      if (first) first.focus({ preventScroll: true });
    });
  }

  function closeMenu(){
    if (!state.menu || state.menu.hidden) return;
    state.menu.hidden = true;
    state.btn?.setAttribute('aria-expanded', 'false');
    unbindGlobal();
  }

  function toggleMenu(){
    if (!state.menu) return;
    if (state.menu.hidden) openMenu(); else closeMenu();
  }

  function handleOutsideClick(e){
    if (!state.menu || state.menu.hidden) return;
    if (state.menu.contains(e.target) || state.btn?.contains(e.target)) return;
    closeMenu();
  }

  function handleKeydown(e){
    if (e.key === 'Escape'){ closeMenu(); state.btn?.focus({ preventScroll: true }); }
  }

  function handleViewportChange(){
    reposition();
  }

  function bindGlobal(){
    if (state.globalBound) return;
    document.addEventListener('click', handleOutsideClick);
    document.addEventListener('keydown', handleKeydown);
    window.addEventListener('resize', handleViewportChange, { passive: true });
    window.addEventListener('scroll', handleViewportChange, { passive: true });
    state.globalBound = true;
  }

  function unbindGlobal(){
    if (!state.globalBound) return;
    document.removeEventListener('click', handleOutsideClick);
    document.removeEventListener('keydown', handleKeydown);
    window.removeEventListener('resize', handleViewportChange);
    window.removeEventListener('scroll', handleViewportChange);
    state.globalBound = false;
  }

  async function handleSignOut(){
    closeMenu();
    try{
      const supabase = await getSupabase();
      await supabase?.auth?.signOut?.();
    }catch{}
    localStorage.removeItem('user_email');
    localStorage.removeItem('user_token');
    localStorage.removeItem('user_name');
    localStorage.removeItem('ng_points');
    window.location.href = '/login.html';
  }

  function triggerLogin(){
    if (window.Auth && typeof window.Auth.open === 'function'){
      window.Auth.open();
    }else{
      window.location.href = '/login.html';
    }
  }

  async function onButtonClick(event){
    // Show menu for everyone. If not logged in, show fallback identity and
    // replace the sign-out control with a login action.
    event.preventDefault();
    // Prevent other click handlers (e.g. app.js) from intercepting this click
    // and showing an upgrade/login prompt. stopImmediatePropagation ensures
    // our behavior takes precedence.
    if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
    await refreshSession();
    const identity = resolveIdentity();
    const loggedIn = hasIdentity(identity);
    buildMenu(identity);

    // After building the menu we can adjust the footer action for unauthenticated users
    // so they see a "Prijava" action instead of "Odjava".
    if (!loggedIn && state.menu){
      const signout = state.menu.querySelector('.account-menu__signout');
      if (signout){
        // clear previously bound handlers and set login trigger
        signout.replaceWith((() => {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'account-menu__signout';
          btn.innerHTML = '<span class="account-menu__icon">🔐</span><span class="account-menu__label">Prijava / Registracija</span>';
          btn.addEventListener('click', function(){ closeMenu(); triggerLogin(); });
          return btn;
        })());
      }
    }

    toggleMenu();
  }

  function bindButton(button){
    if (!button || button.dataset.accountMenuBound) return;
    state.btn = button;
    button.dataset.accountMenuBound = '1';
    button.setAttribute('aria-haspopup', 'true');
    button.setAttribute('aria-expanded', 'false');
    button.addEventListener('click', onButtonClick);
  }

  function observeButton(){
    const existing = document.getElementById('btnAccount') || document.getElementById('btnMine');
    if (existing){
      bindButton(existing);
      return;
    }
    if (state.observer) return;
    state.observer = new MutationObserver(()=>{
      const candidate = document.getElementById('btnAccount') || document.getElementById('btnMine');
      if (candidate){
        bindButton(candidate);
        state.observer.disconnect();
        state.observer = null;
      }
    });
    state.observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  // If a page doesn't include the account button in the static header,
  // inject a minimal avatar button into the `.nav` container so the
  // menu can bind everywhere without editing each HTML file.
  function ensureAccountButton(){
    if (document.getElementById('btnAccount') || document.getElementById('btnMine')) return;
    const nav = document.querySelector('.nav');
    if (!nav) return;
    try{
      const a = document.createElement('a');
      a.className = 'pill';
      a.id = 'btnMine';
      a.href = '#';
      a.setAttribute('role','button');
      a.setAttribute('aria-haspopup','true');
      a.setAttribute('aria-expanded','false');
      a.title = 'Moje vstopnice & kuponi';
      a.style.marginLeft = 'auto';
      a.style.display = 'inline-flex';
      a.style.alignItems = 'center';
      a.style.gap = '6px';
      a.style.padding = '6px 10px';
      a.style.fontSize = '18px';
      a.innerHTML = '<span style="font-size:20px;vertical-align:middle;">👤</span>' +
                    '<span id="pointsBadge" class="badge" style="margin-left:4px;display:none;font-size:11px;">0</span>';
      nav.appendChild(a);
      // If there is no global premium CTA, inject a small Premium button next to avatar
      if (!document.getElementById('btnPremiumTop') && !document.getElementById('headerPremiumBtn')){
        const p = document.createElement('a');
        p.id = 'headerPremiumBtn';
        p.className = 'pill premium-badge';
        p.href = '/premium.html';
        p.textContent = 'Premium';
        p.style.marginLeft = '8px';
        // insert after avatar
        nav.appendChild(p);
      }
    }catch(e){/* ignore injection errors */}
  }

  async function watchAuth(){
    const supabase = await getSupabase();
    if (supabase?.auth?.onAuthStateChange){
      supabase.auth.onAuthStateChange((_event, session)=>{
        state.session = session || null;
        if (!session?.user) closeMenu();
        // update header CTA visibility when auth state changes
        try{ updateHeaderPremiumVisibility(); }catch(e){}
      });
    }
  }

  function boot(){
    injectStyles();
    ensureAccountButton();
    observeButton();
    // Refresh session once and then update header premium visibility
    refreshSession().then(()=>{
      updateHeaderPremiumVisibility();
    }).catch(()=>{
      updateHeaderPremiumVisibility();
    });
    watchAuth();
  }

  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', boot);
  }else{
    boot();
  }

})();

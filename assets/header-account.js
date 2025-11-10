// assets/header-account.js
// Account dropdown for the header avatar. Shows quick links with icons and handles Supabase sign-out.

(function(){
  'use strict';

  try{ window.__header_account_loaded = true; }catch(e){}

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
  const DEFAULT_LOGIN_REDIRECT = '/';

  const state = {
    menu: null,
    btn: null,
    supabase: null,
    supabasePromise: null,
    session: null,
    observer: null,
    globalBound: false,
    docBound: false,
    logoutNotice: false,
    focusLogin: false
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
.account-menu__signout--login{color:var(--primary,#0bbbd6);}
.account-menu__signout--login:hover,.account-menu__signout--login:focus{background:rgba(11,187,214,0.12);}
.account-menu__notice{margin:10px 12px;padding:10px 12px;border-radius:12px;background:rgba(11,187,214,0.12);color:var(--primary,#0bbbd6);font-weight:800;font-size:13px;}
.account-menu__benefits{padding:4px 18px 12px;color:var(--muted,#5b6b7b);font-size:13px;}
.account-menu__benefits ul{margin:0;padding-left:18px;}
.account-menu__benefits li{margin-bottom:6px;line-height:1.3;}
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
        try{ window.currentSupabaseSession = state.session; }catch{}
      }catch{
        state.session = null;
      }
    }
    return state.session;
  }

  function sanitiseNext(target){
    if (!target) return DEFAULT_LOGIN_REDIRECT;
    try{
      const url = new URL(target, window.location.origin);
      if (url.origin === window.location.origin){
        return `${url.pathname}${url.search}${url.hash}`;
      }
    }catch(e){
      if (typeof target === 'string' && target.startsWith('/')) return target;
    }
    return DEFAULT_LOGIN_REDIRECT;
  }

  function redirectToLogin(nextTarget){
    const params = new URLSearchParams();
    params.set('next', sanitiseNext(nextTarget));
    const query = params.toString();
    window.location.href = query ? `/login.html?${query}` : '/login.html';
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
    const sessionUser = state.session?.user || window.currentSupabaseSession?.user || null;
    const hasSupabaseUser = !!sessionUser;
    const fallback = hasSupabaseUser ? fallbackIdentity() : { email: '', name: '' };
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
    return !!(state.session?.user?.id || window.currentSupabaseSession?.user?.id || identity.email);
  }

  function initials(identity){
    const source = identity.name || identity.email;
    if (!source) return '🙂';
    const parts = source.trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return (source[0] || '🙂').toUpperCase();
    if (parts.length === 1) return parts[0].substring(0,2).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }

  function buildMenuItems(identity, loggedIn){
    // Posodobljeno: trajno odstranimo alinejo / link za organizatorje iz menija.
    // Zahteva: naj se v spustnem meniju pri avatarju nikoli več ne pokaže "Za organizatorje".
    // Ostanejo samo uporabniške postavke.
    return [
      { id: 'mi-rewards', label: 'Nagrade', url: '/account/rewards.html', icon: '🏆' },
      { id: 'mi-dashboard', label: 'Moje', url: '/my.html', icon: '🎟️' },
      { id: 'mi-notifications', label: 'Predhodna obvestila', url: '/account/notifications.html', icon: '🔔' },
      { id: 'mi-account', label: 'Nastavitve / Račun', url: '/account/account.html', icon: '⚙️' }
    ];
  }

  

  function buildMenu(identity, options = {}){
    const { logoutSuccess = false } = options;
    const loggedIn = hasIdentity(identity);
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

    if (!loggedIn && logoutSuccess){
      const notice = document.createElement('div');
      notice.className = 'account-menu__notice';
      notice.textContent = 'Odjava uspešna.';
      menu.appendChild(notice);
      state.focusLogin = true;
    }

    if (!loggedIn){
      const benefits = document.createElement('div');
      benefits.className = 'account-menu__benefits';
      benefits.innerHTML = '<ul><li>Prijava omogoča shranjevanje najljubših in kuponov.</li><li>Prejmite obvestila o novih dogodkih in nagradah.</li><li>Preprosto upravljajte QR skeniranja in nakupe.</li></ul>';
      menu.appendChild(benefits);
    }

    const list = document.createElement('div');
    list.className = 'account-menu__list';
    const items = buildMenuItems(identity, loggedIn);
    items.forEach(item => {
      const link = document.createElement('a');
      link.id = item.id;
      link.href = item.url;
      link.className = 'account-menu__item';
      link.setAttribute('role', 'menuitem');
      link.innerHTML = `\n        <span class="account-menu__icon">${item.icon}</span>\n        <span class="account-menu__label">${item.label}${item.badge ? `<span class="account-menu__badge">${item.badge}</span>` : ''}</span>`;
      list.appendChild(link);
    });
    if (items.length) menu.appendChild(list);

    const footer = document.createElement('div');
    footer.className = 'account-menu__footer';
    if (loggedIn){
      const signout = document.createElement('button');
      signout.type = 'button';
      signout.className = 'account-menu__signout';
      signout.innerHTML = '<span class="account-menu__icon">🚪</span><span class="account-menu__label">Odjava</span>';
      signout.addEventListener('click', handleSignOut, { once: true });
      footer.appendChild(signout);
    }else{
      const loginBtn = document.createElement('button');
      loginBtn.type = 'button';
      loginBtn.className = 'account-menu__signout account-menu__signout--login';
      loginBtn.innerHTML = '<span class="account-menu__icon">🔐</span><span class="account-menu__label">Prijava / Registracija</span>';
      loginBtn.addEventListener('click', function(){ closeMenu(); triggerLogin(); });
      footer.appendChild(loginBtn);
    }
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
      let target = null;
      if (state.focusLogin){
        target = state.menu.querySelector('.account-menu__signout--login');
        state.focusLogin = false;
      }
      if (!target){
        target = state.menu.querySelector('.account-menu__item');
      }
      if (!target){
        target = state.menu.querySelector('.account-menu__signout, .account-menu__signout--login');
      }
      if (target){
        try{ target.focus({ preventScroll: true }); }catch{}
      }
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

  function clearSupabaseStorage(supabase){
    state.session = null;
    try{ window.currentSupabaseSession = null; }catch{}
    const clearKeys = ['user_email','user_token','user_refresh','user_name','ng_points'];
    clearKeys.forEach(key => { try{ localStorage.removeItem(key); }catch{} });
    try{
      const storageKey = supabase?.auth?.storageKey;
      if (storageKey){
        if (supabase?.auth?.storage?.removeItem){
          supabase.auth.storage.removeItem(storageKey);
        }
        localStorage.removeItem(storageKey);
      }
    }catch{}
    try{
      const sessionKeys = [];
      for (let i = 0; i < localStorage.length; i += 1){
        const key = localStorage.key(i);
        if (!key) continue;
        if (key.startsWith('sb-') || key.includes('supabase')) sessionKeys.push(key);
      }
      sessionKeys.forEach(key => { try{ localStorage.removeItem(key); }catch{} });
    }catch{}
    try{
      const sessionKeys = [];
      for (let i = 0; i < sessionStorage.length; i += 1){
        const key = sessionStorage.key(i);
        if (!key) continue;
        if (key.startsWith('sb-') || key.includes('supabase')) sessionKeys.push(key);
      }
      sessionKeys.forEach(key => { try{ sessionStorage.removeItem(key); }catch{} });
    }catch{}
  }

  async function handleSignOut(){
    closeMenu();
    let supabase = null;
    try{
      supabase = await getSupabase();
      if (supabase?.auth?.signOut){
        const settle = async (scope) => {
          try{
            const { error } = await supabase.auth.signOut({ scope });
            if (error) console.warn(`[account] signOut ${scope} failed:`, error.message || error);
          }catch(err){
            console.warn(`[account] signOut ${scope} threw:`, err?.message || err);
          }
        };
        await Promise.allSettled([
          settle('global'),
          settle('local')
        ]);
        try{
          const current = await supabase.auth.getSession();
          if (current?.data?.session){
            supabase.auth._removeSession?.();
          }
        }catch(err){
          console.warn('[account] post signOut session fetch failed:', err?.message || err);
        }
      }
    }catch(err){
      console.warn('[account] signOut error:', err?.message || err);
    }finally{
      clearSupabaseStorage(supabase);
    }
    state.logoutNotice = true;
    const identity = resolveIdentity();
    buildMenu(identity, { logoutSuccess: true });
    openMenu();
    state.logoutNotice = false;
  }

  function triggerLogin(){
    if (window.Auth && typeof window.Auth.open === 'function'){
      window.Auth.open();
    }else{
      redirectToLogin(window.location.pathname || DEFAULT_LOGIN_REDIRECT);
    }
  }

  async function onButtonClick(event){
    if (event && event.__accountMenuHandled) return;
    if (event) event.__accountMenuHandled = true;
    // Show menu for everyone. If not logged in, show fallback identity and
    // replace the sign-out control with a login action.
    // Prevent other click handlers (e.g. app.js) from intercepting this click
    // and showing an upgrade/login prompt. stopImmediatePropagation + stopPropagation
    // ensure our behavior takes precedence.
    try{ event.preventDefault(); }catch(e){}
    try{ if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation(); }catch(e){}
    try{ if (typeof event.stopPropagation === 'function') event.stopPropagation(); }catch(e){}
    await refreshSession();
    const identity = resolveIdentity();
    const logoutSuccess = state.logoutNotice;
    state.logoutNotice = false;
    buildMenu(identity, { logoutSuccess });

    toggleMenu();
  }

  function bindButton(button){
    if (!button) return;
    state.btn = button;
    if (button.dataset.accountMenuBound) return;
    button.dataset.accountMenuBound = '1';
    button.setAttribute('aria-haspopup', 'true');
    button.setAttribute('aria-expanded', 'false');
    // Ensure avatar is on top and receives clicks (avoid nearby Premium button intercepts)
    try{
      button.style.position = button.style.position || 'relative';
      button.style.zIndex = '3000';
      button.style.cursor = 'pointer';
    }catch(e){}
    // Use capture phase so this handler runs before other bubble-phase handlers
    // that might intercept the click and show the Premium prompt.
    button.addEventListener('click', onButtonClick, true);
    // Also register a bubble-phase listener as a safety net in case capture
    // listeners are blocked or detached by other scripts.
    button.addEventListener('click', onButtonClick, false);
  }

  function prepareAccountButton(btn){
    if (!btn) return null;
    if (btn.dataset.accountMenuPrepared) return btn;
    btn.dataset.accountMenuPrepared = '1';
    try{
      btn.removeAttribute('href');
      btn.removeAttribute('title');
      btn.removeAttribute('data-tooltip');
      btn.classList.add('nea-account-btn');
      btn.setAttribute('aria-label','Moj račun');
      btn.setAttribute('role','button');
      btn.setAttribute('tabindex','0');
      if (btn.tagName !== 'BUTTON' && typeof btn.removeAttribute === 'function'){
        btn.removeAttribute('onclick');
      }
      btn.style.cursor = 'pointer';
      btn.style.position = btn.style.position || 'relative';
      btn.style.zIndex = '3000';
    }catch(e){}
    return btn;
  }

  function observeButton(){
    const existing = prepareAccountButton(document.getElementById('btnAccount') || document.getElementById('btnMine'));
    if (existing){
      bindButton(existing);
      return;
    }
    if (state.observer) return;
    state.observer = new MutationObserver(()=>{
      const candidate = prepareAccountButton(document.getElementById('btnAccount') || document.getElementById('btnMine'));
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
    const nav = document.querySelector('.nav');
    if (!nav) return null;
    const existing = document.getElementById('btnAccount') || document.getElementById('btnMine');
    if (existing){
      const prepared = prepareAccountButton(existing);
      if (prepared) bindButton(prepared);
      return prepared;
    }
    try{
      const btn = document.createElement('button');
      btn.id = 'btnMine';
      btn.type = 'button';
      btn.className = 'pill nea-account-btn';
      btn.innerHTML = '<span aria-hidden="true" style="font-size:20px;">👤</span>';
      btn.setAttribute('aria-label','Moj račun');
      btn.setAttribute('aria-haspopup','true');
      btn.setAttribute('aria-expanded','false');
      btn.style.marginLeft = 'auto';
      nav.appendChild(btn);
      const prepared = prepareAccountButton(btn);
      if (prepared) bindButton(prepared);
      return prepared;
    }catch(e){ return null; }
  }

  async function watchAuth(){
    const supabase = await getSupabase();
    if (supabase?.auth?.onAuthStateChange){
      supabase.auth.onAuthStateChange((_event, session)=>{
        state.session = session || null;
        try{ window.currentSupabaseSession = session || null; }catch{}
        if (!session?.user) closeMenu();
      });
    }
  }

  function handleDocumentClick(event){
    if (event?.__accountMenuHandled) return;
    const target = event?.target?.closest?.('#btnMine, #btnAccount, .nea-account-btn');
    if (!target) return;
    const prepared = prepareAccountButton(target);
    bindButton(prepared);
    onButtonClick(event);
  }

  function boot(){
    injectStyles();
    const ensured = ensureAccountButton();
    if (!ensured) observeButton();
    if (!state.docBound){
      document.addEventListener('click', handleDocumentClick, true);
      state.docBound = true;
    }
    // Refresh session once
    refreshSession().catch(()=>{});
    watchAuth();
  }

  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', boot);
  }else{
    boot();
  }

})();

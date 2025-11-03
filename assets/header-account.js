// Header account dropdown + dynamic folder-content loader
// Behavior:
// - Clicking the avatar (`#btnMine`) opens a small menu with list items.
// - Clicking a menu item fetches the corresponding page and shows it in a right-side panel.
// - Keeps href fallback (so links still work if JS unavailable).

(function(){
	'use strict';

	const MENU_ID = 'nea-account-menu';
	const PANEL_ID = 'nea-account-panel';
	// Celoten predlagani meni (začne pri Nagrade)
	const MENU_ITEMS = [
		{label: 'Nagrade', url: '/my.html#rewardsHistory', icon: '🎁'},
		{label: 'Unovči točke', url: '/my.html#pointsStore', icon: '🏬'},
		{label: 'Napredek do nagrade', url: '/my.html#pointsProgressWrap', icon: '📈'},
		{label: 'Moje vstopnice & kuponi', url: '/my.html', icon: '🎟️'},
		{label: 'Vstopnice', url: '/my.html#tickets', icon: '🎫'},
		{label: 'Kuponi', url: '/my.html#coupons', icon: '🏷️'},
		{label: 'Zgodovina nakupov', url: '/my.html#purchases', icon: '🧾'},
		{label: 'Premium obvestila', url: '/premium.html#earlyNotifySection', icon: '🔔'},
		{label: 'Upravljanje Premium', url: '/premium.html#manage', icon: '⭐'},
		{label: 'Uredi profil', url: '/my.html#profile', icon: '⚙️'},
		{label: 'Nastavitve obvestil', url: '/my.html#notificationPrefs', icon: '🔧'},
		{label: 'Povabi prijatelje', url: '/my.html#referralCard', icon: '🤝'},
		{label: 'Pomoč & Kontakt', url: '/contact.html', icon: '❓'},
		{label: 'Odjava', action: 'signout', icon: '🚪'}
	];

	function addStyles(){
		if (document.getElementById('nea-account-styles')) return;
		const css = `
			.nea-account-menu{position:absolute; z-index:12000; min-width:200px; background:var(--card); border:1px solid var(--chipborder); box-shadow:0 8px 30px rgba(0,0,0,.12); border-radius:12px; padding:6px;}
			.nea-account-menu ul{list-style:none;margin:0;padding:6px;}
			.nea-account-menu li{padding:8px 10px; cursor:pointer; border-radius:8px; font-weight:800}
			.nea-account-menu li:hover, .nea-account-menu li:focus{background:rgba(11,187,214,.06)}
			.nea-account-panel{position:fixed; right:16px; top:70px; bottom:16px; width:min(560px,86vw); background:var(--card); border:1px solid var(--chipborder); box-shadow:0 20px 60px rgba(0,0,0,.18); border-radius:12px; z-index:12000; overflow:auto; display:flex; flex-direction:column}
			.nea-account-panel .bar{padding:10px; display:flex; align-items:center; justify-content:space-between; border-bottom:1px solid var(--chipborder); font-weight:900}
			.nea-account-panel .content{padding:12px; overflow:auto}
			@media(max-width:760px){ .nea-account-panel{ left:8px; right:8px; top:80px; bottom:8px; width:auto; border-radius:12px } }
		`;
		const s = document.createElement('style'); s.id='nea-account-styles'; s.appendChild(document.createTextNode(css));
		document.head.appendChild(s);
	}

	function createMenu(){
		let existing = document.getElementById(MENU_ID);
		if (existing) return existing;
		const menu = document.createElement('div');
		menu.id = MENU_ID; menu.className = 'nea-account-menu';
		menu.setAttribute('role','menu');
		const ul = document.createElement('ul');
		MENU_ITEMS.forEach((it, idx)=>{
			const li = document.createElement('li');
			li.tabIndex = 0;
			li.dataset.index = idx;
			li.textContent = it.label;
			li.addEventListener('click', onMenuItemClick);
			li.addEventListener('keydown', (e)=>{ if (e.key==='Enter' || e.key===' ') onMenuItemClick.call(li,e); });
			ul.appendChild(li);
		});
		menu.appendChild(ul);
		document.body.appendChild(menu);
		return menu;
	}

	function createPanel(){
		let existing = document.getElementById(PANEL_ID);
		if (existing) return existing;
		const p = document.createElement('aside');
		p.id = PANEL_ID; p.className = 'nea-account-panel';
		p.innerHTML = `<div class="bar"><span>Moji podatki</span><div><button id="neaPanelClose" class="btn mini link">Zapri</button></div></div><div class="content" id="neaPanelContent">Nalagam …</div>`;
		document.body.appendChild(p);
		p.querySelector('#neaPanelClose').addEventListener('click', ()=>{ hidePanel(); });
		return p;
	}

	function positionMenu(menu, anchor){
		const rect = anchor.getBoundingClientRect();
		const docEl = document.documentElement;
		// Prefer to place under the button, shift if close to right edge
		const left = Math.min(rect.left, Math.max(8, docEl.clientWidth - menu.offsetWidth - 8));
		menu.style.top = (rect.bottom + window.scrollY + 6) + 'px';
		menu.style.left = (left + window.scrollX) + 'px';
	}

	function showMenu(anchor){
		addStyles();
		const menu = createMenu();
		menu.style.display = 'block';
		positionMenu(menu, anchor);
		setTimeout(()=>{ menu.querySelector('li')?.focus(); }, 10);
		document.addEventListener('click', outsideMenuClick);
		document.addEventListener('keydown', menuKeyHandler);
	}

	function hideMenu(){
		const menu = document.getElementById(MENU_ID);
		if (menu) menu.style.display='none';
		document.removeEventListener('click', outsideMenuClick);
		document.removeEventListener('keydown', menuKeyHandler);
	}

	function outsideMenuClick(e){
		const menu = document.getElementById(MENU_ID);
		const anchor = document.getElementById('btnMine');
		if (!menu) return;
		if (menu.contains(e.target) || (anchor && anchor.contains(e.target))) return;
		hideMenu();
	}

	function menuKeyHandler(e){
		const menu = document.getElementById(MENU_ID);
		if (!menu || menu.style.display==='none') return;
		const items = Array.from(menu.querySelectorAll('li'));
		const idx = items.indexOf(document.activeElement);
		if (e.key==='ArrowDown') { e.preventDefault(); const next = items[Math.min(items.length-1, (idx+1)||0)]; next?.focus(); }
		else if (e.key==='ArrowUp'){ e.preventDefault(); const prev = items[Math.max(0, (idx-1))]; prev?.focus(); }
		else if (e.key==='Escape'){ hideMenu(); }
	}

	async function onMenuItemClick(e){
		e.preventDefault();
		const idx = Number(this.dataset.index);
		const it = MENU_ITEMS[idx];
		hideMenu();
		if (!it) return;
		if (it.action === 'signout') { await doSignOut(); return; }
		// Load target into side panel
		showPanel();
		await loadIntoPanel(it.url);
	}

	function showPanel(){
		addStyles();
		const p = createPanel();
		p.style.display = 'flex';
		p.scrollTop = 0;
		document.body.classList.add('nea-account-panel-open');
		// close on outside click
		setTimeout(()=>{ document.addEventListener('click', outsidePanelClick); document.addEventListener('keydown', panelKeyHandler); }, 50);
	}

	function hidePanel(){
		const p = document.getElementById(PANEL_ID);
		if (!p) return;
		p.style.display = 'none';
		document.body.classList.remove('nea-account-panel-open');
		document.removeEventListener('click', outsidePanelClick);
		document.removeEventListener('keydown', panelKeyHandler);
	}

	function outsidePanelClick(e){
		const p = document.getElementById(PANEL_ID);
		const anchor = document.getElementById('btnMine');
		if (!p) return;
		if (p.contains(e.target) || (anchor && anchor.contains(e.target))) return;
		hidePanel();
	}

	function panelKeyHandler(e){ if (e.key==='Escape') hidePanel(); }

	async function loadIntoPanel(url){
		const contentEl = document.getElementById('neaPanelContent');
		if (!contentEl) return;
		contentEl.innerHTML = 'Nalagam …';
		try{
			const res = await fetch(url, {cache:'no-store'});
			if (!res.ok) throw new Error('Fetch failed');
			const text = await res.text();
			const parsed = new DOMParser().parseFromString(text, 'text/html');
			// Prefer <main> content
			const main = parsed.querySelector('main') || parsed.querySelector('body') || parsed.documentElement;
			contentEl.innerHTML = '';
			// Import child nodes safely
			Array.from(main.childNodes).forEach(n=>{ contentEl.appendChild(document.importNode(n, true)); });
		}catch(err){
			contentEl.innerHTML = `<div style="padding:12px;color:var(--muted)">Ne morem naložiti vsebine. <a href="${url}" target="_blank">Odpri v novi zavihku</a>.</div>`;
			console.warn('[header-account] load error', err);
		}
	}

	async function doSignOut(){
		// Try to use Supabase client module if available
		try{
			if (window.supabase){ await window.supabase.auth.signOut(); window.location.reload(); return; }
			const mod = await import('/assets/supabase-client.js');
			if (mod && mod.supabase){ await mod.supabase.auth.signOut(); window.location.reload(); return; }
		}catch(e){ console.warn('Signout failed', e); }
		// Fallback: open /logout endpoint if exists
		try{ window.location.href = '/.netlify/functions/logout'; }catch(e){}
	}

	function attach(){
		document.addEventListener('DOMContentLoaded', ()=>{
			const btn = document.getElementById('btnMine');
			if (!btn) return;
			btn.addEventListener('click', (e)=>{
				// prevent navigation; activate menu
				e.preventDefault(); e.stopPropagation();
				const menu = document.getElementById(MENU_ID);
				if (menu && menu.style.display==='block') { hideMenu(); return; }
				showMenu(btn);
			});
			// If user presses Enter when focusing the avatar
			btn.addEventListener('keydown', (e)=>{ if (e.key==='Enter' || e.key===' ') { e.preventDefault(); btn.click(); } });
		});
	}

	attach();
})();


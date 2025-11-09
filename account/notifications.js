import { getCategoryList, resolveCategoryKey, getSubcategories } from '../assets/categories.js';

const EVENT_CATEGORIES = getCategoryList('events');
const SERVICE_CATEGORIES = getCategoryList('services');
const EVENT_KEYS = new Set(EVENT_CATEGORIES.map((cat) => cat.key));
const SERVICE_KEYS = new Set(SERVICE_CATEGORIES.map((cat) => cat.key));

const LEGACY_MAP = {
	koncerti: 'koncerti',
	kulinarika: 'kulinarika',
	sport: 'sport-tekmovanja',
	'šport': 'sport-tekmovanja',
	kultura: 'kultura-umetnost',
	kulturaumetnost: 'kultura-umetnost',
	druzina: 'druzina-otroci',
	družina: 'druzina-otroci',
	otroci: 'druzina-otroci',
	sejmi: 'ostalo',
	ostalo: 'ostalo',
	dogodki: 'ostalo',
	zabava: 'ostalo'
};

const slugify = (value) => String(value || '')
	.toLowerCase()
	.normalize('NFD')
	.replace(/[\u0300-\u036f]/g, '')
	.replace(/&/g, ' in ')
	.replace(/[^a-z0-9]+/g, '-')
	.replace(/^-+|-+$/g, '');

const normalizeCategoryValue = (value) => {
	if (!value) return '';
	let key = resolveCategoryKey('events', value);
	if (key && EVENT_KEYS.has(key)) return key;
	key = resolveCategoryKey('services', value);
	if (key && SERVICE_KEYS.has(key)) return key;
	const slug = slugify(value);
	if (LEGACY_MAP[slug]) return LEGACY_MAP[slug];
	return '';
};

const state = {
	type: 'events',
	selected: new Set(), // holds subcategory keys (max 2)
	monthlyChanges: 0,
	lastChangeMonth: null,
	mainSelected: '', // current main category key for subcategory list
	map: null,
	marker: null,
	circle: null
};

function findSubLabelByKey(key){
	try{
		for (const list of [EVENT_CATEGORIES, SERVICE_CATEGORIES]){
			for (const cat of list){
				if (Array.isArray(cat.sub)){
					const hit = cat.sub.find(s=>s.key===key);
					if (hit) return hit.label || key;
				}
			}
		}
	}catch{}
	return key;
}

const getMessageElement = () => document.getElementById('notifyMsg');

const setMessage = (text = '', tone = 'info') => {
	const msg = getMessageElement();
	if (!msg) return;
	msg.textContent = text;
	if (!text) {
		msg.style.color = '';
		return;
	}
	msg.style.color = tone === 'error' ? '#d64c4c' : '#0bbbd6';
};

const handleCategoryToggle = (key, checked) => {
	if (checked) {
		if (state.selected.has(key)) return;
		if (state.selected.size >= 2) {
			const checkbox = document.querySelector(`#cats input[type="checkbox"][value="${key}"]`);
			if (checkbox) checkbox.checked = false;
			setMessage('Izberite največ 2 kategoriji.', 'error');
			return;
		}
		state.selected.add(key);
	} else {
		state.selected.delete(key);
	}
	if (!state.selected.size) {
		setMessage('Izberite do 2 kategoriji.', 'info');
	} else {
		setMessage('');
	}
};

// Build main categories (events/services) chips
const renderMainCategories = () => {
	const wrap = document.getElementById('mainCats');
	if (!wrap) return;
	wrap.innerHTML = '';
	const list = state.type === 'services' ? SERVICE_CATEGORIES : EVENT_CATEGORIES;
	list.forEach((cat) => {
		const chip = document.createElement('button');
		chip.type = 'button';
		chip.className = 'cat-chip';
		chip.dataset.key = cat.key;
		chip.setAttribute('aria-pressed', state.mainSelected === cat.key ? 'true' : 'false');
		chip.innerHTML = (cat.icon ? `<img src="${cat.icon}" alt="">` : `<span class="cat-emoji">${cat.emoji || '🏷️'}</span>`) +
			`<span class="cat-label">${cat.label}</span>`;
		if (state.mainSelected === cat.key) chip.classList.add('active', 'show-label');
		chip.addEventListener('mouseenter', () => chip.classList.add('show-label'));
		chip.addEventListener('mouseleave', () => { if (!chip.classList.contains('active')) chip.classList.remove('show-label'); });
		chip.addEventListener('click', () => {
			state.mainSelected = cat.key;
			wrap.querySelectorAll('.cat-chip').forEach((b) => { b.classList.remove('active'); b.setAttribute('aria-pressed','false'); });
			chip.classList.add('active'); chip.setAttribute('aria-pressed','true');
			chip.classList.add('show-label');
			renderSubcategories();
		});
		wrap.appendChild(chip);
	});
	// pick first by default
	if (!state.mainSelected && list[0]) { state.mainSelected = list[0].key; }
	renderSubcategories();
};

// Build subcategories for selected main category
const renderSubcategories = () => {
	const wrap = document.getElementById('subCats');
	const subWrap = document.getElementById('subWrap');
	if (!wrap || !subWrap) return;
	const subs = getSubcategories(state.type, state.mainSelected) || [];
	wrap.innerHTML = '';
	subWrap.style.display = subs.length ? 'block' : 'none';
	subs.forEach((sub) => {
		const chip = document.createElement('button');
		chip.type = 'button';
		chip.className = 'cat-chip';
		chip.dataset.key = sub.key;
		chip.innerHTML = `${sub.icon ? `<img src="${sub.icon}" alt="">` : `<span class='cat-emoji'>${sub.emoji||'🏷️'}</span>`}<span class="cat-label">${sub.label}</span>`;
		if (state.selected.has(sub.key)) chip.classList.add('active','show-label');
		chip.addEventListener('click', () => toggleSubcategory(sub.key, sub.label));
		wrap.appendChild(chip);
	});
	renderSelected();
};

const renderSelected = () => {
	const host = document.getElementById('selectedWrap');
	if (!host) return;
	host.innerHTML = '';
	const current = Array.from(state.selected);
	if (!current.length){
		const note = document.createElement('div');
		note.className='muted';
		note.textContent='Ni izbranih podkategorij. Izberi do 2.';
		host.appendChild(note);
		return;
	}
	current.forEach((key) => {
		const pill = document.createElement('span');
		pill.className='selected-pill';
		const label = findSubLabelByKey(key);
		pill.innerHTML = `${label} <button type="button" aria-label="Odstrani">×</button>`;
		pill.querySelector('button').addEventListener('click', () => { state.selected.delete(key); renderSubcategories(); });
		host.appendChild(pill);
	});
};

const toggleSubcategory = (key) => {
	if (!ensurePremiumOrPrompt()) return;
	if (state.selected.has(key)) { state.selected.delete(key); renderSubcategories(); return; }
	if (state.selected.size >= 2) { setMessage('Izberite največ 2 podkategoriji.', 'error'); return; }
	// enforce monthly change quota (max 5 per month)
	if (!canChangeCategories()) { setMessage('Dosežena omejitev 5 menjav v tem mesecu.', 'error'); return; }
	state.selected.add(key);
	markCategoryChange();
	setMessage('Dodano.', 'info');
	renderSubcategories();
};

const loadPreferences = async () => {
	const email = localStorage.getItem('user_email') || '';
	if (!email) {
		setMessage('Vpišite email v Moj profil.', 'error');
		return;
	}
	try {
		const res = await fetch(`/.netlify/functions/notifications-prefs-get?email=${encodeURIComponent(email)}`);
		const data = await res.json();
		if (!res.ok || !data?.ok) return;

		const prefs = data.prefs || {};
		const categories = Array.isArray(prefs.categories) ? prefs.categories.slice(0,2) : [];
		state.selected = new Set(categories);
		renderMainCategories();

		const locationInput = document.getElementById('notifLocation');
		if (locationInput) locationInput.value = prefs.location || '';
		const radiusInput = document.getElementById('notifRadius');
		if (radiusInput) radiusInput.value = Math.max(3, Math.min(50, Number(prefs.radius)||25));
		const phoneInput = document.getElementById('notifPhone');
		if (phoneInput) phoneInput.value = prefs.phone || '';
		// Hydrate marker if lat/lon available
		if (state.map && typeof prefs.lat === 'number' && typeof prefs.lon === 'number'){
			try{
				state.marker.setLatLng([prefs.lat, prefs.lon]);
				state.circle.setLatLng([prefs.lat, prefs.lon]);
				state.map.setView([prefs.lat, prefs.lon], 11);
				const loc = document.getElementById('notifLocation'); if(loc) loc.value = `${prefs.lat.toFixed(5)},${prefs.lon.toFixed(5)}`;
			}catch{}
		}
	} catch (err) {
		console.warn('[notifications] load failed', err);
	}
};

const savePreferences = async () => {
	const email = localStorage.getItem('user_email') || '';
	if (!email) {
		setMessage('Vpišite email.', 'error');
		return;
	}
	const categories = Array.from(state.selected);
	if (categories.length > 2) {
		setMessage('Izberite največ 2 podkategoriji.', 'error');
		return;
	}

	const locationInput = document.getElementById('notifLocation');
	const radiusInput = document.getElementById('notifRadius');
	const phoneInput = document.getElementById('notifPhone');

	// Derive lat/lon from marker or manual input
	let lat = null, lon = null;
	if (state.marker){
		try{ const ll = state.marker.getLatLng(); lat = ll.lat; lon = ll.lng; }catch{}
	}
	if ((lat==null || lon==null) && locationInput && locationInput.value){
		const m = locationInput.value.trim().match(/^(-?\d+(?:\.\d+)?)[, ]\s*(-?\d+(?:\.\d+)?)/);
		if (m){ lat = parseFloat(m[1]); lon = parseFloat(m[2]); }
	}

	const payload = {
		email,
		categories,
		location: locationInput ? locationInput.value : '',
		radius: radiusInput ? Number(radiusInput.value) || 30 : 30,
		lat: (typeof lat === 'number') ? lat : null,
		lon: (typeof lon === 'number') ? lon : null,
		phone: phoneInput ? phoneInput.value.trim() : ''
	};

	try {
		const res = await fetch('/.netlify/functions/notifications-prefs-upsert', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(payload)
		});
		const data = await res.json().catch(() => ({}));
		if (res.ok && data?.ok) {
			setMessage('Shranjeno.', 'info');
		} else {
			setMessage('Napaka pri shranjevanju.', 'error');
		}
	} catch (err) {
		console.warn('[notifications] save failed', err);
		setMessage('Napaka pri povezavi.', 'error');
	}
};

const bindTypeSwitch = () => {
	// Use nicer toggle buttons (replaces radio inputs)
	const btns = document.querySelectorAll('.type-btn');
	btns.forEach((b)=>{
		b.addEventListener('click', ()=>{
			if (!ensurePremiumOrPrompt()) return;
			btns.forEach(x=>x.classList.remove('active'));
			b.classList.add('active');
			state.type = b.dataset.value === 'services' ? 'services' : 'events';
			// Vizualni stil: storitve ne smejo biti rdeče – ohranimo modro paleto
			btns.forEach(x=>{
				if(x.classList.contains('type-services')){
					if(state.type==='services' && x.classList.contains('active')){
						x.style.background='linear-gradient(180deg,#bfeef6,#8fd8e6)';
						x.style.color='#064c56';
					}else{
						x.style.background='linear-gradient(180deg,#f7fdff,#e6fbff)';
						x.style.color='#064c56';
					}
				}
				if(x.classList.contains('type-events')){
					if(state.type==='events' && x.classList.contains('active')){
						x.style.background='linear-gradient(180deg,#0bbbd6,#07aab8)';
						x.style.color='#fff';
					}else{
						x.style.background='linear-gradient(180deg,#f7fdff,#e6fbff)';
						x.style.color='#064c56';
					}
				}
			});
			state.mainSelected = '';
			renderMainCategories();
			populateMainSelect();
			populateSubSelect();
		});
	});
	// initial
	renderMainCategories();
};

// populate the quick main category <select>
function populateMainSelect(){
	const sel = document.getElementById('mainCategorySelect');
	if (!sel) return;
	sel.innerHTML = '';
	const list = state.type === 'services' ? SERVICE_CATEGORIES : EVENT_CATEGORIES;
	list.forEach((c)=>{
		const opt = document.createElement('option');
		opt.value = c.key; opt.textContent = c.label;
		sel.appendChild(opt);
	});
	// set current
	try{ sel.value = state.mainSelected || list[0]?.key || ''; }catch{}
}

// populate the subcategory multi-select
function populateSubSelect(){
	const sel = document.getElementById('subCategorySelect');
	if (!sel) return;
	sel.innerHTML = '';
	const subs = getSubcategories(state.type, state.mainSelected) || [];
	subs.forEach((s)=>{
		const opt = document.createElement('option'); opt.value = s.key; opt.textContent = s.label; sel.appendChild(opt);
	});
	// mark selected ones
	Array.from(sel.options).forEach(o=>{ o.selected = state.selected.has(o.value); });
}

// bind select change handlers
function bindSelectHandlers(){
	const mainSel = document.getElementById('mainCategorySelect');
	const subSel = document.getElementById('subCategorySelect');
	if (mainSel){ mainSel.addEventListener('change',(e)=>{ if (!ensurePremiumOrPrompt()) { e.preventDefault(); return; } state.mainSelected = e.target.value; renderSubcategories(); populateSubSelect(); }); }
	if (subSel){ subSel.addEventListener('change',(e)=>{ if (!ensurePremiumOrPrompt()) { e.preventDefault(); return; }
		const chosen = Array.from(e.target.selectedOptions).map(o=>o.value).slice(0,2);
		state.selected = new Set(chosen);
		renderSubcategories();
	}); }
}

// ===== Premium gating + monthly quota handling =====
const getMonthlyKey = () => {
	const now = new Date();
	return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
};
const loadMonthlyQuota = () => {
	try{
		const raw = JSON.parse(localStorage.getItem('ng_notify_quota')||'{}');
		const k = getMonthlyKey();
		const currentUntil = window.PREMIUM_UNTIL || null;
		// Reset if cycle changed or month rolled
		if (raw.cycleUntil !== currentUntil) return { month:k, changes:0, cycleUntil: currentUntil };
		if (raw.month !== k) return { month:k, changes:0, cycleUntil: currentUntil };
		return { month:k, changes:Number(raw.changes||0), cycleUntil: currentUntil };
	}catch{ return { month:getMonthlyKey(), changes:0, cycleUntil: window.PREMIUM_UNTIL||null }; }
};
const saveMonthlyQuota = (obj) => {
	try{ localStorage.setItem('ng_notify_quota', JSON.stringify(obj)); }catch{}
};
const updateQuotaInfo = () => {
	const info = document.getElementById('quotaInfo');
	const disabled = document.getElementById('changesDisabled');
	const q = loadMonthlyQuota();
	const left = Math.max(0, 5 - Number(q.changes||0));
	if (info) info.textContent = `Preostale menjave: ${left}`;
	const numSpan = document.getElementById('quotaNumber'); if(numSpan) numSpan.textContent = left;
	if (disabled) disabled.style.display = left<=0 ? 'block' : 'none';
};
const canChangeCategories = () => {
	const q = loadMonthlyQuota();
	return Number(q.changes||0) < 5;
};
const markCategoryChange = () => {
	const q = loadMonthlyQuota();
	const cur = { month:getMonthlyKey(), changes: Math.min(5, Number(q.changes||0)+1), cycleUntil: window.PREMIUM_UNTIL || q.cycleUntil || null };
	saveMonthlyQuota(cur);
	updateQuotaInfo();
};
// Override to decrement remaining directly used in UI (already shows remaining via updateQuotaInfo)

// ===== Map (Leaflet) limited to 50km radius =====
function initMap(){
	const node = document.getElementById('earlyMap'); if(!node) return;
	if (state.map) return;
	state.map = L.map('earlyMap').setView([46.05,14.51],7);
	L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'© OSM'}).addTo(state.map);
		state.marker = L.marker([46.05,14.51], { draggable:true }).addTo(state.map);
		state.circle = L.circle([46.05,14.51], { radius: (getRadius()*1000), color:'#0bbbd6' }).addTo(state.map);
		state.marker.on('move', (e)=>{ 
			state.circle.setLatLng(e.latlng);
			const loc = document.getElementById('notifLocation');
			if (loc) loc.value = `${e.latlng.lat.toFixed(5)},${e.latlng.lng.toFixed(5)}`;
		});
}
function getRadius(){
	const r = Number(document.getElementById('notifRadius')?.value||25);
	return Math.max(1, Math.min(50, r));
}
function bindMapControls(){
	const radius = document.getElementById('notifRadius');
	const lbl = document.getElementById('radiusLbl');
	const gps = document.getElementById('btnUseGPS');
	const reset = document.getElementById('btnResetLoc');
	const upd = () => {
		const r = getRadius();
		if(lbl) lbl.textContent = `${r} km (premer ${r*2} km)`;
		try{ state.circle?.setRadius(r*1000); handleRadiusHandle(); }catch{}
	};
	['input','change','pointerup','touchend'].forEach((ev)=> radius?.addEventListener(ev, (e)=>{ if(!ensurePremiumOrPrompt()) { e.preventDefault(); return; } upd(); }));
	upd();
	gps?.addEventListener('click', ()=>{
		if (!ensurePremiumOrPrompt()) return;
		const was = gps.classList.contains('active');
		gps.classList.toggle('active');
		if(was) return; // toggle off does nothing
		if(!navigator.geolocation) return;
		navigator.geolocation.getCurrentPosition((p)=>{
			const lat=p.coords.latitude, lon=p.coords.longitude;
			try{ state.map.setView([lat,lon],11); state.marker.setLatLng([lat,lon]); state.circle.setLatLng([lat,lon]); handleRadiusHandle(); }catch{}
			const loc = document.getElementById('notifLocation'); if (loc) loc.value = `${lat.toFixed(5)},${lon.toFixed(5)}`;
		});
	});
	reset?.addEventListener('click', ()=>{
		try{ state.map.setView([46.05,14.51],7); state.marker.setLatLng([46.05,14.51]); state.circle.setLatLng([46.05,14.51]); }catch{}
		const loc = document.getElementById('notifLocation'); if(loc) loc.value='';
		const r = document.getElementById('notifRadius'); if(r){ r.value=25; if(lbl) lbl.textContent='25 km (premer 50 km)'; try{ state.circle?.setRadius(25*1000); handleRadiusHandle(); }catch{} }
	});
}

// Add a draggable small handle on circle edge to resize radius intuitively
function handleRadiusHandle(){
	try{
		if (!state.map || !state.circle) return;
		if (!state._radiusHandle){
			const el = document.createElement('div');
			el.style.width='18px'; el.style.height='18px'; el.style.background='#0bbbd6'; el.style.border='2px solid #fff'; el.style.borderRadius='50%'; el.style.boxShadow='0 2px 6px rgba(0,0,0,.25)'; el.style.cursor='grab';
			state._radiusHandle = L.marker(state.circle.getLatLng(), { draggable:true, icon: L.divIcon({ className:'radius-handle', html: el.outerHTML, iconSize:[18,18] }) }).addTo(state.map);
			state._radiusHandle.on('move', (e)=>{
				const center = state.circle.getLatLng();
				const pt = e.latlng;
				const distKm = Math.min(50, Math.max(1, center.distanceTo(pt)/1000));
				const rInput = document.getElementById('notifRadius');
				if (rInput){ rInput.value = Math.round(distKm); }
				state.circle.setRadius(distKm*1000);
				const lbl = document.getElementById('radiusLbl'); if(lbl){ const rr=Math.round(distKm); lbl.textContent = `${rr} km (premer ${rr*2} km)`; }
				// reposition handle exactly on circle edge toward drag point
				const bearing = Math.atan2(pt.lat - center.lat, pt.lng - center.lng);
				const factor = distKm / (center.distanceTo(pt)/1000 || 1);
				const newLat = center.lat + (pt.lat - center.lat)*factor;
				const newLng = center.lng + (pt.lng - center.lng)*factor;
				try{ state._radiusHandle.setLatLng([newLat,newLng]); }catch{}
			});
			// keep handle on edge when center moves
			state.marker.on('move', ()=>{
				const center = state.marker.getLatLng();
				const radKm = getRadius();
				// simple east point for default placement
				const earthRadiusKm = 6371;
				const d = radKm/earthRadiusKm;
				const lat1 = center.lat * Math.PI/180;
				const lng1 = center.lng * Math.PI/180;
				const lat2 = lat1;
				const lng2 = lng1 + d/Math.cos(lat1);
				const newLat = lat2*180/Math.PI;
				const newLng = lng2*180/Math.PI;
				try{ state._radiusHandle.setLatLng([newLat,newLng]); }catch{}
			});
		}
		// position handle at east edge based on current radius
		const center = state.circle.getLatLng();
		const radKm = getRadius();
		const earthRadiusKm = 6371;
		const d = radKm/earthRadiusKm;
		const lat1 = center.lat * Math.PI/180;
		const lng1 = center.lng * Math.PI/180;
		const lat2 = lat1;
		const lng2 = lng1 + d/Math.cos(lat1);
		const newLat = lat2*180/Math.PI;
		const newLng = lng2*180/Math.PI;
		try{ state._radiusHandle.setLatLng([newLat,newLng]); }catch{}
	}catch{}
}

function gatePremium(){
	const isPremium = !!(window.IS_PREMIUM);
	const nonBox = document.getElementById('nonPremiumInline');
	const form = document.getElementById('notifyForm');
	if (!form) return;
	if (!isPremium){
		// Keep interactive look but block on action
		if (nonBox) nonBox.style.display='block';
	}else{
		if (nonBox) nonBox.style.display='none';
	}
}

async function refreshPremiumFlag(){
	try{
		const email = localStorage.getItem('user_email') || '';
		if (!email) return;
		const r = await fetch(`/api/my?email=${encodeURIComponent(email)}`).then(x=>x.json()).catch(()=>null);
		if (r && typeof r.premium !== 'undefined'){
			window.IS_PREMIUM = !!r.premium;
			if (r.premium_until) { window.PREMIUM_UNTIL = r.premium_until; }
			gatePremium();
			// update counter visibility/value once premium known
			try{ updateMonthlyCounter(); }catch{}
				if (r.premium_until) { updatePremiumCycle(r.premium_until); }
		}
	}catch{}
}
// ===== Premium helpers and map picker binding =====
function updatePremiumCycle(untilIso){
	try{
		if (!untilIso) return;
		const d = new Date(untilIso);
		if(Number.isNaN(d.getTime())) return;
		const startSpan = document.getElementById('premiumStartDate');
		const cycleBox = document.getElementById('premiumCycle');
		if(startSpan) startSpan.textContent = d.toLocaleDateString('sl-SI');
		if(cycleBox) cycleBox.style.display = 'block';
	}catch{}
}

function ensurePremiumOrPrompt(){
	const isPremium = !!window.IS_PREMIUM;
	if (isPremium) return true;
	const box = document.getElementById('nonPremiumInline');
	if (box){
		box.style.display='block';
		// vibracija (če podprta)
		try{ if(navigator.vibrate) navigator.vibrate(45); }catch{}
		// vizualni 'shake'
		box.classList.add('shake');
		setTimeout(()=>{ try{ box.classList.remove('shake'); }catch{} }, 600);
		try{ box.scrollIntoView({behavior:'smooth', block:'center'}); }catch{}
	}
	return false;
}

function bindMapPickButton(){
	const openBtn = document.getElementById('btnMapPick');
	const confirmBtn = document.getElementById('btnMapConfirm');
	const closeBtn = document.getElementById('btnMapClose');
	const mapHost = document.getElementById('earlyMap');
	if(!openBtn || !mapHost) return;
	const showMap = () => {
		if(!ensurePremiumOrPrompt()) return;
		mapHost.style.display='block';
		confirmBtn.style.display='inline-block';
		closeBtn.style.display='inline-block';
		if(!state.map){ initMap(); bindMapControls(); }
		setTimeout(()=>{ try{ state.map.invalidateSize(); }catch{} }, 50);
	};
	const hideMap = () => {
		mapHost.style.display='none';
		confirmBtn.style.display='none';
		closeBtn.style.display='none';
	};
	openBtn.addEventListener('click', showMap);
	closeBtn?.addEventListener('click', hideMap);
	confirmBtn?.addEventListener('click', async ()=>{
		const loc = document.getElementById('notifLocation');
		let ll = null;
		if(state.marker){ try{ ll = state.marker.getLatLng(); }catch{} }
		if (ll){
			const fallback = `${ll.lat.toFixed(5)},${ll.lng.toFixed(5)}`;
			if (loc) loc.value = fallback;
			try{
				setMessage('Potrjujem lokacijo …', 'info');
				const place = await reverseGeocode(ll.lat, ll.lng, 12, 1200);
				if (place && loc){ loc.value = place; }
			}catch{}
		}
		setMessage('Lokacija potrjena.', 'info');
		hideMap();
	});
}

document.addEventListener('DOMContentLoaded', () => {
	const saveBtn = document.getElementById('saveNotify');
	if (saveBtn) {
		saveBtn.addEventListener('click', (ev) => {
			ev.preventDefault();
			savePreferences();
		});
	}

	state.selected = new Set();
	bindTypeSwitch();
	loadPreferences();
	updateQuotaInfo();
	gatePremium();
		refreshPremiumFlag();
		bindMapPickButton();
	// Show monthly early notifications counter
	updateMonthlyCounter();
	// Map now deferred until user opens it.
	populateMainSelect();
	populateSubSelect();
	bindSelectHandlers();
});

// Reverse geocode helper (Nominatim) – best-effort
async function reverseGeocode(lat, lon, zoom=12, timeoutMs=1200){
	try{
		const ctrl = new AbortController();
		const t = setTimeout(()=>ctrl.abort(), timeoutMs);
		const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&zoom=${encodeURIComponent(zoom)}&addressdetails=1`;
		const r = await fetch(url, { signal: ctrl.signal, headers:{ 'Accept':'application/json','User-Agent':'NearGo/1.0 early-notify' } });
		clearTimeout(t);
		if (!r.ok) return null;
		const j = await r.json().catch(()=>null);
		if (!j) return null;
		if (j.address){
			const a = j.address;
			const city = a.city || a.town || a.village || a.municipality || '';
			const region = a.state || a.county || '';
			const country = a.country || '';
			const parts = [city, region || country].filter(Boolean);
			return parts.length ? parts.join(', ') : (j.display_name || null);
		}
		return j.display_name || null;
	}catch{ return null; }
}

// ===== Monthly notifications counter (X/25) =====
async function updateMonthlyCounter(){
	try{
		const node = document.getElementById('monthlyNotifCount');
		if (!node) return;
		const email = localStorage.getItem('user_email') || '';
		if (!email){ node.style.display='none'; return; }
		// Respect Premium gating – only show if premium
		const isPremium = !!(window.IS_PREMIUM);
		if (!isPremium){ node.style.display='none'; return; }
		const r = await fetch(`/api/early-notify-count?email=${encodeURIComponent(email)}`)
			.then(x=>x.json()).catch(()=>null);
		if (!r || !r.ok){ node.style.display='none'; return; }
		const sent = Number(r.sent||0);
		const cap = Number(r.cap||25);
		node.textContent = `Obvestila ta mesec: ${sent}/${cap}`;
		node.style.display = 'block';
	}catch{
		const node = document.getElementById('monthlyNotifCount');
		if (node) node.style.display='none';
	}
}

// Re-run counter update whenever premium flag refreshes
(async ()=>{
	// Small delay to allow refreshPremiumFlag to complete on first load
	try{ await new Promise(r=>setTimeout(r, 400)); updateMonthlyCounter(); }catch{}
})();

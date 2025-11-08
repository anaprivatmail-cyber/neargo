import { getCategoryList, resolveCategoryKey } from '../assets/categories.js';

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
	selected: new Set()
};

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

const renderCategories = () => {
	const wrap = document.getElementById('cats');
	if (!wrap) return;
	wrap.innerHTML = '';

	const list = state.type === 'services' ? SERVICE_CATEGORIES : EVENT_CATEGORIES;
	list.forEach((cat) => {
		const id = `notif_${state.type}_${cat.key}`;
	const label = document.createElement('label');
	// reuse the app's cat-chip styles for consistent appearance
	label.className = 'cat-chip notify-cat';
	// keep a small margin so chips don't touch
	label.style.margin = '4px 8px 4px 0';

		const input = document.createElement('input');
		input.type = 'checkbox';
		input.id = id;
		input.value = cat.key;
		input.checked = state.selected.has(cat.key);

		// toggle label visibility when checkbox changes and keep visual active state
		input.addEventListener('change', (ev) => {
			const checked = !!ev.target.checked;
			handleCategoryToggle(cat.key, checked);
			if (checked) {
				label.classList.add('show-label', 'active');
			} else {
				label.classList.remove('show-label', 'active');
			}
		});

		// render icon (prefer image) + label text to match other chips
		if (cat.icon) {
			const img = document.createElement('img');
			img.src = cat.icon;
			img.alt = '';
			img.loading = 'lazy';
			label.appendChild(img);
		} else {
			const emoji = document.createElement('span');
			emoji.className = 'cat-emoji';
			emoji.textContent = cat.emoji || '•';
			emoji.style.fontSize = '1.3em';
			label.appendChild(emoji);
		}

		const text = document.createElement('span');
		text.className = 'cat-label';
		text.textContent = cat.label;

		// if initially selected, show label
		if (input.checked) label.classList.add('show-label', 'active');

		label.append(input, text);
		wrap.appendChild(label);
	});
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
		const categories = Array.isArray(prefs.categories) ? prefs.categories : [];
		const normalized = categories
			.map((cat) => normalizeCategoryValue(cat))
			.filter(Boolean)
			.slice(0, 2);
		state.selected = new Set(normalized);
		renderCategories();

		const locationInput = document.getElementById('notifLocation');
		if (locationInput) locationInput.value = prefs.location || '';
		const radiusInput = document.getElementById('notifRadius');
		if (radiusInput) radiusInput.value = Number(prefs.radius) || 30;
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
		setMessage('Izberite največ 2 kategoriji.', 'error');
		return;
	}

	const locationInput = document.getElementById('notifLocation');
	const radiusInput = document.getElementById('notifRadius');

	const payload = {
		email,
		categories,
		location: locationInput ? locationInput.value : '',
		radius: radiusInput ? Number(radiusInput.value) || 30 : 30
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
	const radios = document.querySelectorAll('input[name="type"]');
	radios.forEach((radio) => {
		radio.addEventListener('change', (ev) => {
			if (!ev.target.checked) return;
			state.type = ev.target.value === 'services' ? 'services' : 'events';
			renderCategories();
		});
	});
	const checked = document.querySelector('input[name="type"]:checked');
	if (checked) state.type = checked.value === 'services' ? 'services' : 'events';
	renderCategories();
};

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
});

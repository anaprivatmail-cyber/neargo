// assets/provider-rating.js
// Klient logika za označevanje ponudnikov z majhno elegantno značko:
// "Nov", "Priznan", "Odličen" – temelji na številu aktivnih objav (featured + navadne)
// in (opcijsko) povprečni oceni, če backend enkrat doda numeric rating.
//
// Strategija (heuristika dokler ni dejanske tabele ocen):
//   count <= 2  -> Nov
//   count 3–9   -> Priznan
//   count >=10  -> Odličen
//   Če povprečna ocena >=4.7 in count>=5 -> Odličen (prednost)
// Backend endpoint /api/provider-ratings (netlify/functions/provider-ratings-get.js) lahko vrne:
// { ok:true, items:[ { provider_email:"x@y", count:7, avg:4.3 } ] }

(function(){
	const CACHE_TTL_MS = 5*60*1000; // 5 min
	let ratings = new Map();
	let lastFetch = 0;

	function computeBadge(data){
		if(!data) return null;
		const c = Number(data.count||0);
		const avg = Number(data.avg||0);
		let level = null;
		if(c >= 10 || (c>=5 && avg >= 4.7)) level = 'excellent';
		else if(c >= 3) level = 'recognized';
		else if(c >= 1) level = 'new';
		else return null;
		return level;
	}

	function badgeHtml(level){
		if(!level) return '';
		const baseStyle = 'display:inline-flex;align-items:center;gap:4px;font-size:10px;font-weight:800;padding:3px 6px;border-radius:8px;letter-spacing:.5px;';
		if(level==='new') return '<span class="provider-badge provider-badge--new" style="'+baseStyle+'background:#e9f7ff;color:#056b8a;border:1px solid #b5deef">NOV</span>';
		if(level==='recognized') return '<span class="provider-badge provider-badge--recognized" style="'+baseStyle+'background:#f7f3ff;color:#553b8a;border:1px solid #d9cff5">PRIZNAN</span>';
		if(level==='excellent') return '<span class="provider-badge provider-badge--excellent" style="'+baseStyle+'background:#fff7e4;color:#8a5b05;border:1px solid #f5d7a8">ODLIČEN</span>';
		return '';
	}

	async function ensureRatings(){
		const now = Date.now();
		if(now - lastFetch < CACHE_TTL_MS && ratings.size) return ratings;
		try{
			const r = await fetch('/api/provider-ratings').then(x=>x.json()).catch(()=>null);
			if(r && r.ok && Array.isArray(r.items)){
				ratings = new Map();
				for(const it of r.items){
					if(!it.provider_email) continue;
					ratings.set(String(it.provider_email).toLowerCase(), { count:it.count, avg:it.avg });
				}
				lastFetch = now;
			}
		}catch(_){/* ignore */}
		return ratings;
	}

	async function getProviderBadge(providerEmail){
		if(!providerEmail) return '';
		await ensureRatings();
		const data = ratings.get(String(providerEmail).toLowerCase());
		const level = computeBadge(data);
		return badgeHtml(level);
	}

	// Integracija v obstoječe kartice: po renderSpotCard (index.html) so kartice v .spot
	// Ta funkcija doda badge v <b> naslov, če še ni dodan.
	async function decorateCards(){
		const cards = document.querySelectorAll('.spot[data-provider]');
		if(!cards.length) return;
		await ensureRatings();
		cards.forEach(card => {
			const email = card.dataset.provider;
			if(!email) return;
			const metaTitle = card.querySelector('.meta > b');
			if(!metaTitle) return;
			if(metaTitle.dataset.badgeApplied==='1') return;
			getProviderBadge(email).then(html => {
				if(html){
					// Vstavi badge za naslov
					const wrap = document.createElement('span');
					wrap.innerHTML = ' '+html;
					metaTitle.after(wrap.firstChild);
				}
				metaTitle.dataset.badgeApplied='1';
			});
		});
	}

	// Opazuj spremembe v seznamu (iskanje, izpostavljeno, paging)
	const obs = new MutationObserver((muts)=>{
		let added = false;
		muts.forEach(m => { if(m.addedNodes && m.addedNodes.length) added = true; });
		if(added) decorateCards();
	});
	function bootObserver(){
		const root = document.getElementById('carousel') || document.body;
		obs.observe(root, { childList:true, subtree:true });
	}

	if(document.readyState==='loading'){
		document.addEventListener('DOMContentLoaded', ()=>{ bootObserver(); decorateCards(); });
	}else{ bootObserver(); decorateCards(); }

	// Export za manualno uporabo
	try{ window.getProviderBadge = getProviderBadge; }catch(_){ }
})();

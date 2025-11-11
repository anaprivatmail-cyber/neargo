// assets/search-core.js
// Centralized search logic extracted from index.html (doSearch).
// Provides window.searchCore.doSearch(page, byGeo) preserving multi-select categories.
// Depends on global helpers defined in index.html: qs, normalizeItem, modeFilter, filterEarlyAndStock,
// parseDateAny, getEndTs, isExternalAPI, el, mapSearch, markersSearch, ACTIVE_MODE, GEO, IS_PREMIUM,
// EARLY_PREF_CATS, EARLY_MINUTES.

(function(){
  function doSearch(page, byGeo){
    if(page==null) page=0; if(byGeo==null) byGeo=false;
    try{ window.showPanel && window.showPanel('searchPanel'); }catch{}
    window.currentPage = page;

    var qEl = document.getElementById('q');
    var cityInput = document.getElementById('city');
    var freeOnly = document.getElementById('freeOnly');
    var radius = document.getElementById('radius');
    var radiusCity = document.getElementById('radiusCity');
    var qVal=(qEl && qEl.value ? qEl.value.trim() : "");
    var rawCity=(cityInput && cityInput.value ? cityInput.value.trim() : "");
    var CITY_ALIASES=window.CITY_ALIASES||{};
    var cityVal = CITY_ALIASES[rawCity.toLowerCase()] || rawCity;
    var radUser=Number((radius && radius.value)||30);
    var radCity=Number((radiusCity && radiusCity.value)||30);

    // Multi-select kategorije
    var catsWrap=document.getElementById('cats');
    var selKey = (window.ACTIVE_MODE==='services' ? 'selectedListServices' : 'selectedListEvents');
    var selRaw = (catsWrap && catsWrap.dataset && catsWrap.dataset[selKey]) ? String(catsWrap.dataset[selKey]) : '';
    var selectedCats = selRaw ? selRaw.split(',').filter(Boolean) : [];
    var subSelect=document.getElementById('searchSubcategory');
    var subVal=(subSelect && !subSelect.disabled && subSelect.value)?subSelect.value:"";
    var freeOnlyChecked=(freeOnly && freeOnly.checked);

    var quickMode = window.quickMode || '';

    var fromTs=null, toTs=null;
    if(window.ACTIVE_MODE==='events'){
      if(quickMode){
        var now=new Date(), from=new Date(now), to=new Date(now);
        if(quickMode==='weekend'){ var d=now.getDay(); var ds=(6-(d||7)); from.setDate(now.getDate()+ds); to=new Date(from); to.setDate(from.getDate()+1); }
        else if(quickMode==='7'){ to.setDate(now.getDate()+7); }
        else if(quickMode==='30'){ to.setDate(now.getDate()+30); }
        fromTs=from.setHours(0,0,0,0); toTs=to.setHours(23,59,59,999);
      } else {
        var df=document.getElementById('dateFrom'), dt=document.getElementById('dateTo');
        if(df && df.value) fromTs=new Date(df.value).setHours(0,0,0,0);
        if(dt && dt.value) toTs=new Date(dt.value).setHours(23,59,59,999);
      }
    }

    var params={ q:qVal, radiuskm:(cityVal?radCity:radUser), page:page, size:80 };
    if (byGeo && window.GEO) params.latlon=window.GEO; else if (cityVal) params.city=cityVal; else if (window.GEO) params.latlon=window.GEO;
    if (subVal) params.subcategory=subVal;
    if (selectedCats.length) params.categories = selectedCats.join(',');

    var internal=[], external=[];
    fetch('/api/provider-list?'+window.qs({ q:qVal, radiuskm:(cityVal?radCity:radUser), page:page, size:80, mode:window.ACTIVE_MODE, city:cityVal, latlon:params.latlon }))
      .then(function(r){return r.json();})
      .then(function(d){ internal=(d && d.results)?d.results:[]; })
      .catch(function(){ internal=[]; })
      .finally(function(){
        fetch('/api/search?'+window.qs(params))
          .then(function(r){return r.json();})
          .then(function(d){ external=(d && d.results)?d.results:[]; })
          .catch(function(){ external=[]; })
          .finally(function(){
            var items=internal.concat(external).map(window.normalizeItem);
            items = window.modeFilter ? window.modeFilter(items) : items;
            // dedupe
            var seen={}, nowTs=Date.now();
            items=items.filter(function(e){
              var k=((e.name||e.title||'').toLowerCase())+'|'+(e.start||'')+'|'+((e.venue&&e.venue.address)||e.address||'');
              if(seen[k]) return false; seen[k]=1; return true;
            });
            // expiry
            items=items.filter(function(e){ var t=window.getEndTs?window.getEndTs(e):Date.parse(e.end||e.start); return isFinite(t)?t>=nowTs:true; });
            // date filter
            if(window.ACTIVE_MODE==='events' && (fromTs || toTs)){
              items=items.filter(function(e){
                var t=window.parseDateAny?window.parseDateAny(e.start || e.end):Date.parse(e.start||e.end);
                if(!isFinite(t)) return false; if(fromTs && t<fromTs) return false; if(toTs && t>toTs) return false; return true;
              });
            }
            // category fallback
            for(var i=0;i<items.length;i++){ if(!items[i].category && window.detectCategory) items[i].category=window.detectCategory(items[i]); }
            // city filter
            if(cityVal){ var c=cityVal.toLowerCase(); items=items.filter(function(e){ var txt=((e.venue&&(e.venue.address||e.venue.city)) || e.city || e.address || '').toLowerCase(); return txt.indexOf(c)>-1; }); }
            // free events
            if(freeOnlyChecked && window.ACTIVE_MODE==='events'){
              items=items.filter(function(e){ if(window.isExternalAPI && window.isExternalAPI(e)) return false; var tiersFree=(Array.isArray(e.ticketPrices)&&e.ticketPrices.length>0)? e.ticketPrices.every(function(tp){return Number(tp.price||0)===0;}) : true; var baseFree=(e.offerType==='none') || Number(e.price||0)===0; return baseFree && tiersFree; });
            }
            // early & stock pre-filter
            items = window.filterEarlyAndStock ? window.filterEarlyAndStock(items) : items;
            // multi-cat
            if(selectedCats.length){ var catList = selectedCats.map(function(c){ return String(c).toLowerCase(); }); items=items.filter(function(e){ var c=(e.category||'').toString().toLowerCase(); return catList.some(function(k){ return c===k || c.indexOf(k)>-1; }); }); }
            // subcat
            if(subVal){ var targetSub=subVal.toLowerCase(); items=items.filter(function(e){ var raw=((e.subcategory||e.subCategory||e.subcategoryKey)||'').toString().toLowerCase(); if(raw) return raw===targetSub; var tags=Array.isArray(e.tags)?e.tags.map(function(tag){ return String(tag).toLowerCase(); }):[]; if(tags.length) return tags.indexOf(targetSub)>-1; return true; }); }

            var emailEarly=null; try{ emailEarly=localStorage.getItem('user_email')||''; }catch(_){ emailEarly=''; }
            function finalize(){
              var PAGE_SIZE=10; var total=items.length; var pages=Math.max(1, Math.ceil(total/PAGE_SIZE)); var safePage=Math.max(0, Math.min(page, pages-1)); var slice=items.slice(safePage*PAGE_SIZE, safePage*PAGE_SIZE+PAGE_SIZE);
              var box=document.getElementById('results'); if(!box) return; box.innerHTML='';
              if(!slice.length){ box.innerHTML='<div class="card" style="color:var(--muted)">Ni rezultatov. Poskusi druge datume, večji radij ali drugo mesto.</div>'; if(window.mapSearch){ window.clearMarkers && window.clearMarkers(window.markersSearch); window.markersSearch=[]; } }
              else { slice.forEach(function(e){ var card=window.renderSpotCard?window.renderSpotCard(e):document.createElement('div'); if(!card.className) card.className='spot'; box.appendChild(card); }); }
              if(window.mapSearch && window.setMarkersOn){ window.clearMarkers && window.clearMarkers(window.markersSearch); window.markersSearch=window.setMarkersOn(window.mapSearch, slice); }
              var p=document.getElementById('pagination'); if(p){ p.innerHTML=''; var prev=window.el('button','btn link'); prev.textContent='Nazaj'; prev.disabled=safePage<=0; prev.onclick=function(){ doSearch(safePage-1,false); }; var next=window.el('button','btn link'); next.textContent='Naprej'; next.disabled=safePage>=pages-1; next.onclick=function(){ doSearch(safePage+1,false); }; p.appendChild(prev); p.appendChild(next); }
            }
            if(window.IS_PREMIUM && window.EARLY_PREF_CATS && window.EARLY_PREF_CATS.size>0 && emailEarly){
              fetch('/api/offers-early?'+window.qs({ email: emailEarly, limit:200 }))
                .then(function(r){return r.json();})
                .then(function(d){ var early=Array.isArray(d && d.results)? d.results.map(function(e){ e._earlyPreview=!!e.earlyPreview; return window.normalizeItem(e); }):[]; var key=function(e){ return ((e.name||e.title||'').toLowerCase())+'|'+(e.start||'')+'|'+((e.venue&&e.venue.address)||e.address||''); }; var map=new Map(); items.forEach(function(it){ map.set(key(it), it); }); early.forEach(function(it){ map.set(key(it), it); }); items=Array.from(map.values()); })
                .catch(function(){})
                .finally(function(){ items = window.filterEarlyAndStock?window.filterEarlyAndStock(items):items; finalize(); });
            } else { items = window.filterEarlyAndStock?window.filterEarlyAndStock(items):items; finalize(); }
          });
      });
  }
  window.searchCore={ doSearch }; // expose
})();

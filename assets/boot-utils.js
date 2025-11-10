/* Minimal boot helpers that must be available early for legacy/non-module scripts.
   Keep this file tiny and safe to include as a classic script tag in <head>.
   It only defines window.hashId if not already present. */
(function(){
  'use strict';
  function _defaultHashId(e){
    try{
      if(e && e.id){ return ("ev-"+String(e.id)).replace(/[^a-z0-9]/gi,''); }
      var name = (e && (e.name||e.title||'')).toString().toLowerCase().replace(/[^a-z0-9]/g,'');
      var st = (e && (e.start||'')).toString().replace(/[^0-9]/g,'');
      return ('ev-'+name+'-'+st).slice(0,64);
    }catch(err){ return 'ev-'+Math.random().toString(36).slice(2,8); }
  }

  if(typeof window !== 'undefined'){
    if(!window.hashId) window.hashId = _defaultHashId;
    // small namespace for other potential tiny boot helpers in future
    window.NearGoBoot = window.NearGoBoot || { hashId: window.hashId };
  }
})();
(function(global){
  if (!global || typeof global !== 'object') {
    return;
  }

  const makeHashId = (entry) => {
    if (!entry) return 'ev-unknown';
    if (entry.id !== undefined && entry.id !== null) {
      return `ev-${String(entry.id).replace(/[^a-z0-9]/gi, '')}`;
    }
    const name = String(entry.name || entry.title || 'item')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48);
    const start = String(entry.start || entry.start_time || '')
      .replace(/[^0-9]/g, '')
      .slice(0, 16);
    const base = name || 'item';
    return `ev-${base}${start ? `-${start}` : ''}`.replace(/-+/g, '-');
  };

  const resolvedHashId = typeof global.hashId === 'function' ? global.hashId : makeHashId;

  if (global.hashId !== resolvedHashId) {
    global.hashId = resolvedHashId;
  }

  global.NearGoHelpers = global.NearGoHelpers || {};
  global.NearGoHelpers.hashId = global.hashId;
  try{
    const url = new URL(global.location.href);
    const enable = url.searchParams.get('edit') === '1' || url.hash === '#edit';
    if (enable) {
      const s = document.createElement('script');
      s.src = '/assets/edit-mode.js';
      s.defer = true;
      document.head.appendChild(s);
    }
  }catch(_){ }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : undefined));

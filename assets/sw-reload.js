(function(){
  if (!('serviceWorker' in navigator)) return;
  if (window.__ngSwReloadBound) return;
  window.__ngSwReloadBound = true;

  const STORAGE_KEY = 'ng_sw_version';
  const reloadPage = () => {
    if (document.visibilityState === 'visible') {
      location.reload();
      return;
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        document.removeEventListener('visibilitychange', onVisible);
        location.reload();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
  };

  navigator.serviceWorker.addEventListener('message', (event) => {
    const data = event?.data;
    if (!data || data.type !== 'SW_VERSION') return;
    const version = data.v || data.version || data.SW_VERSION || '';
    if (!version) return;
    try {
      const previous = sessionStorage.getItem(STORAGE_KEY);
      if (previous === version) return;
      sessionStorage.setItem(STORAGE_KEY, version);
    } catch (_) {
      /* ignore storage issues */
    }
    reloadPage();
  });
})();

// Minimal client helper to always use the latest deployed version
// - Registers the service worker
// - Reloads the page once when a new controller takes over
// - Tracks SW version and reloads if it changes

export function initSwReload(){
  if(!('serviceWorker' in navigator)) return;

  // Register (ok to call multiple times)
  try { navigator.serviceWorker.register('/sw.js'); } catch {}

  // Reload once when new SW becomes controller
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloaded) return; reloaded = true; try { location.reload(); } catch {}
  });

  // Handle version broadcast from SW
  navigator.serviceWorker.addEventListener('message', (event) => {
    const data = event.data || {};
    if (data.type === 'SW_VERSION'){
      const prev = localStorage.getItem('SW_VERSION');
      if (prev && prev !== data.version){
        try { location.reload(); } catch {}
      }
      try { localStorage.setItem('SW_VERSION', data.version); } catch {}
    }
  });
}

// Auto-init when module is imported
try { initSwReload(); } catch {}

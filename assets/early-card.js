// Lightweight in-app early notification card with polling
// Requirements: service worker registered; optional toast available

const API = '/api/early-inbox';

function renderCard(offer){
  // Avoid duplicates by tag
  if (document.querySelector(`.early-card[data-id="${offer.id}"]`)) return;
  const card = document.createElement('div');
  card.className = 'early-card';
  card.dataset.id = offer.id;
  const css = `
  .early-card{position:fixed;left:12px;right:12px;bottom:12px;z-index:10010;background:#fff;border:1px solid #cfe1ee;border-radius:14px;box-shadow:0 10px 30px rgba(0,0,0,.12);padding:12px 14px;display:flex;align-items:center;gap:12px}
  .early-card .info{flex:1}
  .early-card .title{font-weight:900;color:#0b1b2b}
  .early-card .sub{font-size:12px;color:#5b6b7b}
  .early-card .btn{background:#0bbbd6;color:#fff;border:none;padding:10px 12px;border-radius:10px;font-weight:800;cursor:pointer}
  .early-card .close{background:transparent;border:none;color:#5b6b7b;font-size:18px;cursor:pointer}
  @media(min-width:640px){.early-card{left:50%;transform:translateX(-50%);width:420px}}
  `;
  if (!document.getElementById('early-card-style')){ const s=document.createElement('style'); s.id='early-card-style'; s.textContent=css; document.head.appendChild(s); }
  card.innerHTML = `
    <div class="info">
      <div class="title">${offer.name || 'Nova ponudba'}</div>
      <div class="sub">Zgodnji dostop • ${offer.subcategory || ''}</div>
    </div>
    <button class="btn">Oglej si</button>
    <button class="close" aria-label="Zapri">×</button>
  `;
  card.querySelector('.btn').addEventListener('click', ()=>{
    const url = '/offer.html?id=' + encodeURIComponent(offer.id);
    window.location.href = url;
  });
  card.querySelector('.close').addEventListener('click', ()=> card.remove());
  document.body.appendChild(card);
  // Attempt to play a notification sound (user gesture may be required first load)
  try { playEarlySound(); } catch {}
}

async function pollInbox(){
  try{
    const email = localStorage.getItem('user_email') || '';
    if (!email) return;
    const r = await fetch(`${API}?email=${encodeURIComponent(email)}&limit=3&mark=1`).then(x=>x.json()).catch(()=>null);
    if (!r || !r.ok || !Array.isArray(r.items) || !r.items.length) return;
    for (const it of r.items){
      const offer = { id: it.offer_id, ...(it.payload||{}) };
      // Notify via service worker (system notification) if available
      if (navigator.serviceWorker?.controller){
        navigator.serviceWorker.controller.postMessage({ type:'EARLY_NOTIFY_PUSH', offer });
      }
      renderCard(offer);
    }
  }catch(err){ /* silent */ }
}

export function initEarlyCard(){
  // Poll every 60s
  setInterval(pollInbox, 60000);
  // Also poll once on load
  pollInbox();
}

// --- Sound support -------------------------------------------------------
let earlySoundLoaded = false;
let earlyAudioEl = null;
function ensureEarlyAudio(){
  if (earlyAudioEl) return earlyAudioEl;
  // Tiny 0.25s beep WAV (440Hz) generated; keep size minimal
  const wavBase64 = "UklGRhQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQwAAAAgICAfHx8fHyAgICAhISEh";
  earlyAudioEl = document.createElement('audio');
  earlyAudioEl.preload = 'auto';
  earlyAudioEl.src = 'data:audio/wav;base64,' + wavBase64;
  earlyAudioEl.style.display = 'none';
  document.body.appendChild(earlyAudioEl);
  return earlyAudioEl;
}
function playEarlySound(){
  const a = ensureEarlyAudio();
  if (!a) return;
  // Reset to start for repeated plays
  try { a.currentTime = 0; } catch {}
  const p = a.play();
  if (p && typeof p.then === 'function') {
    p.catch(()=>{
      // If blocked (autoplay policy), set up a one-time user gesture hook
      if (!earlySoundLoaded) {
        const resume = () => { try { a.play(); } catch{}; earlySoundLoaded = true; document.removeEventListener('click', resume); };
        document.addEventListener('click', resume, { once:true });
      }
    });
  } else {
    earlySoundLoaded = true;
  }
}

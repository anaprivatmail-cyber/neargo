// Lightweight in-app early notification card with polling
// Requirements: service worker registered; optional toast available

const API = '/api/early-inbox';

function renderCard(offer){
  if (!offer || !offer.id) return;
  // Defensive premium gating: only show if user is premium (backend already filters, but double-check).
  try{
    const isPremium = window.IS_PREMIUM === true || !!localStorage.getItem('ng_premium_active');
    if (!isPremium) return; // silently skip if not premium
  }catch{}
  // Avoid duplicates
  if (document.querySelector(`.early-card[data-id="${offer.id}"]`)) return;
  const card = document.createElement('div');
  card.className = 'early-card';
  card.dataset.id = offer.id;
  const css = `
  .early-card{position:fixed;left:12px;right:12px;bottom:12px;z-index:10010;background:linear-gradient(135deg,#ffffff,#f7fdff);border:2px solid #0bbbd6;border-radius:20px;box-shadow:0 14px 44px rgba(0,30,40,.25);padding:14px 16px;display:flex;align-items:flex-start;gap:14px;font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;animation:ecFade .35s ease}
  .early-card .badge{background:#ff6b6b;color:#fff;font-size:11px;font-weight:900;letter-spacing:.5px;padding:4px 8px;border-radius:999px;box-shadow:0 2px 6px rgba(255,107,107,.4);display:inline-flex;align-items:center;gap:4px}
  .early-card .info{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px}
  .early-card .title{font-weight:900;color:#0b1b2b;font-size:15px;line-height:1.25;word-break:break-word}
  .early-card .sub{font-size:12px;color:#0bbbd6;font-weight:700}
  .early-card .time{font-size:11px;color:#5b6b7b;font-weight:600}
  .early-card .actions{display:flex;flex-direction:column;gap:8px;align-items:flex-end}
  .early-card .btn-main{background:#ff6b6b;color:#fff;border:none;padding:10px 16px;border-radius:12px;font-weight:900;cursor:pointer;font-size:14px;box-shadow:0 4px 14px rgba(255,107,107,.4);transition:.2s}
  .early-card .btn-main:hover{background:#e95c5c}
  .early-card .close{background:#0bbbd6;color:#fff;border:none;width:34px;height:34px;border-radius:12px;font-size:18px;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 14px rgba(11,187,214,.4);transition:.2s}
  .early-card .close:hover{background:#099fb4}
  @media(min-width:640px){.early-card{left:50%;transform:translateX(-50%);width:440px}}
  @keyframes ecFade{from{transform:translateY(20px);opacity:0}to{transform:translateY(0);opacity:1}}
  `;
  if (!document.getElementById('early-card-style')){ const s=document.createElement('style'); s.id='early-card-style'; s.textContent=css; document.head.appendChild(s); }
  const publishAt = offer.publish_at ? new Date(offer.publish_at) : null;
  const timeStr = publishAt && !isNaN(publishAt.getTime()) ? publishAt.toLocaleTimeString('sl-SI',{hour:'2-digit',minute:'2-digit'}) : '';
  card.innerHTML = `
    <div class="info">
  <span class="badge" aria-label="Zgodnje obveščanje">🔔 Early</span>
      <div class="title">${offer.name || 'Nova ponudba'}</div>
      <div class="sub">${offer.subcategory || ''}</div>
      ${ timeStr ? `<div class="time">Objava ob ${timeStr}</div>` : '' }
    </div>
    <div class="actions">
      <button class="btn-main" type="button">Oglej si</button>
      <button class="close" aria-label="Zapri">×</button>
    </div>
  `;
  card.querySelector('.btn-main').addEventListener('click', ()=>{
    const url = '/offer.html?id=' + encodeURIComponent(offer.id);
    window.location.href = url;
  });
  card.querySelector('.close').addEventListener('click', ()=> card.remove());
  document.body.appendChild(card);
  try { playEarlySound(); } catch {}
  // Auto-hide after 40s to avoid clutter
  setTimeout(()=>{ try{ card.remove(); }catch{} }, 40000);
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

// Expose for potential manual trigger
export function showEarlyOfferCard(offer){ renderCard(offer); }

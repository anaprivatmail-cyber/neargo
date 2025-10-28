// Nea Assistant main logic
// See window.Nea global API at end
(function(){
'use strict';
const BRAND_COLOR = '#2a7fff';
const FAB_SIZE = 56;
const PANEL_WIDTH = 360;
const SWEEP_ANIMATION = 'nea-sweep';
const SWEEP_DURATION = 800;
const SWEEP_INTERVAL = 30000;
const DISMISS_KEY = 'NEA_LAST_DISMISS';
const HISTORY_KEY = 'NEA_HISTORY';
const LANGS = ['sl','en','it','de','hr','pl','cs','sk'];
const DEFAULT_LANG = 'sl';
const UI = {
  sl: {nea:'Nea', help:'Pomoč', send:'Pošlji', mic:'Govori', tts:'Glasno', close:'Zapri', placeholder:'Vprašaj me ...', typing:'Tipkam ...', error:'Težave s povezavo, poskusi znova.', limited:'Trenutno sem omejena, vendar lahko filtriram rezultate …', cta:'Želiš dodati v koledar ali kupiti vstopnico?', early:'Predčasna obvestila'},
  en: {nea:'Nea', help:'Help', send:'Send', mic:'Speak', tts:'Speak', close:'Close', placeholder:'Ask me ...', typing:'Typing ...', error:'Connection issue, try again.', limited:'I am currently limited, but I can filter results …', cta:'Want to add to calendar or buy a ticket?', early:'Early notifications'},
  it: {nea:'Nea', help:'Aiuto', send:'Invia', mic:'Parla', tts:'Voce', close:'Chiudi', placeholder:'Chiedimi ...', typing:'Sto scrivendo ...', error:'Problemi di connessione, riprova.', limited:'Sono limitata, ma posso filtrare i risultati …', cta:'Vuoi aggiungere al calendario o acquistare un biglietto?', early:'Notifiche anticipate'},
  de: {nea:'Nea', help:'Hilfe', send:'Senden', mic:'Sprechen', tts:'Laut', close:'Schließen', placeholder:'Frag mich ...', typing:'Schreibe ...', error:'Verbindungsproblem, versuche es erneut.', limited:'Ich bin derzeit eingeschränkt, kann aber Ergebnisse filtern …', cta:'Möchtest du zum Kalender hinzufügen oder ein Ticket kaufen?', early:'Frühzeitige Benachrichtigungen'},
  hr: {nea:'Nea', help:'Pomoć', send:'Pošalji', mic:'Govori', tts:'Glasno', close:'Zatvori', placeholder:'Pitaj me ...', typing:'Pišem ...', error:'Problemi s vezom, pokušaj ponovno.', limited:'Trenutno sam ograničena, ali mogu filtrirati rezultate …', cta:'Želiš dodati u kalendar ili kupiti ulaznicu?', early:'Rana obavijest'},
  pl: {nea:'Nea', help:'Pomoc', send:'Wyślij', mic:'Mów', tts:'Głośno', close:'Zamknij', placeholder:'Zapytaj mnie ...', typing:'Piszę ...', error:'Problem z połączeniem, spróbuj ponownie.', limited:'Obecnie mam ograniczenia, ale mogę filtrować wyniki …', cta:'Chcesz dodać do kalendarza lub kupić bilet?', early:'Wczesne powiadomienia'},
  cs: {nea:'Nea', help:'Pomoc', send:'Odeslat', mic:'Mluv', tts:'Hlasitě', close:'Zavřít', placeholder:'Zeptej se mě ...', typing:'Píšu ...', error:'Problém s připojením, zkuste to znovu.', limited:'Momentálně jsem omezená, ale mohu filtrovat výsledky …', cta:'Chcete přidat do kalendáře nebo koupit vstupenku?', early:'Včasná upozornění'},
  sk: {nea:'Nea', help:'Pomoc', send:'Odoslať', mic:'Hovoriť', tts:'Nahlas', close:'Zavrieť', placeholder:'Opýtaj sa ma ...', typing:'Píšem ...', error:'Problém s pripojením, skúste znova.', limited:'Momentálne som obmedzená, ale môžem filtrovať výsledky …', cta:'Chcete pridať do kalendára alebo kúpiť lístok?', early:'Včasné upozornenia'}
};
let lang = localStorage.lang || navigator.language?.slice(0,2) || DEFAULT_LANG;
if (!LANGS.includes(lang)) lang = DEFAULT_LANG;
let IS_PREMIUM = window.IS_PREMIUM;
let sweepTimer, sweepBlocked = false, sweepLast = 0, sweepAnimTimeout;
let panelOpen = false, typing = false, context = null, ttsActive = false, micActive = false, focusTrap = null;
let supportsMic = 'webkitSpeechRecognition' in window || 'SpeechRecognition' in window;
let supportsTTS = 'speechSynthesis' in window;
let history = getHistory();
function t(key){ return UI[lang][key] || UI[DEFAULT_LANG][key] || key; }
function getHistory(){
  try { return JSON.parse(localStorage[HISTORY_KEY+'_'+lang]||'[]'); } catch(e){ return []; }
}
function saveHistory(){
  localStorage[HISTORY_KEY+'_'+lang] = JSON.stringify(history.slice(-10));
}
function now(){ return Date.now(); }
function prefersReducedMotion(){
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
function sweepAllowed(){
  if (prefersReducedMotion()) return false;
  let last = +(localStorage[DISMISS_KEY]||0);
  return (now()-last > 10*60*1000);
}
function sweep(){
  if (!sweepAllowed() || panelOpen) return;
  let fab = document.querySelector('.nea-fab');
  if (!fab) return;
  fab.classList.add(SWEEP_ANIMATION);
  clearTimeout(sweepAnimTimeout);
  sweepAnimTimeout = setTimeout(()=>fab.classList.remove(SWEEP_ANIMATION), SWEEP_DURATION);
}
function startSweepTimer(){
  clearInterval(sweepTimer);
  sweepTimer = setInterval(()=>{
    if (!typing && !panelOpen && sweepAllowed() && document.hasFocus() && !recentActivity()) sweep();
  }, SWEEP_INTERVAL);
}
function recentActivity(){
  let last = +(window.NEA_LAST_ACTIVITY||0);
  return (now()-last < 20000);
}
function setActivity(){
  window.NEA_LAST_ACTIVITY = now();
}
function showPanel(){
  if (panelOpen) return;
  panelOpen = true;
  setActivity();
  document.body.classList.add('nea-panel-open');
  document.querySelector('.nea-panel').removeAttribute('aria-hidden');
  document.querySelector('.nea-panel textarea').focus();
  trapFocus();
  sendMetric('nea_use');
}
function hidePanel(){
  if (!panelOpen) return;
  panelOpen = false;
  document.body.classList.remove('nea-panel-open');
  document.querySelector('.nea-panel').setAttribute('aria-hidden','true');
  localStorage[DISMISS_KEY] = now();
  sendMetric('nea_dismiss');
  untrapFocus();
}
function togglePanel(){
  if (panelOpen) hidePanel(); else showPanel();
}
function trapFocus(){
  let panel = document.querySelector('.nea-panel');
  if (!panel) return;
  let focusable = panel.querySelectorAll('button,textarea');
  let first = focusable[0], last = focusable[focusable.length-1];
  function handler(e){
    if (e.key==='Tab') {
      if (e.shiftKey && document.activeElement===first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement===last) { e.preventDefault(); first.focus(); }
    } else if (e.key==='Escape') {
      hidePanel();
    }
  }
  panel.addEventListener('keydown', handler);
  focusTrap = ()=>panel.removeEventListener('keydown', handler);
}
function untrapFocus(){ if (focusTrap) focusTrap(); focusTrap=null; }
function render(){
  let root = document.getElementById('nea-root');
  if (!root) return;
  root.innerHTML = `
    <button class="nea-fab" aria-label="${t('nea')} – ${t('help')}" tabindex="0" type="button" style="background:${BRAND_COLOR}"><span aria-hidden="true">💬</span></button>
    <aside class="nea-panel" aria-hidden="true" role="dialog" aria-modal="true" aria-label="${t('nea')}" tabindex="-1">
      <header><span>${t('nea')}</span><button class="nea-close" aria-label="${t('close')}" tabindex="0" type="button">✖</button></header>
      <section class="nea-messages" role="log" aria-live="polite"></section>
      <footer>
        <textarea rows="1" placeholder="${t('placeholder')}" aria-label="${t('placeholder')}" tabindex="0"></textarea>
        <button class="nea-send" aria-label="${t('send')}" tabindex="0" type="button">${t('send')}</button>
        ${supportsMic?`<button class="nea-mic" aria-label="${t('mic')}" tabindex="0" type="button">🎙️</button>`:''}
        ${supportsTTS?`<button class="nea-tts" aria-label="${t('tts')}" tabindex="0" type="button">🔊</button>`:''}
      </footer>
    </aside>
  `;
  let fab = root.querySelector('.nea-fab');
  let panel = root.querySelector('.nea-panel');
  let close = root.querySelector('.nea-close');
  let send = root.querySelector('.nea-send');
  let textarea = root.querySelector('textarea');
  let mic = root.querySelector('.nea-mic');
  let tts = root.querySelector('.nea-tts');
  fab.onclick = showPanel;
  close.onclick = hidePanel;
  send.onclick = sendMessage;
  textarea.oninput = autoGrow;
  textarea.onkeydown = function(e){
    if (e.key==='Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };
  if (mic) mic.onclick = startMic;
  if (tts) tts.onclick = toggleTTS;
}
function autoGrow(e){
  let ta = e.target;
  ta.style.height = 'auto';
  ta.style.height = (ta.scrollHeight)+'px';
}
function sendMessage(){
  let textarea = document.querySelector('.nea-panel textarea');
  let text = textarea.value.trim();
  if (!text) return;
  textarea.value = '';
  autoGrow({target:textarea});
  addMessage('user', text);
  textarea.focus();
  doAIChat(text);
}
function addMessage(role, text, opts={}){
  let messages = document.querySelector('.nea-messages');
  if (!messages) return;
  let div = document.createElement('div');
  div.className = 'nea-msg nea-'+role;
  div.textContent = text;
  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight;
  if (role==='ai' && ttsActive && supportsTTS) speak(text);
}
function doAIChat(text){
  if (typing) return;
  typing = true;
  addMessage('ai', t('typing'));
  let payload = {lang, text, context};
  let done = false;
  let timeout = setTimeout(()=>{ if (!done) showError(t('error')); }, 15000);
  fetch('/api/ai-chat', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload)})
    .then(r=>r.json())
    .then(data=>{
      done = true;
      clearTimeout(timeout);
      let reply = data.reply || t('limited');
      replaceLastAI(reply);
      history.push({q:text,a:reply,ts:now()});
      saveHistory();
    })
    .catch(err=>{ done=true; clearTimeout(timeout); showError(t('error')); console.warn('[Nea]',err); });
  setTimeout(()=>{ typing=false; }, 1000);
}
function showError(msg){
  replaceLastAI(msg);
}
function replaceLastAI(text){
  let messages = document.querySelector('.nea-messages');
  if (!messages) return;
  let last = messages.querySelector('.nea-ai:last-child');
  if (last) last.textContent = text;
}
function startMic(){
  if (!supportsMic) return;
  micActive = true;
  sendMetric('nea_mic');
  let rec = window.SpeechRecognition ? new window.SpeechRecognition() : new window.webkitSpeechRecognition();
  rec.lang = lang;
  rec.interimResults = false;
  rec.maxAlternatives = 1;
  let stopped = false;
  rec.onresult = function(e){
    if (stopped) return;
    stopped = true;
    let val = e.results[0][0].transcript;
    addMessage('user', val);
    doAIChat(val);
  };
  rec.onerror = function(e){ stopped=true; showError(t('error')); };
  rec.onend = function(){ stopped=true; };
  rec.start();
  setTimeout(()=>{ if (!stopped) { rec.stop(); } }, 8000);
}
function speak(text){
  if (!supportsTTS) return;
  sendMetric('nea_tts');
  let u = new SpeechSynthesisUtterance(text);
  u.lang = lang;
  window.speechSynthesis.speak(u);
}
function toggleTTS(){ ttsActive = !ttsActive; }
function sendMetric(event){
  fetch('/api/analytics', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({event,lang,ts:now()})}).catch(()=>{});
}
function summarize(item){
  // Simple summary: title, date, venue, 1st sentence of description
  let d = item;
  let desc = (d.description||'').split(/[.!?]/)[0];
  let out = `${d.title||''} @ ${d.venue||''} (${d.start||''}). ${desc}`.trim();
  if (out.length>160) out = out.slice(0,157)+'...';
  return out;
}
function setLang(lc){ if (LANGS.includes(lc)) { lang=lc; render(); } }
function setContext(payload){ context = payload; }
window.Nea = {
  open: showPanel,
  close: hidePanel,
  toggle: togglePanel,
  context: setContext,
  summarize,
  setLang
};
document.addEventListener('DOMContentLoaded',()=>{
  render();
  startSweepTimer();
  document.addEventListener('keydown',e=>{ if (panelOpen) setActivity(); });
  document.addEventListener('mousedown',e=>{ if (panelOpen) setActivity(); });
});
})();

/* NearGo Edit Mode (lightweight). Enable with ?edit=1 or #edit. 
   Lets you select elements, move up/down, tweak margins, edit text, and export a change log.
   For product/design review only; changes are not persisted to server.
*/
(function(){
  'use strict';
  if (typeof window === 'undefined') return;
  if (window.__ng_edit_mode_loaded) return; window.__ng_edit_mode_loaded = true;

  const state = {
    active: true,
    selected: null,
    overlay: null,
    panel: null,
    changeLog: [],
    originals: new WeakMap(),
    hoverOutline: null
  };

  const css = `
  .ng-edit-outline{ outline: 2px dashed #0bbbd6; outline-offset: 2px; }
  .ng-edit-hover{ outline: 2px dotted rgba(11,187,214,0.6); outline-offset: 2px; }
  .ng-edit-panel{ position: fixed; left: 12px; right: 12px; bottom: 12px; z-index: 4000; background: #ffffff; border:1px solid #cfe1ee; border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,.12); padding: 8px; display:flex; align-items:center; gap:8px; font-family: Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; }
  .ng-edit-panel b{ font-size: 12px; color: #0b1b2b; }
  .ng-edit-panel button{ background:#0bbbd6; color:#fff; border:none; padding:8px 10px; border-radius:10px; font-weight:900; cursor:pointer; font-size:12px }
  .ng-edit-panel button.secondary{ background:#fff; color:#0b1b2b; border:1px solid #cfe1ee }
  .ng-edit-info{ font-size:12px; color:#5b6b7b; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; flex:1; }
  .ng-edit-textarea{ display:none; width:100%; height:80px; border:1px solid #cfe1ee; border-radius:8px; padding:6px 8px; font:inherit; }
  .ng-edit-fab{ position: fixed; top: 12px; right: 12px; z-index: 4100; background:#0bbbd6; color:#fff; border:none; padding:10px 12px; border-radius:999px; font-weight:900; box-shadow:0 8px 20px rgba(11,187,214,.35); cursor:pointer; }
  .ng-edit-fab.secondary{ background:#fff; color:#0b1b2b; border:1px solid #cfe1ee }
  @media(min-width:680px){ .ng-edit-panel{ left:auto; width: 560px; right: 12px; } }
  `;

  function addStyle(){ const s=document.createElement('style'); s.id = 'ng-edit-style'; s.textContent = css; document.head.appendChild(s); }

  function cssPath(el){
    if (!el || el.nodeType !== 1) return '';
    if (el.id) return `#${CSS.escape(el.id)}`;
    let path = [];
    let node = el;
    while (node && node.nodeType === 1 && path.length < 5){
      let sel = node.tagName.toLowerCase();
      if (node.className){
        const cls = String(node.className).trim().split(/\s+/).filter(Boolean).slice(0,2).map(c=>'.'+CSS.escape(c)).join('');
        if (cls) sel += cls;
      }
      const parent = node.parentElement;
      if (parent){
        const same = Array.from(parent.children).filter(x => x.tagName === node.tagName);
        if (same.length > 1){
          const idx = same.indexOf(node) + 1;
          sel += `:nth-of-type(${idx})`;
        }
      }
      path.unshift(sel);
      node = parent;
    }
    return path.join(' > ');
  }

  function select(el){
    if (state.selected === el) return;
    if (state.selected) state.selected.classList.remove('ng-edit-outline');
    state.selected = el;
    if (el) el.classList.add('ng-edit-outline');
    updateInfo();
  }

  function handleHover(e){
    const el = e.target;
    if (!el || el === state.panel || state.panel.contains(el)) return;
    if (state.hoverOutline && state.hoverOutline !== state.selected){ state.hoverOutline.classList.remove('ng-edit-hover'); }
    if (el !== state.selected){ el.classList.add('ng-edit-hover'); state.hoverOutline = el; }
  }
  function handleHoverOut(e){
    const el = e.target; if (el && el !== state.selected) el.classList.remove('ng-edit-hover');
  }

  function move(up){
    const el = state.selected; if (!el || !el.parentElement) return;
    const parent = el.parentElement;
    const siblings = Array.from(parent.children);
    const idx = siblings.indexOf(el);
    const newIdx = Math.max(0, Math.min(siblings.length-1, idx + (up?-1:1)));
    if (newIdx === idx) return;
    const ref = siblings[newIdx + (up?0:1)] || null;
    parent.insertBefore(el, ref);
    state.changeLog.push({ type: 'move', selector: cssPath(el), parent: cssPath(parent), toIndex: newIdx });
    updateInfo('Premaknjeno.');
  }

  function adjust(prop, delta){
    const el = state.selected; if (!el) return;
    if (!state.originals.has(el)) state.originals.set(el, { mt: el.style.marginTop, mb: el.style.marginBottom });
    const cur = parseInt(getComputedStyle(el)[prop], 10) || 0;
    const next = Math.max(0, cur + delta);
    el.style[prop] = next + 'px';
    state.changeLog.push({ type: 'style', selector: cssPath(el), prop, value: el.style[prop] });
    updateInfo(`${prop} = ${next}px`);
  }

  function toggleEditText(){
    const el = state.selected; if (!el) return;
    const ta = document.querySelector('.ng-edit-textarea'); if (!ta) return;
    const on = ta.style.display !== 'block';
    if (on){ ta.value = el.innerText.trim(); ta.style.display = 'block'; ta.focus(); }
    else { ta.style.display = 'none'; }
  }
  function applyText(){
    const el = state.selected; if (!el) return;
    const ta = document.querySelector('.ng-edit-textarea'); if (!ta) return;
    const old = el.innerText; const val = ta.value;
    if (old !== val){ el.innerText = val; state.changeLog.push({ type: 'text', selector: cssPath(el), old, value: val }); }
    updateInfo('Besedilo posodobljeno.');
  }

  function exportChanges(){
    const payload = { when: new Date().toISOString(), url: location.pathname + location.search, changes: state.changeLog };
    const str = JSON.stringify(payload, null, 2);
    try{ navigator.clipboard.writeText(str); updateInfo('Kopirano v odložišče.'); }
    catch(_){ const w=window.open('about:blank'); if(w){ w.document.write('<pre>'+str.replace(/[&<>]/g, m=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[m]))+'</pre>'); } }
  }

  function updateInfo(extra){
    const info = document.querySelector('.ng-edit-info');
    if (!info) return;
    const sel = state.selected ? cssPath(state.selected) : '(nič izbrano)';
    info.textContent = (extra? (extra+' · '):'') + sel;
  }

  function ensurePanelVisible(){
    if (!state.panel) return;
    state.panel.style.display = 'flex';
  }

  function togglePanel(){
    if (!state.panel) return;
    const cur = (state.panel.style.display || 'flex');
    state.panel.style.display = (cur === 'none') ? 'flex' : 'none';
  }

  function quickPick(){
    const btn = state.panel && state.panel.querySelector('[data-act="pick"]');
    if (btn) btn.click();
  }

  function buildPanel(){
    const panel = document.createElement('div'); panel.className = 'ng-edit-panel';
    panel.innerHTML = `
      <b>Edit Mode</b>
      <div class="ng-edit-info">Pripravljen.</div>
      <button class="secondary" data-act="pick">Izberi</button>
      <button class="secondary" data-act="up">Gor</button>
      <button class="secondary" data-act="down">Dol</button>
      <button class="secondary" data-act="mt-">−Top</button>
      <button class="secondary" data-act="mt+">+Top</button>
      <button class="secondary" data-act="mb-">−Bottom</button>
      <button class="secondary" data-act="mb+">+Bottom</button>
      <button data-act="text">Uredi besedilo</button>
      <button data-act="apply">Shrani tekst</button>
      <button data-act="export">Export</button>
    `;
    const ta = document.createElement('textarea'); ta.className = 'ng-edit-textarea'; panel.appendChild(ta);
    document.body.appendChild(panel);
    state.panel = panel;

    panel.addEventListener('click', function(ev){
      const act = ev.target && ev.target.getAttribute && ev.target.getAttribute('data-act'); if (!act) return;
      if (act === 'pick'){
        document.body.style.cursor = 'crosshair';
        const once = (e)=>{
          document.body.style.cursor = '';
          document.removeEventListener('click', once, true);
          const el = e.target;
          if (state.panel.contains(el)) return; // ignore clicks on panel
          select(el);
          e.preventDefault(); e.stopPropagation();
        };
        document.addEventListener('click', once, true);
        return;
      }
      if (act === 'up') return move(true);
      if (act === 'down') return move(false);
      if (act === 'mt-') return adjust('marginTop', -4);
      if (act === 'mt+') return adjust('marginTop', +4);
      if (act === 'mb-') return adjust('marginBottom', -4);
      if (act === 'mb+') return adjust('marginBottom', +4);
      if (act === 'text') return toggleEditText();
      if (act === 'apply') return applyText();
      if (act === 'export') return exportChanges();
    });

    document.addEventListener('mouseover', handleHover, true);
    document.addEventListener('mouseout', handleHoverOut, true);
    updateInfo();

    // Floating badge (always visible) to show/hide panel and quick-pick
    const fab = document.createElement('button');
    fab.className = 'ng-edit-fab';
    fab.type = 'button';
    fab.textContent = 'Edit';
    fab.title = 'Edit Mode – klik za prikaz orodij, dvojni klik za Izberi';
    fab.addEventListener('click', togglePanel);
    fab.addEventListener('dblclick', quickPick);
    document.body.appendChild(fab);

    // Keyboard shortcuts
    // Ctrl+Shift+E => toggle panel, Ctrl+Shift+P => pick, Ctrl+Shift+S => show panel
    document.addEventListener('keydown', (e) => {
      if (!e || !e.shiftKey || !e.ctrlKey) return;
      const k = (e.key||'').toUpperCase();
      if (k === 'E'){ e.preventDefault(); togglePanel(); }
      if (k === 'P'){ e.preventDefault(); quickPick(); }
      if (k === 'S'){ e.preventDefault(); ensurePanelVisible(); }
    });

    // Expose tiny API for console recovery
    try{
      window.NG_EDIT = {
        show: ensurePanelVisible,
        hide: () => { if(state.panel) state.panel.style.display = 'none'; },
        toggle: togglePanel,
        pick: quickPick
      };
    }catch(_){ }
  }

  function boot(){ addStyle(); buildPanel(); }

  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', boot);
  } else { boot(); }
})();

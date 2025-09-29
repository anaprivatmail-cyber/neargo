// assets/i18n.js
// Headless i18n: brez risanja novega UI; uporablja obstoječi #langWrap/#langMenu/#langLabel/#lang

const SUPPORTED = [
  ["sl","SL"],["en","EN"],["de","DE"],["hr","HR"],["it","IT"],
  ["hu","HU"],["fr","FR"],["es","ES"],["pt","PT"],["nl","NL"],
  ["pl","PL"],["cs","CS"],["sk","SK"],["ro","RO"],["bg","BG"],
  ["sr","SR"],["bs","BS"],["uk","UK"]
];

function setLabel(el, code){
  if (!el) return;
  el.textContent = (code || "SL").toUpperCase();
}

function saveLang(code){
  try { localStorage.setItem("lang", code); } catch {}
  // Obvesti app, če kje posluša
  try { window.dispatchEvent(new CustomEvent("lang:change",{ detail:{ lang:code }})); } catch {}
}

export function initI18n(){
  const wrap   = document.getElementById("langWrap");
  const menu   = document.getElementById("langMenu");
  const label  = document.getElementById("langLabel");
  const select = document.getElementById("lang");

  if (!wrap || !menu || !label || !select) return;

  // 1) Napolni skriti <select> in obstoječi dropdown meni (če še nista)
  if (!select.options.length) {
    SUPPORTED.forEach(([code, txt], i) => {
      const opt = document.createElement("option");
      opt.value = code; opt.textContent = txt;
      if (i === 0) opt.selected = true;
      select.appendChild(opt);
    });
  }
  if (!menu.children.length) {
    menu.innerHTML = SUPPORTED
      .map(([code, txt]) => `<button type="button" data-lang="${code}">${txt}</button>`)
      .join("");
  }

  // 2) Začetni jezik: localStorage -> navigator -> prvi v seznamu
  const stored = (()=>{
    try { return localStorage.getItem("lang") || ""; } catch { return ""; }
  })();
  const browser = (navigator.language || "sl").slice(0,2).toLowerCase();
  const initial = SUPPORTED.find(([c])=>c===stored)?.[0]
               || SUPPORTED.find(([c])=>c===browser)?.[0]
               || SUPPORTED[0][0];

  try { select.value = initial; } catch {}
  setLabel(label, initial);
  saveLang(initial);

  // 3) Klik na gumb v meniju – spremeni jezik in zapri meni
  menu.addEventListener("click", (e)=>{
    const btn = e.target.closest("button[data-lang]");
    if (!btn) return;
    const code = btn.getAttribute("data-lang");
    try { select.value = code; } catch {}
    setLabel(label, code);
    saveLang(code);

    // zapri meni (UI upravlja #langWrap.open – naj ga sname še main.js toggle)
    try {
      const wrap = document.getElementById("langWrap");
      wrap?.classList.remove("open");
      menu.hidden = true;
    }catch{}
  });

  // 4) Če nekdo ročno spremeni skriti <select>, uskladi label in shrani
  select.addEventListener("change", ()=>{
    const code = select.value || "sl";
    setLabel(label, code);
    saveLang(code);
  });
}

export default { initI18n };

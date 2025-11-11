// assets/i18n.js
// Popoln i18n sistem za NearGo z avtomatskim prevajanjem

class I18nManager {
  constructor() {
    this.currentLang = 'sl';
    this.translations = {};
    this.fallbackLang = 'en';
    
    // Razširjen seznam podprtih jezikov
    this.supportedLangs = [
      ["sl","SL"], // Slovenščina
      ["en","EN"], // Angleščina
      ["de","DE"], // Nemščina
      ["hr","HR"], // Hrvaščina
      ["it","IT"], // Italijanščina
      ["cs","CS"], // Češčina
      ["sk","SK"], // Slovaščina
      ["pl","PL"], // Poljščina
    ];
  }

  // Naloži prevode za jezik
  async loadTranslations(lang) {
    if (this.translations[lang]) {
      return this.translations[lang];
    }

    try {
      // Poskusi naložiti iz datotek za vse podprte jezike
      const response = await fetch(`/assets/i18n/${lang}.json`);
      if (response.ok) {
        this.translations[lang] = await response.json();
        console.log(`[i18n] Loaded translations for ${lang}`);
        return this.translations[lang];
      } else {
        console.warn(`[i18n] Translation file not found for ${lang}, using fallback`);
      }
    } catch(e) {
      console.warn(`[i18n] Could not load translations for ${lang}:`, e);
    }

    // Fallback na angleščino
    if (lang !== this.fallbackLang) {
      if (!this.translations[this.fallbackLang]) {
        try {
          const response = await fetch(`/assets/i18n/${this.fallbackLang}.json`);
          if (response.ok) {
            this.translations[this.fallbackLang] = await response.json();
          }
        } catch(e) {
          console.error(`[i18n] Could not load fallback language ${this.fallbackLang}:`, e);
        }
      }
      
      // Uporabi angleščino kot fallback
      this.translations[lang] = this.translations[this.fallbackLang] || {};
      console.log(`[i18n] Using fallback translations for ${lang}`);
      return this.translations[lang];
    }

    return {};
  }

  // Ustvari osnovne prevode za jezik
  createBasicTranslations(lang) {
    const base = this.translations['en'] || {};
    // V produkciji bi tukaj integrirali Google Translate API ali drug servis
    // Za sedaj samo vrnemo angleščino kot fallback
    return base;
  }

  // Pridobi prevod
  t(key, params = {}) {
    const keys = key.split('.');
    let value = this.translations[this.currentLang];
    
    // Navigiraj do ključa
    for (const k of keys) {
      if (value && typeof value === 'object') {
        value = value[k];
      } else {
        value = null;
        break;
      }
    }

    // Fallback na angleščino
    if (!value && this.currentLang !== this.fallbackLang) {
      let fallback = this.translations[this.fallbackLang] || {};
      for (const k of keys) {
        if (fallback && typeof fallback === 'object') {
          fallback = fallback[k];
        } else {
          fallback = null;
          break;
        }
      }
      value = fallback;
    }

    // Zadnji fallback - prikaži ključ
    if (!value) {
      value = key;
    }

    // Zamenjaj parametre
    if (typeof value === 'string' && Object.keys(params).length > 0) {
      Object.keys(params).forEach(param => {
        value = value.replace(new RegExp(`\\{${param}\\}`, 'g'), params[param]);
      });
    }

    return value;
  }

  // Posodobi UI
  updateUI() {
    console.log(`[i18n] Updating UI with language: ${this.currentLang}`);
    
    // Preveri, ali so prevodi naloženi
    if (!this.translations[this.currentLang]) {
      console.warn(`[i18n] No translations loaded for ${this.currentLang}`);
      return;
    }
    
    // Naslov strani
    const title = this.t('app.title');
    if (title !== 'app.title') {
      document.title = title;
    }
    
    // Vsi elementi z data-i18n atributom
    let translatedCount = 0;
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      const params = {};
      
      // Preverimo, ali element vsebuje parametre
      if (el.hasAttribute('data-i18n-params')) {
        try {
          Object.assign(params, JSON.parse(el.getAttribute('data-i18n-params')));
        } catch(e) {}
      }
      
      const translated = this.t(key, params);
      if (translated !== key) {
        el.textContent = translated;
        translatedCount++;
      } else {
        console.warn(`[i18n] Missing translation for key: ${key}`);
      }
    });
    
    console.log(`[i18n] Translated ${translatedCount} elements`);

    // Placeholder-ji
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
      const key = el.getAttribute('data-i18n-placeholder');
      const translated = this.t(key);
      if (translated !== key) {
        el.placeholder = translated;
      }
    });

    // Kategorije - posodobi dinamično generirane elemente
    if (window.renderCats) {
      window.renderCats();
    }

    // Posodobi gumbe in besedilo ki se generira dinamično
    if (window.updateDynamicContent) {
      window.updateDynamicContent();
    }

    // Toast sporočila
    if (window._toast && !window._toast._i18nWrapped) {
      const originalToast = window._toast;
      window._toast = (msgKey, isOk) => {
        const msg = this.t(msgKey) !== msgKey ? this.t(msgKey) : msgKey;
        originalToast(msg, isOk);
      };
      window._toast._i18nWrapped = true;
    }
  }

  // Nastavi jezik
  async setLanguage(lang) {
    const langData = this.supportedLangs.find(([code]) => code === lang);
    if (!langData) {
      console.warn(`[i18n] Unsupported language: ${lang}`);
      return;
    }

    console.log(`[i18n] Setting language to: ${lang}`);
    this.currentLang = lang;
    saveLang(lang);
    
    await this.loadTranslations(lang);
    this.updateUI();
    
    // Posodobi dinamično vsebino če je funkcija na voljo
    if (typeof updateDynamicContent === 'function') {
      updateDynamicContent();
    } else if (typeof window !== 'undefined' && window.updateDynamicContent) {
      window.updateDynamicContent();
    }
    
    // Posodobi UI label
    setLabel(document.getElementById('langLabel'), langData[1]);
    
    console.log(`[i18n] Language set to ${lang}, translations loaded:`, !!this.translations[lang]);
  }

  // Detectiraj jezik iz browser/geolokacije  
  async detectLanguage() {
    // 1. localStorage
    const stored = (()=>{
      try { return localStorage.getItem("lang") || ""; } catch { return ""; }
    })();
    
    if (stored && this.supportedLangs.find(([code]) => code === stored)) {
      return stored;
    }

    // 2. Browser language
    const browser = (navigator.language || "sl").slice(0,2).toLowerCase();
    if (this.supportedLangs.find(([code]) => code === browser)) {
      return browser;
    }

    // 3. Geolokacija (osnovni mapping)
    try {
      const geoLang = await this.detectFromLocation();
      if (geoLang && this.supportedLangs.find(([code]) => code === geoLang)) {
        return geoLang;
      }
    } catch(e) {}

    return 'sl'; // Default
  }

  async detectFromLocation() {
    try {
      const pos = await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {timeout: 3000});
      });
      
      // Osnovni mapping koordinat na jezik (približno)
      const lat = pos.coords.latitude;
      const lon = pos.coords.longitude;
      
      // Slovenija
      if (lat >= 45.4 && lat <= 46.9 && lon >= 13.4 && lon <= 16.6) return 'sl';
      // Hrvaška
      if (lat >= 42.4 && lat <= 46.6 && lon >= 13.5 && lon <= 19.4) return 'hr';
      // Italija
      if (lat >= 35.5 && lat <= 47.1 && lon >= 6.6 && lon <= 18.8) return 'it';
      // Nemčija/Avstrija
      if (lat >= 47.0 && lat <= 55.1 && lon >= 5.9 && lon <= 15.0) return 'de';
      // Francija
      if (lat >= 41.3 && lat <= 51.1 && lon >= -5.2 && lon <= 9.6) return 'fr';
      // Španija
      if (lat >= 27.6 && lat <= 43.8 && lon >= -18.2 && lon <= 4.3) return 'es';
      
      return null;
    } catch(e) {
      return null;
    }
  }
}

// Globalna instanca
const i18nManager = new I18nManager();

const SUPPORTED = i18nManager.supportedLangs;

function setLabel(el, code){
  if (!el) return;
  el.textContent = (code || "SL").toUpperCase();
}

function saveLang(code){
  try { localStorage.setItem("lang", code); } catch {}
  // Obvesti app, če kje posluša
  try { window.dispatchEvent(new CustomEvent("lang:change",{ detail:{ lang:code }})); } catch {}
}

// Inicializiraj i18n sistem
export async function initI18n(){
  const wrap   = document.getElementById("langWrap");
  const menu   = document.getElementById("langMenu");
  const label  = document.getElementById("langLabel");
  const select = document.getElementById("lang");

  if (!wrap || !menu || !label || !select) return;

  // 1) Napolni skriti <select> in obstoječi dropdown meni
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

  // 2) Detectiraj in nastavi začetni jezik
  const initialLang = await i18nManager.detectLanguage();
  await i18nManager.setLanguage(initialLang);
  
  try { select.value = initialLang; } catch {}

  // 3) Klik na gumb v meniju
  menu.addEventListener("click", async (e)=>{
    const btn = e.target.closest("button[data-lang]");
    if (!btn) return;
    const code = btn.getAttribute("data-lang");
    
    await i18nManager.setLanguage(code);
    try { select.value = code; } catch {}

    // Zapri meni
    try {
      menu.style.display = 'none';
    }catch{}
  });

  // 4) Ročna sprememba
  select.addEventListener("change", async ()=>{
    const code = select.value || "sl";
    await i18nManager.setLanguage(code);
  });

  // Izpostavi globalno
  window.i18n = i18nManager;
}

export default { initI18n, i18nManager };

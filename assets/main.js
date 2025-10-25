// assets/main.js
function cacheBust(){ return (window.__BUILD_TS__ || String(Date.now())); }

function syncHeaderHeight(){
  const nav = document.querySelector('header .nav');
  if (!nav) return;
  const h = nav.offsetHeight || 108;
  document.documentElement.style.setProperty('--header-h', `${h}px`);
}

document.addEventListener('DOMContentLoaded', async () => {
  console.log("main.js DOMContentLoaded - initializing...");
  
  // 1) jezikovni meni – odpiranje z .open, zapiranje ob kliku izven
  const wrap = document.getElementById('langWrap');
  const menu = document.getElementById('langMenu');
  const label = document.getElementById('langLabel');
  
  if (wrap && menu){
    // 18 jezikov kot zahtevano
    const languages = [
      {code: 'sl', name: 'Slovenščina', flag: '🇸🇮'},
      {code: 'en', name: 'English', flag: '🇬🇧'},
      {code: 'de', name: 'Deutsch', flag: '🇩🇪'},
      {code: 'it', name: 'Italiano', flag: '🇮🇹'},
      {code: 'fr', name: 'Français', flag: '🇫🇷'},
      {code: 'es', name: 'Español', flag: '🇪🇸'},
      {code: 'hr', name: 'Hrvatski', flag: '🇭🇷'},
      {code: 'sr', name: 'Српски', flag: '🇷🇸'},
      {code: 'hu', name: 'Magyar', flag: '🇭🇺'},
      {code: 'cs', name: 'Čeština', flag: '🇨🇿'},
      {code: 'sk', name: 'Slovenčina', flag: '🇸🇰'},
      {code: 'pl', name: 'Polski', flag: '🇵🇱'},
      {code: 'ru', name: 'Русский', flag: '🇷🇺'},
      {code: 'nl', name: 'Nederlands', flag: '🇳🇱'},
      {code: 'pt', name: 'Português', flag: '🇵🇹'},
      {code: 'ro', name: 'Română', flag: '🇷🇴'},
      {code: 'bg', name: 'Български', flag: '🇧🇬'},
      {code: 'tr', name: 'Türkçe', flag: '🇹🇷'}
    ];
    
    // Ustvari gumbe za jezike
    menu.innerHTML = ''; // počisti obstoječe
    languages.forEach(lang => {
      const btn = document.createElement('button');
      btn.innerHTML = `${lang.flag} ${lang.name}`;
      btn.onclick = () => {
        if(label) label.textContent = lang.code.toUpperCase();
        localStorage.setItem('ng_lang', lang.code);
        wrap.classList.remove('open');
        menu.hidden = true;
        menu.style.display = 'none';
        console.log(`Language changed to: ${lang.name}`);
      };
      menu.appendChild(btn);
    });
    
    // Naloži shranjeni jezik
    const savedLang = localStorage.getItem('ng_lang') || 'sl';
    const currentLang = languages.find(l => l.code === savedLang);
    if(label && currentLang) label.textContent = currentLang.code.toUpperCase();
    
    wrap.classList.remove('open'); 
    menu.hidden = true;
    
    // Odpiranje z klikom na langWrap, zapiranje z klikom izven
    wrap.addEventListener('click', (e)=>{
      if (e.target.closest('.lang-menu')) return; // Ne zapri če kliknemo na menu
      e.stopPropagation();
      const opened = wrap.classList.toggle('open');
      menu.hidden = !opened;
      menu.style.display = opened ? 'block' : 'none';
    });
    
    // Zapiranje z klikom kjerkoli drugje
    document.addEventListener('click', ()=>{ 
      wrap.classList.remove('open'); 
      menu.hidden = true; 
      menu.style.display = 'none';
    });
    
    console.log("Language menu initialized with 18 languages");
  }

  // 2) višina glave
  syncHeaderHeight();
  if ('ResizeObserver' in window){
    const nav = document.querySelector('header .nav');
    if (nav) new ResizeObserver(syncHeaderHeight).observe(nav);
  }
  window.addEventListener('resize', syncHeaderHeight, {passive:true});
  setTimeout(syncHeaderHeight, 150);

  // 3) zaženi tvoj app (vsa logika, ki je bila prej v indexu)
  if (typeof window.appInit === 'function') {
    console.log("Calling window.appInit() from main.js");
    window.appInit();
  } else {
    console.warn("window.appInit() not found, trying direct initialization");
    // Fallback: če appInit ni na voljo, poizkusi direktno
    if (typeof initializeApp === 'function') {
      initializeApp();
    }
  }
});
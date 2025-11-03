import { createClient } from '@supabase/supabase-js';

const supabase = createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);

async function getSessionState() {
  const { data: { session } } = await supabase.auth.getSession();
  const isLoggedIn = !!session?.user?.id;
  let isPremium = false;

  if (isLoggedIn) {
    const uid = session.user.id;
    const { data, error } = await supabase
      .from('premium_subscriptions')
      .select('status')
      .eq('user_id', uid)
      .maybeSingle();
    if (!error && data) isPremium = ['active','past_due'].includes(data.status);
  }
  return { isLoggedIn, isPremium };
}

export async function renderHeaderUI() {
  const { isLoggedIn, isPremium } = await getSessionState();

  const btnAcc  = document.getElementById('btnAccount');
  const menu    = document.getElementById('accountMenu');
  const badge   = document.getElementById('badgePremium');
  const btnUpg  = document.getElementById('btnUpgradeHeader');
  const miUp    = document.getElementById('mi-upgrade'); // v meniju: Nadgradi na Premium
  const miMng   = document.getElementById('mi-manage');  // v meniju: Upravljaj Premium
  const pointsSlider = document.getElementById('pointsSlider');
  const pointsValue  = document.getElementById('pointsValue');
  const pointsEuro   = document.getElementById('pointsEuro');
  const pointsGoal   = document.getElementById('pointsGoal');

  // Safe-guards
  if (!btnAcc || !btnUpg) return;

  // Guest
  if (!isLoggedIn) {
    badge?.setAttribute('hidden','');
    btnUpg?.setAttribute('hidden','');     // CTA samo na pasici
    if (miUp)  miUp.hidden  = true;
    if (miMng) miMng.hidden = true;
    if (pointsSlider) pointsSlider.value = 0;
    if (pointsValue)  pointsValue.textContent = '0';
    if (pointsEuro)   pointsEuro.textContent = '(0 €)';
    if (pointsGoal)   pointsGoal.textContent = 'do nagrade';

    btnAcc.onclick = (e) => { e.preventDefault(); window.Auth ? Auth.open() : location.href='/login.html'; };
    document.addEventListener('click', (ev) => { if (menu && !menu.contains(ev.target) && !btnAcc.contains(ev.target)) menu.hidden = true; });
    return;
  }

  // Pridobi točke iz Supabase
  let points = 0;
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const uid = session.user.id;
    // Tabela: user_points (ali podobno, prilagodi po tvoji shemi)
    const { data, error } = await supabase
      .from('user_points')
      .select('points')
      .eq('user_id', uid)
      .maybeSingle();
    if (!error && data && typeof data.points === 'number') points = data.points;
  } catch {}

  // Preračun v EUR (100 točk = 1 EUR)
  const POINTS_PER_EURO = 100;
  const euroValue = (points / POINTS_PER_EURO).toFixed(2);
  if (pointsSlider) pointsSlider.value = points;
  if (pointsValue)  pointsValue.textContent = points;
  if (pointsEuro)   pointsEuro.textContent = `(${euroValue} €)`;
  if (pointsGoal) {
    const nextReward = Math.ceil((points+1)/POINTS_PER_EURO)*POINTS_PER_EURO;
    const missing = nextReward - points;
    pointsGoal.textContent = missing > 0 ? `Še ${missing} točk do nagrade` : 'Nagrada dosežena!';
  }

  // Logged-in
  btnAcc.onclick = (e) => {
    e.preventDefault();
    if (!menu) return;
    const open = menu.hidden !== false;
    menu.hidden = !open;
    btnAcc.setAttribute('aria-expanded', String(open));
  };

  if (isPremium) {
    badge?.removeAttribute('hidden');       // ⭐ prikaži
    btnUpg?.setAttribute('hidden','');      // gumb Nadgradi skrij
    if (miUp)  miUp.hidden  = true;
    if (miMng) miMng.hidden = false;
  } else {
    badge?.setAttribute('hidden','');       // brez zvezdice
    btnUpg?.removeAttribute('hidden');      // gumb Nadgradi prikaži
    if (miUp)  miUp.hidden  = false;
    if (miMng) miMng.hidden = true;
  }

  // Pridobivanje točk (primeri, implementacija v backendu):
  // - Ogled 5 dogodkov/storitev prvič: +10
  // - Povabilo 2 prijatelja (ki se registrirata): +10
  // - Prva prijava: +10
  // - Prvi nakup vstopnice/kupona: +10
  // - Dodatno: npr. ocena dogodka, delitev na družabnih omrežjih, feedback ...
  // Backend naj beleži in dodeljuje točke po teh pravilih.

  // Menjava točk: uporabnik lahko točke zamenja za Premium, kupon ali vstopnico (opis v meniju).
}

// Avtomatski refresh na spremembo auth stanja
supabase.auth.onAuthStateChange((_event, _session) => { renderHeaderUI(); });

// Init na load
document.addEventListener('DOMContentLoaded', renderHeaderUI);

import { supabase } from '/assets/supabase-client.js';

const balanceEl = document.getElementById('balance');
const historyEl = document.getElementById('history');
const btnConvert = document.getElementById('btnConvert');
const convInfo = document.getElementById('convInfo');
const btnRedeem = document.getElementById('btnRedeem');
const redeemInfo = document.getElementById('redeemInfo');

async function load(){
  balanceEl.textContent = 'Nalaganje stanja…';
  try{
    const s = await supabase.auth.getSession();
    const u = s?.data?.session?.user || null;
    if (!u) { balanceEl.innerHTML = '<a class="btn" href="/login.html">Prijava</a>'; return; }

    // Try to fetch wallet & ledger via rewards-history (server function)
    const res = await fetch('/.netlify/functions/rewards-history?email='+encodeURIComponent(u.email));
    const j = await res.json();
    if (!j.ok){ balanceEl.textContent = 'Ni podatkov'; historyEl.textContent = '' ; return; }
    const rows = j.rows || [];
    historyEl.innerHTML = rows.length ? rows.slice(0,30).map(r=>`<div>${new Date(r.created_at||r.inserted_at).toLocaleString()} — ${r.type||r.kind||''} — pts ${r.points||r.points_delta||0} — cents ${r.amount||r.credits_cents_delta||0} — ${r.note||r.reason||''}</div>`).join('') : 'Brez zgodovine.';
    balanceEl.innerHTML = `<div>Zadnjih vpisov: ${rows.length}</div>`;
  }catch(e){ balanceEl.textContent = 'Napaka pri nalaganju'; console.error(e); }
}

btnConvert.addEventListener('click', async ()=>{
  convInfo.textContent = 'Pošiljam…';
  const points = Number(document.getElementById('convertPoints').value);
  if (!Number.isInteger(points) || points <= 0) { convInfo.textContent = 'Vnesite veljavno število točk'; return; }
  try{
    const s = await supabase.auth.getSession();
    const email = s?.data?.session?.user?.email;
    if (!email){ convInfo.textContent = 'Prijavite se.'; return; }
    const res = await fetch('/.netlify/functions/rewards-convert',{ method:'POST', headers:{ 'content-type':'application/json' }, body: JSON.stringify({ email, points }) });
    const j = await res.json();
    if (j.ok){ convInfo.textContent = 'Uspešno pretvorjeno.'; load(); } else convInfo.textContent = 'Napaka: '+(j.error||'');
  }catch(e){ convInfo.textContent = 'Napaka pri povezavi'; }
});

btnRedeem.addEventListener('click', async ()=>{
  redeemInfo.textContent = 'Pošiljam…';
  const type = document.getElementById('redeemType').value;
  const eur = Number(document.getElementById('redeemAmount').value);
  if (!eur || eur <= 0){ redeemInfo.textContent = 'Vnesite znesek v €'; return; }
  try{
    const s = await supabase.auth.getSession();
    const email = s?.data?.session?.user?.email;
    if (!email){ redeemInfo.textContent = 'Prijavite se.'; return; }
    // Map euros to points using same rate as server POINT_TO_DOLLAR = 0.01 -> 1 euro = 100 points
    const points = Math.round(eur * 100);
    const res = await fetch('/.netlify/functions/rewards-redeem',{ method:'POST', headers:{ 'content-type':'application/json' }, body: JSON.stringify({ email, points, reward_code: type }) });
    const j = await res.json();
    if (j.ok){ redeemInfo.textContent = 'Uspešno vnovčeno.'; load(); } else redeemInfo.textContent = 'Napaka: '+(j.error||'');
  }catch(e){ redeemInfo.textContent = 'Napaka pri povezavi'; }
});

load();

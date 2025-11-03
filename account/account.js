import { supabase } from '/assets/supabase-client.js';

const status = document.getElementById('status');
const profile = document.getElementById('profile');
const btnSignOut = document.getElementById('btnSignOut');
const btnManage = document.getElementById('btnManagePremium');

async function render(){
  status.textContent = 'Preverjam prijavo…';
  try{
    const s = await supabase.auth.getSession();
    const session = s?.data?.session || null;
    if (!session){ status.textContent = 'Niste prijavljeni.'; profile.innerHTML = `<a class="btn" href="/login.html">Prijava / Registracija</a>`; return; }
    const u = session.user;
    status.textContent = '';
    const html = `
      <div class="row"><strong>Email:</strong> ${u.email || ''}</div>
      <div class="row"><strong>ID:</strong> ${u.id}</div>
      <div class="row"><strong>Metadata:</strong> <pre style="white-space:pre-wrap">${JSON.stringify(u.user_metadata||{},null,2)}</pre></div>
    `;
    profile.innerHTML = html;

    // Try to detect premium subscription
    try{
      const { data, error } = await supabase.from('premium_subscriptions').select('status').eq('user_id', u.id).maybeSingle();
      const active = !!(data && data.status === 'active');
      if (active){ btnManage.textContent = 'Upravljaj Premium (aktiven)'; }
    }catch(e){ console.warn('premium check failed', e); }

  }catch(e){ status.textContent = 'Napaka pri nalaganju profila'; console.error(e); }
}

btnSignOut.addEventListener('click', async ()=>{
  try{ await supabase.auth.signOut(); window.location.href = '/'; }catch(e){ window.location.href = '/.netlify/functions/logout'; }
});

render();

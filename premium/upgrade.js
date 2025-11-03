import { supabase } from '/assets/supabase-client.js';

const btn = document.getElementById('btnStartCheckout');
const info = document.getElementById('pcInfo');

btn.addEventListener('click', async ()=>{
  info.textContent = 'Pripravljam nakup…';
  try{
    // In a production setup we'd call a server endpoint to create a Stripe Checkout session
    // For now show guidance and redirect to premium.html (or show modal)
    info.textContent = 'Za izvedbo plačila v aplikaciji uporabimo App Store / Play Billing; na spletu uporabljamo Stripe.';
    setTimeout(()=>{ window.location.href = '/premium.html'; }, 1200);
  }catch(e){ info.textContent = 'Napaka pri začetku nakupa.'; }
});

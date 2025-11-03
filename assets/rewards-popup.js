// assets/rewards-popup.js
export function showRewardPopup(points, reason){
  try{
    const msg = document.createElement('div');
    msg.className = 'reward-popup';
    msg.innerHTML = `<div class="points">+${points} 🪙</div><div class="text">${reason}</div>`;
    document.body.appendChild(msg);
    // trigger reflow then show
    setTimeout(()=>msg.classList.add('show'),10);
    // small confetti for first-time reward (or every reward if you prefer)
    runMiniConfetti();
    setTimeout(()=>msg.classList.remove('show'),4000);
    setTimeout(()=>msg.remove(),4500);
  }catch(e){ console.warn('showRewardPopup err', e); }
}

function runMiniConfetti(){
  const colors = ['#ff5a5f','#ffb400','#00b894','#0984e3','#6c5ce7'];
  const count = 12;
  const wrap = document.createElement('div');
  wrap.className = 'mini-confetti';
  for (let i=0;i<count;i++){
    const el = document.createElement('div');
    el.className = 'mini-confetti-piece';
    el.style.background = colors[i % colors.length];
    el.style.left = (10 + Math.random()*80) + '%';
    el.style.transform = `rotate(${Math.random()*360}deg)`;
    wrap.appendChild(el);
  }
  document.body.appendChild(wrap);
  setTimeout(()=>wrap.classList.add('fall'),20);
  setTimeout(()=>wrap.remove(),2200);
}

// helper: subscribe to rewards_ledger inserts via supabase client
export function initRewardsListener(supabase, currentUserId){
  if (!supabase || !currentUserId) return;
  try{
    supabase.channel('public:rewards_ledger')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'rewards_ledger' }, (payload) => {
        try{
          const newRow = payload.record || payload.new;
          if (!newRow) return;
          if (String(newRow.user_id) !== String(currentUserId)) return;
          const points = Number(newRow.points || 0);
          const reason = newRow.reason || 'Nagrada';
          showRewardPopup(points, niceReasonText(reason));
        }catch(e){ console.warn('rewards listener error', e); }
      })
      .subscribe();
  }catch(e){ console.warn('initRewardsListener err', e); }
}

function niceReasonText(reason){
  const map = {
    'view_bonus': 'Bravo, raziskuješ nove dogodke!',
    'favorite': 'Hvala, da shranjuješ priljubljene!',
    'share': 'Hvala za deljenje!',
    'review_approved': 'Hvala za mnenje!',
    'notifications_setup': 'Čudovito, obvestila so nastavljena!',
    'purchase_coupon': 'Hvala za nakup kupona!',
    'purchase_ticket': 'Hvala za nakup vstopnice!'
  };
  return map[reason] || reason;
}

// assets/record-view.js
// Generic script to record an event/service view after the user stays on the details page for >=5s
import { supabase } from '/assets/supabase-client.js';

function findItemId(){
  // 1) meta tag
  const m = document.querySelector('meta[name="event-id"]') || document.querySelector('meta[name="item-id"]');
  if (m && m.content) return m.content;
  // 2) element with data-event-id
  const el = document.querySelector('[data-event-id], [data-item-id]');
  if (el) return el.dataset.eventId || el.dataset.itemId;
  // 3) input#eventId
  const input = document.getElementById('eventId');
  if (input && input.value) return input.value;
  // 4) url params
  const ps = new URLSearchParams(location.search);
  return ps.get('eventId') || ps.get('id') || ps.get('eid') || null;
}

export function initRecordView({ item_type='event', delayMs=5000, dedupeDays=7 }={}){
  try{
    const itemId = findItemId();
    if (!itemId) return;
    const storageKey = `viewed:${item_type}:${itemId}`;
    const last = localStorage.getItem(storageKey);
    if (last) {
      const t = Number(last);
      if (!isNaN(t) && (Date.now() - t) < dedupeDays*24*60*60*1000) return; // already viewed in window
    }

    // wait for delay
    setTimeout(async ()=>{
      try{
        const session = await supabase.auth.getSession();
        const token = session?.data?.session?.access_token;
        if (!token) return; // only record for logged-in users
        await fetch('/.netlify/functions/record-view', {
          method: 'POST', headers: { 'content-type':'application/json','authorization': `Bearer ${token}` },
          body: JSON.stringify({ item_id: itemId, item_type })
        });
        localStorage.setItem(storageKey, String(Date.now()));
      }catch(e){ console.warn('recordView err', e); }
    }, delayMs);
  }catch(e){ console.warn('initRecordView err', e); }
}

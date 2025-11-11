// netlify/functions/early-notify-offer.js
// Poslji predhodna obvestila takoj za en konkreten offer (če je v 15-min oknu).
// Klic: /api/early-notify-offer?id=<offerId>

const { createClient } = require('@supabase/supabase-js');
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supa = createClient(SUPABASE_URL, SERVICE_KEY, { auth:{ persistSession:false } });

const MINUTES_BEFORE = Number(process.env.EARLY_NOTIFY_MINUTES || 15);
// Monthly cap now 25 unless overridden
const MAX_PER_MONTH = Number(process.env.EARLY_NOTIFY_CAP || 25);

function km(aLat,aLon,bLat,bLon){
  const R=6371, toRad=d=>d*Math.PI/180;
  const dLat=toRad(bLat-aLat), dLon=toRad(bLon-aLon);
  const x=Math.sin(dLat/2)**2 + Math.cos(toRad(aLat))*Math.cos(toRad(bLat))*Math.sin(dLon/2)**2;
  return 2*R*Math.asin(Math.sqrt(x));
}

async function loadOffer(id){
  const { data, error } = await supa.from('offers').select('id,name,subcategory,venue_lat,venue_lon,publish_at').eq('id', id).maybeSingle();
  if (error) throw new Error('offer_load_failed: '+error.message);
  return data || null;
}
async function loadPrefs(){
  const { data, error } = await supa.from('notification_prefs').select('email,categories,lat,lon,radius,phone');
  if (error) throw new Error('prefs_load_failed: '+error.message);
  let prefs = (data||[]).filter(p=>Array.isArray(p.categories) && p.categories.length);
  // Enforce premium if enabled
  const requirePremium = (process.env.EARLY_NOTIFY_REQUIRE_PREMIUM || '1') !== '0';
  if (requirePremium && prefs.length){
    const emails = prefs.map(p=>p.email).filter(Boolean);
    let premiumEmails = new Set();
    try{ const { data: tix } = await supa.from('tickets').select('customer_email').in('customer_email', emails).eq('type','premium'); (tix||[]).forEach(r=>r.customer_email&&premiumEmails.add(r.customer_email)); }catch{}
    try{ const { data: pu } = await supa.from('premium_users').select('email,premium_until').in('email', emails); const now=Date.now(); (pu||[]).forEach(r=>{ if(r.email && r.premium_until && new Date(r.premium_until).getTime()>now) premiumEmails.add(r.email); }); }catch{}
    prefs = prefs.filter(p=>premiumEmails.has(p.email));
  }
  return prefs;
}
async function withinWindow(offer){
  if(!offer?.publish_at) return false;
  const pub = new Date(offer.publish_at);
  const now = new Date();
  const diffMs = pub.getTime() - now.getTime();
  // Send only if we are inside first minute where (publish_at - MINUTES_BEFORE) <= now < (publish_at - MINUTES_BEFORE + 60s)
  const earliest = pub.getTime() - MINUTES_BEFORE*60*1000;
  return now.getTime() >= earliest && now.getTime() < earliest + 60*1000;
}

async function sendToUser(email, phone, offer){
  // monthly cap check
  const monthStart = new Date(); monthStart.setUTCDate(1); monthStart.setUTCHours(0,0,0,0);
  const { count: totalThisMonth } = await supa
    .from('early_notify_sends')
    .select('*', { head:true, count:'exact' })
    .eq('email', email)
    .gte('sent_at', monthStart.toISOString());
  if (totalThisMonth != null && totalThisMonth >= MAX_PER_MONTH) return false;
  const { error: insErr } = await supa.from('early_notify_sends').insert({ email, offer_id: offer.id, subcategory: offer.subcategory });
  if (insErr){ if (insErr.code==='23505') return false; console.warn('[early-notify-offer] send log fail', insErr.message); return false; }
  // Stub: SMS/Email actual sending
  console.log('[early-notify-offer] send', email, offer.id);
  // In-app inbox record
  try{ await supa.from('early_notify_inbox').insert({ email, offer_id: offer.id, payload: { name: offer.name, subcategory: offer.subcategory, publish_at: offer.publish_at } }); }catch(e){ console.warn('[early-notify-offer] inbox insert failed', e.message||e); }
  if (phone) console.log('[SMS]', phone, 'offer', offer.id);
  return true;
}

exports.handler = async (event) => {
  try{
    const qs = event.queryStringParameters || {};
    const id = (qs.id||'').trim();
    if (!id) return { statusCode:400, body:'missing_id' };
    const offer = await loadOffer(id);
    if (!offer) return { statusCode:404, body:'not_found' };
    if (!await withinWindow(offer)) return { statusCode:200, body:'outside_window' };
    const prefs = await loadPrefs();
    let sent = 0;
    for (const p of prefs){
      if (!p.categories.includes(offer.subcategory)) continue;
      if (p.lat!=null && p.lon!=null && offer.venue_lat!=null && offer.venue_lon!=null){
        const dist = km(p.lat,p.lon,offer.venue_lat,offer.venue_lon);
        const r = Math.max(3, Math.min(50, Number(p.radius)||30));
        if (dist > r) continue;
      }
      const ok = await sendToUser(p.email, p.phone, offer);
      if (ok) sent++;
    }
    return { statusCode:200, body:`sent=${sent}` };
  }catch(e){
    console.error('[early-notify-offer] error', e.message||e);
    return { statusCode:500, body:'error' };
  }
};

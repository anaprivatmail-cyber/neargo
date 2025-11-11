// Serverless cron: predčasna obvestila Premium uporabnikom (cca 5–6 minut ali X ur prej)
// Nadgrajeno: filtriranje po podkategorijah in geo radiju (lat/lon + radius km)

const { createClient } = require('@supabase/supabase-js');
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supa = createClient(SUPABASE_URL, SERVICE_KEY, { auth:{ persistSession:false } });

// Fiksno koliko minut pred public objavo pošljemo Premium uporabnikom (privzeto 15)
const MINUTES_BEFORE = Number(process.env.EARLY_NOTIFY_MINUTES || 15);

// Haversine razdalja v km
function km(aLat,aLon,bLat,bLon){
  const R=6371, toRad=d=>d*Math.PI/180;
  const dLat=toRad(bLat-aLat), dLon=toRad(bLon-aLon);
  const x=Math.sin(dLat/2)**2 + Math.cos(toRad(aLat))*Math.cos(toRad(bLat))*Math.sin(dLon/2)**2;
  return 2*R*Math.asin(Math.sqrt(x));
}

async function getEarlyNotifyPrefs(){
  // notification_prefs: email, categories[], lat, lon, radius
  const { data, error } = await supa
    .from('notification_prefs')
    .select('email,categories,lat,lon,radius');
  if (error) throw new Error('prefs_error: '+error.message);
  let prefs = (data||[]).filter(p=>Array.isArray(p.categories) && p.categories.length);
  // Premium gating: optionally require active premium subscription
  const requirePremium = (process.env.EARLY_NOTIFY_REQUIRE_PREMIUM || '1') !== '0';
  if (requirePremium && prefs.length){
    const emails = prefs.map(p=>p.email).filter(Boolean);
    // Strategy: premium if user has premium ticket OR entry in premium_users table with valid premium_until
    let premiumEmails = new Set();
    try {
      const { data: tix } = await supa
        .from('tickets')
        .select('customer_email')
        .in('customer_email', emails)
        .eq('type','premium');
      (tix||[]).forEach(r=>{ if(r.customer_email) premiumEmails.add(r.customer_email); });
    } catch(e){ console.warn('[early-notify] premium ticket check failed', e.message||e); }
    try {
      const { data: pu } = await supa
        .from('premium_users')
        .select('email,premium_until')
        .in('email', emails);
      const now = Date.now();
      (pu||[]).forEach(r=>{ if(r.email && r.premium_until && new Date(r.premium_until).getTime() > now) premiumEmails.add(r.email); });
    } catch(e){ /* table may not exist yet */ }
    prefs = prefs.filter(p=>premiumEmails.has(p.email));
  }
  // Optional targeted audience filter by points: EARLY_NOTIFY_MIN_POINTS (e.g., 500)
  const minPoints = Number(process.env.EARLY_NOTIFY_MIN_POINTS || 0);
  if (minPoints > 0 && prefs.length){
    const emails = prefs.map(p=>p.email).filter(Boolean);
    try{
      const { data: up } = await supa
        .from('user_points')
        .select('email,points')
        .in('email', emails);
      const ok = new Set();
      (up||[]).forEach(r=>{ if(r?.email && Number(r.points||0) >= minPoints) ok.add(r.email); });
      prefs = prefs.filter(p=> ok.has(p.email));
    }catch(e){ /* table may not exist; ignore and keep prefs */ }
  }
  return prefs;
}

async function getUpcomingOffers(){
  const now = new Date();
  const from = new Date(now.getTime() + MINUTES_BEFORE*60*1000); // we notify MINUTES_BEFORE ahead of publish_at
  const until = new Date(from.getTime() + 60*1000); // narrow 1-minute window to avoid re-sending too many times
  const { data, error } = await supa
    .from('offers')
    .select('id,name,subcategory,venue_lat,venue_lon,publish_at')
    .gte('publish_at', from.toISOString())
    .lt('publish_at', until.toISOString());
  if (error) throw new Error('offers_error: '+error.message);
  return data||[];
}

async function sendNotification(email, offer){
  // New logic: monthly cap is 25 notifications (EARLY_NOTIFY_CAP defaults to 25)
  const MAX_PER_MONTH = Number(process.env.EARLY_NOTIFY_CAP || 25);
  const monthStart = new Date(); monthStart.setUTCDate(1); monthStart.setUTCHours(0,0,0,0);
  // Count already sent this month for any offer in same subcategory set (cap applies globally per user here)
  const { count: totalThisMonth, error: cntErr } = await supa
    .from('early_notify_sends')
    .select('*', { head:true, count:'exact' })
    .eq('email', email)
    .gte('sent_at', monthStart.toISOString());
  if (cntErr) { console.warn('[early-notify] count error', cntErr.message); }
  if (!cntErr && totalThisMonth >= MAX_PER_MONTH){
    console.log('[early-notify] cap reached for', email);
    return false;
  }
  // Insert send log (dedup per offer/email via unique index)
  const { error: insErr } = await supa
    .from('early_notify_sends')
    .insert({ email, offer_id: offer.id, subcategory: offer.subcategory });
  if (insErr){
    if (insErr.code === '23505'){ // unique violation (already sent)
      return false;
    }
    console.warn('[early-notify] insert send log failed', insErr.message);
    return false;
  }
  // Insert inbox item for in-app notification
  try{ await supa.from('early_notify_inbox').insert({ email, offer_id: offer.id, payload:{ name: offer.name, subcategory: offer.subcategory, publish_at: offer.publish_at } }); }catch(e){ console.warn('[early-notify] inbox insert failed', e.message||e); }
  console.log('[early-notify] send', email, offer.id);
  // Example integration here
  return true;
}

exports.handler = async (event, context) => {
  try{
  const prefs = await getEarlyNotifyPrefs();
    if (!prefs.length) return { statusCode:200, body:'No prefs.' };
  const offers = await getUpcomingOffers();
    if (!offers.length) return { statusCode:200, body:'No upcoming offers.' };

    let notified = 0;
    // Pre-skupini offers po subcategory za hitro lookup (manj filtriranja v zanki prefs)
    const bySub = new Map();
    for (const o of offers){
      if(!o.subcategory) continue;
      const arr = bySub.get(o.subcategory) || []; arr.push(o); bySub.set(o.subcategory, arr);
    }
    for (const pref of prefs){
      const { email, categories, lat, lon, radius } = pref;
      const rKm = Math.max(3, Math.min(50, Number(radius)||30));
      const candidateOffers = [];
      for (const cat of categories){
        const arr = bySub.get(cat);
        if (arr) candidateOffers.push(...arr);
      }
      // Deduplicate by id if overlapping categories
      const seen = new Set();
      for (const of of candidateOffers){
        if (seen.has(of.id)) continue; seen.add(of.id);
        if (lat!=null && lon!=null && of.venue_lat!=null && of.venue_lon!=null){
          const dist = km(lat, lon, of.venue_lat, of.venue_lon);
          if (dist > rKm) continue;
        }
  const sent = await sendNotification(email, of);
  if (sent) notified++;
      }
    }
  return { statusCode:200, body:`Sent ${notified} notifications (window ${(new Date()).toISOString()}).` };
  }catch(err){
    console.error('[early-notify] error', err.message||err);
    return { statusCode:500, body:'early_notify_failed' };
  }
};

// OPOMBA: Če tabela `offers` uporablja drugačna imena (npr. venueLat/venueLon ali publishAt), 
// prilagodite selekcijo in polja. Za večjo učinkovitost lahko uporabite PostGIS in ST_DWithin.

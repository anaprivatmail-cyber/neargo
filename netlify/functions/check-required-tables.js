// Netlify function – preveri obvezne tabele/kolone v Supabase z direktnimi SELECT poizvedbami.
// Če dodaš ?diag=1 vrne diagnostične indikatorje (brez skrivnosti).

import { createClient } from '@supabase/supabase-js';

export const handler = async (event) => {
  if (!isAllowed(event)) return json(404, { ok:false, error:'disabled' });
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (event?.queryStringParameters?.diag === '1') {
    return json(200, {
      diag: true,
      hasUrl: !!SUPABASE_URL,
      hasService: !!SUPABASE_SERVICE_ROLE_KEY,
      nodeVersion: process.version,
      hasFetch: typeof fetch === 'function'
    });
  }
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return json(200, { ok:false, configured:false, error:'Manjka SUPABASE_URL ali SERVICE ROLE KEY' });
  }

  const REQUIRED = [
    { name: 'offers', columns: ['id','name','subcategory','publish_at','venue_lat','venue_lon'] },
    { name: 'tickets', columns: ['id','type','customer_email','token','redeemed_at'] },
    { name: 'premium_users', columns: ['email','premium_until'] },
    { name: 'notification_prefs', columns: ['email','categories','radius','lat','lon','phone'] },
    { name: 'event_views', columns: ['user_id','item_id','item_type','viewed_at'] },
    { name: 'rewards_ledger', columns: ['user_id','points','reason','created_at'] },
    { name: 'user_points', columns: ['email','points'] },
    { name: 'early_notify_inbox', columns: ['email','offer_id','payload','read_at'] },
    { name: 'early_notify_sends', columns: ['email','offer_id','subcategory','sent_at'] },
    { name: 'verif_codes', columns: ['id','email','code','created_at','expires_at'] },
    { name: 'scans', columns: ['ticket_id','event_id','token','scanned_at'] },
    { name: 'events', columns: ['id','title','city'] },
    { name: 'invoices', columns: ['id','number','pdf_url'] },
    { name: 'invoice_counters', columns: ['year','last_no'] },
    { name: 'geo_queue', columns: ['id','offer_id','addr_raw','status'] },
    { name: 'geocode_cache', columns: ['addr_norm','lat','lon'] },
    { name: 'geo_cache', optional: true, columns: ['city','country','lat','lon'] },
  ];

  try {
    const client = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth:{ persistSession:false } });
    const missingTables = [];
    const missingColumns = [];
    for (const req of REQUIRED) {
      const cols = req.columns || [];
      let tableExists = true;
      let missingForTable = new Set();
      // Poskus osnovnega select-a
      try {
        const { error } = await client.from(req.name).select(cols.slice(0, Math.min(cols.length,5)).join(',') || '*').limit(1);
        if (error) {
          const msg = (error.message||'').toLowerCase();
          if (msg.includes('does not exist') || msg.includes('relation')) tableExists = false;
          if (tableExists && msg.includes('column')) {
            cols.forEach(c => { if (msg.includes(c.toLowerCase())) missingForTable.add(c); });
          }
        }
      } catch(e){
        const msg = String(e.message||e).toLowerCase();
        if (msg.includes('does not exist') || msg.includes('relation')) tableExists = false;
      }
      if (!tableExists) { if (!req.optional) missingTables.push(req.name); continue; }
      // Preveri vsako kolono posebej če še ni potrjena
      for (const col of cols) {
        if (missingForTable.has(col)) continue;
        try {
          const { error } = await client.from(req.name).select(col).limit(1);
          if (error) {
            const m = (error.message||'').toLowerCase();
            if (m.includes('column') && m.includes('does not exist')) missingForTable.add(col);
          }
        } catch(e){
          const m = String(e.message||e).toLowerCase();
          if (m.includes('column') && m.includes('does not exist')) missingForTable.add(col);
        }
      }
      if (missingForTable.size) missingColumns.push({ table:req.name, missing:Array.from(missingForTable) });
    }
    return json(200, { ok: missingTables.length===0 && missingColumns.length===0, missingTables, missingColumns });
  } catch(e){
    return json(500, { ok:false, error:String(e.message||e) });
  }
};

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET,OPTIONS'
};

function json(statusCode, body){
  return { statusCode, headers: { 'content-type': 'application/json', ...CORS }, body: JSON.stringify(body) };
}

function isAllowed(event){
  // Enable via env flag or secret token header
  const flag = String(process.env.CHECK_TABLES_ENABLED || '').toLowerCase() === 'true';
  if (flag) return true;
  const hdr = event?.headers || {};
  const tokenHeader = hdr['x-check-tables-token'] || hdr['X-Check-Tables-Token'];
  const expected = process.env.CHECK_TABLES_TOKEN;
  if (expected && tokenHeader && tokenHeader === expected) return true;
  return false;
}

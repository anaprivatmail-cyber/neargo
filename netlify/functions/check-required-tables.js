// Netlify function – preveri obvezne tabele/kolone v Supabase prek meta API
// Ne izpisuje ključev in ne razkriva podatkov; vrne samo manjkajoče entitete.

export const handler = async (event) => {
  if (!isAllowed(event)) {
    return json(404, { ok:false, error:'disabled' });
  }
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return json(200, { ok: false, configured: false, error: 'SUPABASE_URL ali SERVICE ROLE manjka' });
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
    const [tables, cols] = await Promise.all([
      meta('tables', SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY),
      meta('columns', SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY),
    ]);

    const tPublic = tables.filter(t => t.schema === 'public');
    const cPublic = cols.filter(c => c.schema === 'public');

    const have = new Map(tPublic.map(t => [t.name, t]));
    const byTable = new Map();
    for (const c of cPublic) {
      const arr = byTable.get(c.table) || []; arr.push(c.name); byTable.set(c.table, arr);
    }

    const missingTables = [];
    const missingColumns = [];
    for (const req of REQUIRED) {
      if (!have.has(req.name)) { if (!req.optional) missingTables.push(req.name); continue; }
      const haveCols = new Set(byTable.get(req.name) || []);
      const miss = (req.columns||[]).filter(col => !haveCols.has(col));
      if (miss.length) missingColumns.push({ table: req.name, missing: miss });
    }

    return json(200, { ok: missingTables.length===0 && missingColumns.length===0, missingTables, missingColumns });
  } catch (e) {
    return json(500, { ok:false, error: String(e.message||e) });
  }
};

async function meta(path, url, key){
  const r = await fetch(`${url}/pg/meta/${path}`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
  if (!r.ok) throw new Error(`meta ${path} → ${r.status}`);
  return r.json();
}

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

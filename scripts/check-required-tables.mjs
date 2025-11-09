#!/usr/bin/env node
// Check if required tables and key columns exist in Supabase (public schema)
// Requires env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error('Manjkajo SUPABASE_URL ali SUPABASE_SERVICE_ROLE_KEY v .env');
  process.exit(1);
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
  // some code references geo_cache too (admin cache)
  { name: 'geo_cache', optional: true, columns: ['city','country','lat','lon'] },
];

async function fetchMeta(path) {
  const res = await fetch(`${url}/pg/meta/${path}`, {
    headers: { apiKey: key, Authorization: `Bearer ${key}` },
  });
  if (!res.ok) throw new Error(`Meta fetch failed: ${path} → ${res.status}`);
  return res.json();
}

(async () => {
  const [tables, cols] = await Promise.all([
    fetchMeta('tables'),
    fetchMeta('columns'),
  ]);
  const tPublic = tables.filter(t => t.schema === 'public');
  const cPublic = cols.filter(c => c.schema === 'public');

  const have = new Map(tPublic.map(t => [t.name, t]));
  const columnsByTable = new Map();
  for (const c of cPublic) {
    const arr = columnsByTable.get(c.table) || [];
    arr.push(c.name);
    columnsByTable.set(c.table, arr);
  }

  const missing = [];
  const colIssues = [];

  for (const req of REQUIRED) {
    if (!have.has(req.name)) {
      if (!req.optional) missing.push(req.name);
      continue;
    }
    if (req.columns && req.columns.length) {
      const haveCols = new Set(columnsByTable.get(req.name) || []);
      const missCols = req.columns.filter(c => !haveCols.has(c));
      if (missCols.length) colIssues.push({ table: req.name, missing: missCols });
    }
  }

  const ok = missing.length === 0 && colIssues.length === 0;
  console.log(JSON.stringify({ ok, missingTables: missing, missingColumns: colIssues }, null, 2));
  if (!ok) process.exit(2);
})();

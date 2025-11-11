// netlify/functions/provider-featured-usage.js
// Returns current month featured usage count for an organizer email.
// Response: { ok:true, plan, used, allowed, month }
// Email required via query param (?email=)

import { createClient } from '@supabase/supabase-js';
import { rateLimit, tooMany } from './_guard.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET,OPTIONS'
};
const json = (d, s=200) => ({ statusCode:s, headers:{ 'Content-Type':'application/json; charset=utf-8', ...CORS }, body: JSON.stringify(d) });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = 'event-images';
const SUBMISSIONS_PREFIX = 'submissions/';

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode:200, headers:CORS, body:'' };
  if (event.httpMethod !== 'GET') return json({ ok:false, error:'Method not allowed' },405);
  // Rate limit reads: 60/minute per IP
  const rl = await rateLimit(event, 'provider-featured-usage', 60, 60);
  if (rl.blocked) return tooMany(60);
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return json({ ok:false, error:'Missing Supabase config' },500);
  const email = String(event.queryStringParameters?.email || '').trim().toLowerCase();
  if (!email) return json({ ok:false, error:'Email required' },400);
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Resolve plan
  async function resolveProviderPlan(e){
    try{
      const { data: row } = await supabase
        .from('provider_plans')
        .select('plan,active_until')
        .eq('email', e)
        .maybeSingle();
      if (row && row.plan){
        if (!row.active_until || new Date(row.active_until).getTime() > Date.now()){
          const val = String(row.plan).toLowerCase();
          if (val==='grow' || val==='pro') return val;
        }
      }
    }catch{}
    return 'free';
  }
  const plan = await resolveProviderPlan(email);
  const FEATURED_LIMIT = { free:0, grow:1, pro:3 };
  const allowed = FEATURED_LIMIT[plan] ?? 0;

  // Early exit if allowed=0 (no need to scan)
  if (allowed === 0) return json({ ok:true, plan, used:0, allowed, month:getMonthKey() });

  let used = 0;
  try {
    const { data: files } = await supabase.storage.from(BUCKET).list(SUBMISSIONS_PREFIX, { limit: 1000 });
    const now = new Date();
    const y = now.getUTCFullYear();
    const m = now.getUTCMonth();
    for (const f of files || []){
      if (!f.name?.endsWith('.json')) continue;
      const path = `${SUBMISSIONS_PREFIX}${f.name}`;
      const { data: dl } = await supabase.storage.from(BUCKET).download(path);
      if (!dl) continue;
      try {
        const txt = await dl.text();
        const obj = JSON.parse(txt);
        if (String(obj.organizerEmail||'').trim().toLowerCase() !== email) continue;
        const featFlag = !!obj.featured || (obj.featuredUntil && Date.parse(obj.featuredUntil) > Date.now());
        if (!featFlag) continue;
        const refStr = obj.featuredUntil || obj.createdAt || null;
        if (!refStr) continue;
        const ref = new Date(refStr);
        if (ref.getUTCFullYear() === y && ref.getUTCMonth() === m) used += 1;
      }catch{}
    }
  } catch {}

  return json({ ok:true, plan, used, allowed, month:getMonthKey() });
};

function getMonthKey(){
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}`;
}

// Simple admin endpoint to inspect geocode queue & cache counts
// GET /.netlify/functions/geo-queue-admin?limit=20&status=pending

const { createClient } = require('@supabase/supabase-js');
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supa = createClient(SUPABASE_URL, SERVICE_KEY, { auth:{persistSession:false} });

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors() };
  try{
    const url = new URL(event.rawUrl || ('http://x'+event.path));
    const limit = Math.max(1, Math.min(100, Number(url.searchParams.get('limit'))||20));
    const status = url.searchParams.get('status');
    let q = supa.from('geo_queue').select('id,offer_id,addr_raw,status,error,created_at').order('created_at',{ascending:false}).limit(limit);
    if (status) q = q.eq('status', status);
    const { data: queue, error: qe } = await q;
    if (qe) throw new Error(qe.message);
    const { data: cacheCnt, error: ce } = await supa.rpc('count_cache');
    // Fallback manual count if RPC not defined
    let cacheCount = cacheCnt; if (ce) { const { count, error: c2 } = await supa.from('geocode_cache').select('*', { head:true, count:'exact'}); if (!c2) cacheCount = count; }
    return json({ ok:true, queue, cacheCount });
  }catch(err){ return json({ ok:false, error:String(err.message||err) },500); }
};

function json(body,status=200){ return { statusCode:status, headers:cors(), body:JSON.stringify(body) }; }
function cors(){ return { 'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET,OPTIONS','Access-Control-Allow-Headers':'Content-Type' }; }
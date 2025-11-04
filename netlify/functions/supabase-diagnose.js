import { createClient } from '@supabase/supabase-js';

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST,OPTIONS'
};

const json = (code, body) => ({ statusCode: code, headers: { 'content-type': 'application/json', ...CORS }, body: JSON.stringify(body) });

export const handler = async (event) => {
  if (String(process.env.DIAGNOSTICS_ENABLED || '').toLowerCase() !== 'true') {
    return { statusCode: 404, headers: { 'cache-control': 'no-store' }, body: '' };
  }
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST' && event.httpMethod !== 'GET') return json(405, { ok: false, error: 'Use GET/POST' });

  const hasEnv = !!SUPABASE_URL && !!SUPABASE_SERVICE_ROLE_KEY;
  if (!hasEnv) return json(200, { ok: false, configured: false, vars: { hasUrl: !!SUPABASE_URL, hasKey: !!SUPABASE_SERVICE_ROLE_KEY } });

  const client = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  try {
    const { data, error } = await client.from('verif_codes').select('id, created_at').limit(1);
    if (error) return json(500, { ok: false, configured: true, error: error.message });
    return json(200, { ok: true, configured: true, tableAccessible: Array.isArray(data), sampleCount: Array.isArray(data) ? data.length : 0 });
  } catch (e) {
    return json(500, { ok: false, configured: true, error: String(e.message || e) });
  }
};

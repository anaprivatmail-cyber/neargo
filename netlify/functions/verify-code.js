import { createClient } from '@supabase/supabase-js';

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;

const supabase = SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  : null;

const RAW_ALLOW_TEST_CODES = String(process.env.ALLOW_TEST_CODES || '').toLowerCase() === 'true';
const NETLIFY_CONTEXT = String(process.env.CONTEXT || '').toLowerCase();
const NETLIFY_DEV = String(process.env.NETLIFY_DEV || '').toLowerCase() === 'true';
const NODE_ENV = String(process.env.NODE_ENV || '').toLowerCase();
const missingInfrastructure = !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY;
const nonProdContext = (NETLIFY_CONTEXT && NETLIFY_CONTEXT !== 'production') || NETLIFY_DEV || NODE_ENV === 'development';
const ALLOW_TEST_CODES = RAW_ALLOW_TEST_CODES || nonProdContext || missingInfrastructure;

function buildCors(event){
  const allowed = String(process.env.ALLOWED_ORIGINS || '*')
    .split(',').map(s => s.trim()).filter(Boolean);
  const reqOrigin = event?.headers?.origin || '';
  const origin = allowed.includes('*') ? '*' : (allowed.find(o => o === reqOrigin) || allowed[0] || '*');
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST,OPTIONS',
    'Cache-Control': 'no-store'
  };
}

const json = (status, body, event) => ({
  statusCode: status,
  headers: { 'content-type': 'application/json; charset=utf-8', ...buildCors(event) },
  body: JSON.stringify(body)
});

const WINDOW_MS = 10 * 60 * 1000; // 10 minut

const sanitizePhone = (value) => {
  const digits = String(value || '').replace(/\D/g, '');
  return digits || null;
};

const normalizeEmail = (value) => {
  const mail = String(value || '').trim().toLowerCase();
  return mail || null;
};

export const handler = async (event) => {
  const CORS = buildCors(event);
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'Method not allowed' }, event);

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch {
    return json(400, { ok: false, error: 'Neveljaven JSON.' }, event);
  }

  const code = String(payload.code || '').trim();
  const phone = sanitizePhone(payload.phone);
  const email = normalizeEmail(payload.email);
  const countryCode = String(payload.countryCode || '').trim();

  if (!code || (!phone && !email)) {
  return json(400, { ok: false, error: 'Manjkajoči podatki.' }, event);
  }

  const windowStart = new Date(Date.now() - WINDOW_MS).toISOString();

  if (!supabase) {
    if (ALLOW_TEST_CODES) {
      return json(200, { ok: true, verified: true, dev: true, note: 'ALLOW_TEST_CODES: simulirano preverjanje' }, event);
    }
    return json(500, { ok: false, error: 'Supabase ni konfiguriran.' }, event);
  }

  try {
    let query = supabase.from('verif_codes')
      .select('*')
      .eq('code', code)
      .eq('used', false)
      .gte('created_at', windowStart)
      .order('created_at', { ascending: false })
      .limit(1);

    if (phone) {
      query = query.eq('phone', phone);
      if (countryCode) query = query.eq('country_code', countryCode);
    } else {
      query = query.eq('email', email);
    }

    const { data, error } = await query;
    if (error) throw error;
    if (!data || !data.length) {
  return json(401, { ok: false, verified: false, error: 'Koda ni pravilna ali je potekla.' }, event);
    }

    const record = data[0];
    const { error: updateErr } = await supabase
      .from('verif_codes')
      .update({ used: true, used_at: new Date().toISOString() })
      .eq('id', record.id);

    if (updateErr) throw updateErr;

    return json(200, { ok: true, verified: true }, event);
  } catch (err) {
    console.error('[verify-code] error:', err?.message || err);
    if (ALLOW_TEST_CODES) {
      return json(200, { ok: true, verified: true, dev: true, note: 'ALLOW_TEST_CODES: simulirano preverjanje' }, event);
    }
    return json(500, { ok: false, verified: false, error: 'Preverjanje ni uspelo.' }, event);
  }
};

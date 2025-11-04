import { createClient } from '@supabase/supabase-js';

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;

const supabase = SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  : null;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST,OPTIONS'
};

const json = (status, body) => ({
  statusCode: status,
  headers: { 'content-type': 'application/json; charset=utf-8', ...CORS_HEADERS },
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

let supportsCountryCodeColumn = true;
let supportsUsedAtColumn = true;

async function runVerificationQuery({ code, phone, email, countryCode, windowStart }) {
  const execute = () => {
    let query = supabase.from('verif_codes')
      .select('*')
      .eq('code', code)
      .eq('used', false)
      .gte('created_at', windowStart)
      .order('created_at', { ascending: false })
      .limit(1);

    if (phone) {
      query = query.eq('phone', phone);
      if (supportsCountryCodeColumn && countryCode) {
        query = query.eq('country_code', countryCode);
      }
    } else {
      query = query.eq('email', email);
    }

    return query;
  };

  let result = await execute();
  if (!result.error) return result;

  const message = (result.error.message || '').toLowerCase();
  if (supportsCountryCodeColumn && message.includes('country_code')) {
    supportsCountryCodeColumn = false;
    result = await execute();
  }

  return result;
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS_HEADERS, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'Method not allowed' });
  if (!supabase) return json(500, { ok: false, error: 'Supabase ni konfiguriran.' });

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch {
    return json(400, { ok: false, error: 'Neveljaven JSON.' });
  }

  const code = String(payload.code || '').trim();
  const phone = sanitizePhone(payload.phone);
  const email = normalizeEmail(payload.email);
  const countryCode = String(payload.countryCode || '').trim();

  if (!code || (!phone && !email)) {
    return json(400, { ok: false, error: 'Manjkajoči podatki.' });
  }

  const windowStart = new Date(Date.now() - WINDOW_MS).toISOString();

  try {
    const { data, error } = await runVerificationQuery({ code, phone, email, countryCode, windowStart });
    if (error) throw error;
    if (!data || !data.length) {
      return json(401, { ok: false, verified: false, error: 'Koda ni pravilna ali je potekla.' });
    }

    const record = data[0];
    const updatePayload = supportsUsedAtColumn
      ? { used: true, used_at: new Date().toISOString() }
      : { used: true };

    let { error: updateErr } = await supabase
      .from('verif_codes')
      .update(updatePayload)
      .eq('id', record.id);

    if (updateErr && supportsUsedAtColumn && (updateErr.message || '').toLowerCase().includes('used_at')) {
      supportsUsedAtColumn = false;
      ({ error: updateErr } = await supabase
        .from('verif_codes')
        .update({ used: true })
        .eq('id', record.id));
    }

    if (updateErr) throw updateErr;

    return json(200, { ok: true, verified: true });
  } catch (err) {
    console.error('[verify-code] error:', err?.message || err);
    return json(500, { ok: false, verified: false, error: 'Preverjanje ni uspelo.' });
  }
};

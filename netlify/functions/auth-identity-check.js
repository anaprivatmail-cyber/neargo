import { createClient } from '@supabase/supabase-js';

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  ALLOWED_ORIGINS
} = process.env;

const supabase = SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  : null;

const buildCors = (event) => {
  const allowed = String(ALLOWED_ORIGINS || '*')
    .split(',').map(s => s.trim()).filter(Boolean);
  const reqOrigin = event?.headers?.origin || '';
  const origin = allowed.includes('*') ? '*' : (allowed.find(o => o === reqOrigin) || allowed[0] || '*');
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST,OPTIONS',
    'Cache-Control': 'no-store'
  };
};

const json = (status, body, event) => ({
  statusCode: status,
  headers: { 'content-type': 'application/json; charset=utf-8', ...buildCors(event) },
  body: JSON.stringify(body)
});

const sanitizePhone = (value) => String(value || '').replace(/\D/g, '');

async function findUserByPhone(normalizedPhone) {
  if (!normalizedPhone || !supabase) return null;
  const perPage = 200;
  for (let page = 1; page < 100; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const users = data?.users || [];
    if (!users.length) break;
    for (const user of users) {
      const candidates = [];
      if (user?.user_metadata?.phone) candidates.push(user.user_metadata.phone);
      if (user?.phone) candidates.push(user.phone);
      if (user?.user_metadata?.login_phone) candidates.push(user.user_metadata.login_phone);
      if (!candidates.length) continue;
      const matched = candidates.some((candidate) => sanitizePhone(candidate) === normalizedPhone);
      if (matched) return user;
    }
    if (users.length < perPage) break;
  }
  return null;
}

export const handler = async (event) => {
  const cors = buildCors(event);
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: cors, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'Method not allowed' }, event);

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch {
    return json(400, { ok: false, error: 'Neveljaven JSON.' }, event);
  }

  if (!supabase) {
    return json(503, { ok: false, error: 'Supabase storitev ni konfigurirana.' }, event);
  }

  const email = String(payload.email || '').trim().toLowerCase();
  const phoneRaw = sanitizePhone(payload.phone);
  const countryDigits = sanitizePhone(payload.countryCode);
  const normalizedPhone = phoneRaw ? `${countryDigits}${phoneRaw}` : '';

  if (!email && !normalizedPhone) {
    return json(400, { ok: false, error: 'Manjka email ali telefonska številka.' }, event);
  }

  const result = {
    ok: true,
    emailExists: false,
    phoneExists: false
  };

  if (email) {
    try {
      const { data, error } = await supabase.auth.admin.getUserByEmail(email);
      if (!error && data?.user) {
        result.emailExists = true;
      }
    } catch (err) {
      const message = String(err?.message || '').toLowerCase();
      if (!message.includes('user not found')) {
        console.error('[auth-identity-check] email lookup failed:', err);
        return json(500, { ok: false, error: 'Preverjanje emaila ni uspelo.' }, event);
      }
    }
  }

  if (normalizedPhone) {
    try {
      const user = await findUserByPhone(normalizedPhone);
      if (user) result.phoneExists = true;
    } catch (err) {
      console.error('[auth-identity-check] phone lookup failed:', err);
      return json(500, { ok: false, error: 'Preverjanje telefona ni uspelo.' }, event);
    }
  }

  return json(200, result, event);
};

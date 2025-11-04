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

const MAX_AGE_MS = 60 * 60 * 1000; // 1 ura

export const handler = async (event) => {
  const cors = buildCors(event);
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: cors, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'Method not allowed' }, event);

  if (!supabase) {
    return json(503, { ok: false, error: 'Supabase storitev ni konfigurirana.' }, event);
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch {
    return json(400, { ok: false, error: 'Neveljaven JSON.' }, event);
  }

  const email = String(payload.email || '').trim().toLowerCase();
  const userId = String(payload.userId || '').trim();
  const codeId = String(payload.codeId || '').trim();

  if (!email || !userId || !codeId) {
    return json(400, { ok: false, error: 'Manjka email, uporabnik ali koda.' }, event);
  }

  try {
    const { data, error } = await supabase
      .from('verif_codes')
      .select('*')
      .eq('id', codeId)
      .eq('email', email)
      .eq('used', true)
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      return json(404, { ok: false, error: 'Koda ni najdena.' }, event);
    }

    if ((data.method && data.method !== 'email')) {
      return json(400, { ok: false, error: 'Koda ni povezana z email potrditvijo.' }, event);
    }

    const createdAt = data.created_at ? new Date(data.created_at).getTime() : null;
    const usedAt = data.used_at ? new Date(data.used_at).getTime() : createdAt;
    const ageMs = usedAt ? Date.now() - usedAt : null;
    if (ageMs !== null && ageMs > MAX_AGE_MS) {
      return json(400, { ok: false, error: 'Koda je potekla.' }, event);
    }

  const { data: userData, error: userErr } = await supabase.auth.admin.getUserById(userId);
    if (userErr) {
      const message = String(userErr?.message || '').toLowerCase();
      if (message.includes('user not found')) {
        return json(404, { ok: false, error: 'Uporabnik ni najden.' }, event);
      }
      throw userErr;
    }

  const user = userData || null;
    if (!user) {
      return json(404, { ok: false, error: 'Uporabnik ni najden.' }, event);
    }

    if (user.email?.toLowerCase() !== email) {
      return json(400, { ok: false, error: 'Email se ne ujema z uporabnikom.' }, event);
    }

    if (user.email_confirmed_at || user.confirmed_at) {
      return json(200, { ok: true, alreadyConfirmed: true }, event);
    }

    const { data: updatedUser, error: updateErr } = await supabase.auth.admin.updateUserById(userId, {
      email_confirm: true
    });

    if (updateErr) throw updateErr;

    return json(200, { ok: true, user: { id: updatedUser?.id, email: updatedUser?.email } }, event);
  } catch (err) {
    console.error('[confirm-email-from-code] error:', err?.message || err);
    return json(500, { ok: false, error: err?.message || 'Potrditve emaila ni mogoče dokončati.' }, event);
  }
};

// Netlify function: verify-code.js
// Preveri SMS/email kodo za prijavo/registracijo

const { createClient } = require('@supabase/supabase-js');
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

exports.handler = async function(event) {
  const body = JSON.parse(event.body || '{}');
  const { phone, email, code, countryCode } = body;
  let query = {};
  if (phone) query.phone = phone;
  if (email) query.email = email;
  if (!code || (!phone && !email)) {
    return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'Manjkajoči podatki.' }) };
  }
  // Poišči kodo v bazi, ne starejšo od 10 min in še ne uporabljeno
  const { data, error } = await supabase
    .from('verif_codes')
    .select('*')
    .eq('code', code)
    .eq(phone ? 'phone' : 'email', phone ? phone : email)
    .eq('used', false)
    .gte('created_at', new Date(Date.now() - 10 * 60 * 1000).toISOString())
    .order('created_at', { ascending: false })
    .limit(1);
  if (error || !data || !data.length) {
    return { statusCode: 401, body: JSON.stringify({ ok: false, verified: false, error: 'Koda ni pravilna ali je potekla.' }) };
  }
  // Označi kodo kot uporabljeno
  await supabase.from('verif_codes').update({ used: true }).eq('id', data[0].id);
  // TODO: Ustvari sejo/token za uporabnika
  return {
    statusCode: 200,
    body: JSON.stringify({ ok: true, verified: true, redirect: '/my.html' })
  };
};

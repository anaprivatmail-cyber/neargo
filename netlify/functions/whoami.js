// Simple diagnostics endpoint to confirm the current user identity.
// It decodes the Supabase JWT (no signature verification) and, if available,
// also verifies via supabase-js using the service role key.

import { createClient } from '@supabase/supabase-js';

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
};

const json = (code, body) => ({ statusCode: code, headers: { 'content-type': 'application/json', ...CORS }, body: JSON.stringify(body) });

function decodeJwt(token){
  try{
    const parts = String(token || '').split('.');
    if (parts.length < 2) return null;
    const b64 = parts[1].replace(/-/g,'+').replace(/_/g,'/');
    const pad = b64.length % 4 ? '='.repeat(4 - (b64.length % 4)) : '';
    const jsonStr = Buffer.from(b64 + pad, 'base64').toString('utf8');
    return JSON.parse(jsonStr);
  }catch{ return null; }
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };
  const auth = event.headers.authorization || event.headers.Authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return json(200, { ok: false, error: 'No token', decoded: null, verified: null });

  const decoded = decodeJwt(token);
  let verified = null;

  if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY){
    try{
      const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
      const { data, error } = await admin.auth.getUser(token);
      if (error) verified = { ok:false, error: error.message };
      else verified = { ok:true, user: { id: data.user?.id, email: data.user?.email } };
    }catch(e){ verified = { ok:false, error: String(e?.message||e) }; }
  }

  return json(200, { ok: true, decoded, verified });
};

import twilio from 'twilio';
import nodemailer from 'nodemailer';
import { createClient } from '@supabase/supabase-js';
import { getStore } from '@netlify/blobs';

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_FROM_NUMBER,
  SMTP_HOST,
  SMTP_PORT,
  SMTP_USER,
  SMTP_PASS,
  EMAIL_FROM
} = process.env;

const supabase = SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  : null;

const RAW_ALLOW_TEST_CODES = String(process.env.ALLOW_TEST_CODES || '').toLowerCase() === 'true';
const NETLIFY_CONTEXT = String(process.env.CONTEXT || '').toLowerCase();
const ALLOW_TEST_CODES = RAW_ALLOW_TEST_CODES || (NETLIFY_CONTEXT && NETLIFY_CONTEXT !== 'production');

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

const CODE_TTL_MS = 10 * 60 * 1000; // 10 minut
function generateCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function sanitizePhone(value) {
  return String(value || '').replace(/\D/g, '');
}

let cachedTransporter = null;
function getTransporter() {
  if (cachedTransporter) return cachedTransporter;
  if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS) {
    if (ALLOW_TEST_CODES) return null; // Dev način: preskoči prave pošiljke
    throw new Error('SMTP ni konfiguriran.');
  }
  cachedTransporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT),
    secure: Number(SMTP_PORT) === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS }
  });
  return cachedTransporter;
}

async function sendEmailCode(to, code) {
  const sender = EMAIL_FROM || 'NearGo <info@getneargo.com>';
  const html = `
    <div style="font-family:Arial,sans-serif;font-size:15px;color:#102437;background:#f6fbfe;padding:24px;border-radius:12px;max-width:420px;margin:auto;">
      <div style="text-align:center;margin-bottom:18px;">
        <div style="display:inline-flex;align-items:center;gap:10px;font-weight:900;font-size:20px;color:#0b1b2b;">
          <span style="display:inline-flex;align-items:center;justify-content:center;width:42px;height:42px;border-radius:14px;background:linear-gradient(135deg,#0bbbd6,#7de3f0);color:#042430;">N</span>
          NearGo
        </div>
      </div>
      <p style="margin:0 0 12px">Vaša potrditvena koda:</p>
      <div style="font-size:32px;font-weight:900;letter-spacing:6px;margin:12px 0 18px;text-align:center;color:#0bbbd6;">${code}</div>
      <p style="margin:0 0 6px">Koda poteče v 10 minutah. Če je niste zahtevali, lahko to sporočilo ignorirate.</p>
      <hr style="border:none;border-top:1px solid rgba(11,30,60,0.08);margin:20px 0">
      <p style="font-size:13px;color:#5b6b7b;margin:0">Ekipa NearGo</p>
    </div>
  `;
  const transporter = getTransporter();
  if (!transporter) {
    if (ALLOW_TEST_CODES) return { dev: true };
    throw new Error('SMTP transporter ni dosegljiv.');
  }
  await transporter.sendMail({ from: sender, to, subject: 'NearGo – potrditvena koda', html });
}

async function sendSmsCode(phone, countryCode, code) {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_FROM_NUMBER) {
    if (ALLOW_TEST_CODES) return { dev: true };
    throw new Error('Twilio ni konfiguriran.');
  }
  const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
  const sanitized = sanitizePhone(phone);
  if (!sanitized) throw new Error('Neveljavna telefonska številka.');
  const prefix = String(countryCode || '').trim() || '+386';
  const to = prefix.startsWith('+') ? `${prefix}${sanitized}` : `+${prefix}${sanitized}`;
  await client.messages.create({
    body: `NearGo koda: ${code}`,
    from: TWILIO_FROM_NUMBER,
    to
  });
  return sanitized;
}

export const handler = async (event) => {
  const CORS = buildCors(event);
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'Method not allowed' }, event);
  // V dev/test načinu omogočimo pošiljanje brez Supabase
  const noDb = !supabase;

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch {
    return json(400, { ok: false, error: 'Neveljaven JSON.' });
  }

  const method = String(payload.method || '').toLowerCase();
  if (!['email', 'sms'].includes(method)) {
    return json(400, { ok: false, error: 'Neznana metoda.' });
  }

  const code = generateCode();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + CODE_TTL_MS).toISOString();

  const record = {
    method,
    code,
    used: false,
    created_at: now.toISOString(),
    expires_at: expiresAt
  };

  // --- Rate limiting (basic) ---
  try {
    const store = await getStore('rate');
    const ip = event.headers['x-nf-client-connection-ip'] || event.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
    const windowKey = Math.floor(Date.now() / (10 * 60 * 1000)); // 10-min okno
    const idRaw = method === 'email' ? String(payload.email || '') : (String(payload.countryCode || '') + sanitizePhone(payload.phone || ''));
    const idKey = `sc:id:${idRaw}:${windowKey}`;
    const ipKey = `sc:ip:${ip}:${windowKey}`;
    async function bump(key, limit){
      const cur = Number(await store.get(key) || '0');
      if (cur >= limit) return false;
      await store.set(key, String(cur + 1), { ttl: 11 * 60 });
      return true;
    }
    const okId = await bump(idKey, 5);
    const okIp = await bump(ipKey, 20);
    if (!okId || !okIp) {
      return json(429, { ok:false, error:'Preveč zahtev – poskusite kasneje.' }, event);
    }
  } catch {}

  try {
    if (method === 'email') {
      const email = String(payload.email || '').trim().toLowerCase();
      if (!email) return json(400, { ok: false, error: 'Manjka email.' }, event);
      record.email = email;
      let inserted = null;
      if (!noDb) {
        const { data, error } = await supabase.from('verif_codes').insert(record).select();
        if (error) throw error;
        inserted = data?.[0];
      }
      let delivery = null;
      try {
        delivery = await sendEmailCode(email, code);
      } catch (sendErr) {
        if (!noDb && inserted?.id) {
          await supabase.from('verif_codes').delete().eq('id', inserted.id);
        }
        throw sendErr;
      }
      return json(200, { ok: true, codeSent: true, ...(ALLOW_TEST_CODES ? { code } : {}), ...(delivery?.dev ? { dev: true } : {}) }, event);
    }

    const phone = sanitizePhone(payload.phone);
    if (!phone) return json(400, { ok: false, error: 'Manjka telefonska številka.' }, event);
    const countryCode = String(payload.countryCode || '').trim();
    record.phone = phone;
    record.country_code = countryCode || null;
    let inserted = null;
    if (!noDb) {
      const { data, error } = await supabase.from('verif_codes').insert(record).select();
      if (error) throw error;
      inserted = data?.[0];
    }
    let delivery = null;
    try {
      delivery = await sendSmsCode(phone, countryCode, code);
    } catch (sendErr) {
      if (!noDb && inserted?.id) {
        await supabase.from('verif_codes').delete().eq('id', inserted.id);
      }
      throw sendErr;
    }
    return json(200, { ok: true, codeSent: true, ...(ALLOW_TEST_CODES ? { code } : {}), ...(delivery?.dev ? { dev: true } : {}) }, event);
  } catch (err) {
    console.error('[send-code] error:', err?.message || err);
    // V dev načinu ne blokiraj – vrni uspeh s kodo v odzivu
    if (ALLOW_TEST_CODES) {
      return json(200, { ok: true, codeSent: true, code, dev: true, note: 'ALLOW_TEST_CODES: simulirano pošiljanje' }, event);
    }
    return json(500, { ok: false, error: err?.message || 'Pošiljanje kode ni uspelo.' }, event);
  }
};

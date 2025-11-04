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
const NETLIFY_DEV = String(process.env.NETLIFY_DEV || '').toLowerCase() === 'true';
const NODE_ENV = String(process.env.NODE_ENV || '').toLowerCase();
const missingDb = !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY;
const missingSmsInfra = !TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_FROM_NUMBER;
const missingEmailInfra = !SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS;
const nonProdContext = (NETLIFY_CONTEXT && NETLIFY_CONTEXT !== 'production') || NETLIFY_DEV || NODE_ENV === 'development';

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

const shouldSimulateSms = RAW_ALLOW_TEST_CODES || nonProdContext || missingSmsInfra;
const shouldSimulateEmail = RAW_ALLOW_TEST_CODES || nonProdContext || missingEmailInfra;

async function insertCodeRecord(payload) {
  if (!supabase || missingDb) return { inserted: null, missingColumns: [] };

  const missingColumns = [];

  async function runInsert(body) {
    const { data, error } = await supabase.from('verif_codes').insert(body).select();
    if (error) throw error;
    return data?.[0] || null;
  }

  try {
    const inserted = await runInsert(payload);
    return { inserted, missingColumns };
  } catch (err) {
    const message = String(err?.message || '').toLowerCase();
    if (payload?.method && message.includes("'method'")) {
      const { method, ...rest } = payload;
      const inserted = await runInsert(rest);
      missingColumns.push('method');
      console.warn('[send-code] verif_codes missing column: method');
      return { inserted, missingColumns };
    }
    throw err;
  }
}

let cachedTransporter = null;
function getTransporter() {
  if (cachedTransporter) return cachedTransporter;
  if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS) {
    if (shouldSimulateEmail) return null; // Dev način: preskoči prave pošiljke
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
        <div style="display:inline-flex;align-items:center;justify-content:center;gap:12px;font-weight:900;font-size:20px;color:#0b1b2b;">
          <span style="display:inline-flex;align-items:center;justify-content:center;width:44px;height:44px;border-radius:16px;background:linear-gradient(135deg,#0bbbd6,#7de3f0);box-shadow:0 4px 20px rgba(11,187,214,0.35);">
            <svg width="26" height="26" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
              <circle cx="16" cy="16" r="13" stroke="#ffffff" stroke-width="2" opacity="0.65" />
              <circle cx="16" cy="16" r="8" stroke="#ffffff" stroke-width="2" opacity="0.85" />
              <circle cx="16" cy="16" r="4" fill="#ffffff" />
            </svg>
          </span>
          <span>NearGo</span>
        </div>
      </div>
      <p style="margin:0 0 12px">Hi! Your NearGo verification code is:</p>
      <div style="font-size:32px;font-weight:900;letter-spacing:6px;margin:12px 0 18px;text-align:center;color:#0bbbd6;">${code}</div>
      <p style="margin:0 0 6px">Enter this code in the app within 10 minutes to confirm your registration.</p>
      <p style="margin:0 0 6px">If you didn’t request it, you can safely ignore this email.</p>
      <hr style="border:none;border-top:1px solid rgba(11,30,60,0.08);margin:20px 0">
      <p style="font-size:13px;color:#5b6b7b;margin:0">— The NearGo Team</p>
    </div>
  `;
  const transporter = getTransporter();
  if (!transporter) {
    if (shouldSimulateEmail) return { dev: true };
    throw new Error('SMTP transporter ni dosegljiv.');
  }
  await transporter.sendMail({ from: sender, to, subject: 'NearGo verification code', html });
}

async function sendSmsCode(phone, countryCode, code) {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_FROM_NUMBER) {
    if (shouldSimulateSms) return { dev: true };
    throw new Error('Twilio ni konfiguriran.');
  }
  const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
  const sanitized = sanitizePhone(phone);
  if (!sanitized) throw new Error('Neveljavna telefonska številka.');
  const prefix = String(countryCode || '').trim() || '+386';
  const to = prefix.startsWith('+') ? `${prefix}${sanitized}` : `+${prefix}${sanitized}`;
  await client.messages.create({
    body: `NearGo verification code: ${code}`,
    from: TWILIO_FROM_NUMBER,
    to
  });
  return sanitized;
}

export const handler = async (event) => {
  const CORS = buildCors(event);
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'Method not allowed' }, event);
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

  const baseRecord = {
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
      const payloadForInsert = { ...baseRecord, email };
      const { inserted, missingColumns } = await insertCodeRecord(payloadForInsert);
      let delivery = null;
      try {
        delivery = await sendEmailCode(email, code);
      } catch (sendErr) {
        if (inserted?.id) {
          await supabase.from('verif_codes').delete().eq('id', inserted.id);
        }
        throw sendErr;
      }
      return json(200, {
        ok: true,
        codeSent: true,
        ...((shouldSimulateEmail || RAW_ALLOW_TEST_CODES) ? { code } : {}),
        ...(delivery?.dev ? { dev: true } : {}),
        ...(missingColumns?.length ? { missingColumns } : {})
      }, event);
    }

    const phone = sanitizePhone(payload.phone);
    if (!phone) return json(400, { ok: false, error: 'Manjka telefonska številka.' }, event);
    const countryCode = String(payload.countryCode || '').trim();
    const payloadForInsert = { ...baseRecord, phone, country_code: countryCode || null };
    const { inserted, missingColumns } = await insertCodeRecord(payloadForInsert);
    let delivery = null;
    try {
      delivery = await sendSmsCode(phone, countryCode, code);
    } catch (sendErr) {
      if (inserted?.id) {
        await supabase.from('verif_codes').delete().eq('id', inserted.id);
      }
      throw sendErr;
    }
    return json(200, {
      ok: true,
      codeSent: true,
      ...((shouldSimulateSms || RAW_ALLOW_TEST_CODES) ? { code } : {}),
      ...(delivery?.dev ? { dev: true } : {}),
      ...(missingColumns?.length ? { missingColumns } : {})
    }, event);
  } catch (err) {
    console.error('[send-code] error:', err?.message || err);
    // V dev načinu ne blokiraj – vrni uspeh s kodo v odzivu
    if (shouldSimulateEmail || shouldSimulateSms) {
      return json(200, { ok: true, codeSent: true, code, dev: true, note: 'Simulated delivery due to missing infrastructure' }, event);
    }
    return json(500, { ok: false, error: err?.message || 'Pošiljanje kode ni uspelo.' }, event);
  }
};

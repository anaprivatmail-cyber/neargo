import twilio from 'twilio';
import nodemailer from 'nodemailer';
import { createClient } from '@supabase/supabase-js';

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

const CODE_TTL_MS = 10 * 60 * 1000; // 10 minut
const ALLOW_TEST_CODES = String(process.env.ALLOW_TEST_CODES || '').toLowerCase() === 'true';

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
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS_HEADERS, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'Method not allowed' });
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

  try {
    if (method === 'email') {
      const email = String(payload.email || '').trim().toLowerCase();
      if (!email) return json(400, { ok: false, error: 'Manjka email.' });
      record.email = email;
      let inserted = null;
      if (!noDb) {
        const { data, error } = await supabase.from('verif_codes').insert(record).select();
        if (error) throw error;
        inserted = data?.[0];
      }
      try {
        await sendEmailCode(email, code);
      } catch (sendErr) {
        if (!noDb && inserted?.id) {
          await supabase.from('verif_codes').delete().eq('id', inserted.id);
        }
        throw sendErr;
      }
      return json(200, { ok: true, codeSent: true, ...(ALLOW_TEST_CODES ? { code } : {}) });
    }

    const phone = sanitizePhone(payload.phone);
    if (!phone) return json(400, { ok: false, error: 'Manjka telefonska številka.' });
    const countryCode = String(payload.countryCode || '').trim();
    record.phone = phone;
    record.country_code = countryCode || null;
    let inserted = null;
    if (!noDb) {
      const { data, error } = await supabase.from('verif_codes').insert(record).select();
      if (error) throw error;
      inserted = data?.[0];
    }
    try {
      await sendSmsCode(phone, countryCode, code);
    } catch (sendErr) {
      if (!noDb && inserted?.id) {
        await supabase.from('verif_codes').delete().eq('id', inserted.id);
      }
      throw sendErr;
    }
    return json(200, { ok: true, codeSent: true, ...(ALLOW_TEST_CODES ? { code } : {}) });
  } catch (err) {
    console.error('[send-code] error:', err?.message || err);
    // V dev načinu ne blokiraj – vrni uspeh s kodo v odzivu
    if (ALLOW_TEST_CODES) {
      return json(200, { ok: true, codeSent: true, code, dev: true, note: 'ALLOW_TEST_CODES: simulirano pošiljanje' });
    }
    return json(500, { ok: false, error: err?.message || 'Pošiljanje kode ni uspelo.' });
  }
};

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
    <div style="font-family:Inter,Arial,sans-serif;font-size:15px;color:#102437;background:#f6fbfe;padding:24px;border-radius:12px;max-width:460px;margin:auto;">
      <div style="text-align:center;margin-bottom:18px;">
        <div style="display:inline-flex;align-items:center;gap:10px;font-weight:900;font-size:20px;color:#0b1b2b;">
          <span aria-hidden="true" style="display:inline-flex;align-items:center;justify-content:center;width:42px;height:42px;border-radius:50%;background:#e6f7fb;border:1px solid #bfeaf3">
            <svg viewBox="0 0 32 32" width="24" height="24" xmlns="http://www.w3.org/2000/svg">
              <defs>
                <radialGradient id="tg" cx="50%" cy="50%">
                  <stop offset="0%" stop-color="#0bbbd6"/>
                  <stop offset="100%" stop-color="#7de3f0"/>
                </radialGradient>
              </defs>
              <circle cx="16" cy="16" r="12" fill="none" stroke="url(#tg)" stroke-width="2" />
              <circle cx="16" cy="16" r="7" fill="none" stroke="url(#tg)" stroke-width="2" opacity=".85" />
              <circle cx="16" cy="16" r="2.8" fill="#0bbbd6" />
            </svg>
          </span>
          NearGo
        </div>
      </div>
      <p style="margin:0 0 12px">Your verification code:</p>
  <div style="font-size:32px;font-weight:900;letter-spacing:6px;margin:12px 0 18px;text-align:center;color:#0bbbd6;font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace; user-select: all; -webkit-user-select: all;">${code}</div>
      <p style="margin:0 0 6px">This code expires in 10 minutes. If you didn’t request it, you can safely ignore this message.</p>
      <hr style="border:none;border-top:1px solid rgba(11,30,60,0.08);margin:20px 0">
      <p style="font-size:13px;color:#5b6b7b;margin:0">NearGo Team</p>
    </div>
  `;
  const transporter = getTransporter();
  await transporter.sendMail({ from: sender, to, subject: 'NearGo – verification code', html });
}

async function sendSmsCode(phone, countryCode, code, originHost) {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_FROM_NUMBER) {
    throw new Error('Twilio ni konfiguriran.');
  }
  const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
  const sanitized = sanitizePhone(phone);
  if (!sanitized) throw new Error('Neveljavna telefonska številka.');
  const prefix = String(countryCode || '').trim() || '+386';
  const to = prefix.startsWith('+') ? `${prefix}${sanitized}` : `+${prefix}${sanitized}`;
  const hostTag = originHost ? ` @${originHost} #${code}` : '';
  await client.messages.create({
    body: `NearGo verification code: ${code}. Expires in 10 minutes.${hostTag}`,
    from: TWILIO_FROM_NUMBER,
    to
  });
  return sanitized;
}

let supportsExpiresAtColumn = true;
let supportsCountryCodeColumn = true;
let supportsMethodColumn = true;

async function insertVerificationRecord(rawRecord) {
  const attempt = async () => {
    const payload = { ...rawRecord };
    if (!supportsExpiresAtColumn) delete payload.expires_at;
    if (!supportsCountryCodeColumn) delete payload.country_code;
    if (!supportsMethodColumn) delete payload.method;
    return supabase.from('verif_codes').insert(payload).select();
  };

  let { data, error } = await attempt();
  if (!error) return { data, error };

  const message = (error.message || '').toLowerCase();
  let retried = false;
  if (supportsExpiresAtColumn && message.includes('expires_at')) {
    supportsExpiresAtColumn = false;
    retried = true;
  }
  if (supportsCountryCodeColumn && message.includes('country_code')) {
    supportsCountryCodeColumn = false;
    retried = true;
  }
  if (supportsMethodColumn && message.includes('method')) {
    supportsMethodColumn = false;
    retried = true;
  }

  if (!retried) return { data, error };

  ({ data, error } = await attempt());
  return { data, error };
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

  const getOriginHost = () => {
    try {
      const origin = event.headers?.origin || event.headers?.Origin || event.headers?.referer || event.headers?.Referer;
      if (!origin) return '';
      const u = new URL(origin);
      return u.host || '';
    } catch {
      return '';
    }
  };
  const originHost = getOriginHost();

  try {
    if (method === 'email') {
      const email = String(payload.email || '').trim().toLowerCase();
      if (!email) return json(400, { ok: false, error: 'Manjka email.' });
      record.email = email;
      const { data, error } = await insertVerificationRecord(record);
      if (error) throw error;
      const inserted = data?.[0];
      try {
        await sendEmailCode(email, code);
      } catch (sendErr) {
        if (inserted?.id) {
          await supabase.from('verif_codes').delete().eq('id', inserted.id);
        }
        throw sendErr;
      }
      return json(200, { ok: true, codeSent: true });
    }

    const phone = sanitizePhone(payload.phone);
    if (!phone) return json(400, { ok: false, error: 'Manjka telefonska številka.' });
    const countryCode = String(payload.countryCode || '').trim();
    record.phone = phone;
    record.country_code = countryCode || null;
  const { data, error } = await insertVerificationRecord(record);
    if (error) throw error;
    const inserted = data?.[0];
    try {
      await sendSmsCode(phone, countryCode, code, originHost);
    } catch (sendErr) {
      if (inserted?.id) {
        await supabase.from('verif_codes').delete().eq('id', inserted.id);
      }
      throw sendErr;
    }
    return json(200, { ok: true, codeSent: true });
  } catch (err) {
    console.error('[send-code] error:', err?.message || err);
    return json(500, { ok: false, error: err?.message || 'Pošiljanje kode ni uspelo.' });
  }
};

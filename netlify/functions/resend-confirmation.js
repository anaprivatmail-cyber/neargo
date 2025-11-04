import nodemailer from 'nodemailer';
import { createClient } from '@supabase/supabase-js';

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  SMTP_HOST,
  SMTP_PORT,
  SMTP_USER,
  SMTP_PASS,
  EMAIL_FROM,
  ALLOWED_ORIGINS,
  ALLOW_TEST_CODES,
  CONTEXT,
  NETLIFY_DEV,
  NODE_ENV,
  CONFIRM_REDIRECT_URL
} = process.env;

const supabase = SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  : null;

const RAW_ALLOW_TEST_CODES = String(ALLOW_TEST_CODES || '').toLowerCase() === 'true';
const NETLIFY_CONTEXT = String(CONTEXT || '').toLowerCase();
const isDevContext = NETLIFY_CONTEXT && NETLIFY_CONTEXT !== 'production';
const shouldSimulateEmail = RAW_ALLOW_TEST_CODES
  || isDevContext
  || String(NETLIFY_DEV || '').toLowerCase() === 'true'
  || String(NODE_ENV || '').toLowerCase() === 'development'
  || !SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS;

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

let cachedTransporter = null;
function getTransporter() {
  if (cachedTransporter) return cachedTransporter;
  if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS) return null;
  cachedTransporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT),
    secure: Number(SMTP_PORT) === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS }
  });
  return cachedTransporter;
}

function buildEmail({ to, link }) {
  const sender = EMAIL_FROM || 'NearGo <info@getneargo.com>';
  const safeLink = link || '#';
  const html = `
    <div style="font-family:Arial,sans-serif;font-size:15px;color:#102437;background:#f6fbfe;padding:24px;border-radius:12px;max-width:460px;margin:auto;">
      <div style="text-align:center;margin-bottom:20px;">
        <div style="display:inline-flex;align-items:center;justify-content:center;gap:12px;font-weight:900;font-size:22px;color:#0b1b2b;">
          <span style="display:inline-flex;align-items:center;justify-content:center;width:48px;height:48px;border-radius:16px;background:linear-gradient(135deg,#0bbbd6,#7de3f0);box-shadow:0 4px 20px rgba(11,187,214,0.35);">
            <svg width="28" height="28" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
              <circle cx="16" cy="16" r="13" stroke="#ffffff" stroke-width="2" opacity="0.65" />
              <circle cx="16" cy="16" r="8" stroke="#ffffff" stroke-width="2" opacity="0.85" />
              <circle cx="16" cy="16" r="4" fill="#ffffff" />
            </svg>
          </span>
          <span>NearGo</span>
        </div>
      </div>
      <h1 style="margin:0 0 14px;font-size:22px;color:#0b1b2b;">Potrdite svoj email</h1>
      <p style="margin:0 0 12px;line-height:1.5;">Da dokončate registracijo, kliknite na gumb spodaj. Če niste zahtevali računa, lahko sporočilo ignorirate.</p>
      <div style="text-align:center;margin:22px 0;">
        <a href="${safeLink}" style="display:inline-block;padding:12px 24px;background:#0bbbd6;color:#fff;font-weight:800;border-radius:999px;text-decoration:none;">Potrdi email</a>
      </div>
      <p style="margin:0 0 8px;font-size:13px;color:#5b6b7b;">Gumb ne dela? Odprite to povezavo: <a href="${safeLink}" style="color:#0bbbd6;word-break:break-all;">${safeLink}</a></p>
      <hr style="border:none;border-top:1px solid rgba(11,30,60,0.08);margin:24px 0">
      <p style="font-size:12px;color:#5b6b7b;margin:0">— NearGo ekipa</p>
    </div>
  `;
  const text = `Pozdravljeni!\n\nZa potrditev računa NearGo odprite povezavo: ${safeLink}\n\nČe se niste registrirali, lahko sporočilo ignorirate.`;
  return { from: sender, to, subject: 'Potrdite svoj NearGo račun', html, text };
}

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
  if (!email) {
    return json(400, { ok: false, error: 'Manjka email.' }, event);
  }

  const redirectTo = String(payload.redirectTo || CONFIRM_REDIRECT_URL || '').trim();
  const options = redirectTo ? { redirectTo } : undefined;

  try {
    const { data, error } = await supabase.auth.admin.generateLink({ type: 'signup', email, options });
    if (error) {
      const message = String(error.message || '').toLowerCase();
      if (message.includes('user not found')) {
        return json(404, { ok: false, error: 'Uporabnik z navedenim emailom ne obstaja.' }, event);
      }
      throw error;
    }

    const actionLink = data?.action_link || data?.properties?.action_link;
    if (!actionLink) {
      return json(500, { ok: false, error: 'Ni mogoče ustvariti potrditvene povezave.' }, event);
    }

    const alreadyConfirmed = Boolean(data?.user?.email_confirmed_at || data?.user?.confirmed_at);

    if (alreadyConfirmed) {
      return json(200, { ok: true, alreadyConfirmed: true }, event);
    }

    if (shouldSimulateEmail) {
      return json(200, { ok: true, dev: true, link: actionLink }, event);
    }

    const transporter = getTransporter();
    if (!transporter) {
      return json(500, { ok: false, error: 'SMTP ni konfiguriran.' }, event);
    }

    const mailOptions = buildEmail({ to: email, link: actionLink });
    await transporter.sendMail(mailOptions);

    return json(200, { ok: true }, event);
  } catch (err) {
    console.error('[resend-confirmation] error:', err?.message || err);
    return json(500, { ok: false, error: err?.message || 'Pošiljanje potrditvenega emaila ni uspelo.' }, event);
  }
};

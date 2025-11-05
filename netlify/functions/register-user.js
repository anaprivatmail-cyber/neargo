import { createClient } from '@supabase/supabase-js';
import nodemailer from 'nodemailer';

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
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

async function sendWelcomeEmail(to, confirmUrl) {
  const sender = EMAIL_FROM || 'NearGo <info@getneargo.com>';
  const html = `
    <div style="font-family:Arial,sans-serif;font-size:15px;color:#102437;background:#f6fbfe;padding:24px;border-radius:12px;max-width:420px;margin:auto;">
      <div style="text-align:center;margin-bottom:18px;">
        <div style="display:inline-flex;align-items:center;gap:10px;font-weight:900;font-size:20px;color:#0b1b2b;">
          <span style="display:inline-flex;align-items:center;justify-content:center;width:42px;height:42px;border-radius:14px;background:linear-gradient(135deg,#0bbbd6,#7de3f0);color:#042430;">N</span>
          NearGo
        </div>
      </div>
      <p style="margin:0 0 12px">Dobrodošli v NearGo!</p>
      <p style="margin:0 0 12px">Vaš račun je bil uspešno ustvarjen. Za dokončanje registracije in aktivacijo računa kliknite na spodnjo povezavo:</p>
      <div style="text-align:center;margin:18px 0;">
        <a href="${confirmUrl}" style="display:inline-block;padding:12px 24px;background:#0bbbd6;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;">Potrdi e-pošto</a>
      </div>
      <p style="margin:0 0 6px">Če povezava ne deluje, kopirajte in prilepite ta URL v brskalnik: ${confirmUrl}</p>
      <p style="margin:0 0 6px">Če niste zahtevali registracije, lahko to sporočilo ignorirate.</p>
      <hr style="border:none;border-top:1px solid rgba(11,30,60,0.08);margin:20px 0">
      <p style="font-size:13px;color:#5b6b7b;margin:0">Ekipa NearGo</p>
    </div>
  `;
  const transporter = getTransporter();
  await transporter.sendMail({ from: sender, to, subject: 'NearGo – dobrodošli in potrdite e-pošto', html });
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

  const { email, password, method, first_name, last_name, phone } = payload;

  if (!email || !password || !method) {
    return json(400, { ok: false, error: 'Manjkajoči podatki.' });
  }

  if (!['email', 'sms'].includes(method)) {
    return json(400, { ok: false, error: 'Neveljavna metoda.' });
  }

  try {
    // Sign up user
    const { data: signUpData, error: signUpError } = await supabase.auth.admin.createUser({
      email,
      password,
      user_metadata: {
        first_name: first_name || '',
        last_name: last_name || '',
        phone: phone || ''
      },
      email_confirm: method === 'email' // Confirm email immediately if verified via email code
    });

    if (signUpError) {
      if (signUpError.message.includes('already registered')) {
        return json(409, { ok: false, error: 'Uporabnik s tem emailom že obstaja.' });
      }
      throw signUpError;
    }

    if (method === 'sms') {
      // For SMS registration, send welcome email with confirmation link
      const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
        type: 'signup',
        email
      });

      if (linkError) throw linkError;

      await sendWelcomeEmail(email, linkData.properties?.email_otp || linkData.properties?.redirect_to || '#');
    }

    return json(200, { ok: true, user: signUpData.user });
  } catch (err) {
    console.error('[register-user] error:', err?.message || err);
    return json(500, { ok: false, error: err?.message || 'Registracija ni uspela.' });
  }
};
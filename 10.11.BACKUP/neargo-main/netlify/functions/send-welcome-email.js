import nodemailer from 'nodemailer';

const {
  BREVO_API_KEY,
  FROM_EMAIL = 'info@getneargo.com',
  FROM_NAME = 'NearGo',
  DOMAIN = process.env.PUBLIC_BASE_URL || process.env.SITE_URL || 'https://getneargo.com',
  SMTP_HOST,
  SMTP_PORT,
  SMTP_USER,
  SMTP_PASS
} = process.env;

const BASE_DOMAIN = DOMAIN.replace(/\/?$/, '');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST,OPTIONS'
};

const json = (status, body) => ({
  statusCode: status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS_HEADERS },
  body: JSON.stringify(body)
});

const logoTargetSvg = `
  <svg width="36" height="36" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
    <circle cx="16" cy="16" r="13" fill="none" stroke="#0b1b2b" stroke-width="2"/>
    <circle cx="16" cy="16" r="8"  fill="none" stroke="#0b1b2b" stroke-width="2" opacity="0.9"/>
    <circle cx="16" cy="16" r="3.2" fill="#0b1b2b"/>
  </svg>`;

async function sendViaBrevo({ to, subject, html, text }) {
  if (!BREVO_API_KEY) return { ok: false, skipped: true };
  const payload = {
    sender: { email: FROM_EMAIL, name: FROM_NAME },
    to: [{ email: to }],
    subject,
    htmlContent: html,
    textContent: text
  };
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'api-key': BREVO_API_KEY
    },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => res.statusText);
    throw new Error(`Brevo ${res.status}: ${detail}`);
  }
  return { ok: true };
}

async function sendViaSmtp({ to, subject, html, text }) {
  if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS) {
    return { ok: false, skipped: true };
  }
  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT),
    secure: Number(SMTP_PORT) === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS }
  });
  await transporter.sendMail({ from: `${FROM_NAME} <${FROM_EMAIL}>`, to, subject, html, text });
  return { ok: true };
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS_HEADERS, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'Method not allowed' });

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch {
    return json(400, { ok: false, error: 'Neveljaven JSON body.' });
  }

  const email = String(payload.email || '').trim().toLowerCase();
  const name = String(payload.name || '').trim();
  if (!email) return json(400, { ok: false, error: 'Manjka e-poštni naslov.' });

  const displayName = name || 'prijatelj';
  const premiumUrl = `${BASE_DOMAIN.replace(/\/$/, '')}/premium.html`;

  const subject = 'NearGo – dobrodošli!';
  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;background:#f6fbfe;padding:0;margin:0">
      <div style="max-width:640px;margin:0 auto;border:1px solid #e3eef7;border-radius:14px;overflow:hidden;background:#fff">
        <div style="padding:14px 18px;display:flex;align-items:center;gap:10px;border-bottom:1px solid #e3eef7;background:#fff">
          <div>${logoTargetSvg}</div>
          <div style="font-weight:900;font-size:20px;letter-spacing:.2px;color:#0b1b2b">NearGo</div>
        </div>
        <div style="padding:24px 28px;color:#0b1b2b">
          <h1 style="margin:0 0 14px;font-size:24px;line-height:1.25">Dobrodošli v NearGo!</h1>
          <p style="margin:0 0 12px">Hvala, ${displayName}, ker ste se registrirali. Želimo vam prijetno raziskovanje dogodkov in ponudb v aplikaciji NearGo.</p>
          <p style="margin:0 0 18px">Za popolno izkušnjo razmislite o <a href="${premiumUrl}" style="color:#0bbbd6;font-weight:700;text-decoration:none">nadgradnji na NearGo Premium</a>. Premium prinaša napredne filtre, prilagojena priporočila in ekskluzivne ugodnosti.</p>
          <div style="margin:20px 0">
            <a href="${premiumUrl}" style="display:inline-block;background:#0bbbd6;color:#fff;text-decoration:none;padding:12px 18px;border-radius:12px;font-weight:800">Odkleni NearGo Premium</a>
          </div>
          <p style="margin:20px 0 0;color:#5b6b7b;font-size:13px">Če imate vprašanja, nam pišite na <a href="mailto:${FROM_EMAIL}" style="color:#0bbbd6;font-weight:700">${FROM_EMAIL}</a>.</p>
        </div>
      </div>
    </div>`;

  const text = `Dobrodošli v NearGo, ${displayName}!

Hvala, da ste se registrirali. Za najboljšo izkušnjo preizkusite NearGo Premium (${premiumUrl}).

Ekipa NearGo`;

  try {
    let sendResult = await sendViaBrevo({ to: email, subject, html, text });
    if (!sendResult?.ok) {
      sendResult = await sendViaSmtp({ to: email, subject, html, text });
    }
    if (!sendResult?.ok) {
      console.warn('[send-welcome-email] noben poštni prevoznik ni konfiguriran – e-pošta ni bila poslana.');
    }
    return json(200, { ok: true, mailed: !!sendResult?.ok, skipped: !sendResult?.ok });
  } catch (err) {
    console.error('[send-welcome-email] error:', err?.message || err);
    return json(500, { ok: false, error: err?.message || 'Pošiljanje e-pošte ni uspelo.' });
  }
};

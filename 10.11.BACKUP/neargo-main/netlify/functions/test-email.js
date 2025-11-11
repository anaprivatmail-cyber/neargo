// /netlify/functions/test-email.js
// ESM (ker imaš "type":"module")

import nodemailer from 'nodemailer';

export const handler = async (event) => {
  // CORS za test iz brskalnika (lahko pustiš)
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: cors(),
      body: '',
    };
  }
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: cors(),
      body: 'Method Not Allowed',
    };
  }

  try {
    const {
      to,
      subject = 'NearGo: test pošte',
      html = '<p>To je testno sporočilo iz Netlify Functions.</p>',
    } = JSON.parse(event.body || '{}');

    if (!to) {
      return json(400, { ok: false, error: 'Manjka polje "to" (prejemnik).' });
    }

    // Preveri okoljske spremenljivke
    const {
      SMTP_HOST,
      SMTP_PORT,
      SMTP_USER,
      SMTP_PASS,
      EMAIL_FROM, // ti imaš to ime
    } = process.env;

    const missing = [];
    if (!SMTP_HOST) missing.push('SMTP_HOST');
    if (!SMTP_PORT) missing.push('SMTP_PORT');
    if (!SMTP_USER) missing.push('SMTP_USER');
    if (!SMTP_PASS) missing.push('SMTP_PASS');
    if (!EMAIL_FROM) missing.push('EMAIL_FROM');

    if (missing.length) {
      return json(500, { ok: false, error: 'Manjkajo env spremenljivke: ' + missing.join(', ') });
    }

    // Transporter (465 = implicit TLS)
    const transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: Number(SMTP_PORT),
      secure: Number(SMTP_PORT) === 465, // true za 465
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    });

    const info = await transporter.sendMail({
      from: EMAIL_FROM,
      to,
      subject,
      html,
    });

    return json(200, { ok: true, messageId: info.messageId });
  } catch (err) {
    console.error(err);
    return json(500, { ok: false, error: String(err?.message || err) });
  }
};

// helpers
function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
}
function json(status, obj) {
  return { statusCode: status, headers: { 'content-type': 'application/json', ...cors() }, body: JSON.stringify(obj) };
}

import nodemailer from 'nodemailer';

export const handler = async (event) => {
  if (String(process.env.DIAGNOSTICS_ENABLED || '').toLowerCase() !== 'true') {
    return resp(404, {});
  }
  if (event.httpMethod === 'OPTIONS') return resp(204, {});
  if (event.httpMethod !== 'POST')   return resp(405, { error: 'Use POST' });

  const body = JSON.parse(event.body || '{}');
  const to = body.to || 'info@getneargo.com';

  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, EMAIL_FROM } = process.env;

  // pokažemo, kaj funkcija uporablja (brez razkritja gesla)
  const summary = {
    SMTP_HOST, 
    SMTP_PORT,
    SMTP_USER,
    EMAIL_FROM,
    passLen: SMTP_PASS ? SMTP_PASS.length : 0
  };

  const attempts = [
    { name: '465-SSL',  port: 465, secure: true,  requireTLS: false },
    { name: '587-STARTTLS', port: 587, secure: false, requireTLS: true }
  ];

  const tried = [];
  for (const a of attempts) {
    try {
      const tx = nodemailer.createTransport({
        host: SMTP_HOST || 'smtp.porkbun.com',
        port: SMTP_PORT ? Number(SMTP_PORT) : a.port,
        secure: SMTP_PORT ? Number(SMTP_PORT) === 465 : a.secure,
        requireTLS: (!SMTP_PORT && a.requireTLS) || false,
        auth: { user: SMTP_USER, pass: SMTP_PASS }
      });

      const info = await tx.sendMail({
        from: EMAIL_FROM || SMTP_USER,
        to,
        subject: `SMTP diag via ${a.name}`,
        html: `<p>Če vidiš ta mail, ${a.name} dela.</p>`
      });

      return resp(200, { ok: true, used: summary, via: a.name, messageId: info.messageId });
    } catch (e) {
      tried.push({ via: a.name, error: String(e.message || e) });
    }
  }

  return resp(500, { ok: false, used: summary, tried });
};

function resp(code, data) {
  return {
    statusCode: code,
    headers: {
      'content-type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS'
    },
    body: JSON.stringify(data)
  };
}

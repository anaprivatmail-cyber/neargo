// netlify/functions/test-email.js
// Public diagnostics + test for email sending. No login required.
// GET /api/test-email?to=<email>&send=1 (send optional)
// Returns details about configured provider (Brevo/SMTP) and error messages if any.

import * as Brevo from "@getbrevo/brevo";
import nodemailer from "nodemailer";

const CORS = { "Access-Control-Allow-Origin":"*", "Access-Control-Allow-Methods":"GET,OPTIONS", "Access-Control-Allow-Headers":"Content-Type" };
const json = (s,b)=>({ statusCode:s, headers:{ "content-type":"application/json", ...CORS }, body: JSON.stringify(b) });

function getProviderInfo(){
  const hasBrevo = !!process.env.BREVO_API_KEY;
  const smtp = {
    host: process.env.SMTP_HOST || null,
    port: process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : null,
    user: process.env.SMTP_USER || null,
    pass: process.env.SMTP_PASS ? "***" : null
  };
  const hasSmtp = !!(smtp.host && smtp.port && smtp.user && process.env.SMTP_PASS);
  const from = process.env.EMAIL_FROM || "NearGo <info@getneargo.com>";
  const support = process.env.SUPPORT_EMAIL || "info@getneargo.com";
  const provider = hasBrevo ? "brevo" : (hasSmtp ? "smtp" : "none");
  return { provider, hasBrevo, smtp, from, support };
}

async function sendViaBrevo({ to, subject, html, attachments=[] }){
  const api = new Brevo.TransactionalEmailsApi();
  api.setApiKey(Brevo.TransactionalEmailsApiApiKeys.apiKey, process.env.BREVO_API_KEY);
  const FROM = process.env.EMAIL_FROM || "NearGo <info@getneargo.com>";
  const FROM_EMAIL = (FROM.match(/<([^>]+)>/) || [null, FROM])[1];
  const FROM_NAME  = FROM.replace(/\s*<[^>]+>\s*$/, "") || "NearGo";
  const m = new Brevo.SendSmtpEmail();
  m.sender = { email: FROM_EMAIL, name: FROM_NAME };
  m.to = [{ email: to }];
  m.subject = subject;
  m.htmlContent = html;
  if (attachments && attachments.length) m.attachment = attachments;
  const res = await api.sendTransacEmail(m);
  return { ok:true, id: res?.messageId || null };
}

async function sendViaSmtp({ to, subject, html }){
  const FROM = process.env.EMAIL_FROM || "NearGo <info@getneargo.com>";
  const host=process.env.SMTP_HOST, port=Number(process.env.SMTP_PORT||0), user=process.env.SMTP_USER, pass=process.env.SMTP_PASS;
  const transporter = nodemailer.createTransport({ host, port, secure: port===465, auth:{ user, pass } });
  await transporter.verify().catch(()=>{});
  const info = await transporter.sendMail({ from: FROM, to, subject, html });
  return { ok:true, id: info?.messageId || null };
}

export const handler = async (event) => {
  try{
    if (event.httpMethod === 'OPTIONS') return { statusCode:204, headers:CORS, body:'' };
    if (event.httpMethod !== 'GET') return json(405, { ok:false, error:'use_get' });

    const cfg = getProviderInfo();
    const qs = event.queryStringParameters || {};
    const to = (qs.to || '').trim();
    const send = (qs.send === '1' || qs.send === 'true');

    if (!send) {
      return json(200, { ok:true, mode:'diagnostics', ...cfg });
    }

    if (!to) return json(400, { ok:false, error:'missing_to' });

    if (cfg.provider === 'none') {
      return json(200, { ok:false, provider:'none', error:'No email provider configured (BREVO_API_KEY or SMTP_* missing).' });
    }

    const subject = 'NearGo – test e-pošte';
    const html = '<p>Pozdravljeni! To je testno sporočilo iz NearGo.</p><p>Če to vidite, pošiljanje deluje.</p>';

    try{
      const result = cfg.provider === 'brevo'
        ? await sendViaBrevo({ to, subject, html })
        : await sendViaSmtp({ to, subject, html });
      return json(200, { ok:true, provider: cfg.provider, result });
    }catch(e){
      return json(200, { ok:false, provider: cfg.provider, error: e?.message || String(e) });
    }
  }catch(e){
    return json(500, { ok:false, error: e?.message || String(e) });
  }
};

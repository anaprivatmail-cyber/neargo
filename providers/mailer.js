// providers/mailer.js
const Brevo = require("@getbrevo/brevo");

const api = new Brevo.TransactionalEmailsApi();
api.setApiKey(
  Brevo.TransactionalEmailsApiApiKeys.apiKey,
  process.env.BREVO_API_KEY
);

const FROM = process.env.EMAIL_FROM || "getneargo <info@getneargo.com>";
const FROM_EMAIL = (FROM.match(/<([^>]+)>/) || [null, FROM])[1];
const FROM_NAME = FROM.replace(/\s*<[^>]+>\s*$/, "") || "getneargo";

async function sendEmailBrevo({ to, subject, html, text, attachments = [] }) {
  const payload = new Brevo.SendSmtpEmail();
  payload.sender = { email: FROM_EMAIL, name: FROM_NAME };
  payload.to = [{ email: to }];
  payload.subject = subject;
  payload.htmlContent = html;
  if (text) payload.textContent = text;
  if (attachments.length) {
    payload.attachment = attachments.map((a) => ({ name: a.name, content: a.contentBase64 }));
  }
  await api.sendTransacEmail(payload);
}

module.exports = { sendEmailBrevo };

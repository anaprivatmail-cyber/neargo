// mailer.cjs - Centraliziran SMTP email modul za NearGo (CommonJS, Netlify kompatibilno)
const nodemailer = require('nodemailer');

const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = Number(process.env.SMTP_PORT);
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const EMAIL_FROM = process.env.EMAIL_FROM || 'NearGo <info@getneargo.com>';

function getTransporter() {
  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS }
  });
}

async function sendMail({ to, subject, html, attachments }) {
  if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS) {
    console.warn('SMTP configuration missing, skipping email send. To:', to, 'Subject:', subject);
    return { success: false, message: 'SMTP not configured' };
  }
  const transporter = getTransporter();
  return await transporter.sendMail({
    from: EMAIL_FROM,
    to,
    subject,
    html,
    attachments
  });
}

module.exports = { sendMail };

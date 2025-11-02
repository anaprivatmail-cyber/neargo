// Netlify function: send-code.cjs
// Pošiljanje verifikacijske kode na email ali SMS (Twilio)

const twilio = require('twilio');
const nodemailer = require('nodemailer');

const TWILIO_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_FROM = process.env.TWILIO_FROM_NUMBER;

function generateCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

exports.handler = async function(event) {
  const body = JSON.parse(event.body || '{}');
  const { method, email, phone, countryCode } = body;
  const code = generateCode();

  // Seznam državnih klicnih številk (za frontend lahko izpelješ iz tega)
  const countryCodes = {
    SI: '+386',
    HR: '+385',
    AT: '+43',
    DE: '+49',
    IT: '+39',
    US: '+1',
    GB: '+44',
    FR: '+33',
    // Dodaj po potrebi
  };

  // Funkcija za pretvorbo lokalne številke v mednarodni format
  function formatPhone(phone, countryCode) {
    // Odstrani presledke, pomišljaje, oklepaje
    let num = phone.replace(/\s|\-|\(|\)/g, '');
    // Če se začne z +, predpostavi da je že v mednarodnem formatu
    if (num.startsWith('+')) return num;
    // Če se začne z 00, pretvori v +
    if (num.startsWith('00')) return '+' + num.slice(2);
    // Če se začne z 0, odstrani 0 in dodaj countryCode
    if (num.startsWith('0')) return countryCode + num.slice(1);
    // Če je že brez 0, dodaj countryCode
    return countryCode + num;
  }

  // Shrani kodo v Supabase (email + code + timestamp)
  const { createClient } = require('@supabase/supabase-js');
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  if (method === 'email' && email) {
    await supabase.from('verif_codes').upsert({
      email,
      code,
      created_at: new Date().toISOString()
    });
    // Pošlji kodo na email z lepim HTML in logotipom direktno prek SMTP/Nodemailer
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT),
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
    });
    await transporter.sendMail({
      from: process.env.EMAIL_FROM,
      to: email,
      subject: 'Vaša potrditvena koda za NearGo',
      html: `
        <div style="font-family:Arial,sans-serif;font-size:16px;color:#222;background:#f9f9f9;padding:24px;border-radius:8px;max-width:400px;margin:auto;">
          <div style="text-align:center;margin-bottom:16px;">
            <img src='https://getneargo.com/assets/icons/other.svg' alt='NearGo' style='height:48px;'>
            <h2 style="margin:8px 0 0 0;font-size:1.5em;">NearGo</h2>
          </div>
          <p>Vaša potrditvena koda za registracijo:</p>
          <div style="font-size:2em;font-weight:bold;letter-spacing:2px;margin:16px 0;">${code}</div>
          <p>Vpišite kodo v aplikacijo za dokončanje registracije.</p>
          <hr style="margin:24px 0;border:none;border-top:1px solid #eee;">
          <small>Ekipa NearGo</small>
        </div>
      `
    });
    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true, codeSent: true })
    };
  }
  if (method === 'sms' && phone && countryCode) {
    // Pretvori številko v mednarodni format
    const formattedPhone = formatPhone(phone, countryCode);
    // Preveri format (mora biti + in vsaj 8 znakov)
    if (!/^\+\d{8,}$/.test(formattedPhone)) {
      return {
        statusCode: 400,
        body: JSON.stringify({ ok: false, error: 'Neveljavna telefonska številka.' })
      };
    }
    // Pošlji kodo na SMS
    const client = twilio(TWILIO_SID, TWILIO_TOKEN);
    await client.messages.create({
      body: `Vaša koda za NearGo: ${code}`,
      from: TWILIO_FROM,
      to: formattedPhone
    });
    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true, codeSent: true, phone: formattedPhone })
    };
  }
  return {
    statusCode: 400,
    body: JSON.stringify({ ok: false, error: 'Neveljavni podatki.' })
  };
};

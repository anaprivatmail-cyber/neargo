// Netlify function: send-code.js
// Pošiljanje verifikacijske kode na email ali SMS (Twilio)

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function generateCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

async function sendEmailCode(email, code) {
  // Try to use mailer.cjs if available, otherwise use a simple implementation
  try {
    const mailer = require('./mailer.cjs');
    await mailer.sendMail({
      to: email,
      subject: 'Vaša potrditvena koda za NearGo',
      html: `
        <div style="font-family:Arial,sans-serif;font-size:16px;color:#222;background:#f9f9f9;padding:24px;border-radius:8px;max-width:400px;margin:auto;">
          <div style="text-align:center;margin-bottom:16px;">
            <h2 style="margin:8px 0 0 0;font-size:1.5em;color:#0bbbd6;">NearGo</h2>
          </div>
          <p>Vaša potrditvena koda za registracijo:</p>
          <div style="font-size:2em;font-weight:bold;letter-spacing:2px;margin:16px 0;color:#0bbbd6;text-align:center;">${code}</div>
          <p>Vpišite kodo v aplikacijo za dokončanje registracije.</p>
          <p style="color:#999;font-size:14px;">Koda je veljavna 10 minut.</p>
          <hr style="margin:24px 0;border:none;border-top:1px solid #eee;">
          <small style="color:#999;">Ekipa NearGo</small>
        </div>
      `
    });
  } catch (err) {
    console.error('Mailer error, falling back to console log:', err);
    // In development, just log the code
    console.log(`Verification code for ${email}: ${code}`);
  }
}

async function sendSMSCode(phone, countryCode, code) {
  // For now, we'll skip SMS implementation and log the code
  // To implement properly, you would need Twilio credentials
  console.log(`SMS code for ${countryCode}${phone}: ${code}`);
  
  // Uncomment when Twilio is configured:
  /*
  const twilio = require('twilio');
  const TWILIO_SID = process.env.TWILIO_ACCOUNT_SID;
  const TWILIO_TOKEN = process.env.TWILIO_AUTH_TOKEN;
  const TWILIO_FROM = process.env.TWILIO_FROM_NUMBER;
  
  if (TWILIO_SID && TWILIO_TOKEN && TWILIO_FROM) {
    const client = twilio(TWILIO_SID, TWILIO_TOKEN);
    await client.messages.create({
      body: `Vaša koda za NearGo: ${code}`,
      from: TWILIO_FROM,
      to: `${countryCode}${phone}`
    });
  }
  */
}

exports.handler = async function(event) {
  try {
    const body = JSON.parse(event.body || '{}');
    const { method, email, phone, countryCode } = body;
    const code = generateCode();

    if (!method || (method !== 'email' && method !== 'sms')) {
      return {
        statusCode: 400,
        body: JSON.stringify({ ok: false, error: 'Neveljavna metoda.' })
      };
    }

    if (method === 'email' && email) {
      // Shrani kodo v bazo
      const { error } = await supabase.from('verif_codes').upsert({
        email,
        code,
        used: false,
        created_at: new Date().toISOString()
      });

      if (error) {
        console.error('Database error:', error);
        return {
          statusCode: 500,
          body: JSON.stringify({ ok: false, error: 'Napaka pri shranjevanju kode.' })
        };
      }

      // Pošlji kodo na email
      await sendEmailCode(email, code);

      return {
        statusCode: 200,
        body: JSON.stringify({ ok: true, codeSent: true, method: 'email' })
      };
    }

    if (method === 'sms' && phone && countryCode) {
      // Shrani kodo v bazo
      const { error } = await supabase.from('verif_codes').upsert({
        phone: countryCode + phone,
        code,
        used: false,
        created_at: new Date().toISOString()
      });

      if (error) {
        console.error('Database error:', error);
        return {
          statusCode: 500,
          body: JSON.stringify({ ok: false, error: 'Napaka pri shranjevanju kode.' })
        };
      }

      // Pošlji kodo na SMS
      await sendSMSCode(phone, countryCode, code);

      return {
        statusCode: 200,
        body: JSON.stringify({ ok: true, codeSent: true, method: 'sms' })
      };
    }

    return {
      statusCode: 400,
      body: JSON.stringify({ ok: false, error: 'Manjkajoči podatki.' })
    };
  } catch (error) {
    console.error('Send code error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ ok: false, error: 'Napaka pri pošiljanju kode: ' + error.message })
    };
  }
};

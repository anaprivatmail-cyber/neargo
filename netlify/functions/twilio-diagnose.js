import twilio from 'twilio';

const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER } = process.env;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST,OPTIONS'
};

const json = (code, body) => ({ statusCode: code, headers: { 'content-type': 'application/json', ...CORS }, body: JSON.stringify(body) });

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'Use POST' });
  let payload;
  try { payload = JSON.parse(event.body || '{}'); } catch { return json(400, { ok: false, error: 'Invalid JSON' }); }
  const to = String(payload.to || '').trim();
  if (!to) return json(400, { ok: false, error: 'Missing `to` phone' });

  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_FROM_NUMBER) {
    return json(200, { ok: false, configured: false, vars: {
      hasSid: !!TWILIO_ACCOUNT_SID, hasToken: !!TWILIO_AUTH_TOKEN, hasFrom: !!TWILIO_FROM_NUMBER
    }});
  }
  try {
    const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
    const msg = await client.messages.create({ from: TWILIO_FROM_NUMBER, to, body: 'NearGo Twilio diagnose: SMS OK' });
    return json(200, { ok: true, configured: true, sid: msg.sid });
  } catch (e) {
    return json(500, { ok: false, configured: true, error: String(e.message || e) });
  }
};

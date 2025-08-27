// netlify/functions/provider-submit.js
export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return res('', 204);

  try {
    if (event.httpMethod !== 'POST') return res('Method Not Allowed', 405);

    const payload = JSON.parse(event.body || '{}');
    const required = ['organizer','organizerEmail','eventName','start'];
    const missing = required.filter(k => !String(payload[k]||'').trim());
    if (missing.length) {
      return json({ ok:false, error:`Manjkajo podatki: ${missing.join(', ')}` }, 400);
    }

    // TODO: shrani v Blobs / DB / pošlji e-mail (pusti tako kot si že imela)
    // Tu samo vrnemo OK, da vidiš uspešno sporočilo v UI.
    return json({ ok:true });
  } catch (e) {
    return json({ ok:false, error: e.message || 'Napaka pri obdelavi' }, 500);
  }
};

function cors(){ return {
  'access-control-allow-origin':'*',
  'access-control-allow-headers':'content-type',
  'access-control-allow-methods':'GET,POST,OPTIONS'
};}
function res(body, status=200, headers={}) {
  return { statusCode: status, headers: { ...cors(), ...headers }, body };
}
function json(data, status=200) {
  return res(JSON.stringify(data), status, { 'content-type':'application/json' });
}

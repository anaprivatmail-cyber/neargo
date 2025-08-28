// netlify/functions/provider-submit.js
// Shrani oddajo v Supabase Storage (JSON, UTF-8) in po želji pošlje e-pošto prek Resend

import { createClient } from '@supabase/supabase-js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
};
const json = (d, s = 200) => ({
  statusCode: s,
  headers: { 'Content-Type': 'application/json', ...CORS },
  body: JSON.stringify(d),
});

const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const FROM_EMAIL     = process.env.FROM_EMAIL     || 'no-reply@getneargo.com';
const ADMIN_EMAIL    = process.env.ADMIN_EMAIL    || 'info@getneargo.com';

// Supabase (service role – premosti RLS)
const SUPABASE_URL             = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY= process.env.SUPABASE_SERVICE_ROLE_KEY;

// kam shranimo JSON oddaje
const BUCKET = 'event-images';
const SUBMISSIONS_PREFIX = 'submissions/';

function slugify(s){
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

async function sendEmail(to, subject, html){
  if (!RESEND_API_KEY) return { ok:false, note:'RESEND_API_KEY ni nastavljen' };
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${RESEND_API_KEY}`,
    },
    body: JSON.stringify({ from: FROM_EMAIL, to, subject, html }),
  });
  const data = await r.json().catch(()=> ({}));
  return { ok: r.ok, data };
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST')   return json({ ok:false, error:'Method not allowed' }, 405);

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return json({ ok:false, error:'Manjka SUPABASE_URL ali SUPABASE_SERVICE_ROLE_KEY' }, 500);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const payload = JSON.parse(event.body || '{}');
    const now = new Date();

    // "featured" = veljavnost 7 dni
    if (payload.featured){
      const until = new Date(Date.now() + 7*24*3600*1000);
      payload.featuredUntil = until.toISOString();
    }

    // ime datoteke za oddajo
    const fileName = `${now.toISOString().replace(/[:.]/g,'-')}-${slugify(payload.eventName || 'dogodek')}.json`;
    const path = `${SUBMISSIONS_PREFIX}${fileName}`;

    // --- KLJUČNO: uporabimo Blob z UTF-8, ne Uint8Array ---
    const bodyObj = {
      ...payload,
      createdAt: now.toISOString(),
      source: 'provider',
    };
    const jsonString = JSON.stringify(bodyObj, null, 2);

    // Blob je v Node 18+ globalen; za vsak slučaj fallback na 'buffer'.Blob
    let blob;
    try {
      blob = new Blob([jsonString], { type: 'application/json; charset=utf-8' });
    } catch (_) {
      const { Blob: NodeBlob } = await import('buffer');
      blob = new NodeBlob([jsonString], { type: 'application/json; charset=utf-8' });
    }

    const { error: uploadError } = await supabase
      .storage
      .from(BUCKET)
      .upload(path, blob, {
        contentType: 'application/json; charset=utf-8',
        upsert: true,
      });

    if (uploadError) {
      return json({ ok:false, error:`Napaka pri shranjevanju v Storage: ${uploadError.message}` }, 500);
    }

    // potrdilo organizatorju (če je e-pošta podana in je RESEND_API_KEY)
    if (payload.organizerEmail){
      try {
        await sendEmail(
          payload.organizerEmail,
          'NearGo – potrditev prejema objave',
          `
            <p>Hvala za oddajo dogodka <b>${payload.eventName || ''}</b>.</p>
            <p>Vaš vnos bomo hitro pregledali. ${payload.featured ? 'Izbrali ste izpostavitev (7 dni).' : ''}</p>
            <p>Ekipa NearGo</p>
          `
        );
      } catch {}
    }

    // obvestilo adminu (če je RESEND_API_KEY)
    try {
      await sendEmail(
        ADMIN_EMAIL,
        'NearGo – nova objava dogodka',
        `
          <p>Nova objava: <b>${payload.eventName || ''}</b></p>
          <p>Mesto: ${payload.city || payload.city2 || ''} | Cena: ${payload.price ?? '—'} | Featured: ${payload.featured ? 'DA':'NE'}</p>
          <pre style="white-space:pre-wrap">${JSON.stringify(payload, null, 2)}</pre>
        `
      );
    } catch {}

    return json({ ok:true, key: path });

  } catch (e) {
    return json({ ok:false, error: e.message || 'Napaka pri shranjevanju' }, 500);
  }
};

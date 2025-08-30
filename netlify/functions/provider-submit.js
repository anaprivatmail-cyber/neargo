// netlify/functions/provider-submit.js
// Shrani oddajo v Supabase Storage (JSON, UTF-8) in po želji pošlje e-pošto prek Resend

import { createClient } from '@supabase/supabase-js';

/* ---------------- CORS + util ---------------- */
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST,OPTIONS'
};
const json = (d, s = 200) => ({
  statusCode: s,
  headers: { 'Content-Type': 'application/json', ...CORS },
  body: JSON.stringify(d)
});

/* ---------------- Konfiguracija iz okolja ---------------- */
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const FROM_EMAIL     = process.env.FROM_EMAIL     || 'no-reply@getneargo.com';
const ADMIN_EMAIL    = process.env.ADMIN_EMAIL    || 'info@getneargo.com';

const SUPABASE_URL              = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// kam shranimo JSON oddaje
const BUCKET = 'event-images';
const SUBMISSIONS_PREFIX = 'submissions/';

/* ---------------- Pomožne ---------------- */
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
      'Authorization': `Bearer ${RESEND_API_KEY}`
    },
    body: JSON.stringify({ from: FROM_EMAIL, to, subject, html })
  });
  const data = await r.json().catch(()=> ({}));
  return { ok: r.ok, data };
}

/** Minimalna server-side validacija (odjemalec validira podrobneje) */
function requireFields(p){
  const missing = [];
  const need = [
    ['organizer', 'Ime organizatorja'],
    ['organizerEmail', 'E-pošta'],
    ['eventName', 'Naslov dogodka'],
    ['venue', 'Lokacija (prizorišče)'],
    ['country', 'Država'],
    ['start', 'Začetek'],
    ['end', 'Konec'],
    ['description', 'Opis'],
    ['category', 'Kategorija']
  ];
  // mesto: lahko pride kot city ali city2
  if (!p.city && !p.city2) missing.push('Mesto/kraj');

  for (const [k, label] of need){
    if (!String(p[k] ?? '').trim()) missing.push(label);
  }

  // če je plačljiv tip, potrebujemo ceno in zalogo
  const saleType = p.offerType || p.saleType || 'none';
  if (saleType === 'ticket' || saleType === 'coupon'){
    if (p.price == null || p.price === '') missing.push('Cena');
    if (p.stock == null || p.stock === '') missing.push('Zaloga');
  }
  return missing;
}

/* ---------------- Handler ---------------- */
export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST')   return json({ ok:false, error:'Method not allowed' }, 405);

  // nujna okoljska
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return json({ ok:false, error:'Manjka SUPABASE_URL ali SUPABASE_SERVICE_ROLE_KEY' }, 500);
  }
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  let payload;
  try{
    payload = JSON.parse(event.body || '{}');
  }catch(e){
    return json({ ok:false, error:'Neveljaven JSON body' }, 400);
  }

  // VALIDACIJA
  const missing = requireFields(payload);
  if (missing.length){
    return json({ ok:false, error: 'Manjkajoča polja: ' + missing.join(', ') }, 400);
  }

  try{
    // Featured (7 dni)
    if (payload.featured){
      const until = new Date(Date.now()+7*24*3600*1000);
      payload.featuredUntil = until.toISOString();
    }

    const now = new Date();
    const fileName = `${now.toISOString().replace(/[:.]/g,'-')}-${slugify(payload.eventName||'dogodek')}.json`;
    const path     = `${SUBMISSIONS_PREFIX}${fileName}`;

    // Za zapis (UTF-8)
    const bodyObj = {
      ...payload,
      createdAt: now.toISOString(),
      source: 'provider'
    };

    // TextEncoder je globalen v Node 18+; fallback za starejše
    const Enc = (typeof TextEncoder !== 'undefined') ? TextEncoder : (await import('node:util')).TextEncoder;
    const uint8 = new Enc().encode(JSON.stringify(bodyObj, null, 2));

    const { error: uploadError } = await supabase
      .storage
      .from(BUCKET)
      .upload(path, uint8, {
        contentType: 'application/json; charset=utf-8',
        upsert: true
      });

    if (uploadError) {
      return json({ ok:false, error:`Napaka pri shranjevanju v Storage: ${uploadError.message}` }, 500);
    }

    /* --------- E-pošta organizatorju --------- */
    if (payload.organizerEmail){
      await sendEmail(
        payload.organizerEmail,
        'NearGo – potrditev prejema objave',
        `
          <p>Hvala za oddajo dogodka <b>${payload.eventName || ''}</b>.</p>
          <p>Vaš vnos bomo hitro pregledali. ${payload.featured ? 'Izbrali ste izpostavitev (7 dni).' : ''}</p>
          <p>Ekipa NearGo</p>
        `
      );
    }

    /* --------- E-pošta adminu --------- */
    const saleType = payload.offerType || payload.saleType || 'none'; // združljivost
    const saleTypeLabel =
      saleType === 'ticket' ? 'ticket' :
      saleType === 'coupon' ? 'coupon' : 'free';

    await sendEmail(
      ADMIN_EMAIL,
      'NearGo – nova objava dogodka',
      `
        <p>Nova objava: <b>${payload.eventName || ''}</b></p>
        <p>Mesto: ${payload.city || payload.city2 || ''}</p>
        <p>Cena: ${payload.price ?? '—'} | Tip: ${saleTypeLabel} | Zaloga: ${payload.stock ?? '—'} | Featured: ${payload.featured ? 'DA':'NE'}</p>
        <p>Strinjanje s provizijo: ${payload.agreeFee ? 'DA' : 'NE'}</p>
        <pre style="white-space:pre-wrap">${JSON.stringify(payload, null, 2)}</pre>
      `
    );

    return json({ ok:true, key:path });

  }catch(e){
    // Zadnja varovalka – vedno pošlji message, da ne bo “neznano”
    return json({ ok:false, error:String(e?.message || e || 'Napaka') }, 500);
  }
};

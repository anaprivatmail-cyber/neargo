// netlify/functions/provider-submit.js
import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
};
const json = (d, s = 200) => ({
  statusCode: s,
  headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS },
  body: JSON.stringify(d)
});

const SUPABASE_URL              = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// pošiljanje prek Brevo (Sendinblue)
const BREVO_API_KEY = process.env.BREVO_API_KEY || '';

const FROM_EMAIL = process.env.FROM_EMAIL || 'info@getneargo.com';
const FROM_NAME  = process.env.FROM_NAME  || 'NearGo';
// Varno vzemi domeno (DOMAIN ali PUBLIC_BASE_URL ali SITE_URL)
const DOMAIN = (process.env.DOMAIN || process.env.PUBLIC_BASE_URL || process.env.SITE_URL || 'https://getneargo.com').replace(/\/$/,'');

const BUCKET = 'event-images';
const SUBMISSIONS_PREFIX = 'submissions/';

function slugify(s){
  return String(s || '')
    .toLowerCase()
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function requireFields(p){
  const missing = [];
  const need = [
    ['organizer',          'Ime organizatorja'],
    ['organizerEmail',     'E-pošta'],
    ['eventName',          'Naslov dogodka'],
    ['venue',              'Lokacija (prizorišče)'],
    ['country',            'Država'],
    ['start',              'Začetek'],
    ['end',                'Konec'],
    ['description',        'Opis'],
    ['category',           'Kategorija']
  ];
  // ime/priemek nista obvezna – lepše je, a ne blokiramo oddaje
  if (!String(p.city || p.city2 || '').trim()) missing.push('Mesto/kraj');
  for (const [k, label] of need) if (!String(p[k] ?? '').trim()) missing.push(label);

  const saleType = p.offerType || p.saleType || 'none';
  if (saleType === 'ticket' || saleType === 'coupon'){
    if (saleType === 'ticket' && (p.price == null || p.price === ''))  missing.push('Cena');
    if (p.stock == null || p.stock === '')  missing.push('Zaloga');
  }

  if (saleType === 'coupon'){
    const k = String(p.couponKind || '').toUpperCase();
    if (!['PERCENT','VALUE','FREEBIE'].includes(k)) missing.push('Tip kupona');
    if (k === 'PERCENT' && !(Number(p.couponPercentOff) > 0 && Number(p.couponPercentOff) <= 100)) missing.push('% popusta (1–100)');
    if (k === 'VALUE'   && !(Number(p.couponValueEur) > 0)) missing.push('Vrednost kupona (€)');
    if (k === 'FREEBIE' && !String(p.couponFreebieLabel || '').trim()) missing.push('Opis brezplačne ugodnosti');
  }
  return missing;
}

async function fromCacheOrGeocode(supabase, city, country) {
  const cityQ = String(city || '').trim();
  const countryQ = String(country || '').trim().toUpperCase();
  if (!cityQ || !countryQ) return null;

  const { data: cached } = await supabase
    .from('geo_cache')
    .select('id, lat, lon')
    .eq('country', countryQ)
    .ilike('city', cityQ)
    .limit(1)
    .maybeSingle();

  if (cached && Number.isFinite(cached.lat) && Number.isFinite(cached.lon)) {
    return { lat: cached.lat, lon: cached.lon, cached: true };
  }

  const search = [cityQ, countryQ].filter(Boolean).join(', ');
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('q', search);
  url.searchParams.set('format', 'json');
  url.searchParams.set('limit', '1');

  const r = await fetch(url.toString(), { headers: { 'User-Agent': 'NearGo/1.0 (getneargo.com)' } });
  if (!r.ok) return null;
  const arr = await r.json().catch(()=>[]);
  if (!arr?.length) return null;

  const lat = parseFloat(arr[0].lat);
  const lon = parseFloat(arr[0].lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  try {
    if (cached?.id) {
      await supabase.from('geo_cache').update({ lat, lon, updated_at: new Date().toISOString() }).eq('id', cached.id);
    } else {
      await supabase.from('geo_cache').insert({ city: cityQ, country: countryQ, lat, lon });
    }
  } catch {}
  return { lat, lon, cached: false };
}

async function sendMailBrevo({ to, subject, html, text }) {
  if (!BREVO_API_KEY) return { ok:false, skipped:true };
  const body = {
    sender: { email: FROM_EMAIL, name: FROM_NAME },
    to: [{ email: to }],
    subject,
    htmlContent: html,
    textContent: text || html.replace(/<[^>]+>/g,' ')
  };
  const r = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'api-key': BREVO_API_KEY },
    body: JSON.stringify(body)
  });
  if (!r.ok) throw new Error(`Brevo ${r.status}: ${await r.text().catch(()=>r.statusText)}`);
  return { ok:true };
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST')   return json({ ok:false, error:'Method not allowed' }, 405);

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY){
    return json({ ok:false, error:'Manjka SUPABASE_URL ali SUPABASE_SERVICE_ROLE_KEY' }, 500);
  }
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  let payload;
  try{ payload = JSON.parse(event.body || '{}'); }
  catch{ return json({ ok:false, error:'Neveljaven JSON body' }, 400); }

  // prisilna cena za kupon
  if ((payload.offerType || payload.saleType) === 'coupon') {
    payload.price = 2;
  }

  const missing = requireFields(payload);
  if (missing.length) return json({ ok:false, error:'Manjkajoča polja: ' + missing.join(', ') }, 400);

  // 800 znakov – trda omejitev
  const desc = String(payload.description || '');
  if (desc.length > 800) {
    return json({ ok:false, error:`Opis je predolg (${desc.length}). Največ 800 znakov.` }, 400);
  }

  try{
    // geokodiranje po potrebi
    if ((!payload.venueLat || !payload.venueLon) && (payload.city || payload.city2) && payload.country){
      const city = payload.city || payload.city2;
      const cc   = payload.country;
      const gc = await fromCacheOrGeocode(supabase, city, cc);
      if (gc){ payload.venueLat = gc.lat; payload.venueLon = gc.lon; }
    }

    // featured 7 dni (brezplačno)
    if (payload.featured){
      const until = new Date(Date.now() + 7*24*3600*1000);
      payload.featuredUntil = until.toISOString();
    }

    // token za urejanje
    const editToken = crypto.randomBytes(24).toString('hex');

    // normalizacija kupona + opis
    if ((payload.offerType || payload.saleType) === 'coupon'){
      payload.couponKind = String(payload.couponKind || '').toUpperCase();
      payload.couponPercentOff   = payload.couponKind==='PERCENT' ? Number(payload.couponPercentOff || 0) : null;
      payload.couponValueEur     = payload.couponKind==='VALUE'   ? Number(payload.couponValueEur || 0)   : null;
      payload.couponFreebieLabel = payload.couponKind==='FREEBIE' ? String(payload.couponFreebieLabel || '').trim() : null;
      payload.couponDesc = String(payload.couponDesc || payload.couponFreebieLabel || '').trim() ||
                           (payload.couponKind==='PERCENT' ? `${payload.couponPercentOff||''}%` :
                            payload.couponKind==='VALUE'   ? `${payload.couponValueEur||''}€` : '');
    }

    // shrani JSON v Storage
    const now = new Date();
    const fileName = `${now.toISOString().replace(/[:.]/g,'-')}-${slugify(payload.eventName || 'dogodek')}.json`;
    const path = `${SUBMISSIONS_PREFIX}${fileName}`;

    const bodyObj = {
      ...payload,
      createdAt: now.toISOString(),
      source: 'provider',
      secretEditToken: editToken
    };
    const uint8 = Buffer.from(JSON.stringify(bodyObj, null, 2), 'utf8');

    const { error: uploadError } = await supabase
      .storage.from(BUCKET)
      .upload(path, uint8, { contentType: 'application/json; charset=utf-8', upsert: true });

    if (uploadError) return json({ ok:false, error:`Napaka pri shranjevanju v Storage: ${uploadError.message}` }, 500);

    // link za urejanje (kratek "TUKAJ" bo v e-pošti)
    const editLink = `${DOMAIN}/api/provider-edit?key=${encodeURIComponent(path)}&token=${encodeURIComponent(editToken)}`;

    // e-pošta
    let emailStatus = "skipped";
    if (!BREVO_API_KEY) {
      console.log("[provider-submit] BREVO_API_KEY manjka – e-mail preskočen");
    } else {
      try{
        const fullName =
          (String(payload.organizerFirstName || '').trim() || '') +
          (payload.organizerLastName ? ' ' + String(payload.organizerLastName).trim() : '');

        const greetName = fullName.trim() || String(payload.organizer || '').trim() || 'organizator';

        const eventLine = `<b>${payload.eventName}</b><br>${payload.venue || ''}${payload.city ? ', ' + payload.city : ''}${payload.country ? ', ' + payload.country : ''}`;

        const couponLine = (payload.offerType === 'coupon')
          ? `<p><b>Kupon:</b> ${payload.couponDesc || 'vnovčljiv pri ponudniku'} (cena za kupca: 2,00 €)</p>`
          : '';

        const featuredLine = payload.featured
          ? '<p><b>Izpostavitev:</b> vključena (7 dni) – <i>brezplačno</i>.</p>'
          : '';

        const html = `
          <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#0b1b2b">
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
              <svg viewBox="0 0 32 32" width="28" height="28" aria-hidden="true">
                <defs>
                  <radialGradient id="g1" cx="50%" cy="50%"><stop offset="0%" stop-color="#0bbbd6"/><stop offset="100%" stop-color="#7de3f0"/></radialGradient>
                </defs>
                <circle cx="16" cy="16" r="13" stroke="url(#g1)" stroke-width="2" fill="none"></circle>
                <circle cx="16" cy="16" r="8" stroke="url(#g1)" stroke-width="2" fill="none" opacity=".9"></circle>
                <circle cx="16" cy="16" r="3.2" fill="#0bbbd6"></circle>
              </svg>
              <h2 style="margin:0">NearGo</h2>
            </div>

            <p style="margin:0 0 10px 0">Pozdravljeni, <b>${greetName}</b>! Vaša objava je bila uspešno prejeta.</p>

            <div style="border:1px solid #cfe1ee;border-radius:12px;padding:12px;margin:12px 0;background:#fff">
              <div>${eventLine}</div>
              <div style="margin-top:6px"><b>Začetek:</b> ${payload.start || ''} • <b>Konec:</b> ${payload.end || ''}</div>
              ${couponLine}
              ${featuredLine}
            </div>

            <p style="margin:12px 0">Uredite oddajo kadarkoli: <a href="${editLink}">TUKAJ</a>.</p>

            <p style="margin-top:18px">Hvala,<br>ekipa NearGo</p>
          </div>`;

        await sendMailBrevo({
          to: payload.organizerEmail,
          subject: 'NearGo – potrditev oddaje & povezava za urejanje',
          html
        });
        emailStatus = "sent";
      } catch (e) {
        emailStatus = `failed: ${e?.message || e}`;
        console.error("[provider-submit] E-pošta napaka:", e);
      }
    }

    return json({
      ok: true,
      key: path,
      lat: payload.venueLat ?? null,
      lon: payload.venueLon ?? null,
      editLink,
      emailStatus
    });

  }catch(e){
    console.error("[provider-submit] FATAL:", e?.message || e);
    return json({ ok:false, error:String(e?.message || e) }, 500);
  }
};

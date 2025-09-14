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

const BREVO_API_KEY = process.env.BREVO_API_KEY || '';
const FROM_EMAIL    = process.env.FROM_EMAIL || 'info@getneargo.com';
const FROM_NAME     = process.env.FROM_NAME  || 'NearGo';
const DOMAIN        = (process.env.DOMAIN || process.env.PUBLIC_BASE_URL || process.env.SITE_URL || 'https://getneargo.com').replace(/\/$/,'');
const SCANNER_KEY   = process.env.SCANNER_KEY || '';

const BUCKET = 'event-images';
const SUBMISSIONS_PREFIX = 'submissions/';

function slugify(s){
  return String(s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}
function escapeHtml(s){
  return String(s||'').replace(/[&<>"']/g, c => (
    { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]
  ));
}
function requireFields(p){
  const missing = [];
  const need = [
    ['organizer','Ime organizatorja'],['organizerEmail','E-pošta'],['eventName','Naslov dogodka'],
    ['venue','Lokacija (prizorišče)'],['country','Država'],['start','Začetek'],['end','Konec'],['description','Opis'],['category','Kategorija']
  ];
  if (!String(p.city || p.city2 || '').trim()) missing.push('Mesto/kraj');
  for (const [k, label] of need) if (!String(p[k] ?? '').trim()) missing.push(label);

  const saleType = p.offerType || p.saleType || 'none';
  if (saleType === 'ticket' || saleType === 'coupon'){
    if (saleType === 'ticket' && (p.price == null || p.price === '')) missing.push('Cena');
    if (p.stock == null || p.stock === '') missing.push('Zaloga');
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

// ——— mail (Brevo) ————————————————————————————————————————————
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
    headers: { 'content-type':'application/json', 'api-key': BREVO_API_KEY },
    body: JSON.stringify(body)
  });
  if (!r.ok) {
    const t = await r.text().catch(()=>r.statusText);
    throw new Error(`Brevo ${r.status}: ${t}`);
  }
  return { ok:true };
}

// ——— handler ————————————————————————————————————————————————
export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST')   return json({ ok:false, error:'Method not allowed' }, 405);

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY){
    return json({ ok:false, error:'Manjka SUPABASE_URL ali SUPABASE_SERVICE_ROLE_KEY' }, 500);
  }
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  let payload;
  try { payload = JSON.parse(event.body || '{}'); }
  catch { return json({ ok:false, error:'Neveljaven JSON body' }, 400); }

  if ((payload.offerType || payload.saleType) === 'coupon') {
    payload.price = 2; // prodajna cena pri nas za kupon
  }

  const missing = requireFields(payload);
  if (missing.length) return json({ ok:false, error:'Manjkajoča polja: ' + missing.join(', ') }, 400);

  const desc = String(payload.description || '');
  if (desc.length > 800) return json({ ok:false, error:`Opis je predolg (${desc.length}). Največ 800 znakov.` }, 400);

  try{
    // Kupon normalizacija
    if ((payload.offerType || payload.saleType) === 'coupon'){
      payload.couponKind = String(payload.couponKind || '').toUpperCase();
      payload.couponPercentOff   = payload.couponKind==='PERCENT' ? Number(payload.couponPercentOff || 0) : null;
      payload.couponValueEur     = payload.couponKind==='VALUE'   ? Number(payload.couponValueEur || 0)   : null;
      payload.couponFreebieLabel = payload.couponKind==='FREEBIE' ? String(payload.couponFreebieLabel || '').trim() : null;

      payload.couponDesc = String(payload.couponDesc || payload.couponFreebieLabel || '').trim()
        || (payload.couponKind==='PERCENT' ? `${payload.couponPercentOff||''}%`
           : payload.couponKind==='VALUE'   ? `${payload.couponValueEur||''}€` : '');

      // display_benefit fallback
      if (!payload.display_benefit) {
        const kind = (payload.couponKind || '').toUpperCase();
        if (kind === 'PERCENT') payload.display_benefit = `-${Number(payload.couponPercentOff||0)}%`;
        else if (kind === 'VALUE') payload.display_benefit = `-${Number(payload.couponValueEur||0).toFixed(2)} €`;
        else if (kind === 'FREEBIE') payload.display_benefit = (payload.couponFreebieLabel||'').trim();
      }
    }

    // shranimo oddajo (JSON) v Storage
    const now = new Date();
    const fileName = `${now.toISOString().replace(/[:.]/g,'-')}-${slugify(payload.eventName || 'dogodek')}.json`;
    const path = `${SUBMISSIONS_PREFIX}${fileName}`;
    const bodyObj = {
      ...payload,
      createdAt: now.toISOString(),
      source: 'provider',
      secretEditToken: crypto.randomBytes(24).toString('hex')
    };

    const uint8 = Buffer.from(JSON.stringify(bodyObj, null, 2), 'utf8');
    const { error: uploadError } = await supabase
      .storage
      .from(BUCKET)
      .upload(path, uint8, { contentType:'application/json; charset=utf-8', upsert:true });

    if (uploadError) return json({ ok:false, error:`Napaka pri shranjevanju v Storage: ${uploadError.message}` }, 500);

    // === NOVO: pošlji potrditveni e-mail organizatorju (če imamo ključ) ===
    try {
      if (BREVO_API_KEY && payload.organizerEmail) {
        const org = escapeHtml(payload.organizer || '');
        const eventName = escapeHtml(payload.eventName || '');
        const city = escapeHtml(payload.city || payload.city2 || '');
        const venue = escapeHtml(payload.venue || '');
        const category = escapeHtml(payload.category || '');
        const start = escapeHtml(payload.start || '');
        const end   = escapeHtml(payload.end || '');
        const offerType = String(payload.offerType || payload.saleType || 'none');

        let offerLine = '';
        if (offerType === 'ticket') {
          const eur = Number(payload.price || 0).toFixed(2);
          offerLine = `<li><b>Vstopnice:</b> ${eur} €</li>`;
        } else if (offerType === 'coupon') {
          const benefit = escapeHtml(payload.display_benefit || payload.couponDesc || '');
          offerLine = `<li><b>Kupon:</b> ${benefit || 'ugodnost'}</li>`;
        }

        const html = `
          <div style="font-family:Arial,Helvetica,sans-serif;max-width:680px;margin:auto;border:1px solid #e3eef7;border-radius:12px;padding:16px">
            <h2 style="margin:0 0 10px">Potrditev oddaje dogodka</h2>
            <p>Spoštovani <b>${org}</b>,</p>
            <p>vaša oddaja dogodka <b>${eventName}</b> je bila prejeta.</p>
            <ul>
              <li><b>Lokacija:</b> ${venue}, ${city}</li>
              <li><b>Kategorija:</b> ${category}</li>
              <li><b>Začetek:</b> ${start}</li>
              <li><b>Konec:</b> ${end}</li>
              ${offerLine}
            </ul>
            <p style="color:#5b6b7b;font-size:13px;margin-top:12px">
              Povzetek oddaje je shranjen pri nas. Po potrditvi prejmete novo obvestilo.
              Za vprašanja nam pišite na <a href="mailto:${FROM_EMAIL}">${FROM_EMAIL}</a>.
            </p>
          </div>`;

        await sendMailBrevo({
          to: payload.organizerEmail,
          subject: `NearGo – prijava dogodka prejeta: ${payload.eventName || ''}`,
          html
        });
      }
    } catch (mailErr) {
      console.error("[provider-submit] mail error:", mailErr?.message || mailErr);
    }
    // === konec pošiljanja e-pošte ===

    return json({ ok:true, key:path });
  }catch(e){
    console.error("[provider-submit] FATAL:", e?.message || e);
    return json({ ok:false, error:String(e?.message || e) }, 500);
  }
};

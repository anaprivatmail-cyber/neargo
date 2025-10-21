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

/** Vrne {kind,value,label} iz prvega elementa coupons[] ali null */
function firstCouponFromArray(p){
  if (!Array.isArray(p?.coupons) || !p.coupons.length) return null;
  const c = p.coupons.find(Boolean);
  if (!c) return null;
  const kind = String(c.type||'').toUpperCase();
  if (kind === 'PERCENT' && Number(c.value)>0) return { kind, value:Number(c.value), label:`-${Number(c.value)}%` };
  if (kind === 'VALUE'   && Number(c.value)>0) return { kind, value:Number(c.value), label:`${Number(c.value).toFixed(2)} €` };
  if (kind === 'FREEBIE' && String(c.value||'').trim()) return { kind, value:String(c.value).trim(), label:String(c.value).trim() };
  return null;
}

// [CHG] requireFields: za storitve ne zahtevamo start/end; stock je obvezen le za dogodke; ticket: cena ali cenik
function requireFields(p){
  const missing = [];
  const isService = String(p.type || p.entryType || (p?.service ? 'service' : 'event')).toLowerCase() === 'service';
  const needBaseEvent = [
    ['organizer','Ime organizatorja'],
    ['organizerEmail','E-pošta'],
    ['eventName','Naslov dogodka'],
    ['venue','Lokacija (prizorišče)'],
    ['country','Država'],
    ['description','Opis'],
    ['category','Kategorija']
  ];
  const needBaseService = [
    ['organizer','Ime organizatorja'],
    ['organizerEmail','E-pošta'],
    ['eventName','Naslov storitve'],
    ['venue','Lokacija (salon/prizorišče)'],
    ['country','Država'],
    ['description','Opis'],
    ['category','Kategorija']
  ];

  if (!String(p.city || p.city2 || '').trim()) missing.push('Mesto/kraj');
  for (const [k, label] of (isService ? needBaseService : needBaseEvent)) {
    if (!String(p[k] ?? '').trim()) missing.push(label);
  }

  // čas je obvezen le za DOGODEK
  if (!isService) {
    if (!String(p.start || '').trim()) missing.push('Začetek');
    if (!String(p.end   || '').trim()) missing.push('Konec');
  } else {
    // storitev: če je unlimited/pokliči, potrebujemo telefon
    const avail = p?.service?.availability || 'unlimited';
    if (String(avail) === 'unlimited') {
      if (!String(p?.service?.phone || '').trim()) {
        missing.push('Telefon za rezervacije (storitev – pokliči)');
      }
    }
    // če je scheduled, termine ureja koledar – tu jih ne zahtevamo
  }

  const saleType = p.offerType || p.saleType || 'none';

  // — VSTOPNICE: zahtevaj CENO ali vsaj en element v ticketPrices
  if (saleType === 'ticket') {
    const hasBase = !(p.price == null || p.price === '');
    const hasTiers = Array.isArray(p.ticketPrices) && p.ticketPrices.some(tp => Number(tp?.price) > 0);
    if (!hasBase && !hasTiers) missing.push('Cena ali cenik vstopnic');
  }

  // — ZALOGA: je obvezna le za DOGODKE z "ticket" ali "coupon"
  if (!isService && (saleType === 'ticket' || saleType === 'coupon')) {
    if (p.stock == null || p.stock === '') missing.push('Zaloga');
  }

  // — KUPONI: veljavno je ali top-level polje ali prvi element v coupons[]
  if (saleType === 'coupon'){
    const fromArray = firstCouponFromArray(p);
    if (!fromArray) {
      const k = String(p.couponKind || '').toUpperCase();
      if (!['PERCENT','VALUE','FREEBIE'].includes(k)) missing.push('Tip kupona');
      if (k === 'PERCENT' && !(Number(p.couponPercentOff) > 0 && Number(p.couponPercentOff) <= 100)) missing.push('% popusta (1–100)');
      if (k === 'VALUE'   && !(Number(p.couponValueEur) > 0)) missing.push('Vrednost kupona (€)');
      if (k === 'FREEBIE' && !String(p.couponFreebieLabel || '').trim()) missing.push('Opis brezplačne ugodnosti');
    }
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

  // [CHG] kupon pri nas stane 2 € (frontend Premium = 0 € rešuje checkout/issue-coupon)
  if ((payload.offerType || payload.saleType) === 'coupon') {
    payload.price = 2;
  }

  const missing = requireFields(payload);
  if (missing.length) return json({ ok:false, error:'Manjkajoča polja: ' + missing.join(', ') }, 400);

  const desc = String(payload.description || '');
  if (desc.length > 800) return json({ ok:false, error:`Opis je predolg (${desc.length}). Največ 800 znakov.` }, 400);

  try{
    // Kupon normalizacija:
    // 1) če pride iz coupons[], ga privzemi v top-level za konsistentnost (display_benefit, mail)
    const cArr = firstCouponFromArray(payload);
    if ((payload.offerType || payload.saleType) === 'coupon' && cArr){
      if (cArr.kind === 'PERCENT') {
        payload.couponKind = 'PERCENT';
        payload.couponPercentOff = Number(cArr.value||0);
        payload.couponValueEur = null;
        payload.couponFreebieLabel = null;
      } else if (cArr.kind === 'VALUE') {
        payload.couponKind = 'VALUE';
        payload.couponValueEur = Number(cArr.value||0);
        payload.couponPercentOff = null;
        payload.couponFreebieLabel = null;
      } else if (cArr.kind === 'FREEBIE') {
        payload.couponKind = 'FREEBIE';
        payload.couponFreebieLabel = String(cArr.value||'').trim();
        payload.couponPercentOff = null;
        payload.couponValueEur = null;
      }
      // display label
      payload.display_benefit = payload.display_benefit || cArr.label;
      // opis kupona
      payload.couponDesc = payload.couponDesc || cArr.label;
    }

    if ((payload.offerType || payload.saleType) === 'coupon' && !cArr){
      // top-level varianta (ostaja enako)
      payload.couponKind = String(payload.couponKind || '').toUpperCase();
      payload.couponPercentOff   = payload.couponKind==='PERCENT' ? Number(payload.couponPercentOff || 0) : null;
      payload.couponValueEur     = payload.couponKind==='VALUE'   ? Number(payload.couponValueEur || 0)   : null;
      payload.couponFreebieLabel = payload.couponKind==='FREEBIE' ? String(payload.couponFreebieLabel || '').trim() : null;

      payload.couponDesc = String(payload.couponDesc || payload.couponFreebieLabel || '').trim()
        || (payload.couponKind==='PERCENT' ? `${payload.couponPercentOff||''}%`
           : payload.couponKind==='VALUE'   ? `${payload.couponValueEur||''}€` : '');

      if (!payload.display_benefit) {
        const kind = (payload.couponKind || '').toUpperCase();
        if (kind === 'PERCENT') payload.display_benefit = `-${Number(payload.couponPercentOff||0)}%`;
        else if (kind === 'VALUE') payload.display_benefit = `-${Number(payload.couponValueEur||0).toFixed(2)} €`;
        else if (kind === 'FREEBIE') payload.display_benefit = (payload.couponFreebieLabel||'').trim();
      }
    }

    // shranimo oddajo (JSON) v Storage — [KEEP]
    const now = new Date();
    const fileName = `${now.toISOString().replace(/[:.]/g,'-')}-${slugify(payload.eventName || 'dogodek')}.json`;
    const path = `${SUBMISSIONS_PREFIX}${fileName}`;

    // generate edit and stats tokens for later use (edit event & view stats)
    const editToken = crypto.randomBytes(24).toString('hex');
    const statsToken = crypto.randomBytes(24).toString('hex');

    // [ADD] stabilen eventId iz poti (za povezavo s service_slots)
    const eventId = crypto.createHash('sha1').update(path).digest('hex').slice(0, 16);

    const bodyObj = {
      ...payload,
      createdAt: now.toISOString(),
      source: 'provider',
      secretEditToken: crypto.randomBytes(24).toString('hex'),
      editToken,
      statsToken,
      eventId // [ADD] v shranjen JSON dodamo identifikator zapisa
    };

    const uint8 = Buffer.from(JSON.stringify(bodyObj, null, 2), 'utf8');
    const { error: uploadError } = await supabase
      .storage
      .from(BUCKET)
      .upload(path, uint8, { contentType:'application/json; charset=utf-8', upsert:true });

    if (uploadError) return json({ ok:false, error:`Napaka pri shranjevanju v Storage: ${uploadError.message}` }, 500);

    // [ADD] Če je storitev s koledarjem → sinhroniziraj termine v service_slots
    const isService = String(payload.type || payload.entryType || (payload?.service ? 'service' : 'event')).toLowerCase() === 'service';
    if (isService && payload?.service?.availability === 'scheduled' && Array.isArray(payload?.service?.slots) && payload.service.slots.length) {
      try {
        await fetch(`${DOMAIN}/api/service-slots-save`, {
          method: 'POST',
          headers: { 'Content-Type':'application/json' },
          body: JSON.stringify({
            eventId,
            slots: payload.service.slots.map(s => ({
              start: s.start,
              end: s.end || null,
              quota: Number(s.quota || 1)
            }))
          })
        });
      } catch (e) {
        // mehko opozorilo, ne prekinjamo glavnega toka
        console.warn('[provider-submit] service-slots-save warn:', e?.message || e);
      }
    }

    // === Potrditveni e-mail organizatorju/ponudniku (glava usklajena z nakupnim mailom) ===
    try {
      if (BREVO_API_KEY && payload.organizerEmail) {
        const contact   = escapeHtml(payload.organizerFullName || payload.organizer || '');
        const eventName = escapeHtml(payload.eventName || '');
        const city      = escapeHtml(payload.city || payload.city2 || '');
        const venue     = escapeHtml(payload.venue || '');
        const category  = escapeHtml(payload.category || '');
        const start     = escapeHtml(payload.start || '');
        const end       = escapeHtml(payload.end || '');
        const offerType = String(payload.offerType || payload.saleType || 'none');

        // [ADD] dinamičen tip za slovnično sporočilo
        const noun = isService ? 'storitev' : 'dogodek';

        // Izpis cen v e-pošti (ostane)
        let offerLine = '';
        const hasTicketPrices = Array.isArray(payload.ticketPrices) && payload.ticketPrices.length > 0;

        if (offerType === 'ticket') {
          if (hasTicketPrices) {
            const ticketLines = payload.ticketPrices
              .filter(tp => tp && typeof tp.price !== 'undefined')
              .map(tp => {
                const lbl = escapeHtml(String(tp.label || '').trim() || 'Vstopnica');
                const pr  = Number(tp.price || 0);
                return `<li>${lbl} — <b>${pr.toFixed(2)} €</b></li>`;
              })
              .join('');
            offerLine = `<li><b>Cenik vstopnic:</b><ul style="margin:6px 0 0;padding-left:18px">${ticketLines}</ul></li>`;
          } else {
            const eur = Number(payload.price || 0).toFixed(2);
            offerLine = `<li><b>Vstopnice:</b> ${eur} €</li>`;
          }
        } else if (offerType === 'coupon') {
          const benefit = escapeHtml(payload.display_benefit || payload.couponDesc || '');
          offerLine = `<li><b>Kupon:</b> ${benefit || 'ugodnost'}</li>`;
        }

        // 🔗 Uredi + Statistika
        const linkEdit  = `${DOMAIN}/edit.html?token=${editToken}&key=${encodeURIComponent(path)}`;
        const linkStats = `${DOMAIN}/org-stats.html?stats=${statsToken}`;

        const logoTargetSvg = `
          <svg width="36" height="36" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
            <circle cx="16" cy="16" r="13" fill="none" stroke="#0b1b2b" stroke-width="2"/>
            <circle cx="16" cy="16" r="8"  fill="none" stroke="#0b1b2b" stroke-width="2" opacity="0.9"/>
            <circle cx="16" cy="16" r="3.2" fill="#0b1b2b"/>
          </svg>`;

        const primary = "#0bbbd6";

        const html = `
          <div style="font-family:Arial,Helvetica,sans-serif;background:#f6fbfe;padding:0;margin:0">
            <div style="max-width:680px;margin:0 auto;border:1px solid #e3eef7;border-radius:14px;overflow:hidden;background:#fff">
              <div style="padding:14px 18px;display:flex;align-items:center;gap:10px;border-bottom:1px solid #e3eef7;background:#fff">
                <div>${logoTargetSvg}</div>
                <div style="font-weight:900;font-size:20px;letter-spacing:.2px;color:#0b1b2b">NearGo</div>
              </div>

              <div style="padding:20px 22px;color:#0b1b2b">
                <h2 style="margin:0 0 12px 0;font-size:20px;line-height:1.35">Potrditev oddaje ${noun}a</h2>
                <p style="margin:0 0 8px">Spoštovani <b>${contact}</b>,</p>
                <p style="margin:0 0 14px">vaša oddaja <b>${noun}a "${eventName}"</b> je bila prejeta.</p>

                <div style="border:1px solid #e3eef7;border-radius:12px;padding:12px 14px;margin:10px 0;background:#f9fcff">
                  ${ venue ? `<div style="margin:2px 0"><b>Lokacija:</b> ${venue}${city?(', '+city):''}</div>` : (city?`<div style="margin:2px 0"><b>Mesto:</b> ${city}</div>`:'') }
                  ${ category ? `<div style="margin:2px 0"><b>Kategorija:</b> ${category}</div>` : '' }
                  ${ !isService && start ? `<div style="margin:2px 0"><b>Začetek:</b> ${start}</div>` : '' }
                  ${ !isService && end   ? `<div style="margin:2px 0"><b>Konec:</b> ${end}</div>`     : '' }
                  ${ isService && payload?.service?.availability==='unlimited' && payload?.service?.phone
                        ? `<div style="margin:2px 0"><b>Telefon za rezervacije:</b> ${escapeHtml(payload.service.phone)}</div>` : '' }
                </div>

                <div style="border:1px solid #cfe1ee;border-radius:12px;padding:14px 16px;margin:12px 0;background:#fff">
                  <div style="font-weight:900;margin-bottom:6px">${eventName}</div>
                  ${
                    (offerType === 'ticket' && hasTicketPrices)
                      ? `<div style="margin:6px 0 4px"><b>Cenik vstopnic</b></div>
                         <ul style="margin:6px 0 0 18px;padding:0">${payload.ticketPrices.map(tp=>{
                           const lbl = escapeHtml(String(tp.label||'Vstopnica'));
                           const pr  = Number(tp.price||0);
                           return `<li style="margin:2px 0">${lbl} — <b>${pr.toFixed(2)} €</b></li>`;
                         }).join('')}</ul>`
                      : (offerType === 'ticket'
                          ? `Vstopnice: <b>${Number(payload.price||0).toFixed(2)} €</b>`
                          : `Kupon: <b>${escapeHtml(payload.display_benefit || payload.couponDesc || 'ugodnost')}</b>` )
                  }
                  ${
                    isService && payload?.service?.availability==='scheduled'
                      ? `<div style="margin-top:6px"><b>Koledar terminov:</b> nastavljen – urejanje na portalu.</div>`
                      : ''
                  }
                </div>

                <div style="margin:12px 0 16px">
                  <a href="${linkEdit}"
                     style="display:inline-block;background:${primary};color:#fff;text-decoration:none;
                            padding:10px 14px;border-radius:10px;font-weight:800;margin-right:10px">
                    Uredi ${noun}
                  </a>
                  <a href="${linkStats}"
                     style="display:inline-block;background:#fff;color:#0b1b2b;text-decoration:none;
                            padding:10px 14px;border-radius:10px;font-weight:800;border:1px solid #cfe1ee">
                    Statistika
                  </a>
                </div>

                <p style="color:#5b6b7b;font-size:13px;margin:8px 0 0">
                  Uredite vsebino: <a href="${linkEdit}" style="color:${primary};font-weight:800">tukaj</a>.
                  Pregled statistike: <a href="${linkStats}" style="color:${primary};font-weight:800">tukaj</a>.
                </p>

                <div style="margin:16px 0 0;color:#5b6b7b;font-size:13px">
                  Vprašanja? <a href="mailto:${FROM_EMAIL}" style="color:${primary};font-weight:800">${FROM_EMAIL}</a>
                </div>
              </div>
            </div>
          </div>`;

        await sendMailBrevo({
          to: payload.organizerEmail,
          subject: `NearGo – prijava ${isService ? 'storitve' : 'dogodka'} prejeta: ${payload.eventName || ''}`,
          html
        });
      }
    } catch (mailErr) {
      console.error("[provider-submit] mail error:", mailErr?.message || mailErr);
    }
    // === konec pošiljanja e-pošte ===

    // [CHG] Response: dodamo eventId (ostalo pustimo)
    return json({ ok:true, key:path, editToken, statsToken, eventId });
  }catch(e){
    console.error("[provider-submit] FATAL:", e?.message || e);
    return json({ ok:false, error:String(e?.message || e) }, 500);
  }
};

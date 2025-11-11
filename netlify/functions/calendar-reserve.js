// netlify/functions/calendar-reserve.js (ESM)
// Reserve a free slot; issue free coupon for Premium users; send confirmation email
import { createClient } from '@supabase/supabase-js';
import QRCode from 'qrcode';
import * as Brevo from '@getbrevo/brevo';
import nodemailer from 'nodemailer';

const SUPABASE_URL  = process.env.SUPABASE_URL;
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || process.env.SITE_URL || '').replace(/\/$/, '');
const supa = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession:false } });

const CORS = { 'Access-Control-Allow-Origin':'*', 'Access-Control-Allow-Methods':'POST,OPTIONS', 'Access-Control-Allow-Headers':'content-type' };
const ok  = (b,s=200)=>({ statusCode:s, headers:{ 'content-type':'application/json', ...CORS }, body: JSON.stringify(b) });
const bad = (m,s=400)=>({ statusCode:s, headers:{ 'content-type':'application/json', ...CORS }, body: JSON.stringify({ ok:false, error:String(m) }) });

function escapeHtml(s){ return String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c])); }

function makeBrevo(){ if (!process.env.BREVO_API_KEY) return null; const api = new Brevo.TransactionalEmailsApi(); api.setApiKey(Brevo.TransactionalEmailsApiApiKeys.apiKey, process.env.BREVO_API_KEY); return api; }
async function sendEmail({ to, subject, html, attachments=[] }){
  const brevo = makeBrevo();
  const FROM = process.env.EMAIL_FROM || 'NearGo <info@getneargo.com>';
  const FROM_EMAIL = (FROM.match(/<([^>]+)>/) || [null, FROM])[1];
  const FROM_NAME  = FROM.replace(/\s*<[^>]+>\s*$/, '') || 'NearGo';
  if (brevo){
    const email = new Brevo.SendSmtpEmail();
    email.sender      = { email: FROM_EMAIL, name: FROM_NAME };
    email.to          = [{ email: to }];
    email.subject     = subject;
    email.htmlContent = html;
    if (attachments.length) email.attachment = attachments.map(a=>({ name:a.name, content:a.content }));
    await brevo.sendTransacEmail(email);
  } else {
    const host = process.env.SMTP_HOST, port = Number(process.env.SMTP_PORT||0), user=process.env.SMTP_USER, pass=process.env.SMTP_PASS;
    if (!host || !port || !user || !pass) return;
    const transporter = nodemailer.createTransport({ host, port, secure: port===465, auth:{ user, pass } });
    await transporter.sendMail({ from: FROM, to, subject, html, attachments: attachments.map(a=>({ filename:a.name, content: Buffer.from(a.content,'base64') })) });
  }
}

async function isPremium(email){
  try{
    const { data } = await supa.from('premium_users').select('premium_until').eq('email', email).maybeSingle();
    if (data?.premium_until && new Date(data.premium_until).getTime() > Date.now()) return true;
  }catch{}
  try{ const { count } = await supa.from('tickets').select('*',{head:true, count:'exact'}).eq('customer_email', email).eq('type','premium'); return (count||0) > 0; }catch{ return false; }
}

function slotWhenText(startIso, endIso){
  try{
    const s = new Date(startIso); const e = endIso ? new Date(endIso) : null;
    const fmt = new Intl.DateTimeFormat('sl-SI', { dateStyle:'medium', timeStyle:'short' });
    const day = new Intl.DateTimeFormat('sl-SI', { weekday:'long' }).format(s);
    return e ? `${day}, ${fmt.format(s)} – ${new Intl.DateTimeFormat('sl-SI',{ timeStyle:'short' }).format(e)}` : `${day}, ${fmt.format(s)}`;
  }catch{ return startIso; }
}

export const handler = async (event) => {
  try{
    if (event.httpMethod === 'OPTIONS') return { statusCode:204, headers:CORS, body:'' };
    if (event.httpMethod !== 'POST')   return bad('use_post', 405);

    const body = JSON.parse(event.body||'{}');
    const slotId = body.slot_id || body.slotId || '';
    const email  = (body.email || body.user_email || '').trim().toLowerCase();
    const eventId    = body.event_id || null;
    const eventTitle = body.event_title || 'Dogodek';
    const benefit    = body.display_benefit || null; // for coupon email
    if (!slotId || !email) return bad('missing_slot_or_email');

    // Rate limiting: max 3 active reservations per 24h per email (across calendars)
    try{
      const since = new Date(Date.now() - 24*60*60*1000).toISOString();
      const { count } = await supa.from('provider_reservations').select('*', { head:true, count:'exact' })
        .eq('reserved_email', email)
        .eq('status','active')
        .gte('reserved_at', since);
      if ((count||0) >= 3) return bad('rate_limited');
    }catch{}

    // 1) Try to atomically reserve: update where status=free
    const nowIso = new Date().toISOString();
    const { data: upd, error: updErr } = await supa
      .from('provider_slots')
      .update({ status:'reserved', reserved_email: email, reserved_at: nowIso, updated_at: nowIso })
      .eq('id', slotId)
      .eq('status','free')
      .select('id,calendar_id,start_time,end_time')
      .limit(1);
    if (updErr) return bad('db_error: '+updErr.message, 500);
    if (!upd || !upd.length) return bad('slot_taken_or_not_found', 409);
    const slot = upd[0];

    // 2) Insert reservation row
    const { data: cal } = await supa.from('provider_calendars').select('id,title,provider_email').eq('id', slot.calendar_id).maybeSingle();
  const { data: resIns } = await supa.from('provider_reservations').insert({ slot_id: slot.id, calendar_id: slot.calendar_id, reserved_email: email }).select('id').single();

    // 3) Check premium and optionally issue a free coupon
    const premium = await isPremium(email);
    let couponToken = null;
    if (premium){
      // generate and insert free coupon (no invoice)
      couponToken = (globalThis.crypto?.randomUUID?.() || null) || Math.random().toString(36).slice(2)+Date.now().toString(36);
      const issuedAt = new Date().toISOString();
      await supa.from('tickets').insert({
        event_id: eventId,
        type: 'coupon',
        display_benefit: benefit,
        stripe_checkout_session_id: null,
        stripe_payment_intent_id: null,
        token: couponToken,
        status: 'issued',
        issued_at: issuedAt,
        created_at: issuedAt,
        customer_email: email
      });
      await supa.from('provider_slots').update({ coupon_token: couponToken }).eq('id', slot.id);
  }

    // 4) Compose and send email to user
    const whenText = slotWhenText(slot.start_time, slot.end_time);
    const redeemUrl = couponToken ? `${PUBLIC_BASE_URL}/r/${couponToken}` : '';
    const qrPng = couponToken ? await QRCode.toBuffer(redeemUrl, { type:'png', margin:1, width: 512 }) : null;

    const logoTargetSvg = `
      <svg width="36" height="36" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
        <circle cx="16" cy="16" r="13" fill="none" stroke="#0b1b2b" stroke-width="2"/>
        <circle cx="16" cy="16" r="8"  fill="none" stroke="#0b1b2b" stroke-width="2" opacity="0.9"/>
        <circle cx="16" cy="16" r="3.2" fill="#0b1b2b"/>
      </svg>`;
    const primary = '#0bbbd6';
    const purchasePayload = {
      type: 'coupon',
      successUrl: `${PUBLIC_BASE_URL}/my.html`,
      cancelUrl: `${PUBLIC_BASE_URL}/my.html`,
      metadata: {
        type: 'coupon',
        event_id: eventId || '',
        event_title: eventTitle || 'Dogodek',
        display_benefit: benefit || '',
      }
    };
    const purchaseLink = `${PUBLIC_BASE_URL}/api/checkout`;
    const html = `
      <div style="font-family:Arial,Helvetica,sans-serif;background:#f6fbfe;padding:0;margin:0">
        <div style="max-width:680px;margin:0 auto;border:1px solid #e3eef7;border-radius:14px;overflow:hidden;background:#fff">
          <div style="padding:14px 18px;display:flex;align-items:center;gap:10px;border-bottom:1px solid #e3eef7;background:#fff">
            <div>${logoTargetSvg}</div>
            <div style="font-weight:900;font-size:20px;letter-spacing:.2px;color:#0b1b2b">NearGo</div>
          </div>
          <div style="padding:20px 22px;color:#0b1b2b">
            <h2 style="margin:0 0 12px 0;font-size:20px;line-height:1.35">Potrditev rezervacije</h2>
            <div style="border:1px solid #e3eef7;border-radius:12px;padding:12px 14px;margin:10px 0;background:#f9fcff">
              ${eventTitle?`<div style=\"margin:2px 0\"><b>Storitev:</b> ${escapeHtml(eventTitle)}</div>`:''}
              <div style="margin:2px 0"><b>Termin:</b> ${escapeHtml(whenText)}</div>
            </div>
            ${ premium ? `
              <p style="margin:12px 0">Ker si Premium, je kupon priložen kot QR (<i>qr.png</i>) in shranjen v razdelku “Moje”.</p>
            ` : `
              <p style="margin:12px 0">Za unovčitev ugodnosti pridobi kupon (2,00 €). Po nakupu je kupon na voljo tudi v razdelku “Moje”.</p>
              <form action="${purchaseLink}" method="POST">
                <input type="hidden" name="payload" value='${JSON.stringify(purchasePayload).replace(/'/g,'&apos;')}' />
                <button style="display:inline-block;background:${primary};color:#fff;font-weight:900;padding:10px 16px;border-radius:999px;border:none;cursor:pointer">Kupi kupon</button>
              </form>
            `}
            <div style="margin:18px 0 4px;color:#5b6b7b;font-size:13px">Hiter dostop: <a href="${PUBLIC_BASE_URL}/my.html" style="color:${primary};font-weight:800">Moje</a></div>
          </div>
        </div>
      </div>`;

    const attachments = qrPng ? [{ name:'qr.png', content: qrPng.toString('base64') }] : [];
    await sendEmail({ to: email, subject: 'NearGo – potrditev rezervacije', html, attachments });

    // Analytics: reservation_created
    try{ await supa.from('provider_reservation_events').insert({ reservation_id: resIns?.id || null, calendar_id: slot.calendar_id, slot_id: slot.id, reserved_email: email, event: 'created' }); }catch{}
    return ok({ ok:true, reserved:true, premium, coupon_token: couponToken });
  }catch(e){
    return bad(e?.message||e, 500);
  }
};

// netlify/functions/calendar-cancel.js (ESM)
// Cancel a reservation (user or provider) and free the slot. Sends cancellation email.
import { createClient } from '@supabase/supabase-js';
import * as Brevo from '@getbrevo/brevo';
import nodemailer from 'nodemailer';

const SUPABASE_URL  = process.env.SUPABASE_URL;
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || process.env.SITE_URL || '').replace(/\/$/, '');
const supa = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession:false } });

const CORS = { 'Access-Control-Allow-Origin':'*', 'Access-Control-Allow-Methods':'POST,OPTIONS', 'Access-Control-Allow-Headers':'content-type' };
const ok  = (b,s=200)=>({ statusCode:s, headers:{ 'content-type':'application/json', ...CORS }, body: JSON.stringify(b) });
const bad = (m,s=400)=>({ statusCode:s, headers:{ 'content-type':'application/json', ...CORS }, body: JSON.stringify({ ok:false, error:String(m) }) });

function makeBrevo(){ if (!process.env.BREVO_API_KEY) return null; const api=new Brevo.TransactionalEmailsApi(); api.setApiKey(Brevo.TransactionalEmailsApiApiKeys.apiKey, process.env.BREVO_API_KEY); return api; }
async function sendMail({ to, subject, html }){
  const brevo = makeBrevo();
  const FROM = process.env.EMAIL_FROM || 'NearGo <info@getneargo.com>';
  const FROM_EMAIL = (FROM.match(/<([^>]+)>/) || [null, FROM])[1];
  const FROM_NAME  = FROM.replace(/\s*<[^>]+>\s*$/, '') || 'NearGo';
  if (brevo){
    const email = new Brevo.SendSmtpEmail();
    email.sender={ email:FROM_EMAIL, name:FROM_NAME }; email.to=[{email:to}]; email.subject=subject; email.htmlContent=html; await brevo.sendTransacEmail(email);
  } else {
    const host=process.env.SMTP_HOST, port=Number(process.env.SMTP_PORT||0), user=process.env.SMTP_USER, pass=process.env.SMTP_PASS;
    if (host && port && user && pass){
      const transporter = nodemailer.createTransport({ host, port, secure:port===465, auth:{ user, pass } });
      await transporter.sendMail({ from:FROM, to, subject, html });
    }
  }
}

function formatWhen(startIso, endIso){
  try{
    const s=new Date(startIso); const e=endIso?new Date(endIso):null;
    return e ? `${s.toLocaleString('sl-SI')} – ${e.toLocaleTimeString('sl-SI',{hour:'2-digit',minute:'2-digit'})}` : s.toLocaleString('sl-SI');
  }catch{return startIso;}
}

export const handler = async (event) => {
  try{
    if (event.httpMethod==='OPTIONS') return { statusCode:204, headers:CORS, body:'' };
    if (event.httpMethod!=='POST') return bad('use_post',405);
    const body = JSON.parse(event.body||'{}');
    const reservationId = body.reservation_id || body.reservationId || null;
    const slotId = body.slot_id || body.slotId || null;
    const email = (body.email || body.user_email || '').trim().toLowerCase();
    const providerToken = body.provider_token || body.token || '';
    if (!reservationId && !slotId) return bad('missing_reservation_or_slot');
    if (!email && !providerToken) return bad('missing_email_or_provider_token');

    // Load reservation + slot
    let reservation=null;
    if (reservationId){
      const { data } = await supa.from('provider_reservations').select('*').eq('id', reservationId).maybeSingle();
      reservation = data || null;
    } else if (slotId){
      const { data } = await supa.from('provider_reservations').select('*').eq('slot_id', slotId).order('reserved_at',{ascending:false}).limit(1); reservation=data?.[0]||null;
    }
    if (!reservation) return bad('not_found',404);
    if (reservation.status==='cancelled') return ok({ ok:true, already:true });

    // Load slot
    const { data: slot } = await supa.from('provider_slots').select('*').eq('id', reservation.slot_id).maybeSingle();
    if (!slot) return bad('slot_not_found',404);

    // Auth: user (email matches) or provider (token matches calendar edit_token)
    let providerOk=false;
    if (providerToken){
      const { data: cal } = await supa.from('provider_calendars').select('id,edit_token,provider_email').eq('id', reservation.calendar_id).maybeSingle();
      if (cal && cal.edit_token === providerToken) providerOk = true;
    }
    const userOk = email && reservation.reserved_email?.toLowerCase() === email;
    if (!providerOk && !userOk) return bad('unauthorized',401);

    // Update reservation + slot
    const nowIso=new Date().toISOString();
  await supa.from('provider_reservations').update({ status:'cancelled', cancelled_at: nowIso }).eq('id', reservation.id);
    await supa.from('provider_slots').update({ status:'free', reserved_email:null, reserved_at:null, coupon_token:null, updated_at: nowIso }).eq('id', slot.id);
    // If coupon was issued, optionally mark ticket cancelled (non-destructive)
    if (slot.coupon_token){
      try{ await supa.from('tickets').update({ status:'cancelled' }).eq('token', slot.coupon_token); }catch{}
    }

    // Send email to user
    if (reservation.reserved_email){
      try{
        const whenTxt = formatWhen(slot.start_time, slot.end_time);
        const html = `<!DOCTYPE html><div style="font-family:Arial,Helvetica,sans-serif;background:#f6fbfe;padding:0;margin:0"><div style="max-width:640px;margin:0 auto;border:1px solid #e3eef7;background:#fff;border-radius:14px;overflow:hidden"><div style="padding:14px 18px;display:flex;gap:10px;align-items:center;border-bottom:1px solid #e3eef7"><div><svg width=36 height=36 viewBox='0 0 32 32' xmlns='http://www.w3.org/2000/svg'><circle cx=16 cy=16 r=13 fill='none' stroke='#0b1b2b' stroke-width='2'/><circle cx=16 cy=16 r=8 fill='none' stroke='#0b1b2b' stroke-width='2' opacity='.9'/><circle cx=16 cy=16 r=3.2 fill='#0b1b2b'/></svg></div><div style="font-weight:900;font-size:20px;color:#0b1b2b">NearGo</div></div><div style="padding:20px 22px;color:#0b1b2b"><h2 style="margin:0 0 12px;font-size:20px">Rezervacija preklicana</h2><p style="margin:0 0 12px">Vaša rezervacija termina <b>${whenTxt}</b> je bila preklicana.${ slot.coupon_token ? ' Kupon je označen kot preklican.' : ''}</p><p style="margin:16px 0 0;font-size:13px;color:#5b6b7b">Upravljanje: <a href='${PUBLIC_BASE_URL}/my.html' style='color:#0bbbd6;font-weight:800'>Moje</a></p></div></div></div>`;
        await sendMail({ to: reservation.reserved_email, subject:'NearGo – rezervacija preklicana', html });
      }catch(e){ console.warn('[calendar-cancel] email fail', e?.message||e); }
    }

  // Analytics: reservation_cancelled
  try{ await supa.from('provider_reservation_events').insert({ reservation_id: reservation.id, calendar_id: reservation.calendar_id, slot_id: reservation.slot_id, reserved_email: reservation.reserved_email, event: 'cancelled' }); }catch{}
  return ok({ ok:true, cancelled:true });
  }catch(e){
    return bad(e?.message||e,500);
  }
};

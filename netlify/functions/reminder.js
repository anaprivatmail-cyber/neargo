// netlify/functions/reminder.js
// Scheduled function: sends reminder emails day before event start for ACTIVE (not redeemed) tickets.
// Uses Supabase for events & tickets, and Netlify Blobs to track already sent reminders.
import { createClient } from '@supabase/supabase-js';
import * as Brevo from '@getbrevo/brevo';
import nodemailer from 'nodemailer';

const SUPABASE_URL  = process.env.SUPABASE_URL;
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || process.env.SITE_URL || 'https://getneargo.com').replace(/\/$/, '');
const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL || 'info@getneargo.com';
const EMAIL_FROM    = process.env.EMAIL_FROM || 'NearGo <info@getneargo.com>';

const supa = createClient(SUPABASE_URL, SERVICE_KEY, { auth:{ persistSession:false } });

// Blobs store for reminder tracking (optional; if missing creds, we fallback to in-memory map during runtime)
let store = null;
try {
  const siteID = process.env.BLOBS_SITE_ID;
  const token  = process.env.BLOBS_TOKEN;
  if (siteID && token) {
    const { getStore } = await import('@netlify/blobs');
    store = getStore({ name: 'reminders', siteID, token });
  }
} catch {}

function h(t){ return String(t||'').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c])); }

function buildHtml({ title, whenText, token }) {
  const logo = `<svg width="36" height="36" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg"><circle cx="16" cy="16" r="13" fill="none" stroke="#0b1b2b" stroke-width="2"/><circle cx="16" cy="16" r="8"  fill="none" stroke="#0b1b2b" stroke-width="2" opacity="0.9"/><circle cx="16" cy="16" r="3.2" fill="#0b1b2b"/></svg>`;
  return `
  <div style="font-family:Arial,Helvetica,sans-serif;background:#f6fbfe;padding:0;margin:0">
    <div style="max-width:680px;margin:0 auto;border:1px solid #e3eef7;border-radius:14px;overflow:hidden;background:#fff">
      <div style="padding:14px 18px;display:flex;align-items:center;gap:10px;border-bottom:1px solid #e3eef7;background:#fff">
        <div>${logo}</div>
        <div style="font-weight:900;font-size:20px;letter-spacing:.2px;color:#0b1b2b">NearGo</div>
      </div>
      <div style="padding:20px 22px;color:#0b1b2b">
        <h2 style="margin:0 0 12px 0;font-size:20px;line-height:1.35">Opomnik: ${h(title)}</h2>
        <p style="margin:12px 0">Dogodek se začne: <b>${h(whenText)}</b></p>
        ${ token ? `<p style="margin:12px 0 4px">Vaša QR koda / kupon: <code style="font-weight:700">${h(token)}</code> (shranjeno v razdelku “Moje”).</p>` : '' }
        <div style="margin:18px 0 4px;color:#5b6b7b;font-size:13px">Vprašanja? <a href="mailto:${SUPPORT_EMAIL}" style="color:#0bbbd6;font-weight:800">${SUPPORT_EMAIL}</a></div>
      </div>
    </div>
  </div>`;
}

function setupBrevo(){
  if (!process.env.BREVO_API_KEY) return null;
  const api = new Brevo.TransactionalEmailsApi();
  api.setApiKey(Brevo.TransactionalEmailsApiApiKeys.apiKey, process.env.BREVO_API_KEY);
  return api;
}

async function sendEmail({ to, subject, html }) {
  const brevo = setupBrevo();
  const FROM = EMAIL_FROM;
  const FROM_EMAIL = (FROM.match(/<([^>]+)>/) || [null, FROM])[1];
  const FROM_NAME  = FROM.replace(/\s*<[^>]+>\s*$/, '') || 'NearGo';
  if (brevo) {
    const mail = new Brevo.SendSmtpEmail();
    mail.sender = { email: FROM_EMAIL, name: FROM_NAME };
    mail.to = [{ email: to }];
    mail.subject = subject;
    mail.htmlContent = html;
    await brevo.sendTransacEmail(mail);
  } else {
    const host = process.env.SMTP_HOST, port = Number(process.env.SMTP_PORT||0), user=process.env.SMTP_USER, pass=process.env.SMTP_PASS;
    if (!host || !port || !user || !pass) throw new Error('no_email_provider');
    const transporter = nodemailer.createTransport({ host, port, secure: port===465, auth:{ user, pass } });
    await transporter.sendMail({ from: FROM, to, subject, html });
  }
}

async function alreadySent(key){
  if (!store) return false; // no tracking if blobs missing
  try { return !!(await store.get(key)); } catch { return false; }
}
async function markSent(key){
  if (!store) return; try { await store.set(key, '1', { contentType:'text/plain' }); } catch {}
}

export const handler = async () => {
  const now = new Date();
  const dayAheadStart = new Date(now.getTime() + 24*60*60*1000);

  // Fetch events starting roughly tomorrow (±1h tolerance)
  const fromIso = new Date(dayAheadStart.getTime() - 60*60*1000).toISOString();
  const toIso   = new Date(dayAheadStart.getTime() + 60*60*1000).toISOString();

  try {
    const { data: events, error: evErr } = await supa
      .from('events')
      .select('id,title,starts_at,start')
      .gte('starts_at', fromIso)
      .lte('starts_at', toIso)
      .limit(200);
    if (evErr) throw new Error(evErr.message);
    if (!events?.length) return { statusCode:200, body: JSON.stringify({ ok:true, events:0 }) };

    let sentCount = 0;
    for (const ev of events) {
      const start = ev.starts_at || ev.start;
      if (!start) continue;
      const whenText = new Date(start).toLocaleString();

      // Tickets for that event (active only)
      const { data: tickets, error: tErr } = await supa
        .from('tickets')
        .select('id,customer_email,token,status')
        .eq('event_id', ev.id)
        .neq('status', 'redeemed')
        .limit(500);
      if (tErr) continue;
      if (!tickets?.length) continue;

      for (const t of tickets) {
        const email = t.customer_email; if (!email) continue;
        const key = `rem-${ev.id}-${email}`;
        if (await alreadySent(key)) continue;
        const html = buildHtml({ title: ev.title || 'Dogodek', whenText, token: t.token });
        try {
          await sendEmail({ to: email, subject: 'Opomnik – NearGo', html });
          await markSent(key);
          sentCount++;
        } catch (e) {
          console.error('[reminder] send fail', e.message);
        }
      }
    }
    return { statusCode:200, body: JSON.stringify({ ok:true, sent: sentCount }) };
  } catch (e) {
    console.error('[reminder] fatal', e.message);
    return { statusCode:200, body: JSON.stringify({ ok:false, error: e.message }) };
  }
};

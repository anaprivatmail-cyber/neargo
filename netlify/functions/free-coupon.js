// netlify/functions/free-coupon.js
// Issues a FREE coupon without Stripe: inserts ticket, stores QR, sends email (no invoice)
import { createClient } from "@supabase/supabase-js";
import QRCode from "qrcode";
import * as Brevo from "@getbrevo/brevo";
import nodemailer from "nodemailer";

const SUPABASE_URL   = process.env.SUPABASE_URL;
const SERVICE_KEY    = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PUBLIC_BASE_URL= (process.env.PUBLIC_BASE_URL || process.env.SITE_URL || "").replace(/\/$/, "");

const supa = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession:false } });

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST,OPTIONS", "Access-Control-Allow-Headers": "content-type" };
const ok  = (b)=>({ statusCode:200, headers:{"content-type":"application/json",...CORS}, body:JSON.stringify(b) });
const bad = (m,s=400)=>({ statusCode:s,   headers:{"content-type":"application/json",...CORS}, body:JSON.stringify({ ok:false, error:m }) });

function escapeHtml(s){ return String(s||"").replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c])); }

function makeBrevo(){
  if (!process.env.BREVO_API_KEY) return null;
  const api = new Brevo.TransactionalEmailsApi();
  api.setApiKey(Brevo.TransactionalEmailsApiApiKeys.apiKey, process.env.BREVO_API_KEY);
  return api;
}

async function sendMail({ to, subject, html, attachments=[] }){
  const brevo = makeBrevo();
  const FROM = process.env.EMAIL_FROM || "NearGo <info@getneargo.com>";
  const FROM_EMAIL = (FROM.match(/<([^>]+)>/) || [null, FROM])[1];
  const FROM_NAME  = FROM.replace(/\s*<[^>]+>\s*$/, "") || "NearGo";
  if (brevo){
    const email = new Brevo.SendSmtpEmail();
    email.sender = { email: FROM_EMAIL, name: FROM_NAME };
    email.to = [{ email: to }];
    email.subject = subject;
    email.htmlContent = html;
    if (attachments.length){
      email.attachment = attachments.map(a => ({ name:a.name, content:a.content }));
    }
    await brevo.sendTransacEmail(email);
  } else {
    // SMTP fallback
    const host = process.env.SMTP_HOST, port = Number(process.env.SMTP_PORT||0), user=process.env.SMTP_USER, pass=process.env.SMTP_PASS;
    if (!host || !port || !user || !pass) throw new Error("No email transport configured");
    const transporter = nodemailer.createTransport({ host, port, secure: port===465, auth:{ user, pass } });
    await transporter.sendMail({ from: FROM, to, subject, html });
  }
}

export const handler = async (event) => {
  try{
    if (event.httpMethod === "OPTIONS") return { statusCode:204, headers:CORS, body:"" };
    if (event.httpMethod !== "POST")   return bad("use_post", 405);

    const body = JSON.parse(event.body || "{}");
    const email = (body.email || body.buyerEmail || "").trim();
    const eventId = body.event_id || body.eventId || null;
    const eventTitle = body.event_title || body.title || "Dogodek";
    const displayBenefit = body.display_benefit || body.benefit || body.freebie_text || "Brezplačno";
    if (!email) return bad("missing_email");

    // --- PREMIUM VALIDATION -------------------------------------------------
    // Free coupon issuance must not bypass Premium gating if configured.
    // Strategy: user is Premium if premium_users has future premium_until OR has a 'premium' ticket.
    const REQUIRE_PREMIUM_FREE_COUPON = process.env.REQUIRE_PREMIUM_FREE_COUPON === '0' ? false : true; // default ON
    let isPremium = false;
    if (REQUIRE_PREMIUM_FREE_COUPON){
      try {
        const { data: pu } = await supa.from('premium_users').select('premium_until').eq('email', email).maybeSingle();
        if (pu?.premium_until && new Date(pu.premium_until).getTime() > Date.now()) isPremium = true;
      } catch {}
      if (!isPremium){
        try { const { count } = await supa.from('tickets').select('*',{head:true,count:'exact'}).eq('customer_email', email).eq('type','premium'); isPremium = (count||0) > 0; } catch {}
      }
      if (!isPremium) return bad('premium_required');
    }

    // --- RATE LIMIT (simple) ------------------------------------------------
    // Prevent abuse: max 5 free coupons per 24h per email.
    const MAX_PER_24H = Number(process.env.FREE_COUPON_MAX_24H || 5);
    try {
      const sinceIso = new Date(Date.now() - 24*60*60*1000).toISOString();
      const { count: recentCount } = await supa
        .from('tickets')
        .select('*',{head:true,count:'exact'})
        .eq('customer_email', email)
        .eq('type','coupon')
        .gte('issued_at', sinceIso)
        .is('stripe_checkout_session_id', null); // free coupons only
      if ((recentCount||0) >= MAX_PER_24H) return bad('rate_limit');
    } catch {}

    // generate token
    const token = (globalThis.crypto?.randomUUID?.() || null) || Math.random().toString(36).slice(2)+Date.now().toString(36);
    const nowIso = new Date().toISOString();

    // insert ticket row (FREE coupon)
    const { error: insErr } = await supa.from("tickets").insert({
      event_id: eventId,
      type: "coupon",
      display_benefit: displayBenefit,
      stripe_checkout_session_id: null,
      stripe_payment_intent_id: null,
      token,
      status: "issued",
      issued_at: nowIso,
      created_at: nowIso,
      customer_email: email
    });
    if (insErr) return bad("db_error: "+insErr.message, 500);

    // QR and email
    const redeemUrl = `${PUBLIC_BASE_URL}/r/${token}`;
    const qrPngBuffer = await QRCode.toBuffer(redeemUrl, { type:"png", margin:1, width:512 });

    const html = `
      <div style="font-family:Arial,Helvetica,sans-serif;background:#f6fbfe;padding:0;margin:0">
        <div style="max-width:680px;margin:0 auto;border:1px solid #e3eef7;border-radius:14px;overflow:hidden;background:#fff">
          <div style="padding:14px 18px;display:flex;align-items:center;gap:10px;border-bottom:1px solid #e3eef7;background:#fff">
            <div><svg width="36" height="36" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg"><circle cx="16" cy="16" r="13" fill="none" stroke="#0b1b2b" stroke-width="2"/><circle cx="16" cy="16" r="8" fill="none" stroke="#0b1b2b" stroke-width="2" opacity="0.9"/><circle cx="16" cy="16" r="3.2" fill="#0b1b2b"/></svg></div>
            <div style="font-weight:900;font-size:20px;letter-spacing:.2px;color:#0b1b2b">NearGo</div>
          </div>
          <div style="padding:20px 22px;color:#0b1b2b">
            <h2 style="margin:0 0 12px 0;font-size:20px;line-height:1.35">Prejeli ste brezplačni kupon</h2>
            <div style="border:1px solid #cfe1ee;border-radius:12px;padding:14px 16px;margin:12px 0;background:#fff">
              <div style="font-weight:900;margin-bottom:6px">${escapeHtml(eventTitle)}</div>
              <div style="margin:2px 0">Ugodnost: <b>${escapeHtml(displayBenefit)}</b></div>
            </div>
            <p style="margin:12px 0">QR koda kupona je priložena (<i>qr.png</i>).<br><span style="opacity:.8">Št. kode:</span> <code style="font-weight:700">${escapeHtml(token)}</code></p>
          </div>
        </div>
      </div>`;

    await sendMail({
      to: email,
      subject: "NearGo – brezplačni kupon",
      html,
      attachments: [{ name: "qr.png", content: qrPngBuffer.toString("base64") }]
    });

    return ok({ ok:true, token, premium: isPremium });
  }catch(e){
    return bad(String(e?.message || e), 500);
  }
};

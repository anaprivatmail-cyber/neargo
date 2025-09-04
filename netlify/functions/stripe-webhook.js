// netlify/functions/stripe-webhook.js
// Stripe webhook: po uspešnem plačilu izdamo kupon/vstopnico, generiramo QR in pošljemo e-mail.
// Zahteva pakete: stripe, @supabase/supabase-js, qrcode, @getbrevo/brevo

const Stripe = require("stripe");
const { createClient } = require("@supabase/supabase-js");
const QRCode = require("qrcode");
const Brevo = require("@getbrevo/brevo");
const crypto = require("node:crypto");

// --- ENV ---
const STRIPE_SECRET_KEY     = process.env.STRIPE_SECRET_KEY;
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const SUPABASE_URL          = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PUBLIC_BASE_URL       = (process.env.PUBLIC_BASE_URL || process.env.SITE_URL || "https://getneargo.com").replace(/\/$/, "");
const SUPPORT_EMAIL         = process.env.SUPPORT_EMAIL || "info@getneargo.com";
const EMAIL_FROM            = process.env.EMAIL_FROM || "NearGo <info@getneargo.com>";

// --- Stripe & Supabase ---
const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });
const supa   = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

// --- Brevo ---
const brevoApi = new Brevo.TransactionalEmailsApi();
if (process.env.BREVO_API_KEY) {
  brevoApi.setApiKey(Brevo.TransactionalEmailsApiApiKeys.apiKey, process.env.BREVO_API_KEY);
}
const FROM_EMAIL = (EMAIL_FROM.match(/<([^>]+)>/) || [null, EMAIL_FROM])[1];
const FROM_NAME  = EMAIL_FROM.replace(/\s*<[^>]+>\s*$/, "") || "NearGo";

exports.handler = async (event) => {
  try {
    if (event.httpMethod === "OPTIONS") {
      return { statusCode: 204, headers: cors(), body: "" };
    }
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, headers: cors(), body: "Method Not Allowed" };
    }
    if (!event.body || !event.headers["stripe-signature"]) {
      return { statusCode: 400, headers: cors(), body: "Missing signature/body" };
    }

    // --- preveri podpis ---
    let stripeEvent;
    try {
      stripeEvent = stripe.webhooks.constructEvent(
        event.body,
        event.headers["stripe-signature"],
        STRIPE_WEBHOOK_SECRET
      );
    } catch (e) {
      console.error("Webhook verification failed:", e.message);
      return { statusCode: 200, headers: cors(), body: JSON.stringify({ received: true }) };
    }

    if (stripeEvent.type !== "checkout.session.completed") {
      return { statusCode: 200, headers: cors(), body: JSON.stringify({ ok: true, ignored: stripeEvent.type }) };
    }

    const s  = stripeEvent.data.object;
    const md = s.metadata || {};

    // --- metadata ---
    const type           = md.type === "coupon" ? "coupon" : "ticket";
    const eventId        = md.event_id || null;
    const eventTitle     = md.event_title || "Dogodek";
    const displayBenefit = md.display_benefit || null;
    const benefitType    = md.benefit_type || null;
    const benefitValue   = md.benefit_value || null;
    const freebieText    = md.freebie_text  || null;
    const customerEmail  = (s.customer_details && s.customer_details.email) || s.customer_email || null;

    // --- token + QR ---
    const token     = cryptoUUID();
    const redeemUrl = `${PUBLIC_BASE_URL}/r/${token}`;

    const qrPngBuffer = await QRCode.toBuffer(redeemUrl, { type: "png", margin: 1, width: 512 });
    const qrBase64    = qrPngBuffer.toString("base64");
    const qrDataUrl   = `data:image/png;base64,${qrBase64}`;

    // --- insert v Supabase ---
    const { data: ticket, error: insErr } = await supa
      .from("tickets")
      .insert({
        event_id: eventId,
        type,
        display_benefit: displayBenefit,
        benefit_type: benefitType,
        benefit_value: benefitValue,
        freebie_text: freebieText,
        stripe_checkout_session_id: s.id,
        stripe_payment_intent_id: s.payment_intent,
        token,
        status: "issued",
        issued_at: new Date().toISOString(),
        customer_email: customerEmail
      })
      .select("id")
      .single();

    if (insErr) {
      console.error("Supabase insert error:", insErr);
      return { statusCode: 200, headers: cors(), body: JSON.stringify({ received: true, db: "error" }) };
    }

    // --- email kupcu ---
    if (process.env.BREVO_API_KEY && customerEmail) {
      const html = renderEmail({
        eventTitle,
        type,
        displayBenefit: displayBenefit || summarizeBenefit({ benefitType, benefitValue, freebieText }),
        qrDataUrl,
        redeemUrl,
        supportEmail: SUPPORT_EMAIL
      });

      const emailPayload = new Brevo.SendSmtpEmail();
      emailPayload.sender      = { email: FROM_EMAIL, name: FROM_NAME };
      emailPayload.to          = [{ email: customerEmail }];
      emailPayload.subject     = `Hvala za nakup – ${type === "coupon" ? "Kupon" : "Vstopnica"}`;
      emailPayload.htmlContent = html;
      emailPayload.attachment  = [{ name: "qr.png", content: qrBase64 }];

      try {
        await brevoApi.sendTransacEmail(emailPayload);
      } catch (mailErr) {
        console.error("Brevo send error:", mailErr?.message || mailErr);
      }
    }

    return { statusCode: 200, headers: cors(), body: JSON.stringify({ ok: true, id: ticket?.id || null }) };
  } catch (e) {
    console.error("Webhook handler error:", e);
    return { statusCode: 200, headers: cors(), body: JSON.stringify({ received: true }) };
  }
};

// --- helpers ---
function cors() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "POST,OPTIONS",
    "access-control-allow-headers": "content-type"
  };
}
function summarizeBenefit({ benefitType, benefitValue, freebieText }) {
  if (benefitType === "percent" && benefitValue) return `${benefitValue}% popusta`;
  if (benefitType === "amount"  && benefitValue) return `${Number(benefitValue).toFixed(2)} € vrednost`;
  if (benefitType === "freebie" && freebieText) return `Brezplačno: ${freebieText}`;
  return "Kupon";
}
function escapeHtml(s) {
  return String(s || "").replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"
  }[c]));
}
function renderEmail({ eventTitle, type, displayBenefit, qrDataUrl, redeemUrl, supportEmail }) {
  const what = type === "coupon" ? "kupon" : "vstopnico";
  const title = type === "coupon" ? "Kupon za dogodek" : "Vstopnica za dogodek";
  const benefitLine = type === "coupon" && displayBenefit
    ? `<p><b>Ugodnost:</b> ${escapeHtml(displayBenefit)}</p>` : "";
  return `
  <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:680px;margin:0 auto">
    <h2>${title}</h2>
    <p><b>${escapeHtml(eventTitle || "Dogodek")}</b></p>
    ${benefitLine}
    <p>Prinesite ${what} na telefonu. Pri ponudniku jo bodo skenirali.</p>
    <div style="margin:10px 0"><img src="${qrDataUrl}" alt="QR" width="220" height="220" style="border:1px solid #eee;border-radius:8px"/></div>
    <p>Če QR ne deluje, odprite povezavo:<br><a href="${redeemUrl}">${redeemUrl}</a></p>
    <hr style="border:none;border-top:1px solid #eee;margin:14px 0">
    <p style="font-size:13px;color:#666">Vprašanja? Pišite na <a href="mailto:${supportEmail}">${supportEmail}</a>.</p>
  </div>`;
}
function cryptoUUID() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.randomBytes(16);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = [...b].map(x => x.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

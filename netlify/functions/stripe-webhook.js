// netlify/functions/stripe-webhook.js
// PROD webhook: Stripe -> QR + email (Brevo) + zapis v Supabase (tickets)
// Zahteve: npm i stripe @supabase/supabase-js qrcode @getbrevo/brevo

const Stripe = require("stripe");
const { createClient } = require("@supabase/supabase-js");
const QRCode = require("qrcode");
const Brevo = require("@getbrevo/brevo");
const crypto = require("node:crypto");

const STRIPE_SECRET_KEY     = process.env.STRIPE_SECRET_KEY;         // sk_live_... / sk_test_...
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;     // whsec_...
const SUPABASE_URL          = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY; // SERVICE ROLE (ne anon!)
const PUBLIC_BASE_URL       = (process.env.PUBLIC_BASE_URL || process.env.SITE_URL || "https://getneargo.com").replace(/\/$/, "");
const SUPPORT_EMAIL         = process.env.SUPPORT_EMAIL || "info@getneargo.com";
const EMAIL_FROM            = process.env.EMAIL_FROM || "NearGo <info@getneargo.com>";

const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });
const supa   = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

// Brevo init
const brevoApi = new Brevo.TransactionalEmailsApi();
if (process.env.BREVO_API_KEY) {
  brevoApi.setApiKey(Brevo.TransactionalEmailsApiApiKeys.apiKey, process.env.BREVO_API_KEY);
}
const FROM_EMAIL = (EMAIL_FROM.match(/<([^>]+)>/) || [null, EMAIL_FROM])[1];
const FROM_NAME  = EMAIL_FROM.replace(/\s*<[^>]+>\s*$/, "") || "NearGo";

exports.handler = async (event) => {
  try {
    // CORS preflight
    if (event.httpMethod === "OPTIONS") {
      return { statusCode: 204, headers: cors(), body: "" };
    }
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, headers: cors(), body: "Method Not Allowed" };
    }
    if (!event.body || !event.headers["stripe-signature"]) {
      return { statusCode: 400, headers: cors(), body: "Missing signature/body" };
    }

    // VARNOST: Stripe preveri podpis in časovni žig
    let stripeEvent;
    try {
      stripeEvent = stripe.webhooks.constructEvent(
        event.body,
        event.headers["stripe-signature"],
        STRIPE_WEBHOOK_SECRET
      );
    } catch (e) {
      console.error("Webhook verification failed:", e.message);
      // vrnemo 2xx, da Stripe ne retry-a v nedogled
      return { statusCode: 200, headers: cors(), body: JSON.stringify({ received: true }) };
    }

    if (stripeEvent.type !== "checkout.session.completed") {
      return { statusCode: 200, headers: cors(), body: JSON.stringify({ ok: true, ignored: stripeEvent.type }) };
    }

    const s  = stripeEvent.data.object;
    const md = s.metadata || {};
    const type = md.type === "coupon" ? "coupon" : "ticket"; // pričakujemo iz checkout-a

    const eventId       = md.event_id || null;
    const eventTitle    = md.event_title || "Dogodek";
    const displayBenefit= md.display_benefit || null;

    const benefitType   = md.benefit_type || null;   // 'percent' | 'amount' | 'freebie'
    const benefitValue  = md.benefit_value || null;  // npr. '10' ali '5'
    const freebieText   = md.freebie_text  || null;  // npr. 'gratis sladica'

    const customerEmail = (s.customer_details && s.customer_details.email) || s.customer_email || null;

    // Ustvari unikatni token (URL-based redeem)
    const token = cryptoUUID();
    const redeemUrl = `${PUBLIC_BASE_URL}/r/${token}`;

    // QR koda za redeem URL (vsebina PNG v base64)
    const qrPngBuffer = await QRCode.toBuffer(redeemUrl, { type: "png", margin: 1, width: 512 });
    const qrBase64 = qrPngBuffer.toString("base64");
    const qrDataUrl = `data:image/png;base64,${qrBase64}`;

    // Vpiši izdano "vstopnico" / "kupon" v Supabase (tabela tickets)
    // Minimalna polja: token, status, issued_at, type, event_id, customer_email ...
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
      .select()
      .single();

    if (insErr) {
      console.error("Supabase insert error:", insErr);
      return { statusCode: 200, headers: cors(), body: JSON.stringify({ received: true }) };
    }

    // Pošlji e-pošto s QR (če imamo e-mail) – pošiljanje ne sme zrušiti webhook-a
    if (customerEmail && process.env.BREVO_API_KEY) {
      const html = renderEmail({
        eventTitle,
        type,
        displayBenefit: displayBenefit || summarizeBenefit({ benefitType, benefitValue, freebieText }),
        qrDataUrl,
        redeemUrl,
        supportEmail: SUPPORT_EMAIL
      });

      const emailPayload = new Brevo.SendSmtpEmail();
      emailPayload.sender = { email: FROM_EMAIL, name: FROM_NAME };
      emailPayload.to = [{ email: customerEmail }];
      emailPayload.subject = `Hvala za nakup – ${type === "coupon" ? "Kupon" : "Vstopnica"}`;
      emailPayload.htmlContent = html;
      // priložimo še PNG kot attachment (če želi)
      emailPayload.attachment = [{ name: "qr.png", content: qrBase64 }];

      try {
        await brevoApi.sendTransacEmail(emailPayload);
      } catch (mailErr) {
        console.error("Brevo send error:", mailErr?.message || mailErr);
      }
    }

    return { statusCode: 200, headers: cors(), body: JSON.stringify({ ok: true }) };
  } catch (e) {
    console.error("Webhook handler error:", e);
    // Stripe želi 2xx, sicer retry-a. Zato vrnemo 200 z received:true.
    return { statusCode: 200, headers: cors(), body: JSON.stringify({ received: true }) };
  }
};

// --- utils ---
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

function renderEmail({ eventTitle, type, displayBenefit, qrDataUrl, redeemUrl, supportEmail }) {
  const what = type === "coupon" ? "kupon" : "vstopnico";
  const title = type === "coupon" ? "Kupon za dogodek" : "Vstopnica za dogodek";
  const benefitLine = type === "coupon" && displayBenefit ? `
      <p style="margin:8px 0 0 0"><b>Ugodnost:</b> ${escapeHtml(displayBenefit)}</p>
  ` : "";

  return `
  <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:680px;margin:0 auto">
    <h2 style="margin:0 0 10px 0">${title}</h2>
    <p style="margin:0 0 8px 0"><b>${escapeHtml(eventTitle || "Dogodek")}</b></p>
    ${benefitLine}
    <p style="margin:12px 0">Spodaj je vaša ${what}. QR kodo pokažite pri vstopu ali pri ponudniku.</p>
    <div style="margin:10px 0">
      <img src="${qrDataUrl}" alt="QR koda" style="width:220px;height:220px;image-rendering:crisp-edges;border:1px solid #eee;border-radius:8px">
    </div>
    <p style="margin:8px 0">Če QR ne deluje, odprite povezavo:<br>
      <a href="${redeemUrl}">${redeemUrl}</a>
    </p>
    <hr style="border:none;border-top:1px solid #eee;margin:14px 0">
    <p style="font-size:13px;color:#666">Vprašanja? Pišite na <a href="mailto:${supportEmail}">${supportEmail}</a>.</p>
  </div>`;
}

function escapeHtml(s) {
  return String(s || "").replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"
  }[c]));
}

function cryptoUUID() {
  // node >=16 ima crypto.randomUUID; fallback na randomBytes
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.randomBytes(16);
  // RFC4122 v4
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = [...b].map(x => x.toString(16).padStart(2, "0")).join("");
  return `${hex.substring(0,8)}-${hex.substring(8,12)}-${hex.substring(12,16)}-${hex.substring(16,20)}-${hex.substring(20)}`;
}

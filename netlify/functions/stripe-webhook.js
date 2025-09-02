// netlify/functions/stripe-webhook.js
// PROD webhook: Stripe -> QR + email (Brevo) + zapis v Supabase (tickets)
// Zahteve: npm i stripe @supabase/supabase-js qrcode @getbrevo/brevo

const Stripe = require("stripe");
const { createClient } = require("@supabase/supabase-js");
const QRCode = require("qrcode");
const Brevo = require("@getbrevo/brevo");

const STRIPE_SECRET_KEY     = process.env.STRIPE_SECRET_KEY;         // sk_live_...
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;     // whsec_...
const SUPABASE_URL          = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY; // SERVICE ROLE (ne anon!)
const PUBLIC_BASE_URL       = (process.env.PUBLIC_BASE_URL || process.env.SITE_URL || "https://getneargo.com").replace(/\/$/, "");
const SUPPORT_EMAIL         = process.env.SUPPORT_EMAIL || "info@getneargo.com";
const EMAIL_FROM            = process.env.EMAIL_FROM || "getneargo <info@getneargo.com>";

const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });
const supa   = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

// Brevo init
const brevoApi = new Brevo.TransactionalEmailsApi();
brevoApi.setApiKey(Brevo.TransactionalEmailsApiApiKeys.apiKey, process.env.BREVO_API_KEY);
const FROM_EMAIL = (EMAIL_FROM.match(/<([^>]+)>/) || [null, EMAIL_FROM])[1];
const FROM_NAME  = EMAIL_FROM.replace(/\s*<[^>]+>\s*$/, "") || "getneargo";

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

    // VARNOST: prepusti Stripe SDK naj preveri podpis
    let stripeEvent;
    try {
      stripeEvent = stripe.webhooks.constructEvent(event.body, event.headers["stripe-signature"], STRIPE_WEBHOOK_SECRET);
    } catch (e) {
      // 2xx, da Stripe ne retry-a neskončno, a zapišemo napako v log
      console.error("Webhook verification failed:", e.message);
      return { statusCode: 200, headers: cors(), body: JSON.stringify({ received: true }) };
    }

    if (stripeEvent.type !== "checkout.session.completed") {
      return { statusCode: 200, headers: cors(), body: JSON.stringify({ ok: true, ignored: stripeEvent.type }) };
    }

    const s  = stripeEvent.data.object;
    const md = s.metadata || {};
    const type = md.type === "coupon" ? "coupon" : "ticket"; // pričakujemo iz checkout-a
    const eventId = md.event_id || null;
    const eventTitle = md.event_title || "Dogodek";
    const displayBenefit = md.display_benefit || null;
    const benefitType  = md.benefit_type || null;   // 'percent' | 'amount' | 'freebie'
    const benefitValue = md.benefit_value || null;  // npr. '10' ali '5'
    const freebieText  = md.freebie_text || null;   // npr. 'gratis sladica'
    const customerEmail = (s.customer_details && s.customer_details.email) || s.customer_email || null;

    // Ustvari unikatni token (URL-based redeem)
    const token = cryptoUUID();
    const redeemUrl = `${PUBLIC_BASE_URL}/r/${token}`;

    // QR koda za redeem URL
    const qrPngBuffer = await QRCode.toBuffer(redeemUrl, { type: "png", margin: 1, width: 512 });
    const qrBase64 = qrPngBuffer.toString("base64");
    const qrDataUrl = `data:image/png;base64,${qrBase64}`;

    // Zapiši v "tickets" (kuponi so prav tako 'tickets' z type='coupon')
    // Potrebna polja (priporočeno):
    //   event_id, type('ticket'|'coupon'), display_benefit, benefit_type, benefit_value, freebie_text,
    //   stripe_checkout_session_id, stripe_payment_intent_id, token, status('issued'), issued_at, customer_email
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

    // Pošlji e-mail s QR (Brevo)
    const html = renderEmail({
      eventTitle,
      type,
      displayBenefit,
      qrDataUrl,
      redeemUrl,
      supportEmail: SUPPORT_EMAIL
    });

    const emailPayload = new Brevo.SendSmtpEmail();
    emailPayload.sender = { email: FROM_EMAIL, name: FROM_NAME };
    emailPayload.to = [{ email: customerEmail }];
    emailPayload.subject = `Hvala za nakup – ${type === "coupon" ? "Kupon" : "Vstopnica"}`;
    emailPayload.htmlContent = html;
    emailPayload.attachment = [{ name: "qr.png", content: qrBase64 }]; // inline attachment

    try {
      await brevoApi.sendTransacEmail(emailPayload);
    } catch (mailErr) {
      console.error("Brevo send error:", mailErr?.message || mailErr);
      // nadaljuj – v DB je že izdano; lahko retri-amo po mailu pozneje
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
    "access-control-allow-headers": "content-type, s

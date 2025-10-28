// netlify/functions/iap-boost-start.js
import Stripe from "stripe";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
};
const json = (s, p) => ({ statusCode: s, headers: { "Content-Type":"application/json; charset=utf-8", ...CORS }, body: JSON.stringify(p) });
const stripe = new Stripe(process.env.STRIPE_APPROVED_KEY || process.env.STRIPE_OTK || process.env.STRIPE_SECRET_KEY, { apiVersion:"2024-06-20" });
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || "";

export default async (event) => {
  try {
    if (event.httpMethod === "OPTIONS") return json(200, { ok: true });
    const url = new URL(event.rawUrl);

    let payload = {};
    if (event.httpMethod === "GET") {
      payload = {
        qty: parseInt(url.searchParams.get("qty") || "1", 10) || 1,
        customerId: url.searchParams.get("customer_id"),
        customer_email: url.searchParams.get("customer_email"),
        successUrl: url.searchParams.get("success_url"),
        cancelUrl: url.searchParams.get("cancel_url"),
      };
    } else if (event.httpMethod === "POST") {
      if (!event.body) return json(400, { ok: false, error: "Missing body" });
      payload = JSON.parse(event.body);
      if (!payload.qty) payload.qty = 1;
    } else {
      return json(405, { ok: false, error: "Method not allowed" });
    }

    const priceId = process.env.STRIPE_PRICE_BOOST_7D;
    if (!priceId) return json(400, { ok:false, error:"Missing STRIPE_PRICE_BOOST_7D" });

    const base = PUBLIC_SANITIZE_URL(PUBLIC_BASE_URL, url);
    const successUrl = payload?.successUrl || `${base}/billing/boost/success`;
    const cancelUrl = payload?.cancelUrl || `${base}/billing/boost/cancel`;

    const metadata = {
      kind: "provider_boost",
      qty: String(payload.qty),
    };

    const params = {
      mode: "payment",
      success_url: successUrl,
      cancel_url: cancelUrl,
      line_items: [{ price: priceId, quantity: payload.qty }],
      metadata,
    };

    if (payload?.customerId) {
      params.customer = payload.customerId;
    } else if (payload?.customer_email) {
      params.customer_email = payload.customer_email;
    }

    const session = await stripe.checkout.sessions.create(params);
    return json(200, { ok: true, id: session.id, url: session.url });
  } catch (e) {
    return json(500, { ok:false, error: e?.message || "Unexpected error" });
  }
};

function PUBLIC_SANITIZE_URL(base, url) {
  if (base) return base.replace(/\/+$/, "");
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}`;
  } catch {
    return "";
  }
        }

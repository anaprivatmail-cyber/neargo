// netlify/functions/iap-portal.js
import Stripe from "stripe";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "POST,OPTIONS"
};
const json = (s, p) => ({ statusCode:s, headers:{ "Content-Type":"application/json; charset=utf-8", ...CORS }, body: JSON.stringify(p) });

const stripe = new Stripe(process.env.STRIPE_APPROVED_KEY || process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || "";

export default async (event) => {
  try {
    if (event.httpMethod === "OPTIONS") return json(200, { ok: true });
    if (event.httpMethod !== "POST") return json(405, { ok: false, error: "Method not allowed" });
    if (!event.body) return json(400, { ok: false, error: "Missing body" });

    const body = JSON.parse(event.body);
    let { customerId, customer_email, returnUrl } = body;

    if (!customerId) {
      if (!customer_email) return json(400, { ok:false, error:"Provide 'customerId' or 'customer_email'" });
      // Try to find or create a customer by email (optional – you can enforce auth + store customer IDs server-side)
      const existing = await stripe.customers.list({ email: customer_email, limit: 1 });
      let customer;
      if (existing.data && existing.data.length) {
        customer = existing.data[0];
      } else {
        customer = await stripe.customers.create({ email: customer_email });
      }
      customerId = customer.id;
    }

    const fallbackReturn = PUBLIC_SANITIZE_URL(PUBLIC_BASE_URL, new URL(event.rawUrl)) + "/#portal-return";
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl || process.env.STRIPE_CUSTOMER_PORTAL_RETURN_URL || fallbackReturn,
    });

    return json(200, { ok: true, url: session.url });
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

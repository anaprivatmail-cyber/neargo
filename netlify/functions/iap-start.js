// netlify/functions/iap-start.js
// Start Stripe Checkout za: premium (web) in provider pakete (Grow/Pro, monthly/yearly)

import Stripe from "stripe";

/* ---------- CORS helpers ---------- */
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
};
const json = (status, payload) => ({
  statusCode: status,
  headers: { "Content-Type": "application/json; charset=utf-8", ...CORS },
  body: JSON.stringify(payload),
});

/* ---------- ENV & Stripe ---------- */
const STRIPE_KEY =
  process.env.STRIPE_SECRET_KEY || process.env.STRIPE_APPROVED_KEY || "";
if (!STRIPE_KEY) {
  console.warn("[iap-start] Missing STRIPE_SECRET_KEY");
}
const stripe = STRIPE_KEY ? new Stripe(STRIPE_KEY, { apiVersion: "2024-06-20" }) : null;

const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || "").replace(/\/+$/, "");
const ENABLE_AUTO_TAX = String(process.env.STRIPE_AUTO_TAX || "").toLowerCase() === "true";

/* ---------- Price map (dogovorjeni ključi) ---------- */
const PRICE_MAP = {
  // Consumer Premium (web)
  premium_monthly: process.env.STRIPE_PRICE_PREMIUM_MONTHLY || "",

  // Provider (B2B)
  provider_grow_monthly: process.env.STRIPE_PRICE_PROVIDER_GROW_MONTHLY || "",
  provider_grow_yearly:  process.env.STRIPE_PRICE_PROVIDER_GROW_YEARLY  || "",
  provider_pro_monthly:  process.env.STRIPE_PRICE_PROVIDER_PRO_MONTHLY  || "",
  provider_pro_yearly:   process.env.STRIPE_PRICE_PROVIDER_PRO_YEARLY   || "",
};

/* ---------- Helperji ---------- */
function baseUrlFromEvent(rawUrl) {
  if (PUBLIC_BASE_URL) return PUBLIC_BASE_URL;
  try {
    const u = new URL(rawUrl);
    return `${u.protocol}//${u.host}`;
  } catch {
    return "";
  }
}
function resolvePriceId(planKey) {
  const key = String(planKey || "").toLowerCase().trim();
  if (!key) return { ok: false, error: "Missing 'plan' in request" };
  const price = PRICE_MAP[key];
  if (!price) {
    return {
      ok: false,
      error:
        `Unknown plan '${key}'. Supported: ` +
        Object.keys(PRICE_MAP)
          .filter(Boolean)
          .join(", "),
    };
  }
  return { ok: true, key, price };
}

/* ---------- Handler ---------- */
export const handler = async (event) => {
  try {
    if (event.httpMethod === "OPTIONS") return json(200, { ok: true });
    if (event.httpMethod !== "POST") return json(405, { ok: false, error: "Use POST" });

    if (!stripe) return json(500, { ok: false, error: "Missing STRIPE_SECRET_KEY" });

    let payload = {};
    try {
      payload = JSON.parse(event.body || "{}");
    } catch {
      return json(400, { ok: false, error: "Invalid JSON body" });
    }

    // plan: "premium_monthly" | "provider_grow_monthly" | "provider_grow_yearly" | "provider_pro_monthly" | "provider_pro_yearly"
    const { ok, error, key: planKey, price } = resolvePriceId(payload.plan);
    if (!ok) return json(400, { ok: false, error });

    const base = baseUrlFromEvent(event.rawUrl);
    if (!base) return json(500, { ok: false, error: "PUBLIC_BASE_URL not set and cannot infer base" });

    const successUrl = payload.successUrl || `${base}/#success`;
    const cancelUrl  = payload.cancelUrl  || `${base}/#cancel`;

    const isProvider = planKey.startsWith("provider_");
    const metadata = {
      kind: isProvider ? "provider_subscription" : "premium_subscription",
      plan: planKey,
      ...(payload?.meta && typeof payload.meta === "object"
        ? Object.fromEntries(
            Object.entries(payload.meta).filter(([_, v]) => typeof v === "string")
          )
        : {}),
    };

    const sessionParams = {
      mode: "subscription",
      success_url: successUrl,
      cancel_url: cancelUrl,
      line_items: [{ price, quantity: 1 }],
      allow_promotion_codes: true,
      metadata,
      ...(ENABLE_AUTO_TAX ? { automatic_tax: { enabled: true } } : {}),
    };

    // Optionally pre-fill
    if (payload?.customerId) {
      sessionParams.customer = String(payload.customerId);
    } else if (payload?.customer_email) {
      sessionParams.customer_email = String(payload.customer_email);
    }

    const session = await stripe.checkout.sessions.create(sessionParams);
    return json(200, { ok: true, id: session.id, url: session.url });
  } catch (err) {
    console.error("[iap-start] fatal:", err?.message || err);
    return json(500, { ok: false, error: err?.message || "Unexpected error" });
  }
};

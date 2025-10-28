// netlify/functions/iap-start.js
// Start Stripe Checkout za Premium (web) in Provider pakete (Grow/Pro, monthly/yearly)

import Stripe from "stripe";

/* ---------- CORS ---------- */
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
const stripe = STRIPE_KEY ? new Stripe(STRIPE_KEY, { apiVersion: "2024-06-20" }) : null;

const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || "").replace(/\/+$/, "");
const ENABLE_AUTO_TAX =
  String(process.env.STRIPE_AUTO_TAX || "").toLowerCase() === "true";

/* ---------- Price map (dogovorjeni env ključi) ---------- */
const PRICE_MAP = {
  // Premium (web)
  premium_monthly: process.env.STRIPE_PRICE_PREMIUM_MONTHLY || "",
  premium_yearly:  process.env.STRIPE_PRICE_PREMIUM_YEARLY  || "", // opcijsko

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

/**
 * Vrne { ok, key, price, error }
 * Sprejme:
 *   - planKey: "premium_monthly" | "provider_grow_monthly" | ...
 *   - ali shorthand: plan="grow|pro|premium", interval="monthly|yearly"
 */
function resolvePlan({ plan, interval }) {
  const p = String(plan || "").toLowerCase().trim();
  const i = String(interval || "").toLowerCase().trim();

  // Shorthand → polni ključ
  if (p && !p.includes("_")) {
    if (p === "premium") {
      const key = i ? `premium_${i}` : "premium_monthly";
      const price = PRICE_MAP[key];
      if (price) return { ok: true, key, price };
      return { ok: false, error: `Missing price for '${key}' in env` };
    }
    if (p === "grow" || p === "pro") {
      const iv = i || "monthly";
      const key = `provider_${p}_${iv}`;
      const price = PRICE_MAP[key];
      if (price) return { ok: true, key, price };
      return { ok: false, error: `Missing price for '${key}' in env` };
    }
  }

  // Polno ime ključa
  const key = p;
  const price = PRICE_MAP[key];
  if (price) return { ok: true, key, price };

  const supported = Object.keys(PRICE_MAP)
    .filter(Boolean)
    .join(", ");
  return {
    ok: false,
    error: `Unknown plan '${plan}'. Supported: ${supported}`,
  };
}

/* ---------- Handler (ESM) ---------- */
export const handler = async (event) => {
  try {
    if (event.httpMethod === "OPTIONS") return json(200, { ok: true });
    if (event.httpMethod !== "POST")
      return json(405, { ok: false, error: "Use POST" });

    if (!stripe)
      return json(500, { ok: false, error: "Missing STRIPE_SECRET_KEY" });

    let body = {};
    try {
      body = JSON.parse(event.body || "{}");
    } catch {
      return json(400, { ok: false, error: "Invalid JSON body" });
    }

    // Podprto:
    // - body.plan = "premium_monthly" | "provider_grow_yearly" | ...
    // - body.plan="grow|pro|premium", body.interval="monthly|yearly"
    const { plan, interval } = body;
    const res = resolvePlan({ plan, interval });
    if (!res.ok) return json(400, { ok: false, error: res.error });

    const base = baseUrlFromEvent(event.rawUrl);
    if (!base)
      return json(500, {
        ok: false,
        error: "PUBLIC_BASE_URL not set and cannot infer base",
      });

    const successUrl = body.successUrl || `${base}/#success`;
    const cancelUrl = body.cancelUrl || `${base}/#cancel`;

    const isProvider = res.key.startsWith("provider_");
    const metadata = {
      kind: isProvider ? "provider_subscription" : "premium_subscription",
      plan: res.key,
      ...(body?.meta && typeof body.meta === "object"
        ? Object.fromEntries(
            Object.entries(body.meta).filter(([_, v]) => typeof v === "string")
          )
        : {}),
    };

    const params = {
      mode: "subscription",
      success_url: successUrl,
      cancel_url: cancelUrl,
      line_items: [{ price: res.price, quantity: 1 }],
      allow_promotion_codes: true,
      metadata,
      ...(ENABLE_AUTO_TAX ? { automatic_tax: { enabled: true } } : {}),
    };

    if (body?.customerId) params.customer = String(body.customerId);
    else if (body?.customer_email) params.customer_email = String(body.customer_email);

    const session = await stripe.checkout.sessions.create(params);
    return json(200, { ok: true, id: session.id, url: session.url });
  } catch (err) {
    console.error("[iap-start] fatal:", err?.message || err);
    return json(500, { ok: false, error: err?.message || "Unexpected error" });
  }
};

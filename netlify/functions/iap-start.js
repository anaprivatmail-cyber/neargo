// netlify/functions/iap-start.js
import Stripe from "stripe";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
};

const json = (status, payload) => ({
  statusCode: status,
  headers: { "Content-Type": "application/json; charset=utf-8", ...CORS },
  body: JSON.stringify(payload),
});

const stripe = new Stripe(process.env.STRIPE_APPROVED_KEY || process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2024-06-20",
});

const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || "";
const ENABLE_AUTO_TAX = String(process.env.STRIPE_AUTO_TAX || "").toLowerCase() === "true";

const PRICE_MAP = {
  // Provider (B2B) monthly
  "provider_grow_monday"  : process.env.STRIPE_PRICE_PROVIDER_GROW_MONTHLY || process.env.STRIPE_PRICE_GROW_MONTHLY,
  "provider_grow_monthly" : process.env.STRIPE_PRICE_GROW_MONTHLY || process.env.STRIPE_PRICE_PROVIDER_GROW_MONTHLY,
  "provider_pro_monthly"  : process.env.STRIPE_PRICE_PROVIDER_PRO_MONTHLY,
  // Provider yearly (optional)
  "provider_grow_yearly"  : process.env.STRIPE_PRICE_PROVIDER_GROW_YEARLY,
  "provider_pro_yearly"   : process.env.STRIPE_PRICE_PROVIDER_PRO_YEARLY,
  // Consumer Premium on web
  "premium_monthly"       : process.env.STRIPE_PRICE_PREMIUM_MONTHLY,
  "premium_yearly"        : process.env.STRIPE_PRICE_PREMIUM_YEARLY,
};

export default async (event) => {
  try {
    if (event.httpMethod === "OPTIONS") {
      return json(200, { ok: true });
    }

    // Accept both GET (for quick manual test) and POST (for app)
    const method = event.httpMethod.toUpperCase();
    const url = new URL(event.rawUrl);

    let payload = {};
    if (method === "GET") {
      payload = {
        plan: url.searchParams.get("plan"),
        successUrl: url.searchParams.get("success_url"),
        cancelUrl: url.searchParams.get("cancel_url"),
        customerId: url.searchParams.get("customer_id"),
        customer_email: url.searchParams.get("customer_email"),
      };
    } else if (method === "POST") {
      if (!event.body) return json(400, { ok: false, error: "Missing request body" });
      try {
        payload = JSON.parse(event.body);
      } catch (e) {
        return json(400, { ok: false, error: "Invalid JSON body" });
      }
    } else {
      return json(405, { ok: false, error: "Method not allowed" });
    }

    const plan = String(payload.plan || "").toLowerCase().trim();
    if (!plan) return json(400, { ok: false, error: "Missing 'plan' in request" });

    const priceId = PRICE_MAP[plan];
    if (!priceId) {
      return json(400, {
        ok: false,
        error: `Unknown plan '${plan}'. Supported: ${Object.keys(PRICE_MAP).filter(Boolean).join(", ")}`,
      });
    }

    const base = PUBLIC_SANITIZE_URL(PUBLIC_BASE_URL, url);
    const successUrl = payload?.successUrl || `${base}/billing/success?plan=${encodeURIComponent(plan)}`;
    const cancelUrl = payload?.cancelUrl || `${base}/billing/cancel?plan=${encodeURIComponent(plan)}`;

    const isProvider = plan.startsWith("provider_");
    const metadata = {
      kind: isProvider ? "provider_subscription" : "premium_subscription",
      plan,
    };
    if (payload?.meta && typeof payload.meta === "object") {
      for (const [k, v] of Object.entries(payload.meta)) {
        if (typeof v === "string") {
          metadata[k] = v;
        }
      }
    }

    const sessionParams = {
      mode: "subscription",
      success_url: successUrl,
      cancel_url: cancelUrl,
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      allow_promotion_codes: true,
      // optionally enable Stripe Tax if you plan to
      ...(ENABLE_REQUIRES(ENABLE_AUTO_TAX) ? { automatic_tax: { enabled: true } } : {}),
      metadata,
    };

    // Optionally attach a known Stripe customer or pre-fill email
    if (payload?.customerId) {
      sessionParams.customer = payload.customerId;
    } else if (payload?.customer_email) {
      sessionParams.customer_email = payload.customer_email;
    }

    const session = await stripe.checkout.sessions.create(sessionParams);

    return json(200, { ok: true, id: session.id, url: session.url });
  } catch (err) {
    return json(500, { ok: false, error: err?.message || "Unexpected error" });
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
function ENABLE_REQUIRES(flag) {
  return !!flag;
}

// netlify/functions/checkout.js
// Stripe Checkout prek REST (brez SDK).
// POST body:
// {
//   type: "ticket" | "coupon",         // če je "coupon", ignoriramo lineItems in uporabimo fiksno ceno iz COUPON_PRICE_CENTS
//   lineItems:[{name, description, amount, currency, quantity}],
//   successUrl, cancelUrl, customerEmail,
//   metadata: { event_id, event_title, display_benefit, benefit_type, benefit_value, freebie_text, ... }
// }

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const COUPON_PRICE_CENTS = Number(process.env.COUPON_PRICE_CENTS || 200); // 200 = 2,00 €
const BASE_URL = (process.env.PUBLIC_BASE_URL || "https://getneargo.com").replace(/\/$/, "");

exports.handler = async (event) => {
  try {
    // CORS preflight
    if (event.httpMethod === "OPTIONS") {
      return {
        statusCode: 204,
        headers: corsHeaders(),
        body: "",
      };
    }

    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: "Method Not Allowed" };
    }

    if (!STRIPE_SECRET_KEY || !/^sk_(live|test)_/i.test(STRIPE_SECRET_KEY)) {
      return json({ ok: false, error: "Stripe not configured: STRIPE_SECRET_KEY (sk_...) is missing/invalid." });
    }

    const payload = safeJson(event.body) || {};
    const {
      type,                              // "coupon" | "ticket"
      metadata = {},
      lineItems: rawLineItems = [],
      successUrl = `${BASE_URL}/#success`,
      cancelUrl  = `${BASE_URL}/#cancel`,
      customerEmail,
    } = payload;

    // Build line_items
    let lineItems = [];

    if (type === "coupon") {
      // Kupon je vedno fiksno COUPON_PRICE_CENTS, ime povzamemo iz display_benefit (če obstaja)
      const name = metadata.display_benefit ? `Kupon – ${metadata.display_benefit}` : "Kupon";
      lineItems = [{
        currency: "eur",
        name,
        description: metadata.event_title ? `Za: ${metadata.event_title}` : undefined,
        amount: COUPON_PRICE_CENTS, // v centih
        quantity: 1,
      }];
    } else {
      // Ticket ali ostalo – obdržimo obstoječe vedenje
      if (!Array.isArray(rawLineItems) || !rawLineItems.length) {
        return json({ ok: false, error: "Missing lineItems." });
      }
      lineItems = rawLineItems;
    }

    // x-www-form-urlencoded za Stripe
    const form = new URLSearchParams();
    form.set("mode", "payment");
    form.set("success_url", successUrl);
    form.set("cancel_url", cancelUrl);
    if (customerEmail) form.set("customer_email", customerEmail);

    // Dodamo metapodatke (zelo pomembno za webhook)
    // Primer: metadata[event_id]=..., metadata[type]=coupon, ...
    const fullMetadata = { ...metadata, type: type || (metadata.type ?? "ticket") };
    Object.entries(fullMetadata).forEach(([k, v]) => {
      if (v === undefined || v === null) return;
      form.set(`metadata[${k}]`, String(v));
    });

    // line_items -> price_data
    lineItems.forEach((it, i) => {
      form.set(`line_items[${i}][price_data][currency]`, it.currency || "eur");
      form.set(`line_items[${i}][price_data][product_data][name]`, it.name || "Ticket");
      if (it.description) {
        form.set(`line_items[${i}][price_data][product_data][description]`, it.description);
      }
      // znesek v CENTIH
      form.set(`line_items[${i}][price_data][unit_amount]`, String(it.amount));
      form.set(`line_items[${i}][quantity]`, String(it.quantity || 1));
    });

    const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok || !data?.url) {
      const msg = (data && data.error && data.error.message) ? data.error.message : "Stripe error";
      return json({ ok: false, error: msg, debug: data });
    }

    return json({ ok: true, id: data.id, url: data.url });
  } catch (err) {
    return json({ ok: false, error: String(err?.message || err) }, 200);
  }
};

// Helpers
function corsHeaders() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "POST,OPTIONS",
    "access-control-allow-headers": "content-type",
  };
}
function json(obj, statusCode = 200) {
  return {
    statusCode,
    headers: { "content-type": "application/json", ...corsHeaders() },
    body: JSON.stringify(obj),
  };
}
function safeJson(s) { try { return s ? JSON.parse(s) : null; } catch { return null; } }


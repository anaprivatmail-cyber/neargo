// netlify/functions/checkout.js
// Stripe Checkout prek REST (brez SDK).
// POST body: { lineItems:[{name, description, amount, currency, quantity}], successUrl, cancelUrl, customerEmail }

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;

// CommonJS export – pomembno za Netlify Functions (če ne uporabljaš "type":"module")
exports.handler = async (event) => {
  try {
    // CORS preflight
    if (event.httpMethod === "OPTIONS") {
      return {
        statusCode: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "POST,OPTIONS",
          "access-control-allow-headers": "content-type",
        },
        body: "",
      };
    }

    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: "Method Not Allowed" };
    }

    if (!STRIPE_SECRET_KEY || !/^sk_(live|test)_/i.test(STRIPE_SECRET_KEY)) {
      // če je pomotoma vpisan pk_ ključ, to jasno povej
      return json({ ok: false, error: "Stripe not configured: STRIPE_SECRET_KEY (sk_...) is missing/invalid." });
    }

    const payload = safeJson(event.body);
    const {
      lineItems = [],
      successUrl = "https://getneargo.com/#success",
      cancelUrl  = "https://getneargo.com/#cancel",
      customerEmail,
    } = payload || {};

    if (!Array.isArray(lineItems) || !lineItems.length) {
      return json({ ok: false, error: "Missing lineItems." });
    }

    // zgradimo x-www-form-urlencoded telo za Stripe
    const form = new URLSearchParams();
    form.set("mode", "payment");
    form.set("success_url", successUrl);
    form.set("cancel_url", cancelUrl);
    if (customerEmail) form.set("customer_email", customerEmail);

    lineItems.forEach((it, i) => {
      form.set(`line_items[${i}][price_data][currency]`, it.currency || "eur");
      form.set(`line_items[${i}][price_data][product_data][name]`, it.name || "Ticket");
      if (it.description) form.set(`line_items[${i}][price_data][product_data][description]`, it.description);
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
      // vrni jasen opis napake iz Stripe, če obstaja
      const msg = (data && data.error && data.error.message) ? data.error.message : "Stripe error";
      return json({ ok: false, error: msg, debug: data });
    }

    return json({ ok: true, id: data.id, url: data.url });
  } catch (err) {
    // če funkcija pade, naj NE vrne HTML, ampak JSON, da frontend ne pade pri .json()
    return json({ ok: false, error: String(err?.message || err) }, 200);
  }
};

// helperji
function json(obj, statusCode = 200) {
  return {
    statusCode,
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
    },
    body: JSON.stringify(obj),
  };
}
function safeJson(s) { try { return s ? JSON.parse(s) : null; } catch { return null; } }

// netlify/functions/checkout.js
// Uporabi Stripe REST API brez SDK (da ni odvisnosti).
// POST body: { lineItems:[{name, description, amount, currency, quantity}], successUrl, cancelUrl, customerEmail }

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;

export const handler = async (event) => {
  try {
    if (event.httpMethod === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "POST,OPTIONS",
          "access-control-allow-headers": "content-type",
        },
      });
    }
    if (event.httpMethod !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    if (!STRIPE_SECRET_KEY) {
      return new Response(
        JSON.stringify({ ok: false, error: "Stripe not configured (missing STRIPE_SECRET_KEY)" }),
        { status: 200, headers: { "content-type": "application/json", "access-control-allow-origin": "*" } }
      );
    }

    const payload = JSON.parse(event.body || "{}");
    const {
      lineItems = [],
      successUrl = "https://getneargo.com/#success",
      cancelUrl = "https://getneargo.com/#cancel",
      customerEmail,
    } = payload;

    // Build form data for Stripe
    const form = new URLSearchParams();
    form.set("mode", "payment");
    form.set("success_url", successUrl);
    form.set("cancel_url", cancelUrl);
    if (customerEmail) form.set("customer_email", customerEmail);

    lineItems.forEach((it, i) => {
      form.set(`line_items[${i}][price_data][currency]`, it.currency || "eur");
      form.set(`line_items[${i}][price_data][product_data][name]`, it.name || "Ticket");
      if (it.description) form.set(`line_items[${i}][price_data][product_data][description]`, it.description);
      form.set(`line_items[${i}][price_data][unit_amount]`, String(it.amount)); // v centih
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

    const data = await res.json();
    if (!res.ok) {
      return new Response(JSON.stringify({ ok: false, error: data.error?.message || "Stripe error" }), {
        status: 200,
        headers: { "content-type": "application/json", "access-control-allow-origin": "*" },
      });
    }

    return new Response(JSON.stringify({ ok: true, id: data.id, url: data.url }), {
      status: 200,
      headers: { "content-type": "application/json", "access-control-allow-origin": "*" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 200,
      headers: { "content-type": "application/json", "access-control-allow-origin": "*" },
    });
  }
};

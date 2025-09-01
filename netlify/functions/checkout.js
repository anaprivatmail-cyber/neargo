// netlify/functions/checkout.js
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
      return new Response(JSON.stringify({ ok: false, error: "Stripe not configured" }), {
        status: 500,
        headers: { "content-type": "application/json", "access-control-allow-origin": "*" },
      });
    }

    const { eventId, type, customerEmail } = JSON.parse(event.body || "{}");

    // 1. Preberi podatke dogodka iz Supabase
    const { createClient } = await import("@supabase/supabase-js");
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY
    );

    const { data: ev, error } = await supabase
      .from("events")
      .select("*")
      .eq("id", eventId)
      .single();

    if (error || !ev) {
      return new Response(JSON.stringify({ ok: false, error: "Event not found" }), {
        status: 404,
        headers: { "content-type": "application/json", "access-control-allow-origin": "*" },
      });
    }

    // Cena v centih (EUR → centi)
    const amount = Math.round(Number(ev.price) * 100);

    // 2. Stripe Checkout Session
    const form = new URLSearchParams();
    form.set("mode", "payment");
    form.set("success_url", "https://getneargo.com/#success");
    form.set("cancel_url", "https://getneargo.com/#cancel");
    if (customerEmail) form.set("customer_email", customerEmail);
    form.set("line_items[0][price_data][currency]", "eur");
    form.set("line_items[0][price_data][product_data][name]", ev.title || "Ticket");
    form.set("line_items[0][price_data][unit_amount]", String(amount));
    form.set("line_items[0][quantity]", "1");

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
        status: 500,
        headers: { "content-type": "application/json", "access-control-allow-origin": "*" },
      });
    }

    return new Response(JSON.stringify({ ok: true, url: data.url }), {
      status: 200,
      headers: { "content-type": "application/json", "access-control-allow-origin": "*" },
    });

  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 500,
      headers: { "content-type": "application/json", "access-control-allow-origin": "*" },
    });
  }
};

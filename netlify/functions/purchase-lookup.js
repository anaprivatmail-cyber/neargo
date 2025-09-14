// netlify/functions/purchase-lookup.js
// --------------------------------------
// Vrne podatke o nakupu (dogodek, token, benefit)
// na podlagi Stripe Checkout Session ID (cs).
// --------------------------------------

const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false }
});

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: cors(), body: "" };
  }

  if (event.httpMethod !== "GET") {
    return { statusCode: 405, headers: cors(), body: "Method Not Allowed" };
  }

  const cs = (event.queryStringParameters && event.queryStringParameters.cs) || "";
  if (!cs) {
    return { statusCode: 400, headers: cors(), body: JSON.stringify({ ok: false, error: "Manjka ?cs=" }) };
  }

  try {
    // Najdi ticket po Stripe Checkout Session ID
    const { data: tickets, error } = await supa
      .from("tickets")
      .select("token, type, display_benefit, event_id")
      .eq("stripe_checkout_session_id", cs)
      .limit(1);

    if (error) throw error;
    if (!tickets || !tickets.length) {
      return { statusCode: 404, headers: cors(), body: JSON.stringify({ ok: false, error: "Ni najdeno" }) };
    }

    const t = tickets[0];

    // Dobi osnovne podatke o dogodku
    let eventData = null;
    if (t.event_id) {
      const { data: events } = await supa
        .from("events")
        .select("id, name, venue, start, end, images")
        .eq("id", t.event_id)
        .limit(1);
      if (events && events.length) eventData = events[0];
    }

    return {
      statusCode: 200,
      headers: { ...cors(), "Content-Type": "application/json" },
      body: JSON.stringify({ ok: true, ticket: t, event: eventData })
    };

  } catch (e) {
    console.error("[purchase-lookup] error:", e);
    return { statusCode: 500, headers: cors(), body: JSON.stringify({ ok: false, error: e.message }) };
  }
};

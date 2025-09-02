// netlify/functions/redeem.js
const { supa } = require("../../providers/supa");

/** Preveri Supabase user iz Bearer tokena (Supabase Auth JWT) */
async function getUserFromAuth(header) {
  if (!header || !header.startsWith("Bearer ")) return null;
  const jwt = header.slice(7);
  const { data, error } = await supa.auth.getUser(jwt);
  if (error) return null;
  return data.user;
}

exports.handler = async (event) => {
  try {
    const user = await getUserFromAuth(event.headers.authorization);
    if (!user) return { statusCode: 401, body: JSON.stringify({ ok: false, reason: "Unauthenticated" }) };

    const token = (event.path || "").split("/").pop();
    if (!token) return { statusCode: 400, body: JSON.stringify({ ok: false, reason: "Missing token" }) };

    const { data: ticket, error } = await supa.from("tickets").select("*").eq("token", token).single();
    if (error || !ticket) return { statusCode: 404, body: JSON.stringify({ ok: false, reason: "Not found" }) };

    // (opcijsko) preveri lastništvo eventa
    if (process.env.ENFORCE_PROVIDER === "true" && ticket.event_id) {
      const { data: ev } = await supa.from("events").select("id,provider_user_id").eq("id", ticket.event_id).single();
      if (ev && ev.provider_user_id && ev.provider_user_id !== user.id) {
        return { statusCode: 403, body: JSON.stringify({ ok: false, reason: "Forbidden" }) };
      }
    }

    if (ticket.status === "redeemed") {
      return { statusCode: 200, body: JSON.stringify({ ok: false, reason: "Already redeemed", redeemed_at: ticket.redeemed_at }) };
    }

    const { data: updated, error: upErr } = await supa
      .from("tickets")
      .update({ status: "redeemed", redeemed_at: new Date().toISOString(), redeemed_by: user.id })
      .eq("id", ticket.id)
      .select()
      .single();

    if (upErr) return { statusCode: 500, body: JSON.stringify({ ok: false, reason: "DB error" }) };

    return {
      statusCode: 200,
      body: JSON.stringify({
        ok: true,
        type: updated.type,
        display_benefit: updated.display_benefit,
        customer_email: updated.customer_email,
        redeemed_at: updated.redeemed_at,
      }),
    };
  } catch (e) {
    console.error(e);
    return { statusCode: 500, body: JSON.stringify({ ok: false, reason: "internal" }) };
  }
};

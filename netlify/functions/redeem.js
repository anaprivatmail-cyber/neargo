// netlify/functions/redeem.js
// Prod redeem endpoint: ponudnik skenira QR (token) -> označi kot "redeemed"
const { supa } = require("../../providers/supa");

/** Preveri Supabase user iz Bearer tokena (Supabase Auth JWT) */
async function getUserFromAuth(header) {
  try {
    if (!header || !header.startsWith("Bearer ")) return null;
    const jwt = header.slice(7);
    const { data, error } = await supa.auth.getUser(jwt);
    if (error) return null;
    return data.user;
  } catch {
    return null;
  }
}

exports.handler = async (event) => {
  try {
    // CORS preflight
    if (event.httpMethod === "OPTIONS") {
      return { statusCode: 204, headers: cors(), body: "" };
    }
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, headers: cors(), body: "Method Not Allowed" };
    }

    // Auth
    const user = await getUserFromAuth(event.headers.authorization);
    if (!user) return json({ ok: false, reason: "Unauthenticated" }, 401);

    // /api/redeem/<token>  (prek netlify.toml redirecta) ali /.netlify/functions/redeem/<token>
    const path = event.path || "";
    // vzemi zadnji segment; poskrbi, da ne vrne "redeem"
    let token = path.split("/").pop();
    if (!token || token.toLowerCase() === "redeem") {
      // poskusi še iz query stringa ?token=...
      const qs = new URLSearchParams(event.rawQuery || event.queryStringParameters || "");
      token = qs.get("token");
    }
    if (!token) return json({ ok: false, reason: "Missing token" }, 400);

    // Najdi ticket/kupon po tokenu
    const { data: ticket, error } = await supa
      .from("tickets")
      .select("*")
      .eq("token", token)
      .single();

    if (error || !ticket) return json({ ok: false, reason: "Not found" }, 404);

    // (opcijsko) preveri, da prijavljeni ponudnik lahko unovči ta event
    if (String(process.env.ENFORCE_PROVIDER || "false") === "true" && ticket.event_id) {
      const { data: ev } = await supa
        .from("events")
        .select("id, provider_user_id")
        .eq("id", ticket.event_id)
        .single();

      if (ev?.provider_user_id && ev.provider_user_id !== user.id) {
        return json({ ok: false, reason: "Forbidden" }, 403);
      }
    }

    // Že unovčeno?
    if (ticket.status === "redeemed") {
      return json({
        ok: false,
        reason: "Already redeemed",
        redeemed_at: ticket.redeemed_at
      });
    }

    // Označi kot unovčeno
    const { data: updated, error: upErr } = await supa
      .from("tickets")
      .update({
        status: "redeemed",
        redeemed_at: new Date().toISOString(),
        redeemed_by: user.id
      })
      .eq("id", ticket.id)

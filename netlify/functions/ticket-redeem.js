// netlify/functions/ticket-redeem.js
const { supa } = require("../../providers/supa");

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-scanner-key",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "content-type": "application/json",
  };
}
function json(body, status = 200) {
  return { statusCode: status, headers: cors(), body: JSON.stringify(body) };
}

async function userFromAuth(header) {
  try {
    if (!header || !header.startsWith("Bearer ")) return null;
    const jwt = header.slice(7);
    const { data, error } = await supa.auth.getUser(jwt);
    if (error) return null;
    return data.user || null;
  } catch {
    return null;
  }
}

exports.handler = async (event) => {
  // CORS preflight
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: cors(), body: "" };
  if (event.httpMethod !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  // auth: dovolimo Supabase JWT ali x-scanner-key
  const scannerKey = event.headers["x-scanner-key"] || event.headers["X-Scanner-Key"];
  const SK = process.env.SCANNER_KEY || "";
  const scannerOk = !!SK && scannerKey === SK;
  const authedUser = await userFromAuth(event.headers.authorization);
  if (!authedUser && !scannerOk) return json({ ok: false, error: "unauthorized" }, 401);

  // vhod
  let token = null, eventId = null;
  try {
    const body = JSON.parse(event.body || "{}");
    token = body.token || null;
    eventId = body.eventId || null;
  } catch {}

  // fallback iz poti/query
  if (!token) {
    const seg = (event.path || "").split("/").pop();
    if (seg && seg !== "ticket-redeem") token = seg;
  }
  if (!token && event.queryStringParameters) {
    token = event.queryStringParameters.token || null;
    eventId = eventId || event.queryStringParameters.eventId || null;
  }
  if (!token) return json({ ok: false, error: "missing_token" }, 400);

  // poišči vstopnico
  const { data: ticket, error: findErr } = await supa
    .from("tickets")
    .select("*")
    .eq("token", token)
    .single();

  if (findErr || !ticket) return json({ ok: false, error: "not_found" }, 404);

  // (opcijsko) preveri organizatorja, če je vključeno
  if ((process.env.ENFORCE_PROVIDER || "false") === "true" && ticket.event_id && authedUser) {
    const { data: ev } = await supa
      .from("events")
      .select("id, provider_user_id")
      .eq("id", ticket.event_id)
      .single();
    if (ev?.provider_user_id && ev.provider_user_id !== authedUser.id) {
      return json({ ok: false, error: "forbidden" }, 403);
    }
  }

  // (opcijsko) preveri ujemanje eventId
  if (eventId && String(eventId) !== String(ticket.event_id || "")) {
    return json({ ok: false, error: "wrong_event", forEvent: ticket.event_id }, 409);
  }

  // če je že vnovčeno
  if (ticket.status === "redeemed") {
    return json({ ok: true, alreadyRedeemed: true, redeemed_at: ticket.redeemed_at });
  }

  // posodobitev - optimistično, samo če je bil "issued"
  const now = new Date().toISOString();
  const { data: updated, error: upErr } = await supa
    .from("tickets")
    .update({
      status: "redeemed",
      redeemed_at: now,
      redeemed_by: authedUser ? authedUser.id : "scanner",
    })
    .eq("id", ticket.id)
    .eq("status", "issued")
    .select("id, status, redeemed_at")
    .single();

  if (upErr) return json({ ok: false, error: "db_error", detail: upErr.message }, 500);
  if (!updated) {
    // race condition: nekdo drug je vmes vnovčil
    return json({ ok: true, alreadyRedeemed: true, redeemed_at: ticket.redeemed_at });
  }

  return json({ ok: true, status: updated.status, redeemed_at: updated.redeemed_at });
};

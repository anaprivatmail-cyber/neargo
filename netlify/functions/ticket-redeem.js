// /netlify/functions/ticket-redeem.js
import { supa } from "../../providers/supa.js";

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-scanner-key",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "content-type": "application/json",
  };
}
function res(status, body) {
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

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return res(204, {});
  if (event.httpMethod !== "POST") return res(405, { ok: false, error: "method_not_allowed" });

  // dovolimo ali Supabase JWT ali x-scanner-key
  const scannerKey = event.headers["x-scanner-key"] || event.headers["X-Scanner-Key"];
  const SK = process.env.SCANNER_KEY || "";
  const scannerOk = !!SK && scannerKey === SK;

  const authedUser = await userFromAuth(event.headers.authorization);
  if (!authedUser && !scannerOk) return res(401, { ok: false, error: "unauthorized" });

  // vhod
  let token = null, eventId = null;
  try {
    const body = JSON.parse(event.body || "{}");
    token = body.token || null;
    eventId = body.eventId || null;
  } catch {}

  if (!token) {
    const seg = (event.path || "").split("/").pop();
    if (seg && seg !== "ticket-redeem") token = seg;
  }
  if (!token && event.queryStringParameters) {
    token = event.queryStringParameters.token || null;
    eventId = eventId || event.queryStringParameters.eventId || null;
  }
  if (!token) return res(400, { ok: false, error: "missing_token" });

  // poišči vstopnico
  const { data: ticket, error: findErr } = await supa
    .from("tickets")
    .select("*")
    .eq("token", token)
    .single();
  if (findErr || !ticket) return res(404, { ok: false, error: "not_found" });

  // opcijsko preveri organizatorja
  if ((process.env.ENFORCE_PROVIDER || "false") === "true" && ticket.event_id) {
    if (authedUser) {
      const { data: ev } = await supa
        .from("events")
        .select("id, provider_user_id")
        .eq("id", ticket.event_id)
        .single();
      if (ev?.provider_user_id && ev.provider_user_id !== authedUser.id) {
        return res(403, { ok: false, error: "forbidden" });
      }
    }
  }

  if (eventId && String(eventId) !== String(ticket.event_id || "")) {
    return res(409, { ok: false, error: "wrong_event", forEvent: ticket.event_id });
  }

  if (ticket.status === "redeemed") {
    return res(200, { ok: true, alreadyRedeemed: true, redeemed_at: ticket.redeemed_at });
  }

  const now = new Date().toISOString();
  const { data: updated, error: upErr } = await supa
    .from("tickets")
    .update({
      status: "redeemed",
      redeemed_at: now,
      redeemed_by: authedUser ? authedUser.id : "scanner",
    })
    .eq("id", ticket.id)
    .eq("status", "issued") // prepreči dvojno vnovčitev
    .select("id, status, redeemed_at")
    .single();

  if (upErr) return res(500, { ok: false, error: "db_error", detail: upErr.message });
  if (!updated) {
    return res(200, { ok: true, alreadyRedeemed: true, redeemed_at: ticket.redeemed_at });
  }

  return res(200, { ok: true, status: updated.status, redeemed_at: updated.redeemed_at });
};

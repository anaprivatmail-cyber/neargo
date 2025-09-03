// netlify/functions/ticket-redeem.cjs
// CJS handler + zanesljiv dinamični import ESM modula supa.js, + audit v public.vnovcitve

const path = require("path");
const { pathToFileURL } = require("url");
const crypto = require("crypto");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, x-scanner-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "content-type": "application/json",
};
const json = (body, status = 200) => ({
  statusCode: status,
  headers: corsHeaders,
  body: JSON.stringify(body),
});
const sha = (s) => crypto.createHash("sha256").update(String(s || "")).digest("hex");

exports.handler = async (event) => {
  // --- Dinamični import ESM modula (relativno na to datoteko)
  const supaUrl = pathToFileURL(path.join(__dirname, "../../providers/supa.js")).href;
  const supaModule = await import(supaUrl);
  const { supa } = supaModule || {};
  if (!supa || typeof supa.from !== "function") return json({ ok: false, error: "supa_unavailable" }, 500);

  // Helper: preberi user iz Supabase JWT
  async function userFromAuth(header) {
    try {
      if (!header || !header.startsWith("Bearer ")) return null;
      const jwt = header.slice(7);
      const { data, error } = await supa.auth.getUser(jwt);
      if (error) return null;
      return data.user || null;
    } catch { return null; }
  }

  // Helper: audit log v public.vnovcitve
  async function logScan({ result, ticketId = null, eventId = null, providedKey = null, raw = null }) {
    try {
      const h = event.headers || {};
      // Netlify posreduje IP v različnih headerjih; vzemi prvega veljavnega
      const fwd = (h["x-forwarded-for"] || "").split(",")[0].trim() || null;
      const ip = h["x-nf-client-connection-ip"] || h["client-ip"] || fwd || null;
      const ua = h["user-agent"] || null;
      await supa.from("vnovcitve").insert({
        ticket_id: ticketId,
        scanned_at: new Date().toISOString(),
        result,
        event_id: eventId || null,
        device_key_hash: providedKey ? sha(providedKey).slice(0, 32) : null, // ne hranimo plain ključa
        ip, user_agent: ua, raw
      });
    } catch (_) { /* logging ne zruši procesa */ }
  }

  // CORS / metoda
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: corsHeaders, body: "" };
  if (event.httpMethod !== "POST")   return json({ ok: false, error: "method_not_allowed" }, 405);

  // Avtentikacija skenerja: dovolimo EITHER Supabase JWT ali x-scanner-key
  const scannerKey = event.headers["x-scanner-key"] || event.headers["X-Scanner-Key"];
  const SK = process.env.SCANNER_KEY || "";
  const scannerOk = !!SK && scannerKey === SK;
  const authedUser = await userFromAuth(event.headers.authorization);
  if (!authedUser && !scannerOk) {
    await logScan({ result: "UNAUTHORIZED", providedKey: scannerKey });
    return json({ ok: false, error: "unauthorized" }, 401);
  }

  // Body / query
  let token = null, eventId = null;
  try {
    const body = JSON.parse(event.body || "{}");
    token   = (body.token || "").trim() || null;
    eventId = (body.eventId || "").trim() || null;   // prazen string -> null
  } catch { /* ignore */ }

  // Fallback iz poti / querystringa
  if (!token) {
    const seg = (event.path || "").split("/").pop();
    if (seg && seg !== "ticket-redeem") token = seg;
  }
  if (!token && event.queryStringParameters) {
    token = (event.queryStringParameters.token || "").trim() || null;
    eventId = eventId || (event.queryStringParameters.eventId || "").trim() || null;
  }
  if (!token) return json({ ok: false, error: "missing_token" }, 400);

  // === Najdi ticket (najprej po CODE, fallback po TOKEN) ===
  // Vrnemo samo potrebna polja
  let { data: ticket, error: findErr } = await supa
    .from("tickets")
    .select("id, status, event_id, code, token, redeemed_at")
    .eq("code", token)
    .single();

  if (findErr || !ticket) {
    const r2 = await supa
      .from("tickets")
      .select("id, status, event_id, code, token, redeemed_at")
      .eq("token", token)
      .single();
    ticket = r2.data; findErr = r2.error;
  }

  if (!ticket) {
    await logScan({ result: "NOT_FOUND", providedKey: scannerKey, eventId, raw: { token } });
    return json({ ok: false, error: "not_found" }, 404);
  }

  // (opcijsko) preveri organizatorja
  if ((process.env.ENFORCE_PROVIDER || "false") === "true" && ticket.event_id && authedUser) {
    const { data: ev } = await supa
      .from("events")
      .select("id, provider_user_id")
      .eq("id", ticket.event_id)
      .single();
    if (ev?.provider_user_id && ev.provider_user_id !== authedUser.id) {
      await logScan({ result: "FORBIDDEN", ticketId: ticket.id, eventId: ticket.event_id, providedKey: scannerKey });
      return json({ ok: false, error: "forbidden" }, 403);
    }
  }

  // (opcijsko) ujemanje eventId
  if (eventId && String(eventId) !== String(ticket.event_id || "")) {
    await logScan({ result: "WRONG_EVENT", ticketId: ticket.id, eventId, providedKey: scannerKey, raw: { ticket_event: ticket.event_id } });
    return json({ ok: false, error: "wrong_event", forEvent: ticket.event_id }, 409);
  }

  // Že vnovčeno?
  if (ticket.status === "redeemed") {
    await logScan({ result: "ALREADY_USED", ticketId: ticket.id, eventId: ticket.event_id, providedKey: scannerKey, raw: { redeemed_at: ticket.redeemed_at } });
    return json({ ok: true, alreadyRedeemed: true, redeemed_at: ticket.redeemed_at });
  }

  // Označi kot vnovčeno (idempotentno: samo iz 'issued')
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
    // Race condition – nekdo je medtem vnovčil
    await logScan({ result: "ALREADY_USED", ticketId: ticket.id, eventId: ticket.event_id, providedKey: scannerKey, raw: { race: true } });
    return json({ ok: true, alreadyRedeemed: true, redeemed_at: ticket.redeemed_at });
  }

  await logScan({ result: "VALID", ticketId: updated.id, eventId: ticket.event_id, providedKey: scannerKey });
  return json({ ok: true, status: updated.status, redeemed_at: updated.redeemed_at });
};

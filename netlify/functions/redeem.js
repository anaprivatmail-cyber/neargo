// netlify/functions/redeem.js
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL  = process.env.SUPABASE_URL;
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SCANNER_KEY   = process.env.SCANNER_KEY || "";

const supa = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession:false } });

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
  "Access-Control-Allow-Headers": "content-type,x-scanner-key"
};
const ok  = (b)=>({ statusCode:200, headers:{ "content-type":"application/json", ...CORS }, body:JSON.stringify(b) });
const bad = (m,s=400)=>({ statusCode:s, headers:{ "content-type":"application/json", ...CORS }, body:JSON.stringify({ ok:false, error:m }) });

export const handler = async (event) => {
  try {
    if (event.httpMethod === "OPTIONS") return { statusCode:204, headers:CORS, body:"" };
    if (event.httpMethod !== "POST")   return bad("use_post", 405);

    // Avtorizacija skenerja
    const providedKey = event.headers["x-scanner-key"] || event.headers["X-Scanner-Key"] || "";
    if (!SCANNER_KEY || providedKey !== SCANNER_KEY) return bad("unauthorized_scanner", 401);

    let body = {};
    try { body = JSON.parse(event.body || "{}"); } catch { return bad("invalid_json", 400); }
    const token   = (body.token || "").trim();
    const eventId = (body.eventId || "").trim();
    const scannerEmail = (body.scannerEmail || "").trim(); // opcijsko iz UI

    if (!token) return bad("missing_token");

    // Poišči ticket
    let q = supa.from("tickets")
      .select("id,type,status,display_benefit,email,redeemed_at,event_id")
      .eq("token", token)
      .limit(1);

    if (eventId) q = q.eq("event_id", eventId);

    const { data: rows, error } = await q;
    if (error) return bad("db_error: "+error.message, 500);

    const row = rows && rows[0];
    if (!row) return bad("not_found", 404);

    const statusLc = String(row.status || "").toLowerCase();

    // Če je že unovčen
    if (statusLc === "redeemed") {
      await logScan(row, token, scannerEmail, providedKey, true); // log tudi ponovni scan
      return ok({
        ok: true,
        token, // <-- dodano: številka QR kode v odzivu
        alreadyRedeemed: true,
        status: "redeemed",
        redeemedAt: row.redeemed_at || null,
        type: row.type,
        display_benefit: row.display_benefit || null,
  email: row.email || null
      });
    }

    // Posodobi na redeemed
    const nowIso = new Date().toISOString();
    const { error: upErr } = await supa
      .from("tickets")
      .update({ status: "redeemed", redeemed_at: nowIso })
      .eq("id", row.id);

    if (upErr) return bad("update_failed", 500);

    await logScan(row, token, scannerEmail, providedKey, false);

    return ok({
      ok: true,
      token, // <-- dodano: številka QR kode v odzivu
      status: "redeemed",
      redeemedAt: nowIso,
      type: row.type,
      display_benefit: row.display_benefit || null,
  email: row.email || null
    });

  } catch (e) {
    return bad(String(e?.message || e), 200);
  }
};

// Zapis v tabelo scans
async function logScan(row, token, scannerEmail, scannerKey, already) {
  try {
    await supa.from("scans").insert({
      ticket_id: row.id,
      event_id: row.event_id,
      token,
      scanner_email: scannerEmail || null,
      scanner_key: scannerKey || null
    });
  } catch(e) {
    console.error("[redeem] logScan error", e.message);
  }
               }

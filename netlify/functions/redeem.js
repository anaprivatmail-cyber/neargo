// netlify/functions/redeem.js
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SCANNER_KEY = process.env.SCANNER_KEY || ""; // isti kot v mailu/Checkerju

const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth:{ persistSession:false } });

export const handler = async (event) => {
  try {
    if (event.httpMethod === "OPTIONS") return { statusCode:204, headers:cors(), body:"" };
    if (event.httpMethod !== "POST")     return json({ ok:false, error:"Use POST" },405);

    // preveri “magic key” za skener
    const providedKey = event.headers["x-scanner-key"] || event.headers["X-Scanner-Key"];
    if (!SCANNER_KEY || providedKey !== SCANNER_KEY) {
      return json({ ok:false, error:"unauthorized_scanner" }, 401);
    }

    const body = JSON.parse(event.body || "{}");
    const token = String(body.token || "").trim();
    if (!token) return json({ ok:false, error:"missing_token" },400);

    // najdi ticket/kupon po tokenu
    const { data: row, error } = await supa
      .from("tickets")
      .select("id, type, status, display_benefit, customer_email, redeemed_at")
      .eq("token", token)
      .single();

    if (error || !row) return json({ ok:false, error:"not_found" },404);

    if (row.status === "REDEEMED") {
      return json({ ok:true, alreadyRedeemed:true, redeemed_at: row.redeemed_at, type:row.type, display_benefit:row.display_benefit, customer_email: row.customer_email });
    }

    // označi redeemed
    const now = new Date().toISOString();
    const { error: upErr } = await supa
      .from("tickets")
      .update({ status:"REDEEMED", redeemed_at: now })
      .eq("id", row.id);

    if (upErr) return json({ ok:false, error:"update_failed" },500);

    return json({
      ok:true,
      status:"REDEEMED",
      redeemed_at: now,
      type: row.type,
      display_benefit: row.display_benefit,
      customer_email: row.customer_email
    });
  } catch (e) {
    return json({ ok:false, error:String(e?.message||e) },200);
  }
};

function cors(){ return { "Access-Control-Allow-Origin":"*", "Access-Control-Allow-Methods":"POST,OPTIONS", "Access-Control-Allow-Headers":"content-type,x-scanner-key"}; }
function json(obj, status=200){ return { statusCode:status, headers:{ "content-type":"application/json", ...cors() }, body:JSON.stringify(obj) }; }

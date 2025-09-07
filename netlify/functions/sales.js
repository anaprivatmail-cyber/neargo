// netlify/functions/sales.js
// Hiter pregled: prodano & unovčeno
import { createClient } from "@supabase/supabase-js";
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SCANNER_KEY = process.env.SCANNER_KEY || "";

const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth:{ persistSession:false } });

export const handler = async (event) => {
  try {
    if (event.httpMethod === "OPTIONS") return { statusCode:204, headers:cors(), body:"" };
    if (event.httpMethod !== "GET")     return json({ ok:false, error:"Use GET" },405);

    const providedKey = event.headers["x-scanner-key"] || event.headers["X-Scanner-Key"];
    if (!SCANNER_KEY || providedKey !== SCANNER_KEY) return json({ ok:false, error:"unauthorized_scanner" },401);

    const { count: sold }     = await supa.from("tickets").select("id", { count:"exact", head:true });
    const { count: redeemed } = await supa.from("tickets").select("id", { count:"exact", head:true }).eq("status","REDEEMED");

    return json({ ok:true, sold: sold || 0, redeemed: redeemed || 0 });
  } catch (e) {
    return json({ ok:false, error:String(e?.message||e) },200);
  }
};

function cors(){ return { "Access-Control-Allow-Origin":"*", "Access-Control-Allow-Methods":"GET,OPTIONS", "Access-Control-Allow-Headers":"x-scanner-key" }; }
function json(obj, status=200){ return { statusCode:status, headers:{ "content-type":"application/json", ...cors() }, body:JSON.stringify(obj) }; }

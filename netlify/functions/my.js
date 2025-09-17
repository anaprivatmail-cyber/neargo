// netlify/functions/my.js
// Vrne vstopnice/kupon po e-pošti kupca in pripne osnovne podatke o dogodku.

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL  = process.env.SUPABASE_URL;
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY; // Service role (samo na serverju!)
const supa = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,OPTIONS",
  "Access-Control-Allow-Headers": "content-type"
};
const ok  = (b)          => ({ statusCode: 200, headers: { "content-type":"application/json", ...CORS }, body: JSON.stringify(b) });
const bad = (m, s = 400) => ({ statusCode: s,   headers: { "content-type":"application/json", ...CORS }, body: JSON.stringify({ ok:false, error:m }) });

export const handler = async (event) => {
  try{
    if (event.httpMethod === "OPTIONS") return { statusCode:204, headers:CORS, body:"" };
    if (event.httpMethod !== "GET")     return bad("use_get", 405);

    const qs    = event.queryStringParameters || {};
    const email = (qs.email || "").trim();
    // Alternativa (če boš kdaj prešla na user-id):
    // const userId = (event.headers["x-user-id"] || "").trim();

    if (!email) return bad("missing_email");

    // 1) Tickets po e-pošti
    const { data: tickets, error } = await supa
      .from("tickets")
      .select("id,type,event_id,issued_at,token,customer_email")
      .eq("customer_email", email)
      .order("issued_at", { ascending:false });

    if (error) return bad("db_error: "+error.message, 500);
    if (!tickets?.length) return ok({ ok:true, items: [] });

    // 2) Basic info o dogodkih (slika, naslov, kje/kdaj)
    const eids = [...new Set(tickets.map(t => t.event_id).filter(Boolean))];
    let evMap = new Map();
    if (eids.length){
      const { data: evs, error: evErr } = await supa
        .from("events")
        .select("id,title,city,place,starts_at,start,image,url")
        .in("id", eids);
      if (evErr) return bad("events_error: "+evErr.message, 500);
      (evs || []).forEach(e => evMap.set(e.id, e));
    }

    // 3) Mapiranje v format za my.html
    const items = tickets.map(t => {
      const e = evMap.get(t.event_id) || {};
      return {
        id:    t.id,
        kind:  t.type === "coupon" ? "coupon" : "ticket",
        title: e.title || "Dogodek",
        date:  e.starts_at || e.start || t.issued_at || "",
        place: e.place || e.city || "",
        image: e.image || "",
        qr:    t.token ? `/r/${encodeURIComponent(t.token)}` : "",
        url:   e.url || ""
      };
    });

    return ok({ ok:true, items });
  }catch(e){
    return bad(String(e?.message || e), 500);
  }
};

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
    let email = (qs.email || "").trim();
    if (!email) {
      // Poskusi iz Authorization: Bearer <supabase access token>
      const auth = event.headers?.authorization || event.headers?.Authorization || "";
      const m = auth.match(/^Bearer\s+(.+)$/i);
      if (m) {
        try{
          const token = m[1];
          const { data, error } = await supa.auth.getUser(token);
          if (!error && data?.user?.email) email = data.user.email.trim();
        }catch{}
      }
    }
    if (!email) return bad("missing_email", 401);

    // Premium flag (active if premium_users has future premium_until or 'premium' ticket exists)
  let isPremium = false;
  let premiumUntil = null;
    try{
      const nowIso = new Date().toISOString();
      const { data: pu } = await supa.from('premium_users').select('email,premium_until').eq('email', email).maybeSingle();
      if (pu && pu.premium_until){
        premiumUntil = pu.premium_until;
        if (new Date(pu.premium_until).getTime() > Date.now()) isPremium = true;
      }
    }catch{}
    if (!isPremium){
      try{ const { count } = await supa.from('tickets').select('*',{head:true, count:'exact'}).eq('customer_email', email).eq('type','premium'); isPremium = (count||0) > 0; }catch{}
    }

    // 1) Tickets po e-pošti (brez kakršnihkoli 'demo' vnosov)
    const { data: tickets, error } = await supa
      .from("tickets")
      .select("id,type,event_id,issued_at,token,customer_email,status,redeemed_at,display_benefit")
      .eq("customer_email", email)
      .order("issued_at", { ascending:false });

    if (error) return bad("db_error: "+error.message, 500);
  if (!tickets?.length) return ok({ ok:true, items: [], premium: isPremium, premium_until: premiumUntil });

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
      const token = t.token || "";
      return {
        id:    t.id,
        kind:  t.type === "coupon" ? "coupon" : "ticket",
        title: e.title || "Dogodek",
        date:  e.starts_at || e.start || t.issued_at || "",
        place: e.place || e.city || "",
        image: e.image || "",
        qr:    token ? `/r/${encodeURIComponent(token)}` : "",
        code:  token, // <-- DODANO: številka QR kode (token) za prikaz v "Moje"
        url:   e.url || "",
        status: t.status || "issued",
        redeemed_at: t.redeemed_at || null,
        benefit: t.display_benefit || null
      };
    });

  return ok({ ok:true, items, premium: isPremium, premium_until: premiumUntil });
  }catch(e){
    return bad(String(e?.message || e), 500);
  }
};

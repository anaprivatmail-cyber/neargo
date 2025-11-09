// netlify/functions/scans-list.js
// Admin seznam skenov z osnovnimi podatki o dogodku in vstopnici.

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL  = process.env.SUPABASE_URL;
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY; // service role – samo na serverju
const supa = createClient(SUPABASE_URL, SERVICE_KEY, { auth:{ persistSession:false } });

const CORS = {
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Methods":"GET,OPTIONS",
  "Access-Control-Allow-Headers":"content-type"
};
const ok  = (b)=>({ statusCode:200, headers:{ "content-type":"application/json; charset=utf-8", ...CORS }, body:JSON.stringify(b) });
const bad = (m,s=400)=>({ statusCode:s, headers:{ "content-type":"application/json; charset=utf-8", ...CORS }, body:JSON.stringify({ ok:false, error:m }) });

export const handler = async (event) => {
  try{
    if (event.httpMethod === "OPTIONS") return { statusCode:204, headers:CORS, body:"" };
    if (event.httpMethod !== "GET")     return bad("use_get", 405);

    const qs = event.queryStringParameters || {};
    const eventId      = (qs.eventId || "").trim();
    const token        = (qs.token || "").trim();
    const scannerEmail = (qs.scannerEmail || "").trim();
    const fromIso      = (qs.from || "").trim();
    const toIso        = (qs.to   || "").trim();
    const limit        = Math.max(1, Math.min(2000, Number(qs.limit || 200)));

    // 1) Osnovni query na scans
    let q = supa.from("scans").select("id,ticket_id,event_id,token,scanned_at,scanner_email,scanner_key").order("scanned_at",{ ascending:false }).limit(limit);

    if (eventId)      q = q.eq("event_id", Number(eventId));
    if (token)        q = q.ilike("token", `%${token}%`);
    if (scannerEmail) q = q.ilike("scanner_email", `%${scannerEmail}%`);
    if (fromIso)      q = q.gte("scanned_at", fromIso);
    if (toIso)        q = q.lte("scanned_at", toIso);

    const { data: scans, error } = await q;
    if (error) return bad("db_error: "+error.message, 500);
    if (!scans?.length) return ok({ ok:true, items: [] });

    // 2) Dopolni z info iz tickets (type, customer_email)
    const ticketIds = [...new Set(scans.map(s => s.ticket_id).filter(Boolean))];
    let tmap = new Map();
    if (ticketIds.length){
      const { data: tix } = await supa.from("tickets").select("id,type,customer_email").in("id", ticketIds);
      (tix||[]).forEach(t => tmap.set(t.id, t));
    }

    // 3) Dopolni z info iz events (title, city) – po event_id
    const eventIds = [...new Set(scans.map(s => s.event_id).filter(Boolean))];
    let emap = new Map();
    if (eventIds.length){
      const { data: evs } = await supa.from("events").select("id,title,city").in("id", eventIds);
      (evs||[]).forEach(e => emap.set(e.id, e));
    }

    const items = scans.map(s => {
      const t = tmap.get(s.ticket_id) || {};
      const e = emap.get(s.event_id) || {};
      return {
        id: s.id,
        scanned_at: s.scanned_at,
        token: s.token,
        event_id: s.event_id,
        event_title: e.title || null,
        event_city: e.city || null,
        type: t.type || null,
        customer_email: t.customer_email || null,
        scanner_email: s.scanner_email || null
      };
    });

    return ok({ ok:true, items });
  }catch(e){
    return bad(String(e?.message || e), 500);
  }
};

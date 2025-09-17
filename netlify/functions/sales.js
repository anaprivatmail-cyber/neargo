// netlify/functions/sales.js
// Pregled prodaje/unovčitev z dvema načinoma dostopa:
// 1) Organizator: GET /.netlify/functions/sales?stats=<statsToken>
//    - stats token enolično določa dogodek; eventId se v tem načinu ignorira
// 2) Skener:      GET /.netlify/functions/sales?eventId=<uuid> z glavo x-scanner-key
//    - če eventId ni podan, vrnemo globalni povzetek za skenerja

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL              = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SCANNER_KEY               = process.env.SCANNER_KEY || "";

const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth:{ persistSession:false } });

export const handler = async (event) => {
  try {
    if (event.httpMethod === "OPTIONS") return { statusCode:204, headers:cors(), body:"" };
    if (event.httpMethod !== "GET")     return json({ ok:false, error:"Use GET" },405);

    const qs   = event.queryStringParameters || {};
    const statsToken = (qs.stats || "").trim();
    const eventIdQ   = (qs.eventId || "").trim() || null;

    // Headers v Netlify/Node so vedno lower-case
    const providedKey = event.headers["x-scanner-key"] || "";
    const scannerOk   = !!SCANNER_KEY && providedKey === SCANNER_KEY;

    let eventFilter = null;

    if (statsToken) {
      // Organizator prek stats tokena – enolično določa dogodek
      const { data: ev, error: evErr } = await supa
        .from("events")
        .select("id, title, city, start, stats_token")
        .eq("stats_token", statsToken)
        .single();

      if (evErr || !ev) return json({ ok:false, error:"invalid_stats_token" },401);

      eventFilter = { id: ev.id, meta: { title: ev.title, city: ev.city, start: ev.start } };

      // Če je bil hkrati podan eventId, ga ignoriramo (stats že določa event)
      // (Lahko bi tudi preverili ujemanje in vrnili napako; tukaj varno ignoriramo.)
    } else if (scannerOk) {
      // Skener z dovoljenjem
      if (eventIdQ) {
        const { data: ev } = await supa
          .from("events")
          .select("id, title, city, start")
          .eq("id", eventIdQ)
          .single();

        if (!ev) return json({ ok:false, error:"unknown_event" },404);

        eventFilter = { id: ev.id, meta: { title: ev.title, city: ev.city, start: ev.start } };
      } else {
        // Globalni povzetek za skenerja
        eventFilter = null;
      }
    } else {
      return json({ ok:false, error:"unauthorized" },401);
    }

    // Helper – condition za event
    const whereEvent = eventFilter?.id ? { column: "event_id", value: eventFilter.id } : null;

    // SOLD = issued + redeemed
    const sold = await countTickets(whereEvent, ["issued","ISSUED","redeemed","REDEEMED"]);

    // REDEEMED = redeemed
    const redeemed = await countTickets(whereEvent, ["redeemed","REDEEMED"]);

    // Zadnja prodaja (če stolpec created_at obstaja)
    const lastSale = await getLastSaleAt(whereEvent);

    // Po tipu (ticket/coupon), če obstaja stolpec type
    const byType = await breakdownByType(whereEvent);

    return json({
      ok:true,
      scope: eventFilter?.id ? "event" : "global",
      event: eventFilter?.meta || null,
      sold,
      redeemed,
      lastSale,
      byType
    });
  } catch (e) {
    return json({ ok:false, error:String(e?.message||e) },200);
  }
};

/* ===== Helpers ===== */
async function countTickets(whereEvent, allowedStatuses){
  let q = supa.from("tickets").select("id", { count:"exact", head:true });
  if (whereEvent) q = q.eq(whereEvent.column, whereEvent.value);
  if (allowedStatuses?.length) q = q.in("status", allowedStatuses);
  const { count } = await q;
  return count || 0;
}

async function getLastSaleAt(whereEvent){
  // Če nimaš created_at na tickets, vrni null
  let q = supa
    .from("tickets")
    .select("created_at", { head:false })
    .order("created_at", { ascending:false })
    .limit(1);

  if (whereEvent) q = q.eq(whereEvent.column, whereEvent.value);

  const { data, error } = await q;
  if (error || !data || !data.length || !data[0]?.created_at) return null;
  return data[0].created_at;
}

async function breakdownByType(whereEvent){
  try{
    // Preveri obstoj stolpca type
    let probe = supa.from("tickets").select("type", { head:false }).limit(1);
    if (whereEvent) probe = probe.eq(whereEvent.column, whereEvent.value);
    const { data: p } = await probe;
    if (!p || typeof p[0]?.type === "undefined") return {};

    const groups = {};
    for (const kind of ["ticket","coupon"]) {
      const sold = await countTicketsByType(whereEvent, ["issued","ISSUED","redeemed","REDEEMED"], kind);
      const redeemed = await countTicketsByType(whereEvent, ["redeemed","REDEEMED"], kind);
      groups[kind] = { sold, redeemed };
    }
    return groups;
  }catch{
    return {};
  }
}

async function countTicketsByType(whereEvent, allowedStatuses, typeVal){
  let q = supa.from("tickets").select("id", { count:"exact", head:true }).eq("type", typeVal);
  if (whereEvent) q = q.eq(whereEvent.column, whereEvent.value);
  if (allowedStatuses?.length) q = q.in("status", allowedStatuses);
  const { count } = await q;
  return count || 0;
}

/* ===== infra ===== */
function cors(){
  return {
    "Access-Control-Allow-Origin":"*",
    "Access-Control-Allow-Methods":"GET,OPTIONS",
    "Access-Control-Allow-Headers":"x-scanner-key, content-type"
  };
}
function json(obj, status=200){
  return {
    statusCode: status,
    headers: { "content-type":"application/json; charset=utf-8", ...cors() },
    body: JSON.stringify(obj)
  };
}

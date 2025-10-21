// netlify/functions/reserve-slot.js
import { createClient } from "@supabase/supabase-js";

export const handler = async (event) => {
  if (event.httpMethod !== "POST")
    return { statusCode: 405, body: "POST only" };

  const { eventId, slotId, qty = 1, email } = JSON.parse(event.body || "{}");
  if (!slotId) return { statusCode: 400, body: "Missing slotId" };

  const supa = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
  );

  const { data: slot, error: e1 } = await supa
    .from("service_slots")
    .select("id, capacity, reserved")
    .eq("id", slotId)
    .single();

  if (e1 || !slot)
    return { statusCode: 404, body: JSON.stringify({ ok: false, error: "Slot not found" }) };

  const now = new Date();
  const { data: held } = await supa
    .from("slot_holds")
    .select("qty")
    .eq("slot_id", slotId)
    .eq("status", "held")
    .gte("expires_at", now.toISOString());

  const totalHeld = (held || []).reduce((s, h) => s + (h.qty || 0), 0);
  const free = Math.max(0, (slot.capacity || 0) - (slot.reserved || 0) - totalHeld);
  if (qty > free)
    return {
      statusCode: 409,
      body: JSON.stringify({ ok: false, error: "no_capacity", free }),
    };

  const exp = new Date(Date.now() + 10 * 60 * 1000);
  const { data: ins, error: e2 } = await supa
    .from("slot_holds")
    .insert({
      event_id: eventId,
      slot_id: slotId,
      qty,
      email,
      expires_at: exp.toISOString(),
    })
    .select()
    .single();

  if (e2)
    return {
      statusCode: 500,
      body: JSON.stringify({ ok: false, error: e2.message }),
    };

  return {
    statusCode: 200,
    body: JSON.stringify({ ok: true, holdId: ins.id, expiresAt: ins.expires_at }),
  };
};

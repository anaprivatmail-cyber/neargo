// netlify/functions/service-slots-save.js
import { createClient } from "@supabase/supabase-js";

const supa = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

export const handler = async (event) => {
  if (event.httpMethod !== "POST")
    return { statusCode: 405, body: "POST only" };

  const { eventId, slots = [] } = JSON.parse(event.body || "{}");
  if (!eventId) return { statusCode: 400, body: "Missing eventId" };

  // zbriši stare in vstavi nove
  await supa.from("service_slots").delete().eq("event_id", eventId);

  if (Array.isArray(slots) && slots.length > 0) {
    const payload = slots.map((s) => ({
      event_id: eventId,
      start_ts: s.start,
      end_ts: s.end || null,
      capacity: s.quota || 1,
      reserved: 0,
    }));

    const { error } = await supa.from("service_slots").insert(payload);
    if (error)
      return {
        statusCode: 500,
        body: JSON.stringify({ ok: false, error: error.message }),
      };
  }

  return { statusCode: 200, body: JSON.stringify({ ok: true }) };
};

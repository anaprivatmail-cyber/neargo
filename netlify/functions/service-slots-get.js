// netlify/functions/service-slots-get.js
import { createClient } from "@supabase/supabase-js";

const supa = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

export const handler = async (event) => {
  const { eventId } = event.queryStringParameters || {};
  if (!eventId)
    return { statusCode: 400, body: JSON.stringify({ ok: false, error: "Missing eventId" }) };

  const { data, error } = await supa
    .from("service_slots")
    .select("*")
    .eq("event_id", eventId)
    .order("start_ts");

  if (error)
    return {
      statusCode: 500,
      body: JSON.stringify({ ok: false, error: error.message }),
    };

  return { statusCode: 200, body: JSON.stringify({ ok: true, results: data }) };
};

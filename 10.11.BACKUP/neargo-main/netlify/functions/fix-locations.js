// netlify/functions/fix-locations.js
import { createClient } from "@supabase/supabase-js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};
const json = (body, status = 200) => ({
  statusCode: status,
  headers: { "Content-Type": "application/json; charset=utf-8", ...CORS },
  body: JSON.stringify(body, null, 2)
});

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = "event-images";
const DIR = "submissions";

async function fetchLatLon(address) {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(address)}`;
  try {
    const r = await fetch(url);
    const d = await r.json();
    if (d && d[0]) return { lat: parseFloat(d[0].lat), lon: parseFloat(d[0].lon) };
  } catch (e) {
    console.warn("Napaka pri geokodiranju:", e);
  }
  return { lat: null, lon: null };
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: CORS, body: "" };

  const sb = createClient(SUPABASE_URL, SUPABASE_KEY);
  const { data: files, error } = await sb.storage.from(BUCKET).list(DIR);
  if (error) return json({ ok: false, error: error.message }, 500);

  const updated = [];
  for (const f of files) {
    if (!f.name.endsWith(".json")) continue;

    const { data, error: dlErr } = await sb.storage.from(BUCKET).download(`${DIR}/${f.name}`);
    if (dlErr) continue;

    const txt = await data.text();
    const obj = JSON.parse(txt);

    if (!obj.venueLat || !obj.venueLon) {
      const addr = [obj.venue, obj.city || obj.city2, obj.country].filter(Boolean).join(", ");
      const coords = await fetchLatLon(addr);
      if (coords.lat && coords.lon) {
        obj.venueLat = coords.lat;
        obj.venueLon = coords.lon;
        await sb.storage.from(BUCKET).upload(`${DIR}/${f.name}`, JSON.stringify(obj, null, 2), {
          contentType: "application/json",
          upsert: true
        });
        updated.push({ name: f.name, ...coords });
      }
    }
  }

  return json({
    ok: true,
    updatedCount: updated.length,
    updated
  });
};

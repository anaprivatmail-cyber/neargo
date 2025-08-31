// netlify/functions/prune-provider-events.js
exports.handler = async () => {
  try {
    const { createClient } = await import("@supabase/supabase-js");            // ADD
    const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY); // ADD (service role v Netlify vars)

    // izbriši samo provider (form) dogodke, ki so se že končali
    const nowIso = new Date().toISOString();
    const { error } = await supa
      .from("events")
      .delete()
      .lt("end", nowIso)
      .eq("source", "provider"); // predpostavka: provider zapise označujemo z source='provider'
    if (error) throw error;

    return { statusCode: 200, body: "ok" };
  } catch (e) {
    return { statusCode: 500, body: "prune error: " + e.message };
  }
};

// Netlify schedule (cron – vsako uro)
exports.config = { schedule: "0 * * * *" };

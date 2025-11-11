// netlify/functions/cron-purge.js
const { createClient } = require("@supabase/supabase-js");

exports.handler = async () => {
  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    const now = new Date().toISOString();

    // prilagodi ime tabele/polja 'submissions'/'end'
    const { error } = await supabase
      .from("submissions")
      .delete()
      .lt("end", now);

    if (error) throw error;

    return { statusCode: 200, body: "purged" };
  } catch (e) {
    return { statusCode: 500, body: String(e?.message || e) };
  }
};

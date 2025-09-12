// netlify/functions/redirect-qr.js
const { createClient } = require("@supabase/supabase-js");

exports.handler = async (event) => {
  try {
    const token = (event.queryStringParameters && event.queryStringParameters.token) || "";
    if (!token) return { statusCode: 400, body: "Missing token" };

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    const qrPath = `passes/qr/${token}.png`;

    const { data, error } = await supabase
      .storage.from("invoices")  // ali 'passes' če ga ločiš – nato posodobi tudi webhook
      .createSignedUrl(qrPath, 60 * 60 * 24 * 7);

    if (error || !data?.signedUrl) return { statusCode: 404, body: "Not found" };

    return { statusCode: 302, headers: { Location: data.signedUrl }, body: "" };
  } catch (e) {
    return { statusCode: 500, body: "Error" };
  }
};

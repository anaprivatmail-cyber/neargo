// netlify/functions/trigger-place-worker.js

export const handler = async (event, context) => {
  const FUNCTION_URL = process.env.SUPABASE_FUNCTION_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

  if (!FUNCTION_URL || !SUPABASE_ANON_KEY) {
    console.error("Missing env vars SUPABASE_FUNCTION_URL or SUPABASE_ANON_KEY");
    return {
      statusCode: 500,
      body: "Missing env vars",
    };
  }

  try {
    const res = await fetch(FUNCTION_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}), // lahko tudi kaj dodaš, če bi kdaj želela
    });

    const text = await res.text();
    console.log("Status:", res.status);
    console.log("Body:", text);

    return {
      statusCode: 200,
      body: `Called place-worker: ${res.status}`,
    };
  } catch (err) {
    console.error("Error calling place-worker:", err);
    return {
      statusCode: 500,
      body: "Error calling place-worker",
    };
  }
};

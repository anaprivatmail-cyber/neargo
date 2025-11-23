// netlify/functions/trigger-place-worker.js

export const handler = async () => {
  // ⚠️ Important: These are the ENV names for the SCRAPER project
  const FUNCTION_URL = process.env.SCRAPER_FUNCTION_URL;
  const SCRAPER_ANON_KEY = process.env.SCRAPER_ANON_KEY;

  if (!FUNCTION_URL || !SCRAPER_ANON_KEY) {
    console.error("Missing env vars SCRAPER_FUNCTION_URL or SCRAPER_ANON_KEY");
    return {
      statusCode: 500,
      body: "Missing env vars SCRAPER_FUNCTION_URL or SCRAPER_ANON_KEY",
    };
  }

  try {
    const res = await fetch(FUNCTION_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${SCRAPER_ANON_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    });

    const body = await res.text();

    console.log("HTTP Status:", res.status);
    console.log("Response:", body);

    return {
      statusCode: 200,
      body: `Triggered place-worker (Scraper). Supabase responded: ${res.status}`,
    };

  } catch (error) {
    console.error("Error calling Supabase place-worker:", error);
    return {
      statusCode: 500,
      body: "Error calling Supabase place-worker",
    };
  }
};

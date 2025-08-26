// netlify/functions/analytics.js
export const handler = async (event) => {
  // CORS
  const CORS = {
    'Access-Control-Allow-Origin':'*',
    'Access-Control-Allow-Headers':'Content-Type',
    'Access-Control-Allow-Methods':'POST,OPTIONS'
  };
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS, body: '' };
  }
  try {
    const body = JSON.parse(event.body || '{}');
    // Shranimo v Netlify Blobs (brez nameščanja paketov)
    const { put } = await import("@netlify/blobs");
    const key = `events/${Date.now()}-${Math.random().toString(36).slice(2)}.json`;
    await put(key, JSON.stringify({
      ...body,
      ip: event.headers["x-nf-client-connection-ip"] || null
    }), { contentType: "application/json", dataType: "json", blob: "analytics" });

    return {
      statusCode: 200,
      headers: { 'Content-Type':'application/json', ...CORS },
      body: JSON.stringify({ ok:true })
    };
  } catch (e) {
    return {
      statusCode: 200,
      headers: { 'Content-Type':'application/json', ...CORS },
      body: JSON.stringify({ ok:false, error: e.message || 'error' })
    };
  }
};

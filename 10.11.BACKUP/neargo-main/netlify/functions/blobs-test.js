// /netlify/functions/blobs-test.js
import { getStore } from "@netlify/blobs";

const store = getStore("neargo"); // poljubno ime "store"-a

export const handler = async (event) => {
  // CORS
  if (event.httpMethod === "OPTIONS") return resp(204, "");
  const path = event.queryStringParameters?.path || "demo/test.json";

  try {
    if (event.httpMethod === "POST") {
      // zapiši / posodobi
      const body = event.body || "{}";
      await store.set(path, body, { contentType: "application/json" });
      return resp(200, JSON.stringify({ ok: true, action: "write", path }));
    }

    if (event.httpMethod === "GET") {
      // preberi ali izpiši seznam
      const list = event.queryStringParameters?.list;
      if (list === "1") {
        const items = await store.list({ prefix: path.replace(/\/[^/]*$/, "/") });
        return resp(200, JSON.stringify({ ok: true, action: "list", prefix: path, items }));
      }
      const blob = await store.get(path); // vrne Blob ali null
      if (!blob) return resp(404, JSON.stringify({ ok: false, error: "not_found", path }));
      const text = await blob.text();
      return resp(200, JSON.stringify({ ok: true, action: "read", path, data: safeJson(text) }));
    }

    if (event.httpMethod === "DELETE") {
      await store.delete(path);
      return resp(200, JSON.stringify({ ok: true, action: "delete", path }));
    }

    return resp(405, "Method Not Allowed");
  } catch (e) {
    console.error(e);
    return resp(500, JSON.stringify({ ok: false, error: String(e?.message || e) }));
  }
};

function resp(code, body) {
  return {
    statusCode: code,
    headers: {
      "content-type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS"
    },
    body
  };
}
function safeJson(s) { try { return JSON.parse(s); } catch { return s; } }

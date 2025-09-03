// /netlify/functions/blobs-test.js
import { createBlob, getBlob, listBlobs, deleteBlob } from "@netlify/blobs";

export const handler = async (event) => {
  // CORS (da lahko kličeš iz brskalnika)
  if (event.httpMethod === "OPTIONS") return resp(204, "");
  const path = event.queryStringParameters?.path || "demo/test.json";

  try {
    if (event.httpMethod === "POST") {
      // Zapišemo/posodobimo blob
      const body = event.body || "{}";
      await createBlob({
        name: path,                 // "imenik/datoteka"
        data: body,                 // lahko je string, Buffer ali Readable
        contentType: "application/json",
        metadata: { sample: "true" } // poljubno
      });
      return resp(200, JSON.stringify({ ok: true, action: "write", path }));
    }

    if (event.httpMethod === "GET") {
      // Preberemo blob ali listing
      const list = event.queryStringParameters?.list;
      if (list === "1") {
        const items = await listBlobs({ prefix: path.replace(/\/[^/]*$/, "/") }); // seznam v "imeniku"
        return resp(200, JSON.stringify({ ok: true, action: "list", prefix: path, items }));
      }
      const blob = await getBlob(path);
      if (!blob) return resp(404, JSON.stringify({ ok: false, error: "not_found", path }));
      const text = await blob.text();
      return resp(200, JSON.stringify({ ok: true, action: "read", path, data: safeJson(text) }));
    }

    if (event.httpMethod === "DELETE") {
      await deleteBlob(path);
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

// /netlify/functions/get-coupon.js
import { getStore } from "@netlify/blobs";
import { parseToken, qrDataUrl, json } from "./utils.js";

function makeStore() {
  const siteID = process.env.BLOBS_SITE_ID;
  const token  = process.env.BLOBS_TOKEN;
  if (!siteID || !token) throw new Error("Missing BLOBS_SITE_ID or BLOBS_TOKEN");
  return getStore({ name: "entitlements", siteID, token });
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return json(204, {});
  const token = event.queryStringParameters?.token || "";

  const parsed = parseToken(token, process.env.QR_SECRET || "");
  if (!parsed.ok) return json(400, { ok:false, error:"invalid_token", reason: parsed.reason });

  const store = makeStore();
  const blob = await store.get(`entitlements/${token}.json`);
  if (!blob) return json(404, { ok:false, error:"not_found" });

  const data = JSON.parse(await blob.text());
  const qr = await qrDataUrl(token);

  return json(200, {
    ok: true,
    token,
    qr,
    status: data.status,
    issuedAt: data.issuedAt,
    redeemedAt: data.redeemedAt,
    eventId: data.eventId,
    coupon: data.coupon
  });
};

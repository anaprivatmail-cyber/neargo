// /netlify/functions/redeem.js
import { getStore } from "@netlify/blobs";
import { parseToken, json } from "./utils.js";

function makeStore() {
  const siteID = process.env.BLOBS_SITE_ID;
  const token  = process.env.BLOBS_TOKEN;
  if (!siteID || !token) throw new Error("Missing BLOBS_SITE_ID or BLOBS_TOKEN");
  return getStore({ name: "entitlements", siteID, token });
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return json(204, {});
  if (event.httpMethod !== "POST")     return json(405, { error: "Use POST" });

  // avtentikacija skenerja
  const providedKey = event.headers["x-scanner-key"] || event.headers["X-Scanner-Key"];
  if (!process.env.SCANNER_KEY || providedKey !== process.env.SCANNER_KEY) {
    return json(401, { ok:false, error:"unauthorized_scanner" });
  }

  const { token, eventId } = JSON.parse(event.body || "{}");
  if (!token || !eventId) return json(400, { ok:false, error:"Required: token, eventId" });

  const parsed = parseToken(token, process.env.QR_SECRET || "");
  if (!parsed.ok) return json(400, { ok:false, error:"invalid_token", reason: parsed.reason });

  const store = makeStore();
  const path = `entitlements/${token}.json`;
  const blob = await store.get(path);
  if (!blob) return json(404, { ok:false, error:"not_found" });

  const data = JSON.parse(await blob.text());

  // preveri pravilen dogodek
  if (String(data.eventId) !== String(eventId)) {
    return json(409, { ok:false, error:"wrong_event", forEvent: data.eventId });
  }

  // preveri veljavnost (če je določena)
  if (data?.coupon?.validTo && new Date(data.coupon.validTo) < new Date()) {
    return json(409, { ok:false, error:"expired" });
  }

  // idempotentno – že vnovčeno
  if (data.status === "REDEEMED") {
    return json(200, { ok:true, alreadyRedeemed:true, redeemedAt: data.redeemedAt });
  }

  data.status = "REDEEMED";
  data.redeemedAt = new Date().toISOString();
  await store.set(path, JSON.stringify(data), { contentType: "application/json" });

  return json(200, { ok:true, status: data.status, redeemedAt: data.redeemedAt });
};

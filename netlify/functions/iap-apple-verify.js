// netlify/functions/iap-apple-verify.js  (ESM)
import { createClient } from "@supabase/supabase-js";

/**
 * iOS IAP verifikacija (legacy, a še vedno podprta) prek Apple /verifyReceipt.
 * Uporabimo "shared secret" (APPLE_SHARED_SECRET).
 *
 * Pričakovani JSON body iz iOS appa:
 * {
 *   "receiptData": "<base64>",
 *   "productId": "premium.monthly",          // opcijsko, pomaga pri logiki
 *   "originalTransactionId": "1234567890",   // opcijsko, lepše vezano na uporabnika
 *   "email": "user@example.com",             // če imaš e-pošto uporabnika (drugače user_id)
 *   "userId": "<uuid | app id>"              // opcijsko, če ne želiš e-pošte
 * }
 *
 * Odgovor:
 * { ok: true, premium: true, valid_until: "...", auto_renew: true }
 */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST,OPTIONS"
};
const json = (d, s = 200) => ({
  statusCode: s,
  headers: { "Content-Type": "application/json; charset=utf-8", ...CORS },
  body: JSON.stringify(d)
});

const SUPABASE_URL  = process.env.SUPABASE_URL;
const SUPABASE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY; // service role (potrebujemo write)
const APPLE_SHARED_SECRET = process.env.APPLE_SHARED_SECRET; // App Store Connect -> App-Specific Shared Secret

const supa = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession:false } });

const APPLE_VERIFY_PROD = "https://buy.itunes.apple.com/verifyReceipt";
const APPLE_VERIFY_SANDBOX = "https://sandbox.itunes.apple.com/verifyReceipt";

// Helper: v Apple receiptih je datum v ms (string)
const msToIso = (ms) => new Date(Number(ms||0)).toISOString();

function pickLatestActive(lines = [], productId = null){
  // Apple vrača vrstice (latest_receipt_info). Vzamemo NAJVEČJI expires_date_ms,
  // po možnosti za isti productId, sicer najpoznejšega.
  const arr = (lines||[]).slice().sort((a,b)=> Number(b.expires_date_ms||0) - Number(a.expires_date_ms||0));
  if (!arr.length) return null;
  if (productId) {
    const same = arr.find(r => String(r.product_id||"") === String(productId));
    if (same) return same;
  }
  return arr[0];
}

export const handler = async (event) => {
  try{
    if (event.httpMethod === "OPTIONS") return { statusCode:200, headers:CORS, body:"" };
    if (event.httpMethod !== "POST")   return json({ ok:false, error:"Method Not Allowed" }, 405);

    if (!SUPABASE_URL || !SUPABASE_KEY || !APPLE_SHARED_SECRET) {
      return json({ ok:false, error:"Manjka SUPABASE_URL/SERVICE_ROLE_KEY ali APPLE_SHARED_SECRET" }, 500);
    }

    let body;
    try { body = JSON.parse(event.body||"{}"); }
    catch { return json({ ok:false, error:"Neveljaven JSON" }, 400); }

    const receiptData = String(body.receiptData||"").trim();
    if (!receiptData) return json({ ok:false, error:"Manjka 'receiptData' (base64)" }, 400);

    const productId = body.productId ? String(body.productId) : null;
    const email     = body.email ? String(body.email).trim() : null;
    const userId    = body.userId ? String(body.userId).trim() : null;

    // 1) Pošlji v production verifyReceipt
    async function verifyAt(url){
      const r = await fetch(url, {
        method:"POST",
        headers:{ "Content-Type":"application/json" },
        body: JSON.stringify({
          "receipt-data": receiptData,
          "password": APPLE_SHARED_SECRET,     // app specific shared secret
          "exclude-old-transactions": true
        })
      });
      const j = await r.json();
      return j;
    }

    let res = await verifyAt(APPLE_VERIFY_PROD);

    // 21007 = sandbox receipt poslan na prod -> preusmeri v sandbox
    if (res?.status === 21007) {
      res = await verifyAt(APPLE_VERIFY_SANDBOX);
    }

    if (!res || typeof res.status === "undefined") {
      return json({ ok:false, error:"Nepričakovan odgovor Apple" }, 502);
    }
    if (res.status !== 0) {
      // status != 0 pomeni napako ali neveljavno
      return json({ ok:false, error:`Apple verifyReceipt status=${res.status}` }, 400);
    }

    // 2) Izluščimo zadnjo aktivno naročnino (latest_receipt_info)
    const latestLines = res.latest_receipt_info || [];
    const latest = pickLatestActive(latestLines, productId);

    if (!latest) {
      // Ni zapisa o naročnini
      return json({ ok:false, premium:false, error:"Ni aktivnega zapisa v latest_receipt_info" }, 200);
    }

    const expiresMs = Number(latest.expires_date_ms||0);
    const validUntil = expiresMs ? msToIso(expiresMs) : null;
    const isActive = expiresMs > Date.now();

    // auto_renew_status pride v pending_renewal_info (polje)
    const pending = Array.isArray(res.pending_renewal_info) ? res.pending_renewal_info[0] : null;
    const autoRenew = pending ? (String(pending.auto_renew_status||"0")==="1") : true;

    // original_transaction_id = stabilen ID naročnine v Apple svetu
    const originalTxn = latest.original_transaction_id || body.originalTransactionId || null;

    // 3) Zapišemo v "subscriptions" (platform = 'apple')
    try{
      await supa.from("subscriptions").upsert({
        email: email || null,
        user_id: userId || null,
        platform: "apple",
        provider_sub_id: originalTxn,         // to je tvoj ključ za to naročnino
        product_id: latest.product_id || productId || null,
        status: isActive ? "active" : "expired",
        current_period_end: validUntil,
        auto_renew: !!autoRenew,
        updated_at: new Date().toISOString()
      }, { onConflict: "provider_sub_id" });
    }catch(e){
      console.error("[iap-apple-verify] upsert subscriptions error:", e?.message||e);
      // ne ustavimo odgovora; vrnemo premium status, a z opozorilom
    }

    return json({
      ok:true,
      premium: isActive,
      valid_until: validUntil,
      auto_renew: !!autoRenew,
      platform: "apple"
    });

  }catch(e){
    console.error("[iap-apple-verify] fatal:", e?.message||e);
    return json({ ok:false, error:e?.message||"Server error" }, 500);
  }
};

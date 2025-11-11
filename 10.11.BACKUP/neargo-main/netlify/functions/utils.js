// /netlify/functions/utils.js
import crypto from "crypto";
import QRCode from "qrcode";

const b64url = (buf) =>
  buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/,"");
const fromB64url = (str) =>
  Buffer.from(str.replace(/-/g, "+").replace(/_/g, "/"), "base64");

/** Ustvari podpisan token: NG1.<data>.<sig>  (HMAC-SHA256, 16B podpis) */
export function makeToken(secret) {
  const id = crypto.randomBytes(16);   // id kupona
  const nonce = crypto.randomBytes(12);
  const data = Buffer.concat([id, nonce]); // 28B
  const sig = crypto.createHmac("sha256", secret).update(data).digest().subarray(0, 16);
  return "NG1." + b64url(data) + "." + b64url(sig);
}

/** Preveri podpis in vrne idHex (UUID-ju podobna oblika) */
export function parseToken(token, secret) {
  if (!token || !token.startsWith("NG1.")) return { ok:false, reason:"bad_prefix" };
  const parts = token.split(".");
  if (parts.length !== 3) return { ok:false, reason:"bad_format" };
  const data = fromB64url(parts[1]);
  const sig  = fromB64url(parts[2]);
  const exp  = crypto.createHmac("sha256", secret).update(data).digest().subarray(0,16);
  if (sig.length !== exp.length || !crypto.timingSafeEqual(sig, exp)) {
    return { ok:false, reason:"sig_fail" };
  }
  const hex = data.subarray(0,16).toString("hex");
  const idHex =
    `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
  return { ok:true, idHex };
}

export async function qrDataUrl(str) {
  return QRCode.toDataURL(str, { errorCorrectionLevel: "M", margin: 1 });
}

export function json(status, obj) {
  return {
    statusCode: status,
    headers: {
      "content-type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "POST, GET, OPTIONS"
    },
    body: JSON.stringify(obj)
  };
}

// /netlify/functions/issue-coupon.js
import { getStore } from "@netlify/blobs";
import nodemailer from "nodemailer";
import { makeToken, qrDataUrl, json } from "./utils.js";

function makeStore() {
  const siteID = process.env.BLOBS_SITE_ID;
  const token  = process.env.BLOBS_TOKEN;
  if (!siteID || !token) throw new Error("Missing BLOBS_SITE_ID or BLOBS_TOKEN");
  return getStore({ name: "entitlements", siteID, token });
}

const requiredEnv = [
  "QR_SECRET", "SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "EMAIL_FROM"
];

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return json(204, {});
  if (event.httpMethod !== "POST")     return json(405, { error: "Use POST" });

  const missing = requiredEnv.filter(k => !process.env[k]);
  if (missing.length) return json(500, { ok:false, error:"Missing env: "+missing.join(", ") });

  try {
    const body = JSON.parse(event.body || "{}");
    const {
      buyerEmail,    // kam pošljemo kupon
      title,         // naslov kupona (npr. "-20% na pijačo")
      kind,          // "PERCENT" | "VALUE" | "FREEBIE"
      percentOff,    // če kind=PERCENT
      valueEur,      // če kind=VALUE
      freebieLabel,  // če kind=FREEBIE
      eventId,       // id dogodka
      validTo        // ISO datum, opcijsko
    } = body;

    if (!buyerEmail || !title || !kind || !eventId) {
      return json(400, { ok:false, error:"Required: buyerEmail, title, kind, eventId" });
    }

    // 1) ustvari podpisan token
    const token = makeToken(process.env.QR_SECRET);

    // 2) shrani v Blobs
    const store = makeStore();
    const now = new Date().toISOString();
    const record = {
      token,
      status: "ISSUED",
      issuedAt: now,
      redeemedAt: null,
      eventId,
      coupon: { title, kind, percentOff, valueEur, freebieLabel, validTo: validTo || null }
    };
    await store.set(`entitlements/${token}.json`, JSON.stringify(record), {
      contentType: "application/json"
    });

    // 3) e-pošta z QR + linkom
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT),
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
    });

    const base = process.env.PUBLIC_BASE_URL || `https://${event.headers.host}`;
    const viewUrl = `${base}/coupon.html?token=${encodeURIComponent(token)}`;
    const dataUrl = await qrDataUrl(token);

    const html = `
      <div style="font-family:Arial,sans-serif;font-size:16px;color:#222;background:#f9f9f9;padding:24px;border-radius:8px;max-width:420px;margin:auto;">
        <div style="text-align:center;margin-bottom:16px;">
          <img src='https://getneargo.com/assets/icons/other.svg' alt='NearGo' style='height:48px;'>
          <h2 style="margin:8px 0 0 0;font-size:1.5em;color:#2a7be4;">NearGo</h2>
        </div>
        <p style="margin:0 0 8px;font-size:1.1em;color:#222;">Prejeli ste kupon:</p>
        <div style="font-size:1.2em;font-weight:bold;letter-spacing:1px;margin:8px 0 16px 0;color:#2a7be4;">${escapeHtml(title)}</div>
        <p style="margin:0 0 10px">Skenirajte QR kodo na mestu vnovčitve ali odprite <a href="${viewUrl}" style="color:#2a7be4;text-decoration:underline;">${viewUrl}</a>.</p>
        <img alt="QR" src="${dataUrl}" style="width:220px;height:220px;display:block;margin:10px auto 16px auto;border:0"/>
        <div style="font:12px/1.4 monospace;color:#666;text-align:center;margin-bottom:12px;">${token}</div>
        <hr style="margin:24px 0;border:none;border-top:1px solid #eee;">
        <small style="color:#888;">Ekipa NearGo – Hvala za zaupanje!<br>Za pomoč ali vprašanja pišite na <a href='mailto:info@getneargo.com' style='color:#2a7be4;'>info@getneargo.com</a></small>
      </div>
    `;

    await transporter.sendMail({
      from: process.env.EMAIL_FROM,
      to: buyerEmail,
      subject: "NearGo – vaš kupon",
      html
    });

    return json(200, { ok:true, token, viewUrl });
  } catch (e) {
    console.error(e);
    return json(500, { ok:false, error: String(e?.message || e) });
  }
};

function escapeHtml(s=""){ return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

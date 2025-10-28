// netlify/functions/issue-coupon.js  (ESM)
import { createClient } from "@supabase/supabase-js";
import QRCode from "qrcode";
import * as Brevo from "@getbrevo/brevo";
import crypto from "node:crypto";

const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession:false } });

const brevoApi = new Brevo.TransactionalEmailsApi();
if (process.env.BREVO_API_KEY) {
  brevoApi.setApiKey(Brevo.TransactionalEmailsApiApiKeys.apiKey, process.env.BREVO_API_KEY);
}
const EMAIL_FROM = process.env.EMAIL_FROM || "NearGo <info@getneargo.com>";
const FROM_EMAIL = (EMAIL_FROM.match(/<([^>]+)>/) || [null, EMAIL_FROM])[1];
const FROM_NAME  = EMAIL_FROM.replace(/\s*<[^>]+>\s*$/, "") || "NearGo";
const SUPPORT_EMAIL  = process.env.SUPPORT_EMAIL || "info@getneargo.com";
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || process.env.SITE_URL || "https://getneargo.com").replace(/\/$/,"");

function escapeHtml(s){ return String(s||"").replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

export const handler = async (event) => {
  try{
    if (event.httpMethod === "OPTIONS") return { statusCode:204, headers:{ "access-control-allow-origin": "*"}, body:"" };
    if (event.httpMethod !== "POST") return { statusCode:405, body:"Method Not Allowed" };

    const body = JSON.parse(event.body || "{}");
    const md   = body.metadata || {};
    if ((md.type||"") !== "coupon") {
      return { statusCode:400, body: JSON.stringify({ ok:false, error:"type must be coupon" }) };
    }

    // izlušči ključne podatke
    const eventId    = md.event_id || null;
    const eventTitle = md.event_title || "Ponudba";
    const display    = md.display_benefit || "";
    const imageUrl   = md.image_url || null;
    const venueText  = (md.event_venue || "").toString();
    const startIso   = (md.slot_start || md.event_start_iso || "").toString();

    // email kupca – če ga ne dobiš iz FE, ga lahko dodaš v prijavi
    const customerEmail = body.email || md.customer_email || null;
    if (!customerEmail) return { statusCode:400, body: JSON.stringify({ ok:false, error:"Missing customer email" }) };

    // pripravi token + QR
    const token = (crypto.randomUUID && crypto.randomUUID()) || crypto.randomBytes(16).toString("hex");
    const redeemUrl = `${PUBLIC_BASE_URL}/r/${token}`;
    const qrPngBuffer = await QRCode.toBuffer(redeemUrl, { type:"png", margin:1, width:512 });

    // vstavi v tickets (0 EUR, issued)
    const nowIso = new Date().toISOString();
    const { error: insErr } = await supa.from("tickets").insert({
      event_id: eventId,
      type: "coupon",
      display_benefit: display,
      benefit_type: md.benefit_type || null,
      benefit_value: md.benefit_value || null,
      freebie_text:  md.freebie_text  || null,
      token,
      status: "issued",
      issued_at: nowIso,
      created_at: nowIso,
      customer_email: customerEmail,
      stripe_checkout_session_id: null,
      stripe_payment_intent_id: null
    });
    if (insErr) return { statusCode:500, body: JSON.stringify({ ok:false, error: insErr.message }) };

    // e-mail s QR (brez PDF računa)
    if (process.env.BREVO_API_KEY) {
      const logoTargetSvg = `
        <svg width="36" height="36" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
          <circle cx="16" cy="16" r="13" fill="none" stroke="#0b1b2b" stroke-width="2"/>
          <circle cx="16" cy="16" r="8"  fill="none" stroke="#0b1b2b" stroke-width="2" opacity="0.9"/>
          <circle cx="16" cy="16" r="3.2" fill="#0b1b2b"/>
        </svg>`;

      const whenText = startIso ? new Date(startIso).toLocaleString() : "";
      const html = `
        <div style="font-family:Arial,Helvetica,sans-serif;background:#f6fbfe;padding:0;margin:0">
          <div style="max-width:680px;margin:0 auto;border:1px solid #e3eef7;border-radius:14px;overflow:hidden;background:#fff">
            <div style="padding:14px 18px;display:flex;align-items:center;gap:10px;border-bottom:1px solid #e3eef7;background:#fff">
              <div>${logoTargetSvg}</div>
              <div style="font-weight:900;font-size:20px;letter-spacing:.2px;color:#0b1b2b">NearGo</div>
            </div>
            <div style="padding:20px 22px;color:#0b1b2b">
              <h2 style="margin:0 0 12px 0;font-size:20px;line-height:1.35">Kupon – potrditev</h2>
              <div style="border:1px solid #e3eef7;border-radius:12px;padding:12px 14px;margin:10px 0;background:#f9fcff">
                <div style="margin:2px 0"><b>Ponudba:</b> ${escapeHtml(eventTitle)}</div>
                ${ venueText ? `<div style="margin:2px 0"><b>Lokacija:</b> ${escapeHtml(venueText)}</div>` : '' }
                ${ whenText  ? `<div style="margin:2px 0"><b>Termin:</b> ${escapeHtml(whenText)}</div>` : '' }
              </div>
              ${ imageUrl ? `<img src="${imageUrl}" alt="" width="100%" style="max-height:240px;object-fit:cover;border-radius:12px;border:1px solid #e3eef7;margin:8px 0 14px">` : "" }
              <div style="border:1px solid #cfe1ee;border-radius:12px;padding:14px 16px;margin:12px 0;background:#fff">
                <div style="margin:2px 0"><b>Vrednost kupona:</b> ${escapeHtml(display || 'ugodnost')}</div>
                <div style="margin:6px 0 0"><span style="opacity:.75">Cena kupona:</span> <b style="font-size:16px">0,00 EUR</b></div>
              </div>
              <p style="margin:12px 0">
                QR koda kupona je priložena (<i>qr.png</i>). <br>
                <b>Kupon je shranjen tudi v razdelku “Moje” v aplikaciji NearGo.</b><br>
                <span style="opacity:.8">Št. kode:</span> <code style="font-weight:700">${escapeHtml(token)}</code>
              </p>
              <div style="margin:18px 0 4px;color:#5b6b7b;font-size:13px">
                Vprašanja? <a href="mailto:${SUPPORT_EMAIL}" style="color:#0bbbd6;font-weight:800">${SUPPORT_EMAIL}</a>
              </div>
            </div>
          </div>
        </div>`;

      try{
        const email = new Brevo.SendSmtpEmail();
        email.sender      = { email: FROM_EMAIL, name: FROM_NAME };
        email.to          = [{ email: customerEmail }];
        email.subject     = "Kupon – potrdilo";
        email.htmlContent = html;
        email.attachment  = [{ name: "qr.png", content: qrPngBuffer.toString("base64") }];
        await brevoApi.sendTransacEmail(email);
      }catch(e){
        console.error("[issue-coupon] email error:", e?.message || e);
      }
    }

    return { statusCode:200, body: JSON.stringify({ ok:true, token }) };
  }catch(e){
    console.error("[issue-coupon] fatal:", e?.message || e);
    return { statusCode:500, body: JSON.stringify({ ok:false, error: e?.message || "server error" }) };
  }
};

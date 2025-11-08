// netlify/functions/stripe-webhook.js  (ESM)
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import QRCode from "qrcode";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import * as Brevo from "@getbrevo/brevo";
import fs from "fs";
import path from "path";
import crypto from "node:crypto";

// ——— ENV ————————————————————————————————————————————————————————————————
const STRIPE_SECRET_KEY     = process.env.STRIPE_SECRET_KEY;
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

const SUPABASE_URL         = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || process.env.SITE_URL || "https://getneargo.com").replace(/\/$/,"");
const SUPPORT_EMAIL   = process.env.SUPPORT_EMAIL || "info@getneargo.com";
const EMAIL_FROM      = process.env.EMAIL_FROM || "NearGo <info@getneargo.com>";

const COMPANY = {
  name:  process.env.INVOICE_COMPANY_NAME  || "NearGo d.o.o.",
  addr:  process.env.INVOICE_COMPANY_ADDR  || "",
  taxId: process.env.INVOICE_COMPANY_TAX_ID|| "",
  reg:   process.env.INVOICE_COMPANY_REG   || "",
  iban:  process.env.INVOICE_COMPANY_IBAN  || "",
  swift: process.env.INVOICE_COMPANY_SWIFT || ""
};
const COMPANY_REGISTER_INFO = process.env.COMPANY_REGISTER_INFO || "";
const COMPANY_SHARE_CAPITAL = process.env.COMPANY_SHARE_CAPITAL || "";

// robustno branje DDV
const TAX_RATE = (() => {
  const raw = (process.env.INVOICE_TAX_RATE ?? "22").toString().replace(",", ".");
  const n = parseFloat(raw.replace(/[^0-9.]+/g, ""));
  return Number.isFinite(n) ? n : 22;
})();
const CURRENCY = (process.env.INVOICE_CURRENCY || "eur").toLowerCase();

const FONTS_DIR     = path.join(process.cwd(), "netlify", "functions", "fonts");
const FONT_REG_TTF  = path.join(FONTS_DIR, "NotoSans-Regular.ttf");
const FONT_BOLD_TTF = path.join(FONTS_DIR, "NotoSans-Bold.ttf");

const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });
const supa   = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession:false } });

const brevoApi = new Brevo.TransactionalEmailsApi();
if (process.env.BREVO_API_KEY) {
  brevoApi.setApiKey(Brevo.TransactionalEmailsApiApiKeys.apiKey, process.env.BREVO_API_KEY);
}
const FROM_EMAIL = (EMAIL_FROM.match(/<([^>]+)>/) || [null, EMAIL_FROM])[1];
const FROM_NAME  = EMAIL_FROM.replace(/\s*<[^>]+>\s*$/, "") || "NearGo";

// ——— helperji ——————————————————————————————————————————————————————————————
function cors() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "POST,OPTIONS",
    "access-control-allow-headers": "content-type",
  };
}
function escapeHtml(s){
  return String(s||"").replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function summarizeBenefit({ benefitType, benefitValue, freebieText }) {
  if (benefitType === "percent" && benefitValue) return `${benefitValue}% popusta`;
  if (benefitType === "amount"  && benefitValue) return `${Number(benefitValue).toFixed(2)} € vrednost`;
  if (benefitType === "freebie" && freebieText) return `Brezplačno: ${freebieText}`;
  return "";
}
// RPC atomarno številčenje računov
async function nextInvoiceNo() {
  const year = new Date().getFullYear();
  await supa.from("invoice_counters").upsert({ year, last_no: 0 }, { onConflict: "year" });
  const { data, error } = await supa.rpc("increment_invoice_counter", { y: year });
  if (error) throw error;
  return { seq: `${year}-${String(data).padStart(6,"0")}`, year };
}

// ——— PDF ——————————————————————————————————————————————————————————————
async function createInvoicePdf({ seqNo, buyer, totalGross, base, tax, paidAt, sessionId, type }) {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);

  const regBytes  = fs.existsSync(FONT_REG_TTF)  ? fs.readFileSync(FONT_REG_TTF)  : null;
  const boldBytes = fs.existsSync(FONT_BOLD_TTF) ? fs.readFileSync(FONT_BOLD_TTF) : null;

  const fontReg  = regBytes  ? await pdf.embedFont(regBytes,  { subset:true }) : null;
  const fontBold = boldBytes ? await pdf.embedFont(boldBytes, { subset:true }) : null;

  const F_REG  = fontReg  || await pdf.embedFont(StandardFonts.Helvetica);
  const F_BOLD = fontBold || F_REG;

  const page = pdf.addPage([595.28, 841.89]);
  const { height } = page.getSize();
  let y = height - 48;

  const line = (txt, size=11, f=F_REG, color=rgb(0,0,0))=>{
    page.drawText(String(txt ?? ""), { x:40, y, size, font:f, color });
    y -= (size + 6);
  };

  line(COMPANY.name, 14, F_BOLD, rgb(0,0.25,0.45));
  if (COMPANY.addr)  line(COMPANY.addr);
  if (COMPANY.taxId) line(`DDV ID: ${COMPANY.taxId}`);
  if (COMPANY.reg)   line(COMPANY.reg);

  y -= 8;
  line(`Datum: ${new Date(paidAt).toLocaleString()}`);
  line(`Št. računa: ${seqNo}`);
  y -= 12;

  line(`Kupec: ${buyer.name || buyer.email || ""}`, 12, F_BOLD);
  line(`${buyer.email || ""}`, 11, F_REG);
  y -= 6;

  line("Obračun:", 12, F_BOLD);
  line(`Osnova: ${(base/100).toFixed(2)} ${CURRENCY.toUpperCase()}`);
  line(`DDV (${TAX_RATE}%): ${(tax/100).toFixed(2)} ${CURRENCY.toUpperCase()}`);
  line(`SKUPAJ: ${(totalGross/100).toFixed(2)} ${CURRENCY.toUpperCase()}`, 13, F_BOLD, rgb(0,0.45,0.25));

  y -= 10;
  if (COMPANY.iban)  line(`IBAN: ${COMPANY.iban}`);
  if (COMPANY.swift) line(`SWIFT/BIC: ${COMPANY.swift}`);

  y -= 10;
  line("Račun PLAČAN.", 11, F_BOLD, rgb(0,0.45,0.25));

  y -= 8;
  line(`Stripe session: ${sessionId}`, 9, F_REG, rgb(0,0,0));

  if (COMPANY_REGISTER_INFO || COMPANY_SHARE_CAPITAL) {
    y -= 14;
    if (COMPANY_REGISTER_INFO) line(COMPANY_REGISTER_INFO, 9, F_REG, rgb(0,0,0));
    if (COMPANY_SHARE_CAPITAL) line(COMPANY_SHARE_CAPITAL, 9, F_REG, rgb(0,0,0));
  }

  if (type === "coupon") {
    y -= 14;
    line("Opomba: kupon stane 2 €; njegova vrednost (popust, znesek ali gratis)", 9, F_REG, rgb(0,0,0));
    line("se unovči pri organizatorju in ni zamenljiva za denar.", 9, F_REG, rgb(0,0,0));
  }

  return await pdf.save();
}

// ——— MAIN HANDLER ————————————————————————————————————————————————————
export const handler = async (event) => {
  try {
    if (event.httpMethod === "OPTIONS") return { statusCode:204, headers:cors(), body:"" };
    if (event.httpMethod !== "POST")   return { statusCode:405, headers:cors(), body:"Method Not Allowed" };
    if (!event.body || !event.headers["stripe-signature"])
      return { statusCode:400, headers:cors(), body:"Missing signature/body" };

    let stripeEvent;
    try {
      stripeEvent = stripe.webhooks.constructEvent(
        event.body,
        event.headers["stripe-signature"],
        STRIPE_WEBHOOK_SECRET
      );
    } catch (e) {
      console.error("[webhook] signature error:", e.message);
      return { statusCode:200, headers:cors(), body: JSON.stringify({ received:true }) };
    }

    if (stripeEvent.type !== "checkout.session.completed") {
      return { statusCode:200, headers:cors(), body: JSON.stringify({ ok:true, ignored: stripeEvent.type }) };
    }

    const s  = stripeEvent.data.object;
    const md = s.metadata || {};

  const purchaseType   = (md.type || "").toString();
  const type           = (purchaseType === "coupon") ? "coupon" : (purchaseType === "premium" ? "premium" : "ticket");
    const eventId        = md.event_id || null;
    const eventTitle     = md.event_title || "Dogodek";
    const displayBenefit = md.display_benefit || null;
    const benefitType    = md.benefit_type || null;
    const benefitValue   = md.benefit_value || null;
    const freebieText    = md.freebie_text  || null;
    const imageUrl       = md.image_url     || null;
    const venueText      = (md.event_venue || "").toString();
    const startIso       = (md.event_start_iso || "").toString();
    const customerEmail  = (s.customer_details && s.customer_details.email) || s.customer_email || null;

    const token     = (crypto.randomUUID && crypto.randomUUID()) || crypto.randomBytes(16).toString("hex");
    const redeemUrl = `${PUBLIC_BASE_URL}/r/${token}`; // ostane za QR in PDF, ni linka v mailu
    const qrPngBuffer = await QRCode.toBuffer(redeemUrl, { type:"png", margin:1, width:512 });

    const display_benefit_final = displayBenefit || summarizeBenefit({benefitType,benefitValue,freebieText});

    const mailIntro = type === 'coupon'
      ? `Kupili ste kupon za: ${eventTitle}`
      : (type === 'premium' ? `Kupili ste NearGo Premium` : `Kupili ste vstopnico za: ${eventTitle}`);
    const subject = type === 'coupon' ? 'Kupon – potrdilo' : (type === 'premium' ? 'Premium – potrdilo' : 'Vstopnica – potrdilo');

    // vnos v tickets (z created_at za analitiko)
    const nowIso = new Date().toISOString();
    const { error: insErr } = await supa.from("tickets").insert({
      event_id: eventId,
      type,
      display_benefit: display_benefit_final,
      benefit_type: benefitType,
      benefit_value: benefitValue,
      freebie_text: freebieText,
      stripe_checkout_session_id: s.id,
      stripe_payment_intent_id: s.payment_intent,
      token,
      status: "issued",
      issued_at: nowIso,
      created_at: nowIso,
      customer_email: customerEmail
    });
    if (insErr) {
      console.error("[webhook] insert tickets error:", insErr);
      return { statusCode:200, headers:cors(), body: JSON.stringify({ received:true, db:"error" }) };
    }

  const totalGross = Number(type === "coupon" ? 200 : (s.amount_total || 0));
    const base = Math.round(totalGross / (1 + TAX_RATE/100));
    const tax  = totalGross - base;

    const paidAt = nowIso;
    const { seq, year } = await nextInvoiceNo();

    let pdfBytes;
    try {
      pdfBytes = await createInvoicePdf({
        seqNo: seq,
        buyer: { name:"", email:customerEmail },
        totalGross, base, tax,
        paidAt, sessionId: s.id,
        type
      });
    } catch (e) {
      console.error("[webhook] fatal while creating PDF:", e?.message || e);
      return { statusCode:200, headers:cors(), body: JSON.stringify({ received:true, pdf:"error" }) };
    }

    const pdfPath = `invoices/${year}/${seq}.pdf`;
    try {
      await supa.storage.from("invoices").upload(pdfPath, pdfBytes, { contentType: "application/pdf", upsert: true });
    } catch (e) {
      console.error("[webhook] upload invoice error:", e?.message || e);
    }

    try {
      const qrPath = `passes/qr/${token}.png`;
      await supa.storage.from("invoices").upload(qrPath, qrPngBuffer, { contentType: "image/png", upsert: true });
    } catch (e) {
      console.error("[webhook] upload QR error:", e?.message || e);
    }

    const { data: signed } = await supa.storage.from("invoices").createSignedUrl(pdfPath, 60*60*24*30);
    const pdfUrl = signed?.signedUrl || null;

    await supa.from("invoices").insert({
      seq_no: seq, year,
      customer_email: customerEmail,
      items: [{ name: type==="coupon" ? `Kupon: ${eventTitle}` : (type==="premium" ? `Premium NearGo` : `Vstopnica: ${eventTitle}`), qty:1, unit_price: totalGross }],
      currency: CURRENCY,
      subtotal: base, tax_rate: TAX_RATE, tax_amount: tax, total: totalGross,
      paid_at: paidAt,
      stripe_session_id: s.id,
      stripe_payment_intent: s.payment_intent,
      event_id: eventId,
      type,
      pdf_url: pdfUrl
    });

    // Premium purchase: grant premium access (default 1 year)
    if (type === 'premium' && customerEmail) {
      try {
        const until = new Date();
        // assume yearly premium for now
        until.setUTCFullYear(until.getUTCFullYear() + 1);
        await supa.from('premium_users').upsert(
          { email: customerEmail, premium_until: until.toISOString(), updated_at: new Date().toISOString() },
          { onConflict: 'email' }
        );
      } catch (e) {
        console.error('[webhook] premium upsert failed:', e?.message || e);
      }
    }

    // ——— EMAIL (profil: bel header + črn napis + tarča) ———
    if (process.env.BREVO_API_KEY && customerEmail) {
      const logoTargetSvg = `
        <svg width="36" height="36" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
          <circle cx="16" cy="16" r="13" fill="none" stroke="#0b1b2b" stroke-width="2"/>
          <circle cx="16" cy="16" r="8"  fill="none" stroke="#0b1b2b" stroke-width="2" opacity="0.9"/>
          <circle cx="16" cy="16" r="3.2" fill="#0b1b2b"/>
        </svg>`;
      const benefitPretty = display_benefit_final;
      const whenText  = startIso ? new Date(startIso).toLocaleString() : "";
      const imgInMail = imageUrl || null;

      // LABEL za znesek: za kupon -> "Cena kupona", sicer "Skupaj"
  const priceLabel = (type === 'coupon') ? 'Cena kupona' : (type === 'premium' ? 'Cena naročnine' : 'Skupaj');
      // LABEL za prikaz ugodnosti kupona
      const benefitLabel = (type === 'coupon') ? 'Vrednost kupona' : 'Vstopnica';

      const html = `
        <div style="font-family:Arial,Helvetica,sans-serif;background:#f6fbfe;padding:0;margin:0">
          <div style="max-width:680px;margin:0 auto;border:1px solid #e3eef7;border-radius:14px;overflow:hidden;background:#fff">

            <!-- Bel header, črn napis + tarča -->
            <div style="padding:14px 18px;display:flex;align-items:center;gap:10px;border-bottom:1px solid #e3eef7;background:#fff">
              <div>${logoTargetSvg}</div>
              <div style="font-weight:900;font-size:20px;letter-spacing:.2px;color:#0b1b2b">NearGo</div>
            </div>

            <div style="padding:20px 22px;color:#0b1b2b">
              <h2 style="margin:0 0 12px 0;font-size:20px;line-height:1.35">${escapeHtml(mailIntro)}</h2>

              ${(venueText || whenText) ? `
                <div style="border:1px solid #e3eef7;border-radius:12px;padding:12px 14px;margin:10px 0;background:#f9fcff">
                  ${ venueText ? `<div style="margin:2px 0"><b>Lokacija:</b> ${escapeHtml(venueText)}</div>` : '' }
                  ${ whenText  ? `<div style="margin:2px 0"><b>Termin:</b> ${escapeHtml(whenText)}</div>` : '' }
                </div>` : ''}

              ${ imgInMail ? `<img src="${imgInMail}" alt="" width="100%" style="max-height:240px;object-fit:cover;border-radius:12px;border:1px solid #e3eef7;margin:8px 0 14px">` : "" }

              <div style="border:1px solid #cfe1ee;border-radius:12px;padding:14px 16px;margin:12px 0;background:#fff">
                ${ type==="premium"
                  ? `<div style="font-weight:900;margin-bottom:6px">NearGo Premium</div><div style="margin:2px 0">Naročnina: <b>1×</b></div>`
                  : `<div style="font-weight:900;margin-bottom:6px">${escapeHtml(eventTitle)}</div><div style="margin:2px 0">${ type==="coupon" ? `${benefitLabel}: <b>${escapeHtml(benefitPretty || 'ugodnost')}</b>` : 'Vstopnica: <b>1×</b>' }</div>` }
                <div style="margin:6px 0 0"><span style="opacity:.75">${priceLabel}:</span>
                  <b style="font-size:18px">${(totalGross/100).toFixed(2)} ${CURRENCY.toUpperCase()}</b>
                </div>
              </div>

              <p style="margin:12px 0">
                ${type==="coupon" ? "QR koda kupona" : "QR koda vstopnice"} je priložena (<i>qr.png</i>), račun pa kot PDF (<i>Racun-${seq}.pdf</i>).
                <br><b>Vstopnica/kupon je shranjena tudi v razdelku “Moje” v aplikaciji NearGo.</b>
                <br><span style="opacity:.8">Št. kode:</span> <code style="font-weight:700">${escapeHtml(token)}</code>
              </p>

              <div style="margin:18px 0 4px;color:#5b6b7b;font-size:13px">
                Vprašanja? <a href="mailto:${SUPPORT_EMAIL}" style="color:#0bbbd6;font-weight:800">${SUPPORT_EMAIL}</a>
              </div>
            </div>
          </div>
        </div>`;

      try {
        const email = new Brevo.SendSmtpEmail();
        email.sender      = { email: FROM_EMAIL, name: FROM_NAME };
        email.to          = [{ email: customerEmail }];
        email.subject     = subject;
        email.htmlContent = html;
        email.attachment  = [
          { name: "qr.png",           content: qrPngBuffer.toString("base64") },
          { name: `Racun-${seq}.pdf`, content: Buffer.from(pdfBytes).toString("base64") }
        ];
        await brevoApi.sendTransacEmail(email);
      } catch (mailErr) {
        console.error("[webhook] Brevo send error:", mailErr?.message || mailErr);
      }
    }

    return { statusCode:200, headers:cors(), body: JSON.stringify({ ok:true }) };

  } catch (e) {
    console.error("[webhook] fatal:", e?.message || e);
    return { statusCode:200, headers:cors(), body: JSON.stringify({ received:true }) };
  }
};

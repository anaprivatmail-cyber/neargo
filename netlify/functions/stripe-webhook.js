// netlify/functions/stripe-webhook.js
// Produkcija: ob checkout.session.completed zapiše ticket, izda račun (PDF + storage),
// pošlje kupcu e-pošto (QR + račun) in vedno vrne 200 OK Stripe-u.

import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import QRCode from "qrcode";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import * as Brevo from "@getbrevo/brevo";
import crypto from "node:crypto";

/* ===== ENV ===== */
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
const TAX_RATE = Number(process.env.INVOICE_TAX_RATE || 22);   // %
const CURRENCY = (process.env.INVOICE_CURRENCY || "eur").toLowerCase();

/* ===== Clients ===== */
const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });
const supa   = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const brevo  = new Brevo.TransactionalEmailsApi();
if (process.env.BREVO_API_KEY) {
  brevo.setApiKey(Brevo.TransactionalEmailsApiApiKeys.apiKey, process.env.BREVO_API_KEY);
}
const FROM_EMAIL = (EMAIL_FROM.match(/<([^>]+)>/u) || [null, EMAIL_FROM])[1];
const FROM_NAME  = EMAIL_FROM.replace(/\s*<[^>]+>\s*$/u, "") || "NearGo";

/* ===== Helpers ===== */
const cors = () => ({
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST,OPTIONS",
  "access-control-allow-headers": "content-type",
});

const cryptoUUID = () =>
  (crypto.randomUUID?.() ??
    (() => {
      const b = crypto.randomBytes(16);
      b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
      const h = [...b].map(x => x.toString(16).padStart(2,"0")).join("");
      return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
    })()
  );

function summarizeBenefit({ benefitType, benefitValue, freebieText }) {
  if (benefitType === "percent" && benefitValue) return `${benefitValue}% popusta`;
  if (benefitType === "amount"  && benefitValue) return `${Number(benefitValue).toFixed(2)} € vrednost`;
  if (benefitType === "freebie" && freebieText) return `Brezplačno: ${freebieText}`;
  return "Kupon";
}
const escapeHtml = s => String(s||"").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));

/* Zaporedna številka računa */
async function nextInvoiceNo() {
  const year = new Date().getFullYear();
  await supa.from("invoice_counters").upsert({ year, last_no: 0 }, { onConflict: "year" });
  const { data, error } = await supa.rpc("increment_invoice_counter", { y: year });
  if (error) throw error;
  const n = data;
  return { seq: `${year}-${String(n).padStart(6,"0")}`, year, n };
}

/* PDF račun */
async function createInvoicePdf({ seqNo, buyer, items, subtotal, taxRate, taxAmount, total, paidAt, sessionId }) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595.28, 841.89]); // A4
  const { height } = page.getSize();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  let y = height - 48;
  const line = (txt, size=11, f=font, color=rgb(0,0,0)) => {
    page.drawText(String(txt), { x: 40, y, size, font: f, color }); y -= size + 6;
  };

  line(COMPANY.name, 14, bold, rgb(0,0.25,0.45));
  if (COMPANY.addr)  line(COMPANY.addr);
  if (COMPANY.taxId) line(`DDV ID: ${COMPANY.taxId}`);
  if (COMPANY.reg)   line(COMPANY.reg);
  y -= 8;
  line(`Datum: ${new Date(paidAt).toLocaleString()}`);
  line(`Št. računa: ${seqNo}`);
  y -= 12;

  line(`Kupec: ${buyer.name || buyer.email}`, 12, bold);
  line(`${buyer.email}`); y -= 4;

  line("Postavke:", 12, bold);
  items.forEach(it => line(`• ${it.name} × ${it.qty} – ${(it.unit_price/100).toFixed(2)} ${CURRENCY.toUpperCase()}`));
  y -= 6;

  line(`Osnova: ${(subtotal/100).toFixed(2)} ${CURRENCY.toUpperCase()}`, 11, bold);
  line(`DDV (${taxRate}%): ${(taxAmount/100).toFixed(2)} ${CURRENCY.toUpperCase()}`, 11, bold);
  line(`SKUPAJ: ${(total/100).toFixed(2)} ${CURRENCY.toUpperCase()}`, 13, bold, rgb(0,0.45,0.25));
  y -= 10;
  if (COMPANY.iban)  line(`IBAN: ${COMPANY.iban}`);
  if (COMPANY.swift) line(`SWIFT/BIC: ${COMPANY.swift}`);
  y -= 8; line(`Stripe session: ${sessionId}`, 9, font, rgb(0.4,0.4,0.4));

  const bytes = await pdf.save();
  return bytes;
}

/* ===== Handler ===== */
export const handler = async (event) => {
  try {
    if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: cors(), body: "" };
    if (event.httpMethod !== "POST")   return { statusCode: 405, headers: cors(), body: "Method Not Allowed" };
    if (!event.body || !event.headers["stripe-signature"])
      return { statusCode: 400, headers: cors(), body: "Missing signature/body" };

    // Preveri Stripe podpis
    let stripeEvent;
    try {
      stripeEvent = stripe.webhooks.constructEvent(
        event.body,
        event.headers["stripe-signature"],
        STRIPE_WEBHOOK_SECRET
      );
    } catch (e) {
      console.error("[webhook] signature error:", e.message);
      // vedno vrnemo 200, da Stripe ne bombarda ponovno
      return { statusCode: 200, headers: cors(), body: JSON.stringify({ received: true }) };
    }

    if (stripeEvent.type !== "checkout.session.completed") {
      return { statusCode: 200, headers: cors(), body: JSON.stringify({ ok:true, ignored: stripeEvent.type }) };
    }

    const s  = stripeEvent.data.object; // Checkout Session
    const md = s.metadata || {};

    const type           = (md.type === "coupon") ? "coupon" : "ticket";
    const eventId        = md.event_id || null;
    const eventTitle     = md.event_title || "Dogodek";
    const displayBenefit = md.display_benefit || null;
    const benefitType    = md.benefit_type || null;
    const benefitValue   = md.benefit_value || null;
    const freebieText    = md.freebie_text  || null;

    // Robustno poberi e-pošto kupca
    const customerEmail =
      s.customer_details?.email ||
      s.customer_email ||
      s.customer?.email ||
      md.customer_email || md.buyer_email || null;

    // QR token + URL
    const token = cryptoUUID();
    const redeemUrl = `${PUBLIC_BASE_URL}/r/${token}`;
    const qrPngBuffer = await QRCode.toBuffer(redeemUrl, { type: "png", margin: 1, width: 512 });

    /* ==== 1) Zapiši ticket ==== */
    const { data: ticketIns, error: ticketErr } = await supa
      .from("tickets")
      .insert({
        event_id: eventId,
        type,
        display_benefit: displayBenefit,
        benefit_type: benefitType,
        benefit_value: benefitValue,
        freebie_text: freebieText,
        stripe_checkout_session_id: s.id,
        stripe_payment_intent_id: s.payment_intent,
        token,
        status: "issued",
        issued_at: new Date().toISOString(),
        customer_email: customerEmail
      })
      .select("id")
      .single();

    if (ticketErr) {
      console.error("[webhook] Supabase insert tickets error:", ticketErr);
      return { statusCode: 200, headers: cors(), body: JSON.stringify({ received: true, db: "error" }) };
    }

    /* ==== 2) Izdaj račun (PDF + storage + DB) ==== */
    const paidAt    = new Date().toISOString();
    const unitCents = (type === "coupon") ? 200 : (s.amount_total || 0);
    const items     = [{ name: type === "coupon" ? `Kupon: ${eventTitle}` : `Vstopnica: ${eventTitle}`, qty: 1, unit_price: unitCents }];
    const subtotal  = items.reduce((a,b)=>a + b.unit_price*b.qty, 0);
    const taxAmount = Math.round(subtotal * (TAX_RATE/100));
    const total     = subtotal + taxAmount;

    const { seq, year } = await nextInvoiceNo();
    const pdfBytes = await createInvoicePdf({
      seqNo: seq,
      buyer: { name: "", email: customerEmail },
      items, subtotal, taxRate: TAX_RATE, taxAmount, total,
      paidAt, sessionId: s.id
    });

    const pdfPath = `invoices/${year}/${seq}.pdf`;
    try {
      await supa.storage.from("invoices").upload(pdfPath, pdfBytes, { contentType: "application/pdf", upsert: true });
    } catch (upErr) {
      console.error("[webhook] upload invoice error:", upErr?.message || upErr);
    }
    const { data: signed } = await supa.storage.from("invoices").createSignedUrl(pdfPath, 60*60*24*30);
    const pdfUrl = signed?.signedUrl || null;

    const { error: invErr } = await supa.from("invoices").insert({
      seq_no: seq, year,
      customer_email: customerEmail,
      items,
      currency: CURRENCY,
      subtotal, tax_rate: TAX_RATE, tax_amount: taxAmount, total,
      paid_at: paidAt,
      stripe_session_id: s.id,
      stripe_payment_intent: s.payment_intent,
      event_id: eventId,
      type,
      pdf_url: pdfUrl
    });
    if (invErr) console.error("[webhook] insert invoices error:", invErr?.message || invErr);

    /* ==== 3) E-pošta kupcu (zahvala + QR + račun) ==== */
    if (process.env.BREVO_API_KEY && customerEmail) {
      try {
        const primary = "#0bbbd6";
        const logoUrl = `${PUBLIC_BASE_URL}/icon-192.png`;
        const benefitPretty = displayBenefit || summarizeBenefit({ benefitType, benefitValue, freebieText });

        const html = `
          <div style="font-family:Inter,system-ui,Segoe UI,Roboto,Arial,sans-serif;max-width:680px;margin:auto;border:1px solid #e3eef7;border-radius:12px;overflow:hidden">
            <div style="background:${primary};padding:16px 20px;color:#fff;display:flex;align-items:center;gap:12px">
              <img src="${logoUrl}" width="32" height="32" alt="NearGo" style="border-radius:8px;border:1px solid rgba(255,255,255,.35)">
              <div style="font-weight:900;letter-spacing:.3px">NearGo</div>
            </div>
            <div style="padding:18px 20px;color:#0b1b2b">
              <p style="margin:0 0 10px">Hvala za nakup!</p>
              <div style="border:1px solid #cfe1ee;border-radius:10px;padding:12px 14px;margin:10px 0;background:#fff">
                <div><b>${escapeHtml(eventTitle)}</b></div>
                <div>${type==="coupon" ? `Kupon: <b>${escapeHtml(benefitPretty)}</b>` : `Vstopnica: <b>1×</b>`}</div>
              </div>
              <p style="margin:12px 0 6px">Tvoja ${type==="coupon"?"<b>QR koda kupona</b>":"<b>QR koda vstopnice</b>"} je v priponki (<i>qr.png</i>).</p>
              <p style="margin:0 0 6px">Račun <b>${seq}</b> (PDF) je priložen.</p>
              <p style="margin:16px 0 0;color:#5b6b7b;font-size:13px">Vprašanja? <a href="mailto:${SUPPORT_EMAIL}" style="color:${primary};font-weight:800">${SUPPORT_EMAIL}</a></p>
            </div>
          </div>`;

        const email = new Brevo.SendSmtpEmail();
        email.sender      = { email: FROM_EMAIL, name: FROM_NAME };
        email.to          = [{ email: customerEmail }];
        email.subject     = `Hvala za nakup – ${type === "coupon" ? "Kupon" : "Vstopnica"}`;
        email.htmlContent = html;
        email.attachment  = [
          { name: "qr.png",        content: qrPngBuffer.toString("base64") },
          { name: `Racun-${seq}.pdf`, content: Buffer.from(pdfBytes).toString("base64") }
        ];
        await brevo.sendTransacEmail(email);
      } catch (mailErr) {
        console.error("[webhook] Brevo send error:", mailErr?.message || mailErr);
      }
    }

    // Zaključi
    return { statusCode: 200, headers: cors(), body: JSON.stringify({ ok: true, id: ticketIns?.id || null }) };

  } catch (e) {
    console.error("[webhook] fatal:", e?.message || e);
    // vedno 200 za Stripe (da ne retry-a neskončno)
    return { statusCode: 200, headers: cors(), body: JSON.stringify({ received: true }) };
  }
};

// netlify/functions/stripe-webhook.js
// Stripe webhook: po uspešnem plačilu izdamo kupon/vstopnico, generiramo QR, izdamo račun (PDF),
// shranimo v Supabase in pošljemo e-mail kupcu z računom in QR kodo.
// Zahteva pakete: stripe, @supabase/supabase-js, qrcode, pdf-lib, @getbrevo/brevo

const Stripe = require("stripe");
const { createClient } = require("@supabase/supabase-js");
const QRCode = require("qrcode");
const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");
const Brevo = require("@getbrevo/brevo");
const crypto = require("node:crypto");

// --- ENV ---
const STRIPE_SECRET_KEY     = process.env.STRIPE_SECRET_KEY;
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

const SUPABASE_URL          = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;

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
const TAX_RATE = Number(process.env.INVOICE_TAX_RATE || 22);       // v %
const CURRENCY = (process.env.INVOICE_CURRENCY || "eur").toLowerCase();

const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });
const supa   = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

// Brevo
const brevoApi = new Brevo.TransactionalEmailsApi();
if (process.env.BREVO_API_KEY) {
  brevoApi.setApiKey(Brevo.TransactionalEmailsApiApiKeys.apiKey, process.env.BREVO_API_KEY);
}
const FROM_EMAIL = (EMAIL_FROM.match(/<([^>]+)>/) || [null, EMAIL_FROM])[1];
const FROM_NAME  = EMAIL_FROM.replace(/\s*<[^>]+>\s*$/, "") || "NearGo";

// --- Helpers ---
function cors() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "POST,OPTIONS",
    "access-control-allow-headers": "content-type"
  };
}
function cryptoUUID() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.randomBytes(16);
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map(x=>x.toString(16).padStart(2,"0")).join("");
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}
function summarizeBenefit({ benefitType, benefitValue, freebieText }) {
  if (benefitType === "percent" && benefitValue) return `${benefitValue}% popusta`;
  if (benefitType === "amount"  && benefitValue) return `${Number(benefitValue).toFixed(2)} € vrednost`;
  if (benefitType === "freebie" && freebieText) return `Brezplačno: ${freebieText}`;
  return "Kupon";
}
function escapeHtml(s){ return String(s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

// zaporedna številka računa
async function nextInvoiceNo() {
  const year = new Date().getFullYear();
  await supa.from("invoice_counters").upsert({ year, last_no: 0 }, { onConflict: "year" });
  const { data, error } = await supa.rpc("increment_invoice_counter", { y: year });
  if (error) throw error;
  const n = data;
  return { seq: `${year}-${String(n).padStart(6,"0")}`, year, n };
}

// naredi PDF račun
async function createInvoicePdf({ seqNo, buyer, items, subtotal, taxRate, taxAmount, total, paidAt, sessionId }) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595.28, 841.89]);
  const { height } = page.getSize();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  let y = height - 48;
  const line = (txt, size=11, f=font, color=rgb(0,0,0))=>{
    page.drawText(txt, { x: 40, y, size, font: f, color }); y -= size+6;
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
  line(`${buyer.email}`);
  y -= 4;

  line("Postavke:", 12, bold);
  items.forEach(it=>{
    line(`• ${it.name} × ${it.qty} – ${(it.unit_price/100).toFixed(2)} ${CURRENCY.toUpperCase()}`);
  });
  y -= 6;

  line(`Osnova: ${(subtotal/100).toFixed(2)} ${CURRENCY.toUpperCase()}`, 11, bold);
  line(`DDV (${taxRate}%): ${(taxAmount/100).toFixed(2)} ${CURRENCY.toUpperCase()}`, 11, bold);
  line(`SKUPAJ: ${(total/100).toFixed(2)} ${CURRENCY.toUpperCase()}`, 13, bold, rgb(0,0.45,0.25));
  y -= 10;

  if (COMPANY.iban) line(`IBAN: ${COMPANY.iban}`);
  if (COMPANY.swift) line(`SWIFT/BIC: ${COMPANY.swift}`);

  y -= 8; line(`Stripe session: ${sessionId}`, 9, font, rgb(0.4,0.4,0.4));
  const bytes = await pdf.save();
  return bytes;
}

// --- Handler ---
exports.handler = async (event) => {
  try {
    if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: cors(), body: "" };
    if (event.httpMethod !== "POST")   return { statusCode: 405, headers: cors(), body: "Method Not Allowed" };
    if (!event.body || !event.headers["stripe-signature"])
      return { statusCode: 400, headers: cors(), body: "Missing signature/body" };

    let stripeEvent;
    try {
      stripeEvent = stripe.webhooks.constructEvent(
        event.body, event.headers["stripe-signature"], STRIPE_WEBHOOK_SECRET
      );
    } catch (e) {
      console.error("Stripe signature error:", e.message);
      return { statusCode: 200, headers: cors(), body: JSON.stringify({ received: true }) };
    }

    if (stripeEvent.type !== "checkout.session.completed") {
      return { statusCode: 200, headers: cors(), body: JSON.stringify({ ok:true, ignored: stripeEvent.type }) };
    }

    const s  = stripeEvent.data.object;
    const md = s.metadata || {};

    const type           = md.type === "coupon" ? "coupon" : "ticket";
    const eventId        = md.event_id || null;
    const eventTitle     = md.event_title || "Dogodek";
    const displayBenefit = md.display_benefit || null;
    const benefitType    = md.benefit_type || null;
    const benefitValue   = md.benefit_value || null;
    const freebieText    = md.freebie_text  || null;
    const customerEmail  = (s.customer_details && s.customer_details.email) || s.customer_email || null;

    // Token + QR
    const token = cryptoUUID();
    const redeemUrl = `${PUBLIC_BASE_URL}/r/${token}`;
    const qrPngBuffer = await QRCode.toBuffer(redeemUrl, { type: "png", margin: 1, width: 512 });
    const qrBase64    = qrPngBuffer.toString("base64");

    // Shrani ticket/kupon
    const { data: ticket, error: insErr } = await supa
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

    if (insErr) {
      console.error("Supabase insert error:", insErr);
      return { statusCode: 200, headers: cors(), body: JSON.stringify({ received: true, db: "error" }) };
    }

    // ------- Račun -------
    const paidAt   = new Date().toISOString();
    const unitCents = (type === "coupon") ? 200 : (s.amount_total || 0);
    const items = [
      { name: type === "coupon" ? `Kupon: ${eventTitle}` : `Vstopnica: ${eventTitle}`, qty: 1, unit_price: unitCents }
    ];
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
    const { error: upErr } = await supa.storage.from("invoices").upload(pdfPath, pdfBytes, {
      contentType: "application/pdf", upsert: true
    });
    if (upErr) console.error("Upload invoice error:", upErr);

    const { data: signed } = await supa.storage.from("invoices").createSignedUrl(pdfPath, 60*60*24*30);
    const pdfUrl = signed?.signedUrl || null;

    await supa.from("invoices").insert({
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

    // ------- Email kupcu -------
    if (process.env.BREVO_API_KEY && customerEmail) {
      const html = `
        <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#0b1b2b">
          <h2>Hvala za nakup v NearGo</h2>
          <p>Uspešno ste kupili ${type === "coupon" ? "kupon" : "vstopnico"} za: <b>${escapeHtml(eventTitle)}</b>.</p>
          ${ type === "coupon"
              ? `<p>Ugodnost kupona: ${escapeHtml(displayBenefit || summarizeBenefit({benefitType,benefitValue,freebieText}))}.</p>`
              : `` }
          <p>QR kodo prilagamo v priponki (<b>qr.png</b>).<br>Račun <b>${seq}</b> je priložen kot PDF.</p>
          <p>Če imate vprašanja, pišite na <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>.</p>
        </div>`;

      const emailPayload = new Brevo.SendSmtpEmail();
      emailPayload.sender      = { email: FROM_EMAIL, name: FROM_NAME };
      emailPayload.to          = [{ email: customerEmail }];
      emailPayload.subject     = `Hvala za nakup – ${type === "coupon" ? "Kupon" : "Vstopnica"}`;
      emailPayload.htmlContent = html;
      emailPayload.attachment  = [
        { name: "qr.png", content: qrPngBuffer.toString("base64") },
        { name: `Racun-${seq}.pdf`, content: Buffer.from(pdfBytes).toString("base64") }
      ];

      try { await brevoApi.sendTransacEmail(emailPayload); }
      catch (mailErr) { console.error("Brevo send error:", mailErr?.message || mailErr); }
    }

    return { statusCode: 200, headers: cors(), body: JSON.stringify({ ok: true, id: ticket?.id || null }) };

  } catch (e) {
    console.error("Webhook handler error:", e);
    return { statusCode: 200, headers: cors(), body: JSON.stringify({ received: true }) };
  }
};

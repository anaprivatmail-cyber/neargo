// netlify/functions/stripe-webhook.js
const Stripe = require("stripe");
const { createClient } = require("@supabase/supabase-js");
const QRCode = require("qrcode");
const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");
const Brevo = require("@getbrevo/brevo");
const fontkit = require("@pdf-lib/fontkit");
const crypto = require("node:crypto");

// ── ENV ────────────────────────────────────────────────────────────────────────
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
const TAX_RATE = Number(process.env.INVOICE_TAX_RATE || 22); // v %
const CURRENCY = (process.env.INVOICE_CURRENCY || "eur").toLowerCase();

// ── clients ───────────────────────────────────────────────────────────────────
const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });
const supa   = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

const brevoApi = new Brevo.TransactionalEmailsApi();
if (process.env.BREVO_API_KEY) {
  brevoApi.setApiKey(Brevo.TransactionalEmailsApiApiKeys.apiKey, process.env.BREVO_API_KEY);
} else {
  console.warn("[webhook] BREVO_API_KEY is missing – purchase e-mails will be skipped.");
}

const FROM_EMAIL = (EMAIL_FROM.match(/<([^>]+)>/) || [null, EMAIL_FROM])[1];
const FROM_NAME  = EMAIL_FROM.replace(/\s*<[^>]+>\s*$/, "") || "NearGo";

// ── helpers ───────────────────────────────────────────────────────────────────
function cors() {
  return {
    "access-control-allow-origin":  "*",
    "access-control-allow-methods": "POST,OPTIONS",
    "access-control-allow-headers": "content-type",
  };
}
function escapeHtml(s){ return String(s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function summarizeBenefit({ benefitType, benefitValue, freebieText }) {
  if (benefitType === "percent" && benefitValue) return `${benefitValue}% popusta`;
  if (benefitType === "amount"  && benefitValue) return `${Number(benefitValue).toFixed(2)} € vrednost`;
  if (benefitType === "freebie" && freebieText) return `Brezplačno: ${freebieText}`;
  return "";
}

// zaporedna številka računa
async function nextInvoiceNo() {
  const year = new Date().getFullYear();
  await supa.from("invoice_counters").upsert({ year, last_no: 0 }, { onConflict: "year" });
  const { data, error } = await supa.rpc("increment_invoice_counter", { y: year });
  if (error) throw error;
  return { seq: `${year}-${String(data).padStart(6,"0")}`, year, n:data };
}

// PDF račun (osnova, ddv in skupaj)
async function createInvoicePdf({ seqNo, buyer, totalGross, base, tax, paidAt, sessionId }) {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const page = pdf.addPage([595.28, 841.89]); // A4
  const { height } = page.getSize();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  let y = height - 48;
  const line = (txt, size=11, f=font, color=rgb(0,0,0))=>{
    page.drawText(String(txt), { x:40, y, size, font:f, color }); y -= size+6;
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
  line(`${buyer.email}`); y -= 10;

  line("Obračun:", 12, bold);
  line(`Osnova: ${(base/100).

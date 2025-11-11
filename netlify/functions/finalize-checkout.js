// Fallback finalization for Stripe Checkout when webhooks are not delivered.
// GET /api/finalize-checkout?cs=cs_test_...
// Idempotent: if a ticket/premium already exists for the session, it returns ok.

import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import QRCode from 'qrcode';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import * as Brevo from '@getbrevo/brevo';
import nodemailer from 'nodemailer';
import fs from 'fs';
import path from 'path';

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supa = createClient(SUPABASE_URL, SERVICE_KEY, { auth:{ persistSession:false } });

const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || process.env.SITE_URL || 'https://getneargo.com').replace(/\/$/, '');
const SUPPORT_EMAIL   = process.env.SUPPORT_EMAIL || 'info@getneargo.com';
const EMAIL_FROM      = process.env.EMAIL_FROM || 'NearGo <info@getneargo.com>';

const FONTS_DIR     = path.join(process.cwd(), 'netlify', 'functions', 'fonts');
const FONT_REG_TTF  = path.join(FONTS_DIR, 'NotoSans-Regular.ttf');
const FONT_BOLD_TTF = path.join(FONTS_DIR, 'NotoSans-Bold.ttf');

const TAX_RATE = (()=>{ const raw=(process.env.INVOICE_TAX_RATE||'22').toString().replace(',', '.'); const n=parseFloat(raw.replace(/[^0-9.]+/g,'')); return Number.isFinite(n)?n:22; })();
const CURRENCY = (process.env.INVOICE_CURRENCY || 'eur').toLowerCase();

const brevoApi = new Brevo.TransactionalEmailsApi();
if (process.env.BREVO_API_KEY) brevoApi.setApiKey(Brevo.TransactionalEmailsApiApiKeys.apiKey, process.env.BREVO_API_KEY);
const FROM_EMAIL = (EMAIL_FROM.match(/<([^>]+)>/) || [null, EMAIL_FROM])[1];
const FROM_NAME  = EMAIL_FROM.replace(/\s*<[^>]+>\s*$/, '') || 'NearGo';

const CORS = { 'Access-Control-Allow-Origin':'*', 'Access-Control-Allow-Methods':'GET,OPTIONS', 'Access-Control-Allow-Headers':'Content-Type, Authorization' };
const json = (s,b)=>({ statusCode:s, headers:{ 'content-type':'application/json', ...CORS }, body: JSON.stringify(b) });

async function nextInvoiceNo(){
  const year = new Date().getFullYear();
  await supa.from('invoice_counters').upsert({ year, last_no: 0 }, { onConflict: 'year' });
  const { data, error } = await supa.rpc('increment_invoice_counter', { y: year });
  if (error) throw error;
  return { seq: `${year}-${String(data).padStart(6,'0')}`, year };
}

async function createInvoicePdf({ seqNo, buyer, totalGross, base, tax, paidAt, sessionId }){
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const regBytes  = fs.existsSync(FONT_REG_TTF)  ? fs.readFileSync(FONT_REG_TTF)  : null;
  const boldBytes = fs.existsSync(FONT_BOLD_TTF) ? fs.readFileSync(FONT_BOLD_TTF) : null;
  const F_REG  = regBytes  ? await pdf.embedFont(regBytes,{subset:true}) : await pdf.embedFont(StandardFonts.Helvetica);
  const F_BOLD = boldBytes ? await pdf.embedFont(boldBytes,{subset:true}) : F_REG;
  const page = pdf.addPage([595.28, 841.89]);
  const { height } = page.getSize();
  let y = height - 48;
  const line=(t,s=11,f=F_REG,c=rgb(0,0,0))=>{ page.drawText(String(t??''),{x:40,y,size:s,font:f,color:c}); y-= (s+6); };
  line('NearGo d.o.o.',14,F_BOLD,rgb(0,0.25,0.45));
  line(`Datum: ${new Date(paidAt).toLocaleString()}`);
  line(`Št. računa: ${seqNo}`);
  y-=12; line(`Kupec: ${buyer.email||''}`,12,F_BOLD);
  y-=6; line(`Osnova: ${(totalGross/(1+TAX_RATE/100)/100).toFixed(2)} ${CURRENCY.toUpperCase()}`);
  line(`DDV (${TAX_RATE}%): ${((totalGross - Math.round(totalGross/(1+TAX_RATE/100)))/100).toFixed(2)} ${CURRENCY.toUpperCase()}`);
  line(`SKUPAJ: ${(totalGross/100).toFixed(2)} ${CURRENCY.toUpperCase()}`,13,F_BOLD,rgb(0,0.45,0.25));
  return await pdf.save();
}

export const handler = async (event) => {
  try{
    if (event.httpMethod === 'OPTIONS') return { statusCode:204, headers:CORS, body:'' };
    if (event.httpMethod !== 'GET') return json(405,{ ok:false, error:'use_get' });
    const cs = (event.queryStringParameters?.cs || '').trim();
    if (!cs) return json(400, { ok:false, error:'missing_cs' });

    // If already processed, return early
    const existing = await supa.from('tickets').select('id').eq('stripe_checkout_session_id', cs).limit(1);
    if (existing?.data && existing.data.length){
      return json(200, { ok:true, already:true });
    }

    const s = await stripe.checkout.sessions.retrieve(cs);
    const md = s.metadata || {};
    const type = (md.type === 'coupon' || md.type === 'premium' || md.type === 'ticket') ? md.type : 'ticket';
    const eventId = md.event_id || null;
    const eventTitle = md.event_title || 'Dogodek';
    const imageUrl = md.image_url || null;
    const displayBenefit = md.display_benefit || null;
    const benefitType  = md.benefit_type || null;
    const benefitValue = md.benefit_value || null;
    const freebieText  = md.freebie_text  || null;
    const customerEmail = (s.customer_details && s.customer_details.email) || s.customer_email || md.email || null;

    if (!customerEmail){
      return json(400, { ok:false, error:'no_email_in_session' });
    }

    if (md.plan && md.interval && (md.type === 'provider-plan')){
      // For provider plans we currently don't insert tickets; just acknowledge.
      return json(200, { ok:true, provider:true });
    }

    const token = (globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2)) + Date.now().toString(36);
    const nowIso = new Date().toISOString();

    const { error: insErr } = await supa.from('tickets').insert({
      event_id: eventId,
      type,
      display_benefit: displayBenefit,
      benefit_type: benefitType,
      benefit_value: benefitValue,
      freebie_text: freebieText,
      stripe_checkout_session_id: s.id,
      stripe_payment_intent_id: s.payment_intent,
      token,
      status: 'issued',
      issued_at: nowIso,
      created_at: nowIso,
      customer_email: customerEmail
    });
    if (insErr) return json(500, { ok:false, error: insErr.message });

    // Premium grant
    if (type === 'premium' && customerEmail){
      try{
        const until = new Date();
        until.setUTCFullYear(until.getUTCFullYear() + 1);
        await supa.from('premium_users').upsert({ email: customerEmail, premium_until: until.toISOString(), updated_at: new Date().toISOString() }, { onConflict: 'email' });
      }catch{}
    }

    // QR & invoice
    const redeemUrl = `${PUBLIC_BASE_URL}/r/${token}`;
    const qrPngBuffer = (type === 'premium') ? null : await QRCode.toBuffer(redeemUrl, { type:'png', margin:1, width:512 });

    const totalGross = Number(s.amount_total || 0);
    const base = Math.round(totalGross / (1 + TAX_RATE/100));
    const tax  = totalGross - base;
    const shouldInvoice = totalGross > 0;
    let pdfBytes = null; let pdfPath = null; let seq = null; let year = null;
    if (shouldInvoice){
      const id = await nextInvoiceNo(); seq = id.seq; year = id.year;
      pdfBytes = await createInvoicePdf({ seqNo: seq, buyer:{ email: customerEmail }, totalGross, base, tax, paidAt: nowIso, sessionId: s.id });
      pdfPath = `invoices/${year}/${seq}.pdf`;
      try{ await supa.storage.from('invoices').upload(pdfPath, pdfBytes, { contentType:'application/pdf', upsert:true }); }catch{}
      try{ const { data: signed } = await supa.storage.from('invoices').createSignedUrl(pdfPath, 60*60*24*30);
        await supa.from('invoices').insert({ seq_no: seq, year, customer_email: customerEmail, items: [{ name: type==='coupon'?`Kupon: ${eventTitle}`:(type==='premium'?`Premium NearGo`:`Vstopnica: ${eventTitle}`), qty:1, unit_price: totalGross }], currency: CURRENCY, subtotal: base, tax_rate: TAX_RATE, tax_amount: tax, total: totalGross, paid_at: nowIso, stripe_session_id: s.id, stripe_payment_intent: s.payment_intent, event_id: eventId, type, pdf_url: signed?.signedUrl || null });
      }catch{}
    }
    if (qrPngBuffer){ try{ await supa.storage.from('invoices').upload(`passes/qr/${token}.png`, qrPngBuffer, { contentType:'image/png', upsert:true }); }catch{} }

    // Email
    try{
      const subject = type==='coupon'?'Kupon – potrdilo':(type==='premium'?'Premium – potrdilo':'Vstopnica – potrdilo');
      const attachments = [ ...(qrPngBuffer ? [{ name:'qr.png', content: qrPngBuffer.toString('base64') }] : []) ];
      if (shouldInvoice && pdfBytes){ attachments.push({ name: `Racun-${seq}.pdf`, content: Buffer.from(pdfBytes).toString('base64') }); }
      if (process.env.BREVO_API_KEY){
        const email = new Brevo.SendSmtpEmail();
        email.sender = { email: FROM_EMAIL, name: FROM_NAME };
        email.to = [{ email: customerEmail }];
        email.subject = subject;
        email.htmlContent = `<p>Pozdravljeni,</p><p>vaš nakup v NearGo je bil uspešen.</p>`;
        if (attachments.length) email.attachment = attachments;
        await brevoApi.sendTransacEmail(email);
      }else{
        const host=process.env.SMTP_HOST, port=Number(process.env.SMTP_PORT||0), user=process.env.SMTP_USER, pass=process.env.SMTP_PASS;
        if (host && port && user && pass){
          const transporter = nodemailer.createTransport({ host, port, secure: port===465, auth:{ user, pass } });
          await transporter.sendMail({ from: EMAIL_FROM, to: customerEmail, subject, html: '<p>Pozdravljeni,</p><p>vaš nakup v NearGo je bil uspešen.</p>' });
        }
      }
    }catch{}

    return json(200, { ok:true, finalized:true });
  }catch(e){
    return json(500, { ok:false, error: e?.message || String(e) });
  }
};

// netlify/functions/stripe-webhook.js
const crypto = require("crypto");
const QRCode = require("qrcode");
const { createClient } = require("@supabase/supabase-js");

const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const SUPABASE_URL   = process.env.SUPABASE_URL;
const SUPABASE_ANON  = process.env.SUPABASE_ANON_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON);

// pomožna: preveri Stripe podpis
function verifyStripeSignature(rawBody, sig, secret){
  const [tPart, v1Part] = (sig || "").split(",").map(s=>s.trim());
  const t = tPart?.split("=")[1];
  const v1 = v1Part?.split("=")[1];
  if(!t || !v1) return false;
  const signedPayload = `${t}.${rawBody}`;
  const expected = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(v1));
}

exports.handler = async (event, context) => {
  try{
    if(event.httpMethod === "OPTIONS"){
      return { statusCode: 204, headers: cors(), body: "" };
    }
    if(event.httpMethod !== "POST"){
      return { statusCode: 405, headers: cors(), body: "Method Not Allowed" };
    }

    const rawBody = event.body || "";
    const sig = event.headers["stripe-signature"] || event.headers["Stripe-Signature"];

    if(!verifyStripeSignature(rawBody, sig, STRIPE_WEBHOOK_SECRET)){
      return { statusCode: 400, headers: cors(), body: "Invalid signature" };
    }

    const payload = JSON.parse(rawBody);

    if(payload.type === "checkout.session.completed"){
      const s = payload.data.object;

      // Metapodatki iz tvoje /api/checkout zahteve (dodaš jih v checkout.js – glej 3. poglavje)
      const kind = s.metadata?.kind || "ticket";  // 'ticket' | 'coupon'
      const eventId = s.metadata?.event_id || null;
      const quantity = Number(s.metadata?.quantity || 1);
      const amountTotal = s.amount_total || 0;   // v centih
      const currency = s.currency || "eur";
      const email = s.customer_details?.email || s.customer_email || null;
      const sessionId = s.id;

      // 1) Zapiši purchase
      const { data: ins, error: perr } = await supabase
        .from("purchases")
        .insert({
          stripe_session_id: sessionId,
          email,
          event_id: eventId,
          amount_total: amountTotal,
          currency,
          code: null,    // za purchase je opcijsko
          status: 'paid'
        })
        .select("id")
        .single();
      if(perr) throw perr;

      // 2) Ustvari N kod in QR slike
      const ticketRows = [];
      for(let i=0;i<quantity;i++){
        const code = `NG-${Math.random().toString(36).slice(2,8).toUpperCase()}-${Date.now().toString().slice(-6)}`;
        // QR – vsebina naj bo unikatna koda
        const qrDataUrl = await QRCode.toDataURL(code, { width: 400, margin: 1 });

        ticketRows.push({ purchase_id: ins.id, kind, event_id: eventId, code });

        // Lahko shraniš PNG v Supabase Storage (opcijsko); za začetek zadošča inline dataURL v mailu
        // TODO: če želiš Upload v Storage → (ustvari bucket 'tickets') in shrani kot PNG datoteko.
      }

      const { error: terr } = await supabase.from("tickets").insert(ticketRows);
      if(terr) throw terr;

      // 3) Pošlji e-pošto s QR (uporabi Resend/SendGrid/Mailgun; tukaj samo primer s preprostim webhook mailerjem)
      // Priporočam Resend. Env: RESEND_API_KEY
      // V mail dodaj seznam kod + QR (ali link na strankin "Moji nakupi" ekran).
      // ... (glej spodaj “E-poštni pošiljatelj”)

      console.log(`Fulfilled purchase ${ins.id} for ${email} (${quantity}x ${kind}).`);
    }

    return { statusCode: 200, headers: cors(), body: JSON.stringify({ received:true }) };
  }catch(e){
    console.error(e);
    return { statusCode: 200, headers: cors(), body: JSON.stringify({ received:true }) }; // Stripe želi 2xx
  }
};

function cors(){
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "POST,OPTIONS",
    "access-control-allow-headers": "content-type, stripe-signature"
  };
}

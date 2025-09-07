// netlify/functions/checkout.js
// Stripe Checkout (centi!) + optional image
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const COUPON_PRICE_CENTS = Number(process.env.COUPON_PRICE_CENTS || 200); // 2,00 €
const BASE_URL = (process.env.PUBLIC_BASE_URL || "https://getneargo.com").replace(/\/$/,"");

export const handler = async (event) => {
  try {
    if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: cors(), body: "" };
    if (event.httpMethod !== "POST")   return json({ ok:false, error:"Method not allowed" },405);
    if (!STRIPE_SECRET_KEY || !STRIPE_SECRET_KEY.startsWith("sk_")) {
      return json({ ok:false, error:"Stripe key missing/invalid" });
    }

    const payload = safeJson(event.body) || {};
    const {
      type,                     // "ticket" | "coupon"
      metadata = {},
      lineItems: raw = [],
      successUrl = `${BASE_URL}/#success`,
      cancelUrl  = `${BASE_URL}/#cancel`,
      customerEmail
    } = payload;

    const form = new URLSearchParams();
    form.set("mode","payment");
    form.set("success_url", successUrl);
    form.set("cancel_url", cancelUrl);
    if (customerEmail) form.set("customer_email", customerEmail);

    Object.entries({ ...metadata, type: type || metadata.type || "ticket" }).forEach(([k,v])=>{
      if (v !== undefined && v !== null) form.set(`metadata[${k}]`, String(v));
    });

    let items = [];
    if (type === "coupon") {
      const name = metadata.display_benefit ? `Kupon – ${metadata.display_benefit}` : "Kupon";
      items = [{
        currency: "eur",
        name,
        description: "Vnovči se pri ponudniku",
        amount: COUPON_PRICE_CENTS,    // CENTI
        quantity: 1,
        image: metadata.image_url || ""
      }];
    } else {
      if (!Array.isArray(raw) || !raw.length) return json({ ok:false, error:"Missing lineItems" });
      items = raw.map(it => ({
        currency: it.currency || "eur",
        name: it.name || "Vstopnica",
        description: it.description || "",
        amount: Math.round(Number(it.amount) * 100), // EVRE -> CENTI
        quantity: it.quantity || 1,
        image: it.image || ""
      }));
      if (items.some(it => !(Number(it.amount) >= 50))) {
        return json({ ok:false, error:"Znesek je prenizek (min 0,50 €)" });
      }
    }

    items.forEach((it,i)=>{
      form.set(`line_items[${i}][price_data][currency]`, it.currency);
      form.set(`line_items[${i}][price_data][product_data][name]`, it.name);
      if (it.description) form.set(`line_items[${i}][price_data][product_data][description]`, it.description);
      if (it.image)       form.set(`line_items[${i}][price_data][product_data][images][0]`, it.image);
      form.set(`line_items[${i}][price_data][unit_amount]`, String(it.amount));
      form.set(`line_items[${i}][quantity]`, String(it.quantity));
    });

    const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: { Authorization:`Bearer ${STRIPE_SECRET_KEY}`, "content-type":"application/x-www-form-urlencoded" },
      body: form.toString()
    });
    const data = await res.json().catch(()=> ({}));
    if (!res.ok || !data?.url) return json({ ok:false, error:data?.error?.message || "Stripe error", debug:data },200);

    return json({ ok:true, id:data.id, url:data.url });
  } catch (e) {
    return json({ ok:false, error:String(e?.message||e) },200);
  }
};

function cors(){ return { "Access-Control-Allow-Origin":"*", "Access-Control-Allow-Methods":"POST,OPTIONS", "Access-Control-Allow-Headers":"content-type" }; }
function json(obj, status=200){ return { statusCode:status, headers:{ "content-type":"application/json", ...cors() }, body:JSON.stringify(obj) }; }
function safeJson(s){ try{ return s? JSON.parse(s) : null; }catch{ return null; } }

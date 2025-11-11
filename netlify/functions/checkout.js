// netlify/functions/checkout.js  (ESM)
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });

// 2,00 € privzeto za kupon (v centih); min 0,50 € zaradi Stripe omejitve
const COUPON_PRICE_CENTS = Math.max(50, Number(process.env.COUPON_PRICE_CENTS || 200));
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || process.env.URL || "").replace(/\/$/, "");
// Premium cena v centih – konfigurabilno prek env; privzeto 500 (5,00 €)
const PREMIUM_PRICE_CENTS = Math.max(100, Number(process.env.PREMIUM_PRICE_CENTS || 500));
// Optional Stripe Price IDs for subscriptions (if set, we'll use mode=subscription)
const PRICE_PREMIUM_MONTHLY = process.env.STRIPE_PRICE_PREMIUM_MONTHLY || '';
const PRICE_GROW_MONTHLY    = process.env.STRIPE_PRICE_GROW_MONTHLY    || '';
const PRICE_GROW_YEARLY     = process.env.STRIPE_PRICE_GROW_YEARLY     || '';
const PRICE_PRO_MONTHLY     = process.env.STRIPE_PRICE_PRO_MONTHLY     || '';
const PRICE_PRO_YEARLY      = process.env.STRIPE_PRICE_PRO_YEARLY      || '';

/** Pretvori znesek v cente, če je podan v evrih.  */
function toCents(val) {
  const n = Number(val);
  if (!Number.isFinite(n)) return 0;
  // če je videti kot centi (>=50 in celo število), pusti
  if (n >= 50 && Number.isInteger(n)) return n;
  // sicer tretiraj kot evre
  return Math.round(n * 100);
}

export const handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: JSON.stringify({ ok: false, error: "Method Not Allowed" }) };
    }

    let payload = JSON.parse(event.body || "{}");
    // Optional: accept form POST with a single 'payload' field (from email CTA)
    if (!payload.type && typeof event.body === 'string' && event.headers['content-type']?.includes('application/x-www-form-urlencoded')){
      const params = new URLSearchParams(event.body);
      const p = params.get('payload');
      if (p) { try { payload = JSON.parse(p); } catch {} }
    }
    const successUrl = payload.successUrl || `${PUBLIC_BASE_URL || ""}/#success`;
    const cancelUrl  = payload.cancelUrl  || `${PUBLIC_BASE_URL || ""}/#cancel`;
    const metadata   = payload.metadata || {};


    // --- KU P O N -----------------------------------------------------------
    if ((payload.type || metadata.type) === "coupon") {
      // opis za PaymentIntent
      const piDesc = metadata.display_benefit ? `Kupon – ${metadata.display_benefit}` : "Kupon";
      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        payment_method_types: ["card"],
        // vedno ustvari Customer in zberi email
        customer_creation: "always",
        success_url: successUrl,
        cancel_url: cancelUrl,
        line_items: [
          {
            price_data: {
              currency: "eur",
              unit_amount: COUPON_PRICE_CENTS, // centi
              product_data: {
                name: "Kupon",
                description: piDesc,
                images: metadata.image_url ? [metadata.image_url] : []
              }
            },
            quantity: 1
          }
        ],
        payment_intent_data: { description: piDesc },
        metadata
      });
      return { statusCode: 200, body: JSON.stringify({ ok: true, url: session.url }) };
    }

    // --- PROVIDER PLAN (Grow/Pro) ------------------------------------------
    if ((payload.type || metadata.type) === "provider-plan") {
      // Določi ceno in ime paketa
      let plan = payload.plan || metadata.plan;
      let interval = payload.interval || metadata.interval;
      let price = 0, name = "";
      if (plan === "grow" && interval === "monthly") { price = 1500; name = "Grow paket – mesečno"; }
      if (plan === "grow" && interval === "yearly")  { price = 15000; name = "Grow paket – letno"; }
      if (plan === "pro"  && interval === "monthly") { price = 3500; name = "Pro paket – mesečno"; }
      if (plan === "pro"  && interval === "yearly")  { price = 35000; name = "Pro paket – letno"; }
      if (!price) return { statusCode: 400, body: JSON.stringify({ ok: false, error: "Neveljaven paket" }) };
      // If Price IDs exist for subscription, switch to subscription mode
      const priceId = (plan === 'grow' && interval === 'monthly') ? PRICE_GROW_MONTHLY
        : (plan === 'grow' && interval === 'yearly') ? PRICE_GROW_YEARLY
        : (plan === 'pro'  && interval === 'monthly') ? PRICE_PRO_MONTHLY
        : (plan === 'pro'  && interval === 'yearly') ? PRICE_PRO_YEARLY
        : '';
      let session;
      if (priceId) {
        session = await stripe.checkout.sessions.create({
          mode: "subscription",
          payment_method_types: ["card"],
          customer_creation: "always",
          success_url: successUrl,
          cancel_url: cancelUrl,
          line_items: [{ price: priceId, quantity: 1 }],
          metadata: { ...metadata, type: 'provider-plan', plan, interval }
        });
      } else {
        session = await stripe.checkout.sessions.create({
          mode: "payment",
          payment_method_types: ["card"],
          customer_creation: "always",
          success_url: successUrl,
          cancel_url: cancelUrl,
          line_items: [
            {
              price_data: {
                currency: "eur",
                unit_amount: price,
                product_data: {
                  name,
                  description: name,
                }
              },
              quantity: 1
            }
          ],
          payment_intent_data: { description: name },
          metadata: { ...metadata, type: 'provider-plan', plan, interval }
        });
      }
      return { statusCode: 200, body: JSON.stringify({ ok: true, url: session.url }) };
    }

    // --- PREMIUM (onemogočeno na Stripe – uporabi native IAP) --------------
    if ((payload.type || metadata.type) === "premium") {
      // Namesto Stripe vračamo napako / usmeritev: Premium kupi v native aplikaciji (Apple/Google IAP).
      return { statusCode: 400, body: JSON.stringify({ ok:false, error:"Premium kupi preko mobilne aplikacije (Apple/Google). Stripe je dovoljen samo za vstopnice in kupone." }) };
    }

    // --- V S T O P N I C E --------------------------------------------------
  if (Array.isArray(payload.lineItems) && payload.lineItems.length) {
      // front-end pošilja amount najpogosteje v evrih → pretvorimo v cente
      const items = payload.lineItems.map((it) => ({
        price_data: {
          currency: it.currency || "eur",
          unit_amount: toCents(it.amount),
          product_data: {
            name: it.name || "Vstopnica",
            description: it.description || "",
            images: metadata.image_url ? [metadata.image_url] : []
          }
        },
        quantity: it.quantity || 1
      }));

      const firstName = payload.lineItems[0]?.name || "Vstopnica";

      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        payment_method_types: ["card"],
        customer_creation: "always",
        success_url: successUrl,
        cancel_url: cancelUrl,
        line_items: items,
        payment_intent_data: { description: firstName },
        client_reference_id: metadata.event_id ? String(metadata.event_id) : undefined,
        metadata: { ...metadata, type: (metadata.type || "ticket"), event_title: firstName }
      });

      return { statusCode: 200, body: JSON.stringify({ ok: true, url: session.url }) };
    }

    // Če payload ni v pričakovani obliki
    return { statusCode: 400, body: JSON.stringify({ ok: false, error: "Neveljaven payload" }) };

  } catch (e) {
    console.error("[checkout] fatal:", e?.message || e);
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: e?.message || "Server error" }) };
  }
};

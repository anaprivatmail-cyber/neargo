// netlify/functions/checkout.js  (ESM)
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });

// 2,00 € privzeto za kupon (v centih); min 0,50 € zaradi Stripe omejitve
const COUPON_PRICE_CENTS = Math.max(50, Number(process.env.COUPON_PRICE_CENTS || 200));
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || process.env.URL || "").replace(/\/$/, "");

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

    const payload = JSON.parse(event.body || "{}");
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

    // --- PREMIUM -----------------------------------------------------------
    if ((payload.type || metadata.type) === "premium") {
      // Uporabi enako Stripe logiko kot za kupon, prilagodi podatke
      const piDesc = "Premium uporabnik NearGo";
      const PREMIUM_PRICE_CENTS = 500;
      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        payment_method_types: ["card"],
        success_url: successUrl,
        cancel_url: cancelUrl,
        line_items: [
          {
            price_data: {
              currency: "eur",
              unit_amount: PREMIUM_PRICE_CENTS,
              product_data: {
                name: "NearGo Premium",
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

    // --- PROVIDER PLAN (Grow/Pro) -----------------------------------------
    if ((payload.type || metadata.type) === "provider-plan") {
      // Uporabi Stripe logiko kot za kupon, prilagodi podatke in ceno
      let priceCents = 0;
      let name = "NearGo Paket";
      let desc = "Paket za ponudnike";
      if (payload.plan === "grow" && payload.interval === "monthly") { priceCents = 1500; name = "Grow paket (mesečno)"; desc = "Grow paket za ponudnike (mesečna naročnina)"; }
      if (payload.plan === "grow" && payload.interval === "yearly")  { priceCents = 15000; name = "Grow paket (letno)"; desc = "Grow paket za ponudnike (letna naročnina)"; }
      if (payload.plan === "pro"  && payload.interval === "monthly") { priceCents = 3500; name = "Pro paket (mesečno)";  desc = "Pro paket za ponudnike (mesečna naročnina)"; }
      if (payload.plan === "pro"  && payload.interval === "yearly")  { priceCents = 35000; name = "Pro paket (letno)";   desc = "Pro paket za ponudnike (letna naročnina)"; }
      if (!priceCents) {
        return { statusCode: 400, body: JSON.stringify({ ok: false, error: "Neveljaven paket ali interval" }) };
      }
      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        payment_method_types: ["card"],
        success_url: successUrl,
        cancel_url: cancelUrl,
        line_items: [
          {
            price_data: {
              currency: "eur",
              unit_amount: priceCents,
              product_data: {
                name,
                description: desc,
                images: metadata.image_url ? [metadata.image_url] : []
              }
            },
            quantity: 1
          }
        ],
        payment_intent_data: { description: name },
        metadata
      });
      return { statusCode: 200, body: JSON.stringify({ ok: true, url: session.url }) };
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
        success_url: successUrl,
        cancel_url: cancelUrl,
        line_items: items,
        payment_intent_data: { description: firstName },
        client_reference_id: metadata.event_id ? String(metadata.event_id) : undefined,
        metadata
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

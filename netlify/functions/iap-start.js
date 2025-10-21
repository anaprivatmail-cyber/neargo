// netlify/functions/iap-start.js
import Stripe from "stripe";
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });

export const handler = async (event) => {
  if (event.httpMethod !== "POST")
    return { statusCode: 405, body: "POST only" };

  const { plan } = JSON.parse(event.body || "{}");
  const successUrl = `${process.env.PUBLIC_BASE_URL}/#success`;
  const cancelUrl  = `${process.env.PUBLIC_BASE_URL}/#cancel`;

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{
        price_data: {
          currency: "eur",
          product_data: { name: "NearGo Premium Naročnina" },
          recurring: { interval: "month" },
          unit_amount: 500,
        },
        quantity: 1,
      }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: { type: "premium", plan: plan || "premium5" },
    });

    return { statusCode: 200, body: JSON.stringify({ ok: true, url: session.url }) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: e.message }) };
  }
};

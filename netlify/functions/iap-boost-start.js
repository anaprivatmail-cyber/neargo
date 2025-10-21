// netlify/functions/iap-boost-start.js
import Stripe from "stripe";
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });

export const handler = async () => {
  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [{
        price_data: {
          currency: "eur",
          product_data: { name: "Boost izpostavitev dogodka/storitve (7 dni)" },
          unit_amount: 400,  # 4 €
        },
        quantity: 1,
      }],
      success_url: `${process.env.PUBLIC_BASE_URL}/#success`,
      cancel_url: `${process.env.PUBLIC_BASE_URL}/#cancel`,
      metadata: { type: "boost" },
    });

    return { statusCode: 200, body: JSON.stringify({ ok: true, url: session.url }) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: e.message }) };
  }
};

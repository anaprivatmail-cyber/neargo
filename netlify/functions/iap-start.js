// netlify/functions/iap-start.js
// Namen: vrne URL za "naroči Premium". Zaenkrat stub, da deploy uspe in UI deluje.
// Ko boš imel Stripe/IAP, tu samo zamenjaš generiranje URL-ja.

exports.handler = async (event) => {
  try {
    // Primer: če želiš (začasno) preusmeriti na interni info page:
    const url = "/premium.html"; // ali URL do Stripe Checkout-a, ko bo pripravljen

    return {
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ok: true, url })
    };
  } catch (err) {
    // Fallback: lahko sporočiš, da naj frontend uporabi Stripe (če ga že imaš)
    return {
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ok: false, fallback: "stripe" })
    };
  }
};

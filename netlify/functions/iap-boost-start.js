// netlify/functions/iap-boost-start.js
// Namen: vrne URL za "Boost izpostavitev". Stub, da UI deluje in deploy ne pade.

exports.handler = async () => {
  try {
    const url = "/organizers.html#boost"; // zamenjaj s pravim plačilnim/konfiguracijskim URL-jem
    return {
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ok: true, url })
    };
  } catch (err) {
    return {
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ok: false })
    };
  }
};

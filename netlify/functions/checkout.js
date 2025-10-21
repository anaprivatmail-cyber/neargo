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
  if (n >= 50 && Number.isInteger(n)) return n; // že centi
  return Math.round(n * 100); // evri -> centi
}

// [ADD] Nežno združevanje metapodatkov iz payload → metadata (ne prepišemo že podanih)
function mergeMeta(base, add) {
  const out = { ...base };
  for (const [k, v] of Object.entries(add || {})) {
    if (v == null || v === "") continue;
    if (out[k] == null || out[k] === "") out[k] = v;
  }
  return out;
}

export const handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: JSON.stringify({ ok: false, error: "Method Not Allowed" }) };
    }

    const payload = JSON.parse(event.body || "{}");
    const successUrl = payload.successUrl || `${PUBLIC_BASE_URL || ""}/#success`;
    const cancelUrl  = payload.cancelUrl  || `${PUBLIC_BASE_URL || ""}/#cancel`;
    let   metadata   = payload.metadata || {};

    // [ADD] izpelji manjkajoče metapodatke iz payload-a
    const derived = {
      type:           payload.type || undefined,
      event_id:       payload.eventId || payload.eid || undefined,
      event_title:    payload.eventTitle || payload.name || undefined,
      event_venue:    payload.venue || undefined,
      event_start_iso:payload.startIso || payload.start || undefined,

      // kupon – opcijsko strukturirano
      display_benefit: payload.benefit || undefined,
      benefit_type:     payload.coupon?.type  || undefined,
      benefit_value:    payload.coupon?.value || undefined,
      freebie_text:     (payload.coupon?.type === "FREEBIE" ? payload.coupon?.value : undefined),

      // termin/hold (storitev)
      hold_id:    payload.holdId || undefined,
      slot_start: payload.slot?.start || undefined,
      slot_end:   payload.slot?.end   || undefined,

      // slika
      image_url:  payload.img || payload.imagePublicUrl || undefined,

      // [ADD] premium indikator (pričakujemo iz frontenda /api/my)
      premium:    (payload.isPremium === true || payload.isPremium === 1) ? "1" : undefined
    };
    metadata = mergeMeta(metadata, derived);

    // --- KU P O N -----------------------------------------------------------
    if ((payload.type || metadata.type) === "coupon") {
      // [ADD] Če je uporabnik premium -> brezplačna izdaja kupona (brez Stripe)
      const isPremium = String(metadata.premium || "").toLowerCase() === "1" || String(metadata.premium||"") === "true";
      if (isPremium) {
        // Označi, da gre za brezplačno izdajo in posreduj vsa potrebna meta polja
        const freeBody = {
          metadata: {
            ...metadata,
            type: "coupon",
            premium: "1"
          },
          email: payload.email || undefined // če ga poznaš na FE; sicer ga bo kasneje izpeljal backend
        };
        try {
          const r = await fetch(`${PUBLIC_BASE_URL}/api/issue-coupon`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(freeBody)
          });
          const j = await r.json().catch(()=>({}));
          if (!r.ok || !j?.ok) {
            return { statusCode: 500, body: JSON.stringify({ ok:false, error: j?.error || "Issue coupon failed" }) };
          }
          // uspeh – preusmeri enako kot pri Stripe success
          return { statusCode: 200, body: JSON.stringify({ ok:true, url: successUrl, free:true }) };
        } catch (e) {
          return { statusCode: 500, body: JSON.stringify({ ok:false, error: e?.message || "Issue coupon error" }) };
        }
      }

      // ne-premium -> Stripe 2,00 €
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
        client_reference_id: metadata.event_id ? String(metadata.event_id) : undefined, // [ADD]
        metadata
      });

      return { statusCode: 200, body: JSON.stringify({ ok: true, url: session.url }) };
    }

    // --- V S T O P N I C E --------------------------------------------------
    if (Array.isArray(payload.lineItems) && payload.lineItems.length) {
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
        client_reference_id: metadata.event_id ? String(metadata.event_id) : undefined, // [ADD]
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

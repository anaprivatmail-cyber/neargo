// netlify/functions/stripe-webhook.js
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const fetch = (...args) => import('node-fetch').then(({default: f}) => f(...args));
const crypto = require('crypto');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE; // omogoča INSERT v protected tabelo
const RESEND_API_KEY = process.env.RESEND_API_KEY; // ali SENDGRID_API_KEY, če uporabljaš SendGrid
const SENDER_EMAIL = process.env.SENDER_EMAIL || 'NearGo <no-reply@getneargo.com>';

exports.handler = async (event) => {
  const sig = event.headers['stripe-signature'];
  let stripeEvent;

  try {
    stripeEvent = stripe.webhooks.constructEvent(
      event.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('❌ Webhook signature verification failed:', err.message);
    return { statusCode: 400, body: `Webhook Error: ${err.message}` };
  }

  if (stripeEvent.type === 'checkout.session.completed') {
    const s = stripeEvent.data.object;

    const payload = {
      stripe_session_id: s.id,
      email: s.customer_details?.email || null,
      amount_total: s.amount_total, // cents
      currency: s.currency,
      kind: s.metadata?.kind || null,
      item_id: s.metadata?.itemId || null,
      // generiraj kodo/QR (preprosta unikatna koda za kupon/vstopnico)
      code: 'NG-' + crypto.randomBytes(6).toString('hex').toUpperCase(),
      status: 'paid'
    };

    try {
      await savePurchase(payload);
      await sendEmail(payload);
    } catch (e) {
      console.error('Post-payment hook failed:', e);
    }
  }

  return { statusCode: 200, body: JSON.stringify({ ok: true }) };
};

async function savePurchase(p) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/purchases`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_SERVICE_ROLE,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation'
    },
    body: JSON.stringify({
      stripe_session_id: p.stripe_session_id,
      email: p.email,
      amount_total: p.amount_total,
      currency: p.currency,
      kind: p.kind,
      item_id: p.item_id,
      code: p.code,
      status: p.status
    })
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`Supabase insert failed: ${r.status} ${t}`);
  }
}

async function sendEmail(p) {
  if (!p.email || !RESEND_API_KEY) return; // preskoči, če e-mail ali ključ ni nastavljen

  const html = `
    <div style="font-family:Arial,sans-serif">
      <h2>Hvala za nakup v NearGo</h2>
      <p><b>Tip:</b> ${p.kind === 'coupon' ? 'Kupon' : 'Vstopnica'}</p>
      <p><b>Koda:</b> ${p.code}</p>
      <p>Znesek: ${(p.amount_total/100).toFixed(2)} ${p.currency.toUpperCase()}</p>
      <p>To e-pošto pokažite ob unovčenju.</p>
    </div>
  `;

  // primer z Resend (https://resend.com) – preprost in zanesljiv
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: SENDER_EMAIL, to: p.email, subject: 'Vaša koda NearGo', html })
  });
}

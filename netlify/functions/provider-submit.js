// netlify/functions/provider-submit.js
// POST JSON: glej payload iz index.html (section "Objavi dogodek")

const RESEND_API_KEY = process.env.RESEND_API_KEY; // ali SENDGRID_API_KEY (glej spodaj)
const FROM_EMAIL = process.env.FROM_EMAIL || "no-reply@getneargo.com";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "info@getneargo.com";

// Poenostavljen mailer prek Resend (https://resend.com). Če ni ključa, samo "simulira".
async function sendEmail({ to, subject, html }) {
  if (!RESEND_API_KEY) {
    console.log("[email simulate]", { to, subject });
    return { ok: true, simulated: true };
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to: Array.isArray(to) ? to : [to],
      subject,
      html,
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Email send failed: ${t}`);
  }
  return { ok: true };
}

function ok(data) {
  return new Response(JSON.stringify({ ok: true, ...data }), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
    },
  });
}

export const handler = async (event) => {
  try {
    if (event.httpMethod === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "POST,OPTIONS",
          "access-control-allow-headers": "content-type",
        },
      });
    }
    if (event.httpMethod !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    const payload = JSON.parse(event.body || "{}");

    // Ustvari “ticket id” in QR (link na pregled v prihodnje)
    const ticketId = crypto.randomUUID();
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(
      `neargo:ticket:${ticketId}`
    )}`;

    const adminHtml = `
      <h2>Nova prijava dogodka</h2>
      <pre>${JSON.stringify(payload, null, 2)}</pre>
      <p>Ticket/Reference: <b>${ticketId}</b></p>
    `;

    const userHtml = `
      <h2>Hvala za prijavo na NearGo</h2>
      <p>Vaš dogodek smo prejeli. Po potrditvi vas obvestimo.</p>
      <p>Referenca: <b>${ticketId}</b></p>
      <p><img src="${qrUrl}" alt="QR" /></p>
      <p>Ekipa NearGo</p>
    `;

    await sendEmail({ to: ADMIN_EMAIL, subject: "NearGo: nova prijava dogodka", html: adminHtml });
    if (payload.organizerEmail) {
      await sendEmail({
        to: payload.organizerEmail,
        subject: "NearGo: potrditev prejema prijave",
        html: userHtml,
      });
    }

    return ok({ ticketId, message: "Prijava sprejeta. Poslali smo e-pošto." });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 200,
      headers: { "content-type": "application/json", "access-control-allow-origin": "*" },
    });
  }
};

// provider-submit.js — sprejem vnosa organizatorja (minimalno)
// Če dodaš RESEND_API_KEY + FROM_EMAIL, pošlje tudi potrditveni e-mail.

import fetch from "node-fetch";

const RESEND = process.env.RESEND_API_KEY || "";
const FROM   = process.env.FROM_EMAIL || "";

async function sendEmail(to, subject, html) {
  if (!RESEND || !FROM || !to) return { ok: false, skipped: true };
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${RESEND}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM, to: [to], subject, html })
  });
  const data = await r.json().catch(()=> ({}));
  return { ok: r.ok, data };
}

export async function handler(event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }
  try {
    const payload = JSON.parse(event.body || "{}");
    // zelo osnovna validacija
    if (!payload.organizer || !payload.eventName) {
      return { statusCode: 200, body: JSON.stringify({ ok:false, error:"Manjkajoča polja" }) };
    }

    // Tu lahko shranjuješ v zunanjo bazo; zaenkrat samo echo + e-mail
    const summary = `
      <h2>Nova objava dogodka</h2>
      <p><b>Organizator:</b> ${payload.organizer}</p>
      <p><b>Email:</b> ${payload.organizerEmail || "-"}</p>
      <p><b>Dogodek:</b> ${payload.eventName}</p>
      <p><b>Kje:</b> ${payload.venue || "-"}, ${payload.city || "-"}, ${payload.country || "-"}</p>
      <p><b>Kdaj:</b> ${payload.start || "-"} – ${payload.end || "-"}</p>
      <p><b>Cena:</b> ${payload.price != null ? payload.price + " €" : "-"}</p>
      <p><b>Povezava:</b> ${payload.url || "-"}</p>
      <p><b>Opis:</b><br/>${(payload.description||"").replace(/\n/g,"<br/>")}</p>
    `;

    // Pošlji organizatorju potrditev (če imamo API ključ)
    if (payload.organizerEmail) {
      await sendEmail(
        payload.organizerEmail,
        "NearGo – prejem objave dogodka",
        `<p>Hvala! Prejeli smo vaš vnos za dogodek <b>${payload.eventName}</b>.</p>`
      );
    }

    // (izbirno) Pošlji tebi / adminu kopijo
    if (FROM) {
      await sendEmail(FROM, "NearGo – nova objava dogodka (kopija)", summary);
    }

    return {
      statusCode: 200,
      headers: { "content-type":"application/json" },
      body: JSON.stringify({ ok: true })
    };
  } catch (e) {
    return { statusCode: 200, body: JSON.stringify({ ok:false, error: String(e) }) };
  }
}

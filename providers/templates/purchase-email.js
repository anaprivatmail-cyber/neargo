// providers/templates/purchase-email.js
function purchaseEmail({ eventTitle, type, displayBenefit, qrDataUrl, redeemUrl, supportEmail }) {
  const label = type === "coupon" ? "Kupon" : "Vstopnica";
  const support = supportEmail || "info@getneargo.com";
  return `
  <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;">
    <h2 style="margin:0 0 8px 0;">Hvala za nakup – ${label}</h2>
    <p style="margin:0 0 16px 0;"><strong>${eventTitle}</strong></p>
    ${displayBenefit ? `<p style="margin:8px 0 16px 0;">Ugodnost: <strong>${displayBenefit}</strong></p>` : ""}
    <div style="text-align:center;margin:20px 0;">
      <img src="${qrDataUrl}" alt="QR koda" style="width:220px;height:220px;"/>
      <p style="font-size:12px;color:#777;margin-top:8px;">Če QR ne deluje, odpri:<br/>
        <a href="${redeemUrl}" target="_blank">${redeemUrl}</a>
      </p>
    </div>
    <p style="margin:16px 0;">Navodila: pokažite ta e-poštni zapis ali QR kodo ponudniku ob prihodu.</p>
    <hr style="border:none;border-top:1px solid #eee;margin:24px 0;" />
    <p style="font-size:12px;color:#666;">Podpora: <a href="mailto:${support}">${support}</a></p>
  </div>`;
}

module.exports = { purchaseEmail };

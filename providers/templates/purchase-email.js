// providers/templates/purchase-email.js
function purchaseEmail({ eventTitle, type, displayBenefit, qrDataUrl, redeemUrl, supportEmail }) {
  const label = type === 'coupon' ? 'Kupon' : 'Vstopnica';
  const support = supportEmail || 'info@getneargo.com';
  const safeTitle = eventTitle || 'NearGo dogodek';
  const benefitBlock = displayBenefit ? `<tr><td style="padding:4px 0 14px;font-size:15px;line-height:1.5;color:#0b1b2b">Ugodnost: <strong>${displayBenefit}</strong></td></tr>` : '';
  return `
<!DOCTYPE html>
<html lang="sl">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${label} – ${safeTitle}</title>
  <style>
    .btn{background:#0bbbd6;color:#fff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:14px;display:inline-block;font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:15px;letter-spacing:.3px}
    .btn:hover{background:#09a5bd}
    .meta-label{color:#0bbbd6;font-weight:800;font-size:13px;letter-spacing:.5px;text-transform:uppercase}
    @media (max-width:600px){ .wrap{padding:18px !important} h1{font-size:22px !important} }
  </style>
</head>
<body style="margin:0;background:#f4fbfd;font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#0b1b2b;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f4fbfd;">
    <tr>
      <td align="center" style="padding:0;">
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:600px;background:#ffffff;border-radius:20px;margin:24px 12px;box-shadow:0 4px 22px rgba(0,0,0,.06);overflow:hidden">
          <tr>
            <td style="background:linear-gradient(135deg,#0bbbd6,#7de3f0);padding:26px 28px;text-align:center;">
              <table role="presentation" width="100%" style="color:#ffffff">
                <tr><td style="text-align:center;padding-bottom:6px">
                  <svg viewBox="0 0 32 32" width="58" height="58" aria-hidden="true" style="display:block;margin:0 auto">
                    <defs><radialGradient id="g1" cx="50%" cy="50%"><stop offset="0%" stop-color="#ffffff"/><stop offset="100%" stop-color="#d9fbff"/></radialGradient></defs>
                    <circle cx="16" cy="16" r="13" fill="none" stroke="url(#g1)" stroke-width="2" />
                    <circle cx="16" cy="16" r="8" fill="none" stroke="#fff" stroke-width="2" opacity=".9" />
                    <circle cx="16" cy="16" r="3.2" fill="#fff" />
                  </svg>
                </td></tr>
                <tr><td style="text-align:center"><h1 style="margin:0;font-size:26px;line-height:1.2;color:#ffffff;font-weight:900;letter-spacing:-.5px">${label} potrjena</h1></td></tr>
              </table>
            </td>
          </tr>
          <tr><td class="wrap" style="padding:28px 34px 34px;font-size:15px;line-height:1.55;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
              <tr><td style="padding:0 0 14px;font-size:17px;font-weight:800;letter-spacing:-.3px">${safeTitle}</td></tr>
              ${benefitBlock}
              <tr><td style="padding:0 0 10px;color:#0b1b2b">Spodaj je tvoja ${label.toLowerCase()}. Ob prihodu jo pokaži ponudniku. Za varnostno kopijo lahko odpreš alternativno povezavo.</td></tr>
              <tr><td style="padding:10px 0 26px;text-align:center">
                <img src="${qrDataUrl}" alt="QR koda" width="220" height="220" style="display:block;border-radius:16px;border:1px solid #e2f5f9;margin:0 auto;box-shadow:0 4px 18px rgba(0,0,0,.08)" />
              </td></tr>
              <tr><td style="text-align:center;padding:0 0 26px">
                <a class="btn" href="${redeemUrl}" target="_blank" rel="noopener">Odpri kodo / povezavo</a>
              </td></tr>
              <tr><td style="font-size:12px;color:#5b6b7b;padding:0 0 20px;text-align:center">Če QR ne deluje, klikni gumb ali kopiraj: <br><span style="word-break:break-all;color:#0bbbd6">${redeemUrl}</span></td></tr>
              <tr><td style="padding:0 0 12px"><span class="meta-label">Navodila</span></td></tr>
              <tr><td style="padding:0 0 8px">1. Sliko ali povezavo pokaži ponudniku ob prihodu.</td></tr>
              <tr><td style="padding:0 0 8px">2. Ne deli kode javno – vsebuje unikatni identifikator.</td></tr>
              <tr><td style="padding:0 0 16px">3. Hrani e-pošto za morebitno dokazilo o nakupu.</td></tr>
              <tr><td style="padding:0 0 16px;border-top:1px solid #e8eef3"></td></tr>
              <tr><td style="font-size:12px;color:#5b6b7b">Potrebujete pomoč? Pišite: <a href="mailto:${support}" style="color:#0bbbd6;text-decoration:none;font-weight:700">${support}</a></td></tr>
            </table>
          </td></tr>
        </table>
        <div style="font-size:11px;color:#6a7987;margin:0 12px 40px;max-width:600px;line-height:1.4">© ${new Date().getFullYear()} NearGo. Ta sporočila pošiljamo ob nakupu ali unovčitvi. Če mislite da je prišlo do napake, kontaktirajte podporo.</div>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function purchaseEmailText({ eventTitle, type, displayBenefit, redeemUrl }) {
  const label = type === 'coupon' ? 'Kupon' : 'Vstopnica';
  return `Potrditev – ${label}\n${eventTitle}\n${displayBenefit ? 'Ugodnost: ' + displayBenefit + '\n' : ''}Odpri / kopiraj povezavo: ${redeemUrl}\nNavodila: Pokaži kodo ponudniku. Ne deli javno.`;
}

module.exports = { purchaseEmail, purchaseEmailText };

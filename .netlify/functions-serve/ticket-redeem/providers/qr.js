// providers/qr.js
const QRCode = require("qrcode");

async function makeQr(data) {
  const pngBuffer = await QRCode.toBuffer(data, { type: "png", margin: 1, width: 512 });
  const base64 = pngBuffer.toString("base64");
  return { pngBuffer, base64DataUrl: `data:image/png;base64,${base64}`, base64 };
}

module.exports = { makeQr };

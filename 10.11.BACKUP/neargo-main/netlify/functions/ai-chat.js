// Nea AI chat proxy (placeholder)
exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }
  // Placeholder: just echo a limited reply
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reply: 'Trenutno sem omejena, vendar lahko filtriram rezultate …' })
  };
};

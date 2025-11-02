exports.handler = async function(event, context) {
  // Destroy session/cookie (implementation depends on auth system)
  return {
    statusCode: 200,
    body: JSON.stringify({ ok: true })
  };
};
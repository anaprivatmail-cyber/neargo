// netlify/functions/public-config.js (ESM)
// Returns small public configuration for the client, including premium price in cents

export const handler = async () => {
  try {
    // Keep same minimum guard as checkout function for consistency
    const cents = Math.max(100, Number(process.env.PREMIUM_PRICE_CENTS || 500));
    return {
      statusCode: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'access-control-allow-origin': '*',
      },
      body: JSON.stringify({ premiumPriceCents: cents })
    };
  } catch (e) {
    return {
      statusCode: 200,
      headers: { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*' },
      body: JSON.stringify({ premiumPriceCents: 500 })
    };
  }
};

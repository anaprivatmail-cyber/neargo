export async function handler(event, context) {
  return {
    statusCode: 200,
    body: JSON.stringify({
      message: "Ključ iz okolja:",
      value: process.env.TM_API_KEY // tu je ime tvojega environment variable
    })
  };
}

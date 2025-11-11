export const handler = async () => {
  return {
    statusCode: 200,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      has_BLOBS_SITE_ID: !!process.env.BLOBS_SITE_ID,
      has_BLOBS_TOKEN: !!process.env.BLOBS_TOKEN,
      siteID: process.env.BLOBS_SITE_ID || null
    })
  };
};

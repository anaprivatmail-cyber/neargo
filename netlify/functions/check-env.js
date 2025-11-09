// Small secure env probe: returns booleans only. Requires x-check-tables-token header.
export const handler = async (event) => {
  const expected = process.env.CHECK_TABLES_TOKEN || '';
  const got = event?.headers?.['x-check-tables-token'] || event?.headers?.['X-Check-Tables-Token'] || '';
  if (!expected || got !== expected) return { statusCode: 404, body: '' };
  const b = (v)=> String(v||'').toLowerCase();
  return {
    statusCode: 200,
    headers: { 'content-type': 'application/json', 'cache-control':'no-store' },
    body: JSON.stringify({
      has_SUPABASE_URL: !!process.env.SUPABASE_URL,
      has_SUPABASE_SERVICE_ROLE_KEY: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
      DIAGNOSTICS_ENABLED: b(process.env.DIAGNOSTICS_ENABLED),
      node: process.version
    })
  };
};
